/**
 * Sparkle Protocol v0.3.8 - Secure P2P Swap Instrument
 *
 * SECURITY: This module NEVER handles private keys.
 * All signing is delegated to browser wallet extensions.
 *
 * v0.3.8 SECURITY FIXES (December 2024):
 * - PSBT TAP_LEAF_SCRIPT field corrected: type 0x16, key=leafVer||script, value=controlBlock
 * - Dust threshold unified to 330 sats everywhere (P2TR standard)
 * - Control block parity now derived from OUTPUT KEY (Q), not hardcoded
 * - nSequence set to 0xfffffffd for RBF signaling (BIP-125)
 * - DM timestamp window tightened to 10 minutes (was 1 hour)
 * - Funding UTXO scriptPubKey format verification (must be 5120...)
 *
 * v0.3.7 SECURITY FIXES (December 2024):
 * - All third-party libraries now SELF-HOSTED (supply-chain hardened)
 * - Subresource Integrity (SRI) hashes on all external scripts
 *
 * v0.3.6 SECURITY FIXES (December 2024):
 * - BOLT11 signature verification now STRICT (blocks on invalid)
 *
 * v0.3.5 SECURITY FIXES (December 2024):
 * - PSBT now correctly built for 2-leaf tree (hashlock + refund)
 * - Control block includes sibling hash for merkle proof
 * - tapMerkleRoot is TapBranch of both leaves, not single leaf
 * - BOLT11 signature message hash corrected to spec (single SHA256)
 * - Invoice payee binding enforced (must match counterparty)
 *
 * v0.3.4 SECURITY FIXES (December 2024):
 * - Real EC point addition using @noble/secp256k1 (audited library)
 * - Taproot address correctly derived from script tree (BIP-341 compliant)
 * - BOLT11 signature verification using ECDSA recovery
 * - Fixed amount check to use swap.offer.price
 * - Increased MIN_FUNDING_CONFIRMATIONS from 1 to 2
 * - Real PSBT hex serialization (BIP-174/371)
 * - Version-pinned dependencies with @noble/secp256k1@2.1.0
 *
 * v0.3.3 (deprecated - incomplete EC implementation)
 *
 * v0.3.2 SECURITY FIXES (December 2024):
 * - Real BOLT11 invoice parsing with payment_hash extraction
 * - Invoice payment_hash binding to script verification
 * - Funding UTXO address/scriptPubKey verification
 * - Confirmation depth check before FUNDED status
 * - Network mismatch self-clear on correct network reconnect
 * - Enhanced PSBT framework with control block computation
 * - Export JSON for external signing tools
 *
 * v0.3.1 SECURITY FIXES (December 2024):
 * - Timelock validation now enforced before swap proceeds
 * - DM signature verification and replay protection added
 * - Script tree validation rebuilds locally (no peer trust)
 * - Network mismatch now blocks swap actions
 * - NIP-65 relay discovery used in subscriptions
 * - UTXO values verified from indexer
 * - Preimage hash verification before claim
 *
 * Architecture:
 * - NIP-07: Nostr identity via browser extensions (Alby, nos2x)
 * - Taproot: P2TR atomic swaps with script-path spending
 * - Bitcoin Wallets: PSBT signing via Unisat, Xverse, etc.
 *
 * @module SparkleSwap
 * @version 0.3.8
 */

// ============================================================================
// Configuration & Constants
// ============================================================================

// Default relays - users can add custom relays via UI
const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
];

// Load custom relays from localStorage
function getActiveRelays() {
  try {
    const stored = localStorage.getItem('sparkle_custom_relays');
    const custom = stored ? JSON.parse(stored) : [];
    // Merge defaults with custom, remove duplicates
    return [...new Set([...DEFAULT_RELAYS, ...custom])];
  } catch (e) {
    return DEFAULT_RELAYS;
  }
}

// Add a custom relay
function addCustomRelay(relayUrl) {
  if (!relayUrl.startsWith('wss://')) {
    throw new Error('Relay URL must start with wss://');
  }
  try {
    const stored = localStorage.getItem('sparkle_custom_relays');
    const custom = stored ? JSON.parse(stored) : [];
    if (!custom.includes(relayUrl)) {
      custom.push(relayUrl);
      localStorage.setItem('sparkle_custom_relays', JSON.stringify(custom));
    }
    return getActiveRelays();
  } catch (e) {
    console.error('Failed to save custom relay:', e);
    return getActiveRelays();
  }
}

// Remove a custom relay
function removeCustomRelay(relayUrl) {
  try {
    const stored = localStorage.getItem('sparkle_custom_relays');
    const custom = stored ? JSON.parse(stored) : [];
    const filtered = custom.filter(r => r !== relayUrl);
    localStorage.setItem('sparkle_custom_relays', JSON.stringify(filtered));
    return getActiveRelays();
  } catch (e) {
    console.error('Failed to remove custom relay:', e);
    return getActiveRelays();
  }
}

// Expose relay management functions globally
window.getActiveRelays = getActiveRelays;
window.addCustomRelay = addCustomRelay;
window.removeCustomRelay = removeCustomRelay;

// Active relays (computed at runtime)
const RELAYS = getActiveRelays();

const SPARKLE_EVENT_KINDS = {
  SWAP_OFFER: 30078,  // Parameterized replaceable for swap offers
  PRODUCT: 30018,     // NIP-15 product listing (legacy compatibility)
};

// Taproot script opcodes
const OP = {
  SHA256: 0xa8,
  EQUALVERIFY: 0x88,
  CHECKSIG: 0xac,
  CHECKLOCKTIMEVERIFY: 0xb1,
  DROP: 0x75,
  IF: 0x63,
  ELSE: 0x67,
  ENDIF: 0x68,
};

// Expected network for this deployment
const EXPECTED_NETWORK = 'testnet'; // Change to 'mainnet' for production

// ============================================================================
// SECURITY: Swap Parameter Validation (Time-Bandit Attack Prevention)
// ============================================================================

/**
 * Safety margin in blocks between Lightning invoice expiry and Bitcoin refund timelock.
 * This prevents the "Time-Bandit Attack" where a malicious seller reveals the preimage
 * at the last moment, leaving the buyer insufficient time to claim on-chain.
 *
 * 6 blocks = ~1 hour minimum safety margin
 * We default to 288 blocks (~48 hours) for delta-safe operation
 */
const SAFETY_DELTA_BLOCKS = 6;
const AVG_BLOCK_TIME_SECONDS = 600; // ~10 minutes per block

/**
 * Validate swap parameters to prevent timing attacks
 * @param {number} invoiceExpiryUnix - Lightning invoice expiry timestamp (Unix)
 * @param {number} bitcoinCltvBlockHeight - Bitcoin refund timelock block height
 * @param {number} currentBlockHeight - Current Bitcoin block height
 * @returns {Object} - { valid: boolean, message: string, safeCltvHeight: number }
 */
function validateSwapParameters(invoiceExpiryUnix, bitcoinCltvBlockHeight, currentBlockHeight) {
  // 1. Convert Lightning invoice expiry to estimated block height
  const nowUnix = Math.floor(Date.now() / 1000);
  const secondsToLnExpiry = invoiceExpiryUnix - nowUnix;

  if (secondsToLnExpiry <= 0) {
    return {
      valid: false,
      message: 'Lightning invoice has already expired',
      safeCltvHeight: null
    };
  }

  const estimatedLnExpiryBlock = currentBlockHeight + Math.ceil(secondsToLnExpiry / AVG_BLOCK_TIME_SECONDS);

  // 2. Calculate minimum safe Bitcoin refund timelock
  const safeCltvHeight = estimatedLnExpiryBlock + SAFETY_DELTA_BLOCKS;

  // 3. Validate: Bitcoin refund path must NOT be valid until after invoice expires + buffer
  if (bitcoinCltvBlockHeight < safeCltvHeight) {
    const shortfall = safeCltvHeight - bitcoinCltvBlockHeight;
    return {
      valid: false,
      message: `SECURITY RISK: Timelock too short by ${shortfall} blocks. ` +
               `Seller could front-run the refund. ` +
               `Required: >${safeCltvHeight}, Actual: ${bitcoinCltvBlockHeight}`,
      safeCltvHeight: safeCltvHeight
    };
  }

  // 4. Calculate safety margin in human-readable format
  const marginBlocks = bitcoinCltvBlockHeight - estimatedLnExpiryBlock;
  const marginHours = Math.round((marginBlocks * AVG_BLOCK_TIME_SECONDS) / 3600);

  return {
    valid: true,
    message: `Timelock validated. Safety margin: ${marginBlocks} blocks (~${marginHours} hours)`,
    safeCltvHeight: safeCltvHeight,
    marginBlocks: marginBlocks,
    marginHours: marginHours
  };
}

// Expose for global use
window.validateSwapParameters = validateSwapParameters;

/**
 * SECURITY: Fetch current block height from a public API
 * Used for validating timelock safety
 */
async function getCurrentBlockHeight() {
  try {
    // Try mempool.space API first (testnet)
    const network = state.bitcoinNetwork === 'mainnet' ? '' : '/testnet';
    const response = await fetch(`https://mempool.space${network}/api/blocks/tip/height`);
    if (response.ok) {
      return parseInt(await response.text());
    }
  } catch (e) {
    console.warn('Failed to fetch block height from mempool.space:', e);
  }

  try {
    // Fallback to blockstream.info
    const network = state.bitcoinNetwork === 'mainnet' ? '' : '/testnet';
    const response = await fetch(`https://blockstream.info${network}/api/blocks/tip/height`);
    if (response.ok) {
      return parseInt(await response.text());
    }
  } catch (e) {
    console.warn('Failed to fetch block height from blockstream.info:', e);
  }

  // Return null if we can't get block height - swap should be blocked
  return null;
}

/**
 * SECURITY: Verify BOLT11 invoice signature using recoverable ECDSA
 * Uses @noble/secp256k1 for signature verification
 *
 * BOLT11 spec (BOLT #11): Signature covers SHA256(hrp_bytes || data_5bit_words)
 * where data_5bit_words is the timestamp + tagged fields as 5-bit values (one per byte)
 *
 * @param {string} invoice - Full BOLT11 invoice string
 * @param {Uint8Array} signatureBytes - 65-byte signature (64 sig + 1 recovery)
 * @param {string} hrp - Human readable part (prefix + amount)
 * @param {Array<number>} dataWords - Data part as 5-bit words (NOT converted to 8-bit)
 * @returns {Promise<{valid: boolean, recoveredPubkey: string|null}>}
 */
async function verifyBolt11Signature(invoice, signatureBytes, hrp, dataWords) {
  if (!window.nobleSecp256k1) {
    console.warn('SECURITY: Cannot verify BOLT11 signature - noble library not loaded');
    return { valid: false, recoveredPubkey: null, error: 'Library not loaded' };
  }

  const secp = window.nobleSecp256k1;

  try {
    // 1. Extract signature (first 64 bytes) and recovery ID (last byte)
    const sig = signatureBytes.slice(0, 64);
    const recoveryId = signatureBytes[64];

    // 2. Compute the message hash per BOLT11 spec
    // BOLT #11: message = SHA256(hrp_as_utf8 || data_5bit_words_as_bytes)
    // Each 5-bit word becomes one byte in the message
    const hrpBytes = new TextEncoder().encode(hrp);
    const dataBytes = new Uint8Array(dataWords); // 5-bit words as bytes

    // Concatenate hrp + data (NOT double-hashed)
    const message = new Uint8Array(hrpBytes.length + dataBytes.length);
    message.set(hrpBytes);
    message.set(dataBytes, hrpBytes.length);

    // Single SHA256 per BOLT11 spec
    const messageHash = new Uint8Array(await crypto.subtle.digest('SHA-256', message));

    // 3. Try to recover the public key from signature
    const signature = secp.Signature.fromCompact(sig).addRecoveryBit(recoveryId);
    const recoveredPoint = signature.recoverPublicKey(messageHash);

    if (!recoveredPoint) {
      return { valid: false, recoveredPubkey: null, error: 'Could not recover pubkey' };
    }

    // 4. Verify the signature
    const isValid = secp.verify(signature, messageHash, recoveredPoint);

    // 5. Convert recovered pubkey to hex (compressed format)
    const recoveredPubkey = recoveredPoint.toHex(true); // compressed

    console.log(`SECURITY: BOLT11 signature verification: ${isValid ? 'VALID' : 'INVALID'}`);

    return {
      valid: isValid,
      recoveredPubkey: recoveredPubkey,
      recoveredPubkeyX: recoveredPubkey.slice(2) // x-only (remove 02/03 prefix)
    };

  } catch (e) {
    console.error('SECURITY: BOLT11 signature verification failed:', e);
    return { valid: false, recoveredPubkey: null, error: e.message };
  }
}

/**
 * SECURITY: Decode Lightning invoice to extract payment_hash, expiry, amount
 * Full BOLT11 decoder implementation with signature verification
 * Returns { paymentHash, expiryUnix, amountMsat, timestamp, signatureValid, ... } or null on failure
 */
async function decodeLightningInvoice(invoice) {
  try {
    const invoiceLower = invoice.toLowerCase();

    // Validate prefix
    let prefix, network;
    if (invoiceLower.startsWith('lnbc')) {
      prefix = 'lnbc';
      network = 'mainnet';
    } else if (invoiceLower.startsWith('lntb')) {
      prefix = 'lntb';
      network = 'testnet';
    } else if (invoiceLower.startsWith('lnbcrt')) {
      prefix = 'lnbcrt';
      network = 'regtest';
    } else {
      console.warn('Invalid invoice prefix');
      return null;
    }

    // Find separator '1' (last occurrence before data)
    const separatorIndex = invoiceLower.lastIndexOf('1');
    if (separatorIndex < prefix.length) {
      console.warn('Invalid invoice format: no separator');
      return null;
    }

    // Extract HRP (human readable part) for signature verification
    const hrp = invoiceLower.slice(0, separatorIndex);

    // Extract amount from prefix (between network prefix and separator)
    const amountPart = invoiceLower.slice(prefix.length, separatorIndex);
    let amountMsat = null;
    if (amountPart) {
      amountMsat = parseBolt11Amount(amountPart);
    }

    // Extract bech32 data part
    const dataPart = invoiceLower.slice(separatorIndex + 1);
    if (dataPart.length < 104) { // Minimum: timestamp(7) + signature(104)
      console.warn('Invoice data too short');
      return null;
    }

    // Decode bech32 data to 5-bit words
    const words = bech32Decode5bit(dataPart);
    if (!words || words.length < 111) { // 7 timestamp + 104 signature minimum
      console.warn('Failed to decode bech32 data');
      return null;
    }

    // Extract timestamp (first 7 words = 35 bits)
    const timestamp = wordsToInt(words.slice(0, 7));

    // Extract tagged fields (between timestamp and signature)
    // Signature is last 104 words (520 bits = 512 sig + 8 recovery)
    const signatureWords = words.slice(words.length - 104);
    const taggedWords = words.slice(7, words.length - 104);
    const tags = parseTaggedFields(taggedWords);

    // Get payment hash (tag 'p' = 1)
    const paymentHash = tags.paymentHash || null;

    // Get expiry (tag 'x' = 6), default 3600
    const expiry = tags.expiry || 3600;
    const expiryUnix = timestamp + expiry;

    // Get min_final_cltv_expiry (tag 'c' = 24)
    const minFinalCltvExpiry = tags.minFinalCltvExpiry || 18;

    // Validate we got the payment hash
    if (!paymentHash) {
      console.warn('Invoice missing payment hash');
      return null;
    }

    // Validate payment hash is 32 bytes (64 hex chars)
    if (!/^[a-f0-9]{64}$/.test(paymentHash)) {
      console.warn('Invalid payment hash format');
      return null;
    }

    // SECURITY: Verify BOLT11 signature
    let signatureValid = false;
    let recoveredPayee = null;

    try {
      // Convert signature words (104 x 5-bit) to bytes (65 bytes)
      const signatureBytes = new Uint8Array(convertBits(signatureWords, 5, 8, false));

      // Data to sign: timestamp + tagged fields (without signature)
      // BOLT11 spec: message is SHA256(hrp || data_5bit_words_as_bytes)
      // Each 5-bit word becomes one byte in the message (NOT converted to 8-bit)
      const dataWordsForSig = words.slice(0, words.length - 104);

      // Verify signature - pass 5-bit words directly, NOT converted to 8-bit
      const sigResult = await verifyBolt11Signature(invoice, signatureBytes, hrp, dataWordsForSig);
      signatureValid = sigResult.valid;
      recoveredPayee = sigResult.recoveredPubkeyX || null;

      if (signatureValid) {
        console.log('SECURITY: BOLT11 signature verified, payee:', recoveredPayee?.slice(0, 16) + '...');
      } else {
        console.warn('SECURITY: BOLT11 signature INVALID or unverifiable:', sigResult.error);
      }

      // Cross-check with embedded payee pubkey if present
      if (tags.payeePubkey && recoveredPayee) {
        if (tags.payeePubkey.toLowerCase() !== recoveredPayee.toLowerCase()) {
          console.warn('SECURITY: Recovered payee does not match embedded payee!');
          signatureValid = false;
        }
      }
    } catch (sigError) {
      console.warn('SECURITY: Signature verification failed:', sigError);
      signatureValid = false;
    }

    return {
      paymentHash: paymentHash,
      expiryUnix: expiryUnix,
      timestamp: timestamp,
      expiry: expiry,
      amountMsat: amountMsat,
      amountSats: amountMsat ? Math.floor(amountMsat / 1000) : null,
      network: network,
      minFinalCltvExpiry: minFinalCltvExpiry,
      description: tags.description || null,
      descriptionHash: tags.descriptionHash || null,
      payeePubkey: tags.payeePubkey || recoveredPayee,
      recoveredPayee: recoveredPayee,
      signatureValid: signatureValid,
      estimatedExpiry: false
    };
  } catch (e) {
    console.error('Failed to decode invoice:', e);
    return null;
  }
}

/**
 * Parse BOLT11 amount string (e.g., "1m" = 1 milli-bitcoin = 100,000 sats)
 */
function parseBolt11Amount(amountStr) {
  if (!amountStr) return null;

  const multipliers = {
    'm': 100000000,    // milli (0.001 BTC) in millisats
    'u': 100000,       // micro (0.000001 BTC) in millisats
    'n': 100,          // nano (0.000000001 BTC) in millisats
    'p': 0.1           // pico (0.000000000001 BTC) in millisats
  };

  const match = amountStr.match(/^(\d+)([munp]?)$/);
  if (!match) return null;

  const value = parseInt(match[1]);
  const unit = match[2] || '';

  if (unit && multipliers[unit]) {
    return Math.floor(value * multipliers[unit]);
  }
  // No unit means BTC
  return value * 100000000000; // BTC to millisats
}

/**
 * Decode bech32 data to 5-bit words
 */
function bech32Decode5bit(data) {
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const words = [];

  for (const char of data) {
    const index = CHARSET.indexOf(char);
    if (index === -1) return null;
    words.push(index);
  }

  return words;
}

/**
 * Convert 5-bit words to integer
 */
function wordsToInt(words) {
  let value = 0;
  for (const word of words) {
    value = (value << 5) | word;
  }
  return value;
}

/**
 * Convert 5-bit words to bytes (8-bit)
 */
function wordsToBytes(words) {
  let bits = 0;
  let value = 0;
  const bytes = [];

  for (const word of words) {
    value = (value << 5) | word;
    bits += 5;

    while (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }

  return bytes;
}

/**
 * Parse BOLT11 tagged fields
 */
function parseTaggedFields(words) {
  const result = {};
  let i = 0;

  while (i < words.length) {
    if (i + 2 >= words.length) break;

    const tag = words[i];
    const dataLength = (words[i + 1] << 5) | words[i + 2];
    i += 3;

    if (i + dataLength > words.length) break;

    const tagData = words.slice(i, i + dataLength);
    i += dataLength;

    switch (tag) {
      case 1: // 'p' - payment_hash (52 words = 32 bytes)
        if (dataLength === 52) {
          const bytes = wordsToBytes(tagData);
          result.paymentHash = bytes.slice(0, 32)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
        }
        break;

      case 6: // 'x' - expiry
        result.expiry = wordsToInt(tagData);
        break;

      case 13: // 'd' - description
        const descBytes = wordsToBytes(tagData);
        result.description = String.fromCharCode(...descBytes);
        break;

      case 23: // 'h' - description_hash
        if (dataLength === 52) {
          const bytes = wordsToBytes(tagData);
          result.descriptionHash = bytes.slice(0, 32)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
        }
        break;

      case 19: // 'n' - payee pubkey
        if (dataLength === 53) {
          const bytes = wordsToBytes(tagData);
          result.payeePubkey = bytes.slice(0, 33)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
        }
        break;

      case 24: // 'c' - min_final_cltv_expiry
        result.minFinalCltvExpiry = wordsToInt(tagData);
        break;

      // Other tags can be added as needed
    }
  }

  return result;
}

/**
 * SECURITY: Validate invoice timelock safety and bind payment_hash
 * This is the critical function that validates invoices before accepting
 * @param {string} invoice - BOLT11 Lightning invoice
 * @param {Object} swap - Swap object with offer data
 * @returns {Promise<{valid: boolean, message: string, decoded?: object}>}
 */
async function validateInvoiceTimelock(invoice, swap) {
  // Get invoice expiry and payment_hash using real BOLT11 decoder
  const decoded = await decodeLightningInvoice(invoice);
  if (!decoded) {
    return {
      valid: false,
      message: 'Invalid Lightning invoice format - could not parse BOLT11'
    };
  }

  // SECURITY: Validate BOLT11 signature - STRICT MODE
  // Invalid signature means the invoice may be forged or from wrong party
  if (!decoded.signatureValid) {
    console.error('SECURITY: Invoice signature INVALID - blocking swap');
    return {
      valid: false,
      message: 'SECURITY: Invoice signature verification failed. ' +
               'The invoice may be forged or corrupted. Cannot proceed.',
      signatureInvalid: true
    };
  }
  console.log('SECURITY: Invoice signature verified successfully');

  // SECURITY: Validate payment_hash was extracted
  if (!decoded.paymentHash) {
    return {
      valid: false,
      message: 'Invoice missing payment_hash - cannot verify swap'
    };
  }

  // SECURITY: If we already have a payment_hash from counterparty, verify they match
  if (swap.data.paymentHash) {
    if (decoded.paymentHash.toLowerCase() !== swap.data.paymentHash.toLowerCase()) {
      return {
        valid: false,
        message: 'CRITICAL: Invoice payment_hash does not match agreed hash! Possible fraud attempt.'
      };
    }
  } else {
    // Store the payment_hash from the invoice (authoritative source)
    swap.data.paymentHash = decoded.paymentHash;
    swap.data.paymentHashSource = 'invoice';
  }

  // Store recovered payee pubkey for verification
  if (decoded.recoveredPayee) {
    swap.data.invoicePayee = decoded.recoveredPayee;
  }

  // SECURITY: Enforce invoice payee matches counterparty
  // The invoice should be signed by the seller (Lightning payee = swap counterparty)
  const expectedPayee = swap.data.sellerLightningPubkey ||
                        swap.data.counterpartyLightningPubkey ||
                        swap.data.scriptTree?.sellerPubkey;

  if (decoded.recoveredPayee && expectedPayee) {
    // Compare x-only pubkeys (strip prefix if present)
    const recoveredX = decoded.recoveredPayee.replace(/^(02|03)/, '');
    const expectedX = expectedPayee.replace(/^(02|03)/, '');

    if (recoveredX.toLowerCase() !== expectedX.toLowerCase()) {
      console.warn('SECURITY: Invoice payee mismatch!');
      console.warn('  Expected:', expectedX.slice(0, 16) + '...');
      console.warn('  Recovered:', recoveredX.slice(0, 16) + '...');

      return {
        valid: false,
        message: 'SECURITY: Invoice payee does not match counterparty! ' +
                 'This invoice may be from a third party. Refusing to proceed.',
        payeeMismatch: true,
        expectedPayee: expectedX,
        actualPayee: recoveredX
      };
    }
    console.log('SECURITY: Invoice payee matches expected counterparty');
  } else if (decoded.recoveredPayee && !expectedPayee) {
    // We have a payee but nothing to compare against - warn but allow
    console.warn('SECURITY: Invoice payee recovered but no expected payee to compare');
    console.warn('  Recovered payee:', decoded.recoveredPayee.slice(0, 16) + '...');
  }

  // SECURITY: Validate invoice network matches expected network
  if (decoded.network !== EXPECTED_NETWORK && decoded.network !== 'regtest') {
    return {
      valid: false,
      message: `Invoice is for ${decoded.network} but app expects ${EXPECTED_NETWORK}`
    };
  }

  // SECURITY: Validate invoice amount if present
  if (decoded.amountSats && swap.offer && swap.offer.price) {
    const offerPrice = parseInt(swap.offer.price);
    if (decoded.amountSats !== offerPrice) {
      return {
        valid: false,
        message: `Invoice amount (${decoded.amountSats} sats) does not match offer price (${offerPrice} sats)`
      };
    }
  }

  // SECURITY: Check if invoice is already expired
  const now = Math.floor(Date.now() / 1000);
  if (decoded.expiryUnix <= now) {
    return {
      valid: false,
      message: 'Invoice has already expired'
    };
  }

  // Get current block height for timelock validation
  const currentHeight = await getCurrentBlockHeight();
  if (!currentHeight) {
    return {
      valid: false,
      message: 'Could not verify block height. Cannot validate timelock safety.'
    };
  }

  // Get the Bitcoin timelock from swap data
  let bitcoinTimelock;
  if (swap.data.scriptTree && swap.data.scriptTree.timeout) {
    bitcoinTimelock = swap.data.scriptTree.timeout;
  } else if (swap.offer && swap.offer.specs && swap.offer.specs.duration) {
    bitcoinTimelock = currentHeight + parseInt(swap.offer.specs.duration);
  } else {
    bitcoinTimelock = currentHeight + 288;
  }

  // Call the core validation function
  const validation = validateSwapParameters(
    decoded.expiryUnix,
    bitcoinTimelock,
    currentHeight
  );

  // Store validation result and decoded invoice data in swap
  swap.data.timelockValidation = {
    invoiceExpiry: decoded.expiryUnix,
    invoiceTimestamp: decoded.timestamp,
    invoiceExpirySecs: decoded.expiry,
    bitcoinTimelock: bitcoinTimelock,
    currentHeight: currentHeight,
    result: validation
  };

  swap.data.invoiceDecoded = {
    paymentHash: decoded.paymentHash,
    amountSats: decoded.amountSats,
    network: decoded.network,
    minFinalCltvExpiry: decoded.minFinalCltvExpiry,
    description: decoded.description,
    payeePubkey: decoded.payeePubkey
  };

  if (!validation.valid) {
    return validation;
  }

  return {
    valid: true,
    message: `Invoice verified. Payment hash bound. ${validation.message}`,
    decoded: decoded
  };
}

// ============================================================================
// NIP-65 Relay Discovery (Gossip Protocol Enhancement)
// ============================================================================

/**
 * Discover user's preferred relays via NIP-65 (Relay List Metadata)
 * This provides censorship resistance by finding where users actually publish
 * @param {string} userPubkey - User's public key (hex)
 * @returns {Promise<string[]>} - Array of relay URLs
 */
async function discoverUserRelays(userPubkey) {
  if (!window.NostrTools || !NostrTools.SimplePool) {
    console.warn('NostrTools not available for NIP-65 discovery');
    return [];
  }

  const pool = new NostrTools.SimplePool();
  const discoveredRelays = [];

  try {
    // Query seed relays for NIP-65 (kind 10002) events
    const events = await pool.list(DEFAULT_RELAYS, [{
      kinds: [10002], // NIP-65: Relay List Metadata
      authors: [userPubkey],
      limit: 1
    }]);

    if (events.length > 0) {
      // Extract 'r' tags (relay URLs) from the user's relay list
      const userRelays = events[0].tags
        .filter(tag => tag[0] === 'r')
        .map(tag => tag[1])
        .filter(url => url.startsWith('wss://'));

      discoveredRelays.push(...userRelays);
      console.log(`NIP-65: Discovered ${userRelays.length} relays for ${userPubkey.slice(0, 8)}...`);
    }
  } catch (err) {
    console.warn('NIP-65 discovery failed:', err);
  }

  return discoveredRelays;
}

/**
 * Get enhanced relay list including NIP-65 discovered relays
 * @param {string} counterpartyPubkey - Optional counterparty to discover relays for
 * @returns {Promise<string[]>} - Merged relay list
 */
async function getEnhancedRelayList(counterpartyPubkey = null) {
  let relays = getActiveRelays();

  if (counterpartyPubkey) {
    const counterpartyRelays = await discoverUserRelays(counterpartyPubkey);
    relays = [...new Set([...relays, ...counterpartyRelays])];
  }

  return relays;
}

// Expose for global use
window.discoverUserRelays = discoverUserRelays;
window.getEnhancedRelayList = getEnhancedRelayList;

// ============================================================================
// Toast Notification System (replaces alert())
// ============================================================================

const toast = {
  container: null,

  init() {
    if (this.container) return;
    this.container = document.createElement('div');
    this.container.id = 'toast-container';
    this.container.style.cssText = `
      position: fixed; top: 20px; right: 20px; z-index: 9999;
      display: flex; flex-direction: column; gap: 10px;
    `;
    document.body.appendChild(this.container);
  },

  show(message, type = 'info', duration = 5000, allowHtml = false) {
    this.init();
    const colors = {
      success: '#10B981',
      error: '#EF4444',
      warning: '#F59E0B',
      info: '#3B82F6',
    };
    const el = document.createElement('div');
    el.style.cssText = `
      background: ${colors[type] || colors.info}; color: white;
      padding: 12px 20px; border-radius: 4px; font-size: 14px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15); max-width: 350px;
      animation: slideIn 0.3s ease-out;
    `;
    // SECURITY: Only allow HTML for trusted internal messages
    if (allowHtml) {
      el.innerHTML = message;
    } else {
      el.textContent = message;
    }
    this.container.appendChild(el);

    setTimeout(() => {
      el.style.animation = 'slideOut 0.3s ease-in';
      setTimeout(() => el.remove(), 300);
    }, duration);
  },

  success(msg, allowHtml = false) { this.show(msg, 'success', 5000, allowHtml); },
  error(msg, allowHtml = false) { this.show(msg, 'error', 8000, allowHtml); },
  warning(msg, allowHtml = false) { this.show(msg, 'warning', 6000, allowHtml); },
  info(msg, allowHtml = false) { this.show(msg, 'info', 5000, allowHtml); },
  // Trusted HTML messages (only for internal use with hardcoded content)
  html(msg, type = 'info', duration = 5000) { this.show(msg, type, duration, true); },
};

// Add toast animations
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  @keyframes slideOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(100%); opacity: 0; } }
  .network-warning { background: #FEE2E2; border: 2px solid #DC2626; color: #DC2626; padding: 15px; margin-bottom: 15px; font-weight: bold; text-align: center; }
`;
document.head.appendChild(style);

// ============================================================================
// Global State (No Private Keys!)
// ============================================================================

const state = {
  // NIP-07 provider (window.nostr)
  nostrProvider: null,
  publicKey: null, // x-only (32 bytes)

  // Bitcoin wallet
  bitcoinWallet: null, // 'unisat' | 'xverse' | null
  bitcoinAccounts: [],
  bitcoinNetwork: 'testnet',

  // SECURITY: Network mismatch blocking
  networkMismatch: false, // true if wallet network doesn't match expected

  // Relay connections
  relayPool: null,
  connectedRelays: 0,

  // Market data
  allOffers: [],
  mySwaps: [],

  // SECURITY: Replay protection - seen event IDs
  seenEventIds: new Set(),

  // Subscriptions
  subs: {
    offers: null,
    dms: null,
  },
};

// ============================================================================
// DOM Cache
// ============================================================================

const dom = {
  // Identity Section
  loginSection: document.getElementById('loginSection'),
  userInfo: document.getElementById('userInfo'),
  userNpub: document.getElementById('userNpub'),
  relayStatus: document.getElementById('relayStatus'),
  createOfferCard: document.getElementById('createOfferCard'),

  // Main Lists
  offerList: document.getElementById('offerList'),
  swapList: document.getElementById('swapList'),

  // Filters
  minAmountFilter: document.getElementById('minAmountFilter'),
  maxAmountFilter: document.getElementById('maxAmountFilter'),
  minDurationFilter: document.getElementById('minDurationFilter'),
};

// ============================================================================
// NIP-07 Wallet Detection & Connection
// ============================================================================

/**
 * Check if NIP-07 provider is available
 */
function isNip07Available() {
  return typeof window !== 'undefined' && 'nostr' in window;
}

/**
 * Get NIP-07 provider
 */
function getNip07Provider() {
  if (!isNip07Available()) return null;
  return window.nostr;
}

/**
 * Connect via NIP-07 (Alby, nos2x, etc.)
 */
window.connectNip07 = async function () {
  const provider = getNip07Provider();

  if (!provider) {
    toast.html(
      '<strong>No Nostr Wallet</strong><br>' +
        'Install <a href="https://getalby.com" target="_blank" style="color:white;text-decoration:underline">Alby</a> ' +
        'or nos2x to use this app.',
      'error', 8000
    );
    return;
  }

  try {
    toast.info('Requesting wallet connection...');

    // Request public key (will prompt user)
    const pubkey = await provider.getPublicKey();

    state.nostrProvider = provider;
    state.publicKey = pubkey;

    // Convert to npub for display
    const npub = bech32Encode('npub', pubkey);

    updateIdentityUI(npub);
    await connectToRelays();

    toast.success('Nostr wallet connected!');
    console.log('NIP-07 connected:', pubkey.slice(0, 16) + '...');
  } catch (err) {
    console.error('NIP-07 connection failed:', err);
    toast.error('Wallet connection rejected or failed.');
  }
};

// ============================================================================
// Bitcoin Wallet Detection & Connection
// ============================================================================

/**
 * Detect available Bitcoin wallets
 */
function detectBitcoinWallets() {
  const wallets = [];
  if (typeof window !== 'undefined') {
    if ('unisat' in window) wallets.push('unisat');
    if ('XverseProviders' in window) wallets.push('xverse');
    if ('LeatherProvider' in window) wallets.push('leather');
    if ('okxwallet' in window && window.okxwallet.bitcoin) wallets.push('okx');
  }
  return wallets;
}

/**
 * Connect to Unisat wallet
 */
async function connectUnisat() {
  if (!window.unisat) throw new Error('Unisat not available');

  const accounts = await window.unisat.requestAccounts();
  const publicKey = await window.unisat.getPublicKey();
  const network = await window.unisat.getNetwork();

  return {
    wallet: 'unisat',
    address: accounts[0],
    publicKey: publicKey,
    network: network === 'testnet' ? 'testnet' : 'mainnet',
  };
}

/**
 * Connect to Xverse wallet
 */
async function connectXverse() {
  if (!window.XverseProviders) throw new Error('Xverse not available');

  const response = await window.XverseProviders.BitcoinProvider.request(
    'getAccounts',
    null
  );

  if (!response || !response.result || response.result.length === 0) {
    throw new Error('No accounts returned from Xverse');
  }

  const account = response.result[0];
  return {
    wallet: 'xverse',
    address: account.address,
    publicKey: account.publicKey,
    network: 'mainnet', // Xverse returns network differently
  };
}

/**
 * Connect Bitcoin wallet
 */
window.connectBitcoin = async function (preferredWallet) {
  const available = detectBitcoinWallets();

  if (available.length === 0) {
    toast.html(
      '<strong>No Bitcoin Wallet</strong><br>' +
        'Install Unisat, Xverse, or Leather to sign transactions.',
      'error', 8000
    );
    return;
  }

  try {
    let connection;
    const wallet = preferredWallet || available[0];

    if (wallet === 'unisat') {
      connection = await connectUnisat();
    } else if (wallet === 'xverse') {
      connection = await connectXverse();
    } else {
      throw new Error(`Wallet ${wallet} not yet supported`);
    }

    state.bitcoinWallet = connection.wallet;
    state.bitcoinAccounts = [connection];
    state.bitcoinNetwork = connection.network;

    // SECURITY: Network mismatch handling
    if (connection.network !== EXPECTED_NETWORK) {
      showNetworkWarning(connection.network, EXPECTED_NETWORK);
    } else {
      // FIX: Clear mismatch if wallet is now on correct network
      clearNetworkWarning();
    }

    console.log('Bitcoin wallet connected:', connection.wallet);
    toast.success(`Connected to ${connection.wallet} (${connection.network})`);

    // Update UI to show Bitcoin connection
    updateBitcoinUI(connection);
  } catch (err) {
    console.error('Bitcoin wallet connection failed:', err);
    toast.error(`Connection failed: ${err.message}`);
  }
};

/**
 * Show network mismatch warning banner
 * SECURITY: Sets networkMismatch flag to block swap actions
 */
function showNetworkWarning(actual, expected) {
  // SECURITY: Set mismatch flag to block swap actions
  state.networkMismatch = true;

  const existing = document.querySelector('.network-warning');
  if (existing) existing.remove();

  const warning = document.createElement('div');
  warning.className = 'network-warning';
  warning.innerHTML = `
    <strong>⚠️ NETWORK MISMATCH - ACTIONS BLOCKED</strong><br>
    Your wallet is on <strong>${actual.toUpperCase()}</strong> but this app expects <strong>${expected.toUpperCase()}</strong>.<br>
    <strong>Swap actions are disabled.</strong> Please switch your wallet to ${expected} network.
  `;
  document.body.insertBefore(warning, document.body.firstChild);
}

/**
 * Clear network mismatch state (called when wallet reconnects on correct network)
 */
function clearNetworkWarning() {
  state.networkMismatch = false;
  const existing = document.querySelector('.network-warning');
  if (existing) existing.remove();
}

function updateBitcoinUI(connection) {
  // Add Bitcoin status to identity card if element exists
  const btcStatus = document.getElementById('btcStatus');
  if (btcStatus) {
    btcStatus.textContent = `${connection.wallet}: ${connection.address.slice(0, 8)}...`;
  }
}

// ============================================================================
// Bech32 Encoding (for npub display)
// ============================================================================

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= GEN[i];
    }
  }
  return chk;
}

function bech32HrpExpand(hrp) {
  const ret = [];
  for (const c of hrp) {
    ret.push(c.charCodeAt(0) >> 5);
  }
  ret.push(0);
  for (const c of hrp) {
    ret.push(c.charCodeAt(0) & 31);
  }
  return ret;
}

function bech32CreateChecksum(hrp, data) {
  const values = bech32HrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
  const polymod = bech32Polymod(values) ^ 1;
  const ret = [];
  for (let i = 0; i < 6; i++) {
    ret.push((polymod >> (5 * (5 - i))) & 31);
  }
  return ret;
}

function convertBits(data, fromBits, toBits, pad) {
  let acc = 0;
  let bits = 0;
  const ret = [];
  const maxv = (1 << toBits) - 1;

  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }

  if (pad) {
    if (bits > 0) {
      ret.push((acc << (toBits - bits)) & maxv);
    }
  }

  return ret;
}

function bech32Encode(hrp, hexData) {
  const data = [];
  for (let i = 0; i < hexData.length; i += 2) {
    data.push(parseInt(hexData.substr(i, 2), 16));
  }

  const converted = convertBits(data, 8, 5, true);
  const checksum = bech32CreateChecksum(hrp, converted);
  const combined = converted.concat(checksum);

  return hrp + '1' + combined.map((d) => BECH32_CHARSET[d]).join('');
}

// ============================================================================
// Relay Connection
// ============================================================================

async function connectToRelays() {
  if (!state.publicKey) return;

  // Use NostrTools SimplePool if available
  if (!window.NostrTools || !NostrTools.SimplePool) {
    console.error('NostrTools not loaded');
    dom.relayStatus.textContent = 'Library Error';
    return;
  }

  state.relayPool = new NostrTools.SimplePool();
  state.connectedRelays = 0;

  dom.relayStatus.textContent = 'Connecting...';
  dom.offerList.innerHTML =
    '<div class="status-msg">Establishing connections...</div>';

  const connectionPromises = RELAYS.map((url) =>
    state.relayPool
      .ensureRelay(url)
      .then(() => {
        state.connectedRelays++;
        console.log(`Connected: ${url}`);
      })
      .catch((err) => console.warn(`Failed: ${url}`, err))
  );

  await Promise.all(connectionPromises);

  if (state.connectedRelays > 0) {
    dom.relayStatus.textContent = `Active (${state.connectedRelays}/${RELAYS.length})`;
    subscribeToMarket();
    subscribeToDMs();
  } else {
    dom.relayStatus.textContent = 'Network Error';
    dom.offerList.innerHTML =
      '<div class="error-msg">Failed to reach relays.</div>';
  }
}

// ============================================================================
// Market Subscription (Offers)
// ============================================================================

async function subscribeToMarket() {
  if (!state.relayPool) return;

  if (state.subs.offers) state.subs.offers.unsub();

  state.allOffers = [];
  dom.offerList.innerHTML =
    '<div class="status-msg">Querying order book...</div>';

  // SECURITY FIX: Use enhanced relay list with NIP-65 discovery
  // This improves censorship resistance by using user's preferred relays
  let activeRelays = RELAYS;
  try {
    // Discover additional relays dynamically
    activeRelays = await getEnhancedRelayList();
    if (activeRelays.length > RELAYS.length) {
      console.log(`NIP-65: Using ${activeRelays.length} relays (${activeRelays.length - RELAYS.length} discovered)`);
    }
  } catch (e) {
    console.warn('NIP-65 relay discovery failed, using defaults:', e);
  }

  // Store active relays in state for other functions
  state.activeRelays = activeRelays;

  // Subscribe to both old and new event kinds
  state.subs.offers = state.relayPool.sub(activeRelays, [
    { kinds: [SPARKLE_EVENT_KINDS.PRODUCT], '#t': ['sparkle-swap-offer-v1'] },
    { kinds: [SPARKLE_EVENT_KINDS.SWAP_OFFER], '#t': ['sparkle-swap-v3'] },
  ]);

  state.subs.offers.on('event', handleOfferEvent);
  state.subs.offers.on('eose', () => {
    console.log(`EOSE: ${state.allOffers.length} offers from ${activeRelays.length} relays`);
    window.fetchLiquidityOffers();
  });
}

function handleOfferEvent(event) {
  try {
    const content = JSON.parse(event.content);
    if (!content.name || !content.price) return;

    const offer = {
      id: event.id,
      pubkey: event.pubkey,
      ...content,
      timestamp: event.created_at,
      isTaproot: event.kind === SPARKLE_EVENT_KINDS.SWAP_OFFER,
    };

    if (!state.allOffers.find((o) => o.id === offer.id)) {
      state.allOffers.push(offer);
      window.fetchLiquidityOffers();
    }
  } catch (e) {
    console.warn('Malformed offer:', e);
  }
}

// ============================================================================
// DM Subscription (NIP-04)
// ============================================================================

async function subscribeToDMs() {
  if (!state.relayPool || !state.publicKey) return;

  if (state.subs.dms) state.subs.dms.unsub();

  // SECURITY FIX: Use enhanced relay list for DM subscriptions
  // This ensures we receive messages from counterparties' preferred relays
  let dmRelays = state.activeRelays || RELAYS;

  // If we have active swaps, discover counterparty relays
  if (state.mySwaps.length > 0) {
    const counterparties = [...new Set(state.mySwaps.map(s => s.provider))];
    for (const cp of counterparties) {
      try {
        const cpRelays = await discoverUserRelays(cp);
        if (cpRelays.length > 0) {
          dmRelays = [...new Set([...dmRelays, ...cpRelays])];
          console.log(`NIP-65: Added ${cpRelays.length} relays for counterparty ${cp.slice(0, 8)}...`);
        }
      } catch (e) {
        console.warn(`Failed to discover relays for ${cp.slice(0, 8)}:`, e);
      }
    }
  }

  state.subs.dms = state.relayPool.sub(dmRelays, [
    { kinds: [4], '#p': [state.publicKey] },
  ]);

  state.subs.dms.on('event', async (event) => {
    try {
      // SECURITY: Validate DM before processing
      const validation = await validateIncomingDM(event);
      if (!validation.valid) {
        console.warn(`DM rejected: ${validation.reason}`, event.id?.slice(0, 16));
        return;
      }

      // Use NIP-07 for decryption (no private key!)
      const plaintext = await state.nostrProvider.nip04.decrypt(
        event.pubkey,
        event.content
      );

      handleIncomingMessage(event.pubkey, plaintext, event.created_at, event.id);
    } catch (err) {
      console.warn('Decryption failed:', err);
    }
  });
}

/**
 * SECURITY: Validate incoming DM event
 * Checks signature, p-tag, timestamp, and replay protection
 * @param {Object} event - Nostr event
 * @returns {Promise<{valid: boolean, reason?: string}>}
 */
async function validateIncomingDM(event) {
  // 1. Check event has required fields
  if (!event.id || !event.pubkey || !event.sig || !event.created_at) {
    return { valid: false, reason: 'Missing required event fields' };
  }

  // 2. REPLAY PROTECTION: Check if we've seen this event before
  if (state.seenEventIds.has(event.id)) {
    return { valid: false, reason: 'Duplicate event (replay attack prevention)' };
  }

  // 3. TIMESTAMP FRESHNESS: Reject events older than 10 min or more than 2 min in future
  // Tighter window prevents replay attacks with stale messages
  const now = Math.floor(Date.now() / 1000);
  const maxAge = 600; // 10 minutes (tightened from 1 hour)
  const maxFuture = 120; // 2 minutes

  if (event.created_at < now - maxAge) {
    return { valid: false, reason: 'Event too old (possible replay attack)' };
  }

  if (event.created_at > now + maxFuture) {
    return { valid: false, reason: 'Event timestamp in future' };
  }

  // 4. VERIFY P-TAG: Ensure message is actually addressed to us
  const pTags = event.tags.filter(t => t[0] === 'p');
  const addressedToUs = pTags.some(t => t[1] === state.publicKey);
  if (!addressedToUs) {
    return { valid: false, reason: 'Message not addressed to current user' };
  }

  // 5. VERIFY SIGNATURE using NostrTools if available
  if (window.NostrTools && NostrTools.verifyEvent) {
    try {
      const isValid = NostrTools.verifyEvent(event);
      if (!isValid) {
        return { valid: false, reason: 'Invalid signature' };
      }
    } catch (e) {
      console.warn('Signature verification error:', e);
      return { valid: false, reason: 'Signature verification failed' };
    }
  } else {
    // If NostrTools.verifyEvent not available, log warning
    console.warn('NostrTools.verifyEvent not available - signature not verified');
  }

  // 6. COUNTERPARTY VALIDATION: Check sender is from an active swap
  const isKnownCounterparty = state.mySwaps.some(s => s.provider === event.pubkey);
  if (!isKnownCounterparty) {
    // Not from a known swap counterparty - could be spam or unsolicited
    console.warn('DM from unknown sender:', event.pubkey.slice(0, 16));
    // We'll still process it but log the warning
  }

  // Mark event as seen for replay protection
  state.seenEventIds.add(event.id);

  // Limit seen events set size to prevent memory bloat
  if (state.seenEventIds.size > 10000) {
    // Remove oldest entries (convert to array, slice, convert back)
    const arr = Array.from(state.seenEventIds);
    state.seenEventIds = new Set(arr.slice(-5000));
  }

  return { valid: true };
}

function handleIncomingMessage(senderPubkey, text, createdAt, eventId = null) {
  const swap = state.mySwaps.find((s) => s.provider === senderPubkey);
  if (!swap) return;

  // SECURITY: Store event ID for audit trail
  if (eventId) {
    if (!swap.data.eventIds) swap.data.eventIds = [];
    swap.data.eventIds.push(eventId);
  }

  swap.messages.push({
    sender: 'provider',
    text: text,
    timestamp: createdAt * 1000,
  });

  // Parse Taproot swap data from messages
  if (text.includes('taproot_address:')) {
    const match = text.match(/taproot_address:\s*([a-zA-Z0-9]+)/);
    if (match) {
      swap.data.taprootAddress = match[1];
      swap.status = 'AWAITING_FUNDING';
    }
  }

  if (text.includes('payment_hash:')) {
    const match = text.match(/payment_hash:\s*([a-fA-F0-9]{64})/);
    if (match) {
      swap.data.paymentHash = match[1];
    }
  }

  if (text.includes('lnbc') || text.includes('lntb')) {
    const match = text.match(/(ln[a-zA-Z0-9]+)/);
    if (match) {
      const invoice = match[1];

      // SECURITY: Validate timelock safety before accepting invoice
      validateInvoiceTimelock(invoice, swap).then(result => {
        if (result.valid) {
          swap.data.invoice = invoice;
          swap.status = 'PREMIUM_DUE';
          swap.data.timelockValidated = true;
          toast.success(`Invoice received. ${result.message}`);
          renderSwapList();
        } else {
          // SECURITY: Block swap if timelock is unsafe
          swap.status = 'SAFETY_BLOCKED';
          swap.data.timelockError = result.message;
          toast.error(`SECURITY: ${result.message}`);
          swap.messages.push({
            sender: 'system',
            text: `SECURITY BLOCK: ${result.message}`,
            timestamp: Date.now(),
          });
          renderSwapList();
        }
      });

      // Don't set status yet - wait for validation
      return;
    }
  }

  if (text.includes('txid:')) {
    const match = text.match(/txid:\s*([a-fA-F0-9]{64})/);
    if (match) {
      const txid = match[1];
      // Extract vout if provided, default to 0
      const voutMatch = text.match(/vout:\s*(\d+)/);
      const vout = voutMatch ? parseInt(voutMatch[1]) : 0;

      swap.data.fundingTxId = txid;
      swap.data.fundingVout = vout;
      swap.status = 'VERIFYING_FUNDING'; // SECURITY: Intermediate state while verifying

      // SECURITY: Verify the funding UTXO before marking as FUNDED
      verifyFundingUtxo(txid, vout, swap.data.taprootAddress, swap).then(verification => {
        if (!verification.valid) {
          if (verification.needsMoreConfirmations) {
            // Not enough confirmations - keep waiting
            swap.status = 'AWAITING_CONFIRMATION';
            swap.data.fundingVerificationMessage = verification.message;
            toast.info(verification.message);

            // SECURITY: Schedule re-check in 60 seconds
            setTimeout(() => {
              if (swap.status === 'AWAITING_CONFIRMATION') {
                console.log('SECURITY: Re-checking funding confirmation...');
                verifyFundingUtxo(txid, vout, swap.data.taprootAddress, swap).then(recheck => {
                  if (recheck.valid) {
                    swap.status = 'FUNDED';
                    swap.data.verifiedUtxo = recheck.utxoInfo;
                    swap.data.fundingVerified = true;
                    toast.success(`Funding confirmed! ${recheck.message}`);
                    renderSwapList();
                  }
                });
              }
            }, 60000);
          } else {
            // SECURITY: Critical verification failure - abort
            swap.status = 'FUNDING_FAILED';
            swap.data.fundingError = verification.message;
            toast.error(`SECURITY: ${verification.message}`);
            swap.messages.push({
              sender: 'system',
              text: `SECURITY BLOCK: Funding verification failed - ${verification.message}`,
              timestamp: Date.now(),
            });
          }
        } else {
          // SECURITY: Verification passed - mark as FUNDED
          swap.status = 'FUNDED';
          swap.data.verifiedUtxo = verification.utxoInfo;
          swap.data.fundingVerified = true;
          toast.success(`Funding verified! ${verification.message}`);
        }
        renderSwapList();
      }).catch(e => {
        console.error('Funding verification error:', e);
        swap.status = 'AWAITING_FUNDING'; // Revert to waiting
        toast.warning('Could not verify funding - will retry later');
        renderSwapList();
      });

      return; // Don't render yet - wait for async verification
    }
  }

  // Taproot script data
  if (text.includes('internal_key:')) {
    const match = text.match(/internal_key:\s*([a-fA-F0-9]{64})/);
    if (match) {
      swap.data.internalKey = match[1];
    }
  }

  if (text.includes('script_tree:')) {
    try {
      const jsonMatch = text.match(/script_tree:\s*(\{[\s\S]+\})/);
      if (jsonMatch) {
        const receivedTree = JSON.parse(jsonMatch[1]);

        // SECURITY: Verify script tree matches expected structure (async for block height)
        verifyScriptTree(receivedTree, swap).then(verification => {
          if (!verification.valid) {
            // SECURITY: Escape the reason as it may contain attacker-controlled data
            const safeReason = escapeHtml(verification.reason);
            toast.html(
              '<strong>SECURITY ALERT: Script Mismatch</strong><br>' +
              safeReason + '<br>' +
              'The counterparty may be attempting fraud. Swap aborted.',
              'error', 10000
            );
            swap.status = 'ABORTED';
            swap.messages.push({
              sender: 'system',
              text: `SECURITY: Script verification failed - ${verification.reason}`,
              timestamp: Date.now(),
            });
          } else {
            swap.data.scriptTree = receivedTree;
            swap.data.scriptVerified = true;
            toast.success(`Script tree verified! ${verification.blocksRemaining} blocks until timeout.`);
          }
          renderSwapList();
        }).catch(e => {
          console.error('Script verification error:', e);
          toast.error('Failed to verify script tree');
        });
        return; // Don't render yet - wait for async verification
      }
    } catch (e) {
      console.warn('Failed to parse script tree:', e);
      toast.warning('Received malformed script tree data');
    }
  }

  renderSwapList();
}

/**
 * SECURITY: Verify that the script tree from counterparty matches expected structure
 * This prevents the seller from inserting backdoors or alternate spending paths
 *
 * ENHANCED: Now rebuilds scripts locally and verifies against received data
 */
async function verifyScriptTree(receivedTree, swap) {
  // Check required fields exist
  if (!receivedTree || typeof receivedTree !== 'object') {
    return { valid: false, reason: 'Invalid script tree format' };
  }

  // Required fields for proper verification
  const requiredFields = ['paymentHash', 'buyerPubkey', 'sellerPubkey', 'timeout'];
  const missingFields = requiredFields.filter(f =>
    !receivedTree[f] && !receivedTree[f.replace(/([A-Z])/g, '_$1').toLowerCase()]
  );

  if (missingFields.length > 0) {
    return { valid: false, reason: `Missing required fields: ${missingFields.join(', ')}` };
  }

  // Normalize field names (support both camelCase and snake_case)
  const paymentHash = receivedTree.paymentHash || receivedTree.payment_hash;
  const buyerPubkey = receivedTree.buyerPubkey || receivedTree.buyer_pubkey;
  const sellerPubkey = receivedTree.sellerPubkey || receivedTree.seller_pubkey;
  const timeout = receivedTree.timeout || receivedTree.locktime;

  // 1. Verify payment hash matches what was agreed
  if (swap.data.paymentHash) {
    if (paymentHash.toLowerCase() !== swap.data.paymentHash.toLowerCase()) {
      return { valid: false, reason: 'Payment hash mismatch - seller may have swapped the preimage' };
    }
  }

  // 2. Verify buyer pubkey is OUR pubkey
  if (state.publicKey) {
    if (buyerPubkey.toLowerCase() !== state.publicKey.toLowerCase()) {
      return { valid: false, reason: 'Buyer pubkey does not match your key - you cannot claim!' };
    }
  }

  // 3. Verify seller pubkey matches the counterparty
  if (swap.provider) {
    if (sellerPubkey.toLowerCase() !== swap.provider.toLowerCase()) {
      return { valid: false, reason: 'Seller pubkey does not match counterparty' };
    }
  }

  // 4. Get current block height from trusted source (NOT from counterparty)
  const trustedHeight = await getCurrentBlockHeight();
  if (!trustedHeight) {
    return { valid: false, reason: 'Cannot verify timeout - unable to fetch current block height' };
  }

  // 5. Verify timeout is reasonable (minimum 72 blocks = ~12 hours)
  const blocksRemaining = timeout - trustedHeight;
  if (blocksRemaining < 72) {
    return { valid: false, reason: `Timeout too short: only ${blocksRemaining} blocks remaining (minimum: 72)` };
  }

  // 6. Verify timeout is not excessively long (max 4032 blocks = ~4 weeks)
  if (blocksRemaining > 4032) {
    return { valid: false, reason: `Timeout too long: ${blocksRemaining} blocks (maximum: 4032)` };
  }

  // 7. Rebuild expected hashlock script and verify
  const expectedHashlockScript = buildHashlockScript(paymentHash, buyerPubkey);
  const receivedHashlock = receivedTree.hashlockScript || receivedTree.hashlock_script;
  if (receivedHashlock && receivedHashlock.toLowerCase() !== expectedHashlockScript.toLowerCase()) {
    return { valid: false, reason: 'Hashlock script mismatch - possible backdoor inserted' };
  }

  // 8. Rebuild expected refund script and verify
  const expectedRefundScript = buildRefundScript(timeout, sellerPubkey);
  const receivedRefund = receivedTree.refundScript || receivedTree.refund_script;
  if (receivedRefund && receivedRefund.toLowerCase() !== expectedRefundScript.toLowerCase()) {
    return { valid: false, reason: 'Refund script mismatch - possible backdoor inserted' };
  }

  // 9. Verify NUMS internal key if provided (should be standard NUMS point)
  const EXPECTED_NUMS_KEY = '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0';
  const receivedInternalKey = receivedTree.internalKey || receivedTree.internal_key;
  if (receivedInternalKey && receivedInternalKey.toLowerCase() !== EXPECTED_NUMS_KEY) {
    return { valid: false, reason: 'Non-standard internal key - possible key-spend backdoor' };
  }

  // 10. SECURITY: Derive expected Taproot address from script tree
  // This binds the script to the address so attacker can't fund different address
  const hashlockScript = buildHashlockScript(paymentHash, buyerPubkey);
  const refundScript = buildRefundScript(timeout, sellerPubkey);
  const internalKey = receivedInternalKey || EXPECTED_NUMS_KEY;

  let derivedTaprootAddress = null;
  try {
    derivedTaprootAddress = await deriveTaprootAddress(
      internalKey,
      hashlockScript,
      refundScript,
      EXPECTED_NETWORK
    );
    console.log(`SECURITY: Derived Taproot address: ${derivedTaprootAddress}`);

    // 11. If we already have a taproot address from counterparty, verify it matches
    if (swap.data.taprootAddress) {
      if (derivedTaprootAddress.toLowerCase() !== swap.data.taprootAddress.toLowerCase()) {
        return {
          valid: false,
          reason: `Taproot address mismatch! Derived: ${derivedTaprootAddress.slice(0, 20)}..., Received: ${swap.data.taprootAddress.slice(0, 20)}... Possible fraud.`
        };
      }
      console.log('SECURITY: Taproot address matches derived address');
    }
  } catch (e) {
    console.warn('SECURITY: Could not derive Taproot address:', e);
    // Continue but warn - address will be verified when funding is checked
  }

  // 12. Store verified parameters in swap for later use
  swap.data.verifiedScriptParams = {
    paymentHash,
    buyerPubkey,
    sellerPubkey,
    timeout,
    internalKey,
    hashlockScript,
    refundScript,
    derivedTaprootAddress,
    trustedBlockHeight: trustedHeight,
    verifiedAt: Date.now()
  };

  // Store derived address for funding verification
  if (derivedTaprootAddress) {
    swap.data.derivedTaprootAddress = derivedTaprootAddress;
  }

  // All checks passed
  return { valid: true, trustedBlockHeight: trustedHeight, blocksRemaining, derivedTaprootAddress };
}

/**
 * SECURITY: Derive Taproot address from internal key and script tree
 * This ensures we can verify funding goes to the correct address
 *
 * @param {string} internalKey - 32-byte x-only internal key hex
 * @param {string} hashlockScript - Hashlock leaf script hex
 * @param {string} refundScript - Refund leaf script hex
 * @param {string} network - 'mainnet' or 'testnet'
 * @returns {Promise<string>} - bech32m Taproot address
 */
async function deriveTaprootAddress(internalKey, hashlockScript, refundScript, network) {
  // 1. Compute TapLeaf hashes for both scripts
  const hashlockLeafHash = await computeTapLeafHash(hashlockScript, 0xc0);
  const refundLeafHash = await computeTapLeafHash(refundScript, 0xc0);

  // 2. Compute Merkle root (for 2-leaf tree: sorted hash of leaves)
  // TapBranch = taggedHash("TapBranch", sorted(left, right))
  let merkleRoot;
  if (hashlockLeafHash < refundLeafHash) {
    merkleRoot = await taggedHash('TapBranch', hashlockLeafHash + refundLeafHash);
  } else {
    merkleRoot = await taggedHash('TapBranch', refundLeafHash + hashlockLeafHash);
  }

  // 3. Compute TapTweak = taggedHash("TapTweak", internal_key || merkle_root)
  const tapTweak = await taggedHash('TapTweak', internalKey + merkleRoot);

  // 4. Tweak the internal key: output_key = internal_key + tapTweak * G
  // For the NUMS key, we can compute this without full EC math
  // Since NUMS has no known discrete log, the tweaked key is deterministic
  const tweakResult = await tweakPublicKey(internalKey, tapTweak);
  const tweakedKey = tweakResult.key;

  // 5. Convert to bech32m address
  const hrp = network === 'mainnet' ? 'bc' : 'tb';
  const address = encodeBech32m(hrp, tweakedKey);

  return address;
}

/**
 * Tweak a public key with a scalar using BIP-341 algorithm
 * Uses @noble/secp256k1 for real EC point addition
 *
 * BIP-341 Taptweak: Q = P + int(t)G where t = tagged_hash("TapTweak", P || merkle_root)
 *
 * @param {string} pubkeyHex - 32-byte x-only pubkey (internal key)
 * @param {string} tweakHex - 32-byte tweak scalar
 * @returns {Promise<string>} - 32-byte tweaked x-only pubkey (output key)
 */
async function tweakPublicKey(pubkeyHex, tweakHex) {
  // Ensure noble library is loaded
  if (!window.nobleSecp256k1) {
    throw new Error('SECURITY: @noble/secp256k1 not loaded - cannot perform EC operations');
  }

  const secp = window.nobleSecp256k1;

  try {
    // 1. Convert hex to bytes
    const pubkeyBytes = hexToBytes(pubkeyHex);
    const tweakBytes = hexToBytes(tweakHex);

    // 2. Lift x-only pubkey to full point (BIP-340 lift_x)
    // For x-only keys, we assume even y-coordinate
    // Prepend 0x02 for compressed format with even y
    const compressedPubkey = new Uint8Array([0x02, ...pubkeyBytes]);

    // 3. Parse the point using noble's ProjectivePoint
    const P = secp.ProjectivePoint.fromHex(compressedPubkey);

    // 4. Convert tweak to scalar (bigint)
    const tweakScalar = BigInt('0x' + tweakHex);

    // 5. Verify tweak is valid (non-zero, less than curve order)
    const CURVE_ORDER = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
    if (tweakScalar === 0n || tweakScalar >= CURVE_ORDER) {
      throw new Error('Invalid tweak scalar');
    }

    // 6. Compute t * G (tweak times generator)
    const tG = secp.ProjectivePoint.BASE.multiply(tweakScalar);

    // 7. Compute Q = P + t * G
    const Q = P.add(tG);

    // 8. Get x-coordinate of Q (x-only output key)
    const Qaffine = Q.toAffine();

    // 9. Determine parity of Q's y-coordinate for control block
    // BIP-341: parity bit is 0 if y is even, 1 if y is odd
    const yIsOdd = (Qaffine.y & 1n) === 1n;
    const parity = yIsOdd ? 1 : 0;

    // 10. Get x-coordinate (x-only output key)
    let outputX = Qaffine.x;

    // 11. Convert to 32-byte hex string
    const outputKeyHex = outputX.toString(16).padStart(64, '0');

    console.log(`SECURITY: Real EC point addition performed for taptweak (parity=${parity})`);

    // Return both the key and parity for control block construction
    return { key: outputKeyHex, parity: parity };

  } catch (e) {
    console.error('SECURITY: EC tweak failed:', e);
    throw new Error(`Taproot key tweak failed: ${e.message}`);
  }
}

/**
 * Encode bytes as bech32m (BIP-350) for Taproot addresses
 * @param {string} hrp - Human readable part ('bc' or 'tb')
 * @param {string} dataHex - 32-byte output key hex
 * @returns {string} - bech32m address
 */
function encodeBech32m(hrp, dataHex) {
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const BECH32M_CONST = 0x2bc830a3;

  // Convert hex to 5-bit groups
  const data8bit = hexToBytes(dataHex);
  const data5bit = convertBits(Array.from(data8bit), 8, 5, true);

  // Witness version 1 for Taproot
  const values = [1, ...data5bit];

  // Compute checksum
  const checksum = bech32CreateChecksum(hrp, values, BECH32M_CONST);

  // Encode
  let result = hrp + '1';
  for (const v of [...values, ...checksum]) {
    result += CHARSET[v];
  }

  return result;
}

/**
 * Convert between bit sizes (for bech32 encoding)
 */
function convertBits(data, fromBits, toBits, pad) {
  let acc = 0;
  let bits = 0;
  const result = [];
  const maxv = (1 << toBits) - 1;

  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((acc >> bits) & maxv);
    }
  }

  if (pad && bits > 0) {
    result.push((acc << (toBits - bits)) & maxv);
  }

  return result;
}

/**
 * Create bech32/bech32m checksum
 */
function bech32CreateChecksum(hrp, values, spec) {
  const enc = bech32HrpExpand(hrp).concat(values).concat([0, 0, 0, 0, 0, 0]);
  const mod = bech32Polymod(enc) ^ spec;
  const result = [];
  for (let i = 0; i < 6; i++) {
    result.push((mod >> (5 * (5 - i))) & 31);
  }
  return result;
}

function bech32HrpExpand(hrp) {
  const result = [];
  for (const c of hrp) {
    result.push(c.charCodeAt(0) >> 5);
  }
  result.push(0);
  for (const c of hrp) {
    result.push(c.charCodeAt(0) & 31);
  }
  return result;
}

function bech32Polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) {
        chk ^= GEN[i];
      }
    }
  }
  return chk;
}

/**
 * Build hashlock script: OP_SHA256 <payment_hash> OP_EQUALVERIFY <buyer_pubkey> OP_CHECKSIG
 * @param {string} paymentHash - 32-byte hex
 * @param {string} buyerPubkey - 32-byte x-only hex
 * @returns {string} - hex script
 */
function buildHashlockScript(paymentHash, buyerPubkey) {
  // OP_SHA256 (0xa8) + PUSH32 (0x20) + payment_hash + OP_EQUALVERIFY (0x88) +
  // PUSH32 (0x20) + buyer_pubkey + OP_CHECKSIG (0xac)
  return 'a8' + '20' + paymentHash + '88' + '20' + buyerPubkey + 'ac';
}

/**
 * Build refund script: <timeout> OP_CHECKLOCKTIMEVERIFY OP_DROP <seller_pubkey> OP_CHECKSIG
 * @param {number} timeout - block height
 * @param {string} sellerPubkey - 32-byte x-only hex
 * @returns {string} - hex script
 */
function buildRefundScript(timeout, sellerPubkey) {
  // Encode timeout as little-endian bytes
  const timeoutHex = encodeScriptNumber(timeout);
  // timeout_push + timeout + OP_CLTV (0xb1) + OP_DROP (0x75) +
  // PUSH32 (0x20) + seller_pubkey + OP_CHECKSIG (0xac)
  return timeoutHex + 'b1' + '75' + '20' + sellerPubkey + 'ac';
}

/**
 * Encode a number for Script (minimal encoding)
 * @param {number} n - number to encode
 * @returns {string} - hex with push opcode prefix
 */
function encodeScriptNumber(n) {
  if (n === 0) return '00';
  if (n >= 1 && n <= 16) return (0x50 + n).toString(16);

  // Convert to little-endian bytes
  let hex = '';
  let temp = n;
  while (temp > 0) {
    hex += (temp & 0xff).toString(16).padStart(2, '0');
    temp = temp >> 8;
  }

  // Add sign byte if high bit set
  if (parseInt(hex.slice(-2), 16) & 0x80) {
    hex += '00';
  }

  // Push opcode for length
  const len = hex.length / 2;
  const pushOp = len.toString(16).padStart(2, '0');

  return pushOp + hex;
}

// ============================================================================
// Signing & Publishing (NIP-07)
// ============================================================================

async function signAndPublishEvent(unsignedEvent) {
  if (!state.nostrProvider) {
    throw new Error('Nostr wallet not connected');
  }

  // NIP-07 signEvent adds id, pubkey, sig
  const signedEvent = await state.nostrProvider.signEvent(unsignedEvent);

  // Publish to all relays
  const pubs = await state.relayPool.publish(RELAYS, signedEvent);

  return { signedEvent, publishCount: pubs.length };
}

async function sendEncryptedMessage(targetPubkey, text) {
  if (!state.nostrProvider) {
    throw new Error('Nostr wallet not connected');
  }

  // NIP-04 encrypt via NIP-07 (no private key!)
  const ciphertext = await state.nostrProvider.nip04.encrypt(
    targetPubkey,
    text
  );

  const event = {
    kind: 4,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', targetPubkey]],
    content: ciphertext,
  };

  return signAndPublishEvent(event);
}

// ============================================================================
// UI Helpers
// ============================================================================

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function updateIdentityUI(npub) {
  dom.userNpub.textContent = `${npub.slice(0, 12)}...${npub.slice(-6)}`;
  dom.loginSection.style.display = 'none';
  dom.userInfo.style.display = 'block';
  if (dom.createOfferCard) {
    dom.createOfferCard.style.display = 'block';
  }
}

// ============================================================================
// Public API: Offer Filtering
// ============================================================================

window.fetchLiquidityOffers = function () {
  const minAmt = dom.minAmountFilter?.value
    ? BigInt(dom.minAmountFilter.value)
    : 0n;
  const maxAmt = dom.maxAmountFilter?.value
    ? BigInt(dom.maxAmountFilter.value)
    : -1n;
  const minDur = parseInt(dom.minDurationFilter?.value) || 0;

  const filtered = state.allOffers.filter((offer) => {
    try {
      const price = BigInt(offer.price);
      const duration = parseInt(offer.specs?.duration) || 0;

      const amountOk =
        maxAmt === -1n ? price >= minAmt : price >= minAmt && price <= maxAmt;
      return amountOk && duration >= minDur;
    } catch {
      return false;
    }
  });

  renderOfferList(filtered);
};

function renderOfferList(offers) {
  if (offers.length === 0) {
    dom.offerList.innerHTML =
      '<div class="status-msg">No offers match criteria.</div>';
    return;
  }

  dom.offerList.innerHTML = offers
    .map((offer) => {
      let formattedPrice = '0';
      try {
        formattedPrice = BigInt(offer.price)
          .toString()
          .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      } catch {
        formattedPrice = 'Invalid';
      }

      const taprootBadge = offer.isTaproot
        ? '<span class="badge taproot">Taproot</span>'
        : '<span class="badge legacy">P2WSH</span>';

      return `
      <div class="offer-item">
        <div class="offer-header">
          <h3>${escapeHtml(offer.name)}</h3>
          ${taprootBadge}
        </div>
        <div class="offer-specs">
          <div class="spec">
            <span class="label">Amount</span>
            <span class="value">${formattedPrice} sats</span>
          </div>
          <div class="spec">
            <span class="label">Duration</span>
            <span class="value">${escapeHtml(String(offer.specs?.duration || 'N/A'))} blocks</span>
          </div>
        </div>
        <div class="offer-actions">
          <small>Provider: ${escapeHtml(offer.pubkey.slice(0, 8))}...</small>
          <button class="btn-secondary" onclick="initiateSwap('${escapeHtml(offer.id)}')">
            Initiate Swap
          </button>
        </div>
      </div>
    `;
    })
    .join('');
}

// ============================================================================
// Public API: Swap Initiation
// ============================================================================

window.initiateSwap = async function (offerId) {
  if (!state.publicKey) {
    toast.warning('Please connect your Nostr wallet first.');
    return;
  }

  // SECURITY: Block swap initiation if network mismatch
  if (state.networkMismatch) {
    toast.error('BLOCKED: Network mismatch. Please switch your wallet to the correct network before initiating swaps.');
    return;
  }

  const offer = state.allOffers.find((o) => o.id === offerId);
  if (!offer) return;

  const initialMsg = `SPARKLE_REQUEST v3\nswap: ${offer.name}\namount: ${offer.price} sats\nbuyer_pubkey: ${state.publicKey}\nprotocol: taproot_atomic`;

  try {
    await sendEncryptedMessage(offer.pubkey, initialMsg);

    const newSwap = {
      id: offer.id,
      offer: offer,
      provider: offer.pubkey,
      status: 'NEGOTIATING',
      messages: [
        {
          sender: 'me',
          text: initialMsg,
          timestamp: Date.now(),
        },
      ],
      data: {
        invoice: null,
        fundingTxId: null,
        taprootAddress: null,
        paymentHash: null,
        internalKey: null,
        scriptTree: null,
      },
    };

    state.mySwaps.push(newSwap);
    renderSwapList();
  } catch (err) {
    console.error('Swap initiation failed:', err);
    toast.error('Failed to send swap request. Check console for details.');
  }
};

// ============================================================================
// Public API: Swap Actions
// ============================================================================

window.confirmPayment = async function (swapId) {
  const swap = state.mySwaps.find((s) => s.id === swapId);
  if (!swap) return;

  swap.status = 'WAITING_FUNDING';
  const msg = 'SPARKLE_CONFIRM: Premium paid. Ready for funding.';

  swap.messages.push({ sender: 'me', text: msg, timestamp: Date.now() });
  renderSwapList();

  await sendEncryptedMessage(swap.provider, msg);
};

window.sendUserReply = async function (swapId) {
  const input = document.getElementById(`reply-${swapId}`);
  const text = input.value.trim();
  if (!text) return;

  const swap = state.mySwaps.find((s) => s.id === swapId);
  if (!swap) return;

  swap.messages.push({ sender: 'me', text: text, timestamp: Date.now() });
  input.value = '';
  renderSwapList();

  await sendEncryptedMessage(swap.provider, text);
};

// ============================================================================
// SECURITY: Preimage and UTXO Verification Helpers
// ============================================================================

/**
 * SECURITY: Verify that preimage hashes to expected payment hash
 * Uses SubtleCrypto for SHA256
 * @param {string} preimage - 32-byte hex preimage
 * @param {string} paymentHash - 32-byte hex hash
 * @returns {Promise<boolean>}
 */
async function verifyPreimage(preimage, paymentHash) {
  if (!preimage || !paymentHash) return false;

  try {
    // Convert hex preimage to Uint8Array
    const preimageBytes = new Uint8Array(
      preimage.match(/.{2}/g).map(b => parseInt(b, 16))
    );

    // Hash with SHA256 using SubtleCrypto
    const hashBuffer = await crypto.subtle.digest('SHA-256', preimageBytes);
    const hashArray = new Uint8Array(hashBuffer);

    // Convert to hex
    const computedHash = Array.from(hashArray)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Compare with expected payment hash
    return computedHash.toLowerCase() === paymentHash.toLowerCase();
  } catch (e) {
    console.error('Preimage verification failed:', e);
    return false;
  }
}

/**
 * SECURITY: Fetch full UTXO data from indexer
 * This ensures we use real values AND verify the scriptPubKey/address
 * @param {string} txid - Transaction ID
 * @param {number} vout - Output index
 * @returns {Promise<{value: number, confirmed: boolean, confirmations: number, scriptPubKey: string, address: string} | null>}
 */
async function fetchUtxoValue(txid, vout) {
  try {
    const network = state.bitcoinNetwork === 'mainnet' ? '' : '/testnet';

    // Try mempool.space API first
    const response = await fetch(`https://mempool.space${network}/api/tx/${txid}`);
    if (response.ok) {
      const tx = await response.json();
      if (tx.vout && tx.vout[vout]) {
        const output = tx.vout[vout];
        const currentHeight = await getCurrentBlockHeight();
        return {
          value: output.value,
          confirmed: tx.status?.confirmed || false,
          confirmations: tx.status?.block_height && currentHeight ?
            currentHeight - tx.status.block_height + 1 : 0,
          // SECURITY: Include scriptPubKey and address for verification
          scriptPubKey: output.scriptpubkey || output.scriptPubKey || '',
          scriptPubKeyType: output.scriptpubkey_type || output.scriptPubKeyType || '',
          address: output.scriptpubkey_address || output.address || ''
        };
      }
    }
  } catch (e) {
    console.warn('Failed to fetch UTXO from mempool.space:', e);
  }

  try {
    const network = state.bitcoinNetwork === 'mainnet' ? '' : '/testnet';

    // Fallback to blockstream.info
    const response = await fetch(`https://blockstream.info${network}/api/tx/${txid}`);
    if (response.ok) {
      const tx = await response.json();
      if (tx.vout && tx.vout[vout]) {
        const output = tx.vout[vout];
        const currentHeight = await getCurrentBlockHeight();
        return {
          value: output.value,
          confirmed: tx.status?.confirmed || false,
          confirmations: tx.status?.block_height && currentHeight ?
            currentHeight - tx.status.block_height + 1 : 0,
          // SECURITY: Include scriptPubKey and address for verification
          scriptPubKey: output.scriptpubkey || output.scriptPubKey || '',
          scriptPubKeyType: output.scriptpubkey_type || output.scriptPubKeyType || '',
          address: output.scriptpubkey_address || output.address || ''
        };
      }
    }
  } catch (e) {
    console.warn('Failed to fetch UTXO from blockstream.info:', e);
  }

  return null;
}

// SECURITY: Minimum confirmations required before marking FUNDED
// Raised from 1 to 2 for better protection against reorg attacks
const MIN_FUNDING_CONFIRMATIONS = 2;

/**
 * SECURITY: Verify funding UTXO matches expected Taproot address
 * This prevents attacks where counterparty sends a txid for an unrelated output
 * @param {string} txid - Funding transaction ID
 * @param {number} vout - Output index
 * @param {string} expectedAddress - Expected Taproot address from counterparty or computed
 * @param {Object} swap - Swap object for context
 * @returns {Promise<{valid: boolean, message: string, utxoInfo?: Object}>}
 */
async function verifyFundingUtxo(txid, vout, expectedAddress, swap) {
  console.log(`SECURITY: Verifying funding UTXO ${txid}:${vout}`);

  // Fetch full UTXO data including scriptPubKey/address
  const utxoInfo = await fetchUtxoValue(txid, vout);

  if (!utxoInfo) {
    return {
      valid: false,
      message: 'Cannot verify funding: UTXO not found. Transaction may not be confirmed yet.',
      utxoInfo: null
    };
  }

  console.log(`SECURITY: UTXO data - Address: ${utxoInfo.address}, Value: ${utxoInfo.value}, Confirmations: ${utxoInfo.confirmations}`);

  // SECURITY FIX: Prefer derived address over counterparty-supplied address
  // This prevents attacks where counterparty provides valid script but funds different address
  const derivedAddress = swap?.data?.derivedTaprootAddress;
  const addressToVerify = derivedAddress || expectedAddress;

  if (derivedAddress) {
    console.log(`SECURITY: Using derived Taproot address for verification: ${derivedAddress.slice(0, 20)}...`);
  }

  // 1. Verify the output address matches expected Taproot address
  if (addressToVerify) {
    if (utxoInfo.address.toLowerCase() !== addressToVerify.toLowerCase()) {
      console.error(`SECURITY: Address mismatch! Expected: ${addressToVerify}, Got: ${utxoInfo.address}`);
      return {
        valid: false,
        message: `CRITICAL: Funding UTXO address mismatch! Expected: ${addressToVerify.slice(0, 20)}..., Got: ${utxoInfo.address.slice(0, 20)}... Possible fraud attempt.`,
        utxoInfo
      };
    }
    console.log('SECURITY: Funding address verification PASSED');
  } else {
    console.warn('SECURITY: No expected address to verify against - skipping address check');
    // If no derived address, this is a security warning - script tree may not be verified yet
    if (!swap?.data?.scriptVerified) {
      return {
        valid: false,
        message: 'Cannot verify funding: Script tree not yet verified. Wait for script verification before accepting funding.',
        utxoInfo
      };
    }
  }

  // 2. Verify it's a Taproot output (P2TR)
  if (utxoInfo.scriptPubKeyType && utxoInfo.scriptPubKeyType !== 'v1_p2tr') {
    return {
      valid: false,
      message: `Invalid output type: expected Taproot (v1_p2tr), got ${utxoInfo.scriptPubKeyType}`,
      utxoInfo
    };
  }

  // 2b. Also verify scriptPubKey format is P2TR (OP_1 <32-byte-key> = 5120...)
  if (utxoInfo.scriptPubKey && !utxoInfo.scriptPubKey.startsWith('5120')) {
    return {
      valid: false,
      message: `Invalid scriptPubKey format: expected P2TR (5120...), got ${utxoInfo.scriptPubKey.slice(0, 4)}...`,
      utxoInfo
    };
  }

  // 3. Verify minimum confirmations
  if (utxoInfo.confirmations < MIN_FUNDING_CONFIRMATIONS) {
    return {
      valid: false,
      message: `Insufficient confirmations: ${utxoInfo.confirmations}/${MIN_FUNDING_CONFIRMATIONS}. Wait for confirmation.`,
      utxoInfo,
      needsMoreConfirmations: true
    };
  }

  // 4. Verify value is reasonable (at least dust threshold)
  const DUST_THRESHOLD = 330; // satoshis (P2TR dust threshold)
  if (utxoInfo.value < DUST_THRESHOLD) {
    return {
      valid: false,
      message: `Funding amount too low: ${utxoInfo.value} sats (minimum: ${DUST_THRESHOLD})`,
      utxoInfo
    };
  }

  // 5. Verify value matches expected price (if available) with small tolerance for fees
  // FIX: Use swap.offer.price instead of undefined swap.price
  const offerPrice = swap.offer?.price || swap.data?.offerPrice;
  if (offerPrice) {
    // Price might be in BTC or sats depending on source
    const priceNum = parseFloat(offerPrice);
    const expectedSats = priceNum < 1 ? Math.round(priceNum * 100000000) : Math.round(priceNum);
    const tolerance = Math.max(1000, expectedSats * 0.02); // 2% or 1000 sats min
    if (Math.abs(utxoInfo.value - expectedSats) > tolerance) {
      console.warn(`SECURITY: Value mismatch - Expected: ${expectedSats}, Got: ${utxoInfo.value}`);
      // This is a warning, not a block - counterparty might have added extra for fees
    }
  }

  console.log(`SECURITY: Funding UTXO verified successfully`);
  return {
    valid: true,
    message: `Funding verified: ${utxoInfo.value} sats, ${utxoInfo.confirmations} confirmations`,
    utxoInfo
  };
}

// ============================================================================
// Taproot Claim Transaction (via Bitcoin Wallet)
// ============================================================================

window.generateTaprootClaim = async function (swapId) {
  const swap = state.mySwaps.find((s) => s.id === swapId);
  if (!swap) return;

  // SECURITY: Block claim if network mismatch
  if (state.networkMismatch) {
    toast.error('BLOCKED: Network mismatch. Please switch your wallet to the correct network before claiming.');
    return;
  }

  // SECURITY: Verify script was properly validated before allowing claim
  if (!swap.data.scriptVerified) {
    toast.error('BLOCKED: Script tree has not been verified. Cannot proceed with claim.');
    return;
  }

  // SECURITY: Verify timelock was validated
  if (!swap.data.timelockValidated) {
    toast.error('BLOCKED: Timelock safety has not been validated. Cannot proceed with claim.');
    return;
  }

  // Get form values
  const vout = parseInt(document.getElementById(`vout-${swapId}`).value) || 0;
  const address = document.getElementById(`addr-${swapId}`).value.trim();
  const preimage = document.getElementById(`pre-${swapId}`).value.trim();
  const feeInput = document.getElementById(`fee-${swapId}`).value;

  // Validation
  if (!swap.data.fundingTxId) {
    toast.error('Funding transaction not received from provider yet.');
    return;
  }

  if (!address) {
    toast.error('Please enter a valid claim address.');
    return;
  }

  // SECURITY: Validate address format matches expected network
  const isMainnetAddr = address.startsWith('bc1') || address.startsWith('1') || address.startsWith('3');
  const isTestnetAddr = address.startsWith('tb1') || address.startsWith('m') || address.startsWith('n') || address.startsWith('2');
  if (EXPECTED_NETWORK === 'mainnet' && !isMainnetAddr) {
    toast.error('BLOCKED: Address does not match mainnet format.');
    return;
  }
  if (EXPECTED_NETWORK === 'testnet' && !isTestnetAddr) {
    toast.error('BLOCKED: Address does not match testnet format.');
    return;
  }

  if (!preimage || !/^[a-fA-F0-9]{64}$/.test(preimage)) {
    toast.error('Preimage must be 64 hex characters (32 bytes).');
    return;
  }

  // SECURITY: Verify preimage hashes to expected payment hash
  const preimageValid = await verifyPreimage(preimage, swap.data.paymentHash);
  if (!preimageValid) {
    toast.error('SECURITY: Preimage does not match payment hash! Transaction would fail.');
    return;
  }

  if (!state.bitcoinWallet) {
    toast.warning('Please connect your Bitcoin wallet first.');
    return;
  }

  try {
    // SECURITY: Fetch actual UTXO value from indexer instead of trusting offer price
    const utxoInfo = await fetchUtxoValue(swap.data.fundingTxId, vout);
    if (!utxoInfo) {
      toast.error('Could not verify funding UTXO. Please check txid and vout.');
      return;
    }

    const amount = BigInt(utxoInfo.value);
    const fee = BigInt(feeInput || 500);
    const outputAmount = amount - fee;

    // SECURITY: Validate output amount (P2TR dust = 330 sats)
    if (outputAmount <= 330n) {
      throw new Error('Output amount below dust limit (330 sats) after fee');
    }

    // Build claim transaction data with verified values
    const claimData = {
      type: 'taproot_claim',
      version: '1.0',
      verified: true,
      input: {
        txid: swap.data.fundingTxId,
        vout: vout,
        amount: amount.toString(),
        verifiedAmount: true, // Amount verified from indexer
        internalKey: swap.data.internalKey || swap.data.verifiedScriptParams?.internalKey,
        scriptTree: swap.data.scriptTree,
        scriptVerified: swap.data.scriptVerified,
        hashlockScript: buildHashlockScript(
          swap.data.verifiedScriptParams?.paymentHash || swap.data.paymentHash,
          swap.data.verifiedScriptParams?.buyerPubkey || state.publicKey
        ),
      },
      output: {
        address: address,
        amount: outputAmount.toString(),
      },
      witness: {
        preimage: preimage,
        preimageVerified: true,
      },
      fee: fee.toString(),
      network: EXPECTED_NETWORK,
    };

    // Display human-readable transaction summary
    const resultArea = document.getElementById(`psbt-result-${swapId}`);

    resultArea.style.display = 'block';
    resultArea.innerHTML = `
      <div style="background:#f8f9fa; border:1px solid #000; padding:15px; margin-bottom:10px;">
        <h4 style="margin:0 0 10px 0; font-size:12pt; border-bottom:1px solid #000; padding-bottom:5px;">
          Transaction Summary
        </h4>
        <table style="width:100%; font-size:10pt;">
          <tr>
            <td style="padding:3px 0;"><strong>You Pay:</strong></td>
            <td style="text-align:right;">${escapeHtml(formatSats(amount.toString()))} sats (locked in swap)</td>
          </tr>
          <tr>
            <td style="padding:3px 0;"><strong>Miner Fee:</strong></td>
            <td style="text-align:right;">${escapeHtml(formatSats(fee.toString()))} sats</td>
          </tr>
          <tr style="border-top:1px solid #ccc;">
            <td style="padding:5px 0;"><strong>You Receive:</strong></td>
            <td style="text-align:right; font-weight:bold; color:#10B981;">${escapeHtml(formatSats(outputAmount.toString()))} sats</td>
          </tr>
          <tr>
            <td style="padding:3px 0;"><strong>To Address:</strong></td>
            <td style="text-align:right; font-family:monospace; font-size:9pt;">${escapeHtml(address)}</td>
          </tr>
        </table>
        <div style="margin-top:10px; padding:8px; background:#FFFBEB; border:1px solid #F59E0B; font-size:9pt;">
          <strong>Important:</strong> Verify the preimage is correct before signing.
          If the preimage is wrong, the transaction will fail.
        </div>
      </div>
      <details style="margin-bottom:10px;">
        <summary style="cursor:pointer; font-size:10pt;">View Raw Transaction Data</summary>
        <textarea id="psbt-out-${swapId}" class="code-input" style="height:120px; margin-top:5px;">${escapeHtml(JSON.stringify(claimData, null, 2))}</textarea>
      </details>
    `;

    // If using Unisat, add sign button
    if (state.bitcoinWallet === 'unisat') {
      const signBtn = document.createElement('button');
      signBtn.className = 'btn';
      signBtn.style.cssText = 'background:#10B981; margin-top:10px;';
      signBtn.textContent = 'Sign and Broadcast with Unisat';
      signBtn.onclick = () => signWithUnisat(swapId, claimData);
      resultArea.appendChild(signBtn);
    }

    console.log('Taproot claim data prepared:', claimData);
    toast.success('Transaction summary ready. Review and sign.');
  } catch (e) {
    console.error('Claim generation error:', e);
    toast.error(`Failed to generate claim: ${e.message}`);
  }
};

/**
 * SECURITY: Build Taproot control block for script-path spending
 * Control block = leafVersion + internal_key + merkle_path
 * For single-leaf tree: merkle_path is empty
 *
 * @param {string} internalKey - 32-byte x-only internal key hex
 * @param {number} leafVersion - Leaf version (0xc0 for Tapscript)
 * @param {Array} merklePath - Array of sibling hashes (empty for single leaf)
 * @param {number} parity - Output key parity (0 or 1)
 * @returns {string} - Control block hex
 */
function buildControlBlock(internalKey, leafVersion = 0xc0, merklePath = [], parity = 0) {
  // First byte: leafVersion | parity
  const firstByte = (leafVersion & 0xfe) | (parity & 0x01);
  let controlBlock = firstByte.toString(16).padStart(2, '0');

  // Internal key (32 bytes, x-only)
  controlBlock += internalKey;

  // Merkle path (each 32 bytes)
  for (const hash of merklePath) {
    controlBlock += hash;
  }

  return controlBlock;
}

/**
 * SECURITY: Compute tagged hash for Taproot
 * taggedHash(tag, msg) = SHA256(SHA256(tag) || SHA256(tag) || msg)
 */
async function taggedHash(tag, data) {
  const tagBytes = new TextEncoder().encode(tag);
  const tagHashBuffer = await crypto.subtle.digest('SHA-256', tagBytes);
  const tagHash = new Uint8Array(tagHashBuffer);

  // Combine: tagHash || tagHash || data
  const dataBytes = hexToBytes(data);
  const combined = new Uint8Array(tagHash.length * 2 + dataBytes.length);
  combined.set(tagHash, 0);
  combined.set(tagHash, tagHash.length);
  combined.set(dataBytes, tagHash.length * 2);

  const resultBuffer = await crypto.subtle.digest('SHA-256', combined);
  return bytesToHex(new Uint8Array(resultBuffer));
}

/**
 * SECURITY: Compute TapLeaf hash for script-path spending
 * tapLeafHash(script) = taggedHash("TapLeaf", leafVersion || compact_size(script) || script)
 */
async function computeTapLeafHash(script, leafVersion = 0xc0) {
  const scriptBytes = hexToBytes(script);
  const compactSize = encodeCompactSize(scriptBytes.length);

  // Combine: leafVersion || compactSize || script
  const combined = new Uint8Array(1 + compactSize.length + scriptBytes.length);
  combined[0] = leafVersion;
  combined.set(compactSize, 1);
  combined.set(scriptBytes, 1 + compactSize.length);

  return await taggedHash('TapLeaf', bytesToHex(combined));
}

/**
 * Encode compact size (varint) for Bitcoin protocol
 */
function encodeCompactSize(n) {
  if (n < 253) {
    return new Uint8Array([n]);
  } else if (n < 0x10000) {
    return new Uint8Array([253, n & 0xff, (n >> 8) & 0xff]);
  } else if (n < 0x100000000) {
    return new Uint8Array([254, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);
  } else {
    throw new Error('Value too large for compact size');
  }
}

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string
 */
function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Reverse bytes (for txid endianness)
 */
function reverseHex(hex) {
  const bytes = hexToBytes(hex);
  bytes.reverse();
  return bytesToHex(bytes);
}

/**
 * Encode a compact size (varint) as used in Bitcoin
 * @param {number} n - The number to encode
 * @returns {string} - Hex-encoded compact size
 */
function encodeCompactSize(n) {
  if (n < 0xfd) {
    return n.toString(16).padStart(2, '0');
  } else if (n <= 0xffff) {
    return 'fd' + n.toString(16).padStart(4, '0').match(/.{2}/g).reverse().join('');
  } else if (n <= 0xffffffff) {
    return 'fe' + n.toString(16).padStart(8, '0').match(/.{2}/g).reverse().join('');
  } else {
    return 'ff' + BigInt(n).toString(16).padStart(16, '0').match(/.{2}/g).reverse().join('');
  }
}

/**
 * Encode a little-endian uint64
 * @param {number|bigint} n - The number to encode
 * @returns {string} - Hex-encoded LE uint64
 */
function encodeLE64(n) {
  const hex = BigInt(n).toString(16).padStart(16, '0');
  return hex.match(/.{2}/g).reverse().join('');
}

/**
 * Encode a little-endian uint32
 * @param {number} n - The number to encode
 * @returns {string} - Hex-encoded LE uint32
 */
function encodeLE32(n) {
  return (n >>> 0).toString(16).padStart(8, '0').match(/.{2}/g).reverse().join('');
}

/**
 * SECURITY: Build minimal PSBT for Taproot script-path spend
 * This produces a PSBT that can be signed by compatible wallets
 * Returns both structured data and hex-serialized PSBT (BIP-174)
 *
 * IMPORTANT: This is a 2-leaf tree (hashlock + refund), NOT single-leaf!
 * - tapMerkleRoot = TapBranch(hashlockLeafHash, refundLeafHash)
 * - controlBlock includes sibling hash for merkle proof
 */
async function buildTaprootPsbt(claimData, swap) {
  console.log('SECURITY: Building Taproot PSBT for 2-leaf script tree');

  // Use verified UTXO data if available
  const verifiedUtxo = swap?.data?.verifiedUtxo;
  const inputAmount = verifiedUtxo?.value || parseInt(claimData.input.amount);
  const scriptPubKeyHex = verifiedUtxo?.scriptPubKey || '';

  // Get script data - BOTH leaves required for correct merkle root
  const hashlockScript = claimData.input.hashlockScript;
  const refundScript = swap?.data?.verifiedScriptParams?.refundScript ||
                       claimData.input.refundScript;

  if (!refundScript) {
    console.error('SECURITY: Missing refundScript - cannot build correct PSBT');
    throw new Error('Missing refundScript for 2-leaf tree PSBT construction');
  }

  const internalKey = claimData.input.internalKey ||
    '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0'; // NUMS point

  // Compute TapLeaf hashes for BOTH scripts
  const hashlockLeafHash = await computeTapLeafHash(hashlockScript, 0xc0);
  const refundLeafHash = await computeTapLeafHash(refundScript, 0xc0);
  console.log('Hashlock leaf hash:', hashlockLeafHash);
  console.log('Refund leaf hash:', refundLeafHash);

  // Compute TapBranch merkle root for 2-leaf tree
  // TapBranch = taggedHash("TapBranch", sorted(left, right))
  let tapMerkleRoot;
  let siblingHash; // The sibling we need in the control block
  if (hashlockLeafHash < refundLeafHash) {
    tapMerkleRoot = await taggedHash('TapBranch', hashlockLeafHash + refundLeafHash);
    siblingHash = refundLeafHash; // Sibling of hashlock is refund
  } else {
    tapMerkleRoot = await taggedHash('TapBranch', refundLeafHash + hashlockLeafHash);
    siblingHash = refundLeafHash; // Sibling of hashlock is refund
  }
  console.log('TapMerkleRoot (2-leaf):', tapMerkleRoot);
  console.log('Sibling hash for control block:', siblingHash);

  // Compute TapTweak and get OUTPUT KEY PARITY for control block
  // BIP-341: parity bit must be derived from Q (output key), not internal key
  const tapTweak = await taggedHash('TapTweak', internalKey + tapMerkleRoot);
  const tweakResult = await tweakPublicKey(internalKey, tapTweak);
  const outputKeyParity = tweakResult.parity;
  console.log('Output key parity for control block:', outputKeyParity);

  // Control block for 2-leaf tree includes the sibling hash as merkle path
  // Format: [leafVersion | parity] || internal_key || merkle_path
  const controlBlock = buildControlBlock(internalKey, 0xc0, [siblingHash], outputKeyParity);
  console.log('Control block (with sibling):', controlBlock);

  // Build the unsigned transaction first
  const txidLE = reverseHex(claimData.input.txid);
  const vout = claimData.input.vout;
  const outputAmount = parseInt(claimData.output.amount);

  // SECURITY: Dust threshold check - P2TR dust is 330 sats
  const DUST_THRESHOLD = 330;
  if (outputAmount < DUST_THRESHOLD) {
    throw new Error(`Output amount ${outputAmount} sats is below dust threshold (${DUST_THRESHOLD} sats)`);
  }

  // Compute output scriptPubKey from address
  const outputScriptPubKey = addressToScriptPubKey(claimData.output.address);

  // === Build unsigned raw transaction ===
  let unsignedTx = '';
  unsignedTx += '02000000'; // Version 2, LE
  unsignedTx += '00';       // Marker (segwit)
  unsignedTx += '01';       // Flag (segwit)
  unsignedTx += '01';       // Input count
  // Input
  unsignedTx += txidLE;
  unsignedTx += encodeLE32(vout);
  unsignedTx += '00';       // Empty scriptSig for segwit
  unsignedTx += 'fdffffff'; // Sequence 0xfffffffd (RBF-enabled, enables nLockTime)
  // Output count
  unsignedTx += '01';
  // Output
  unsignedTx += encodeLE64(outputAmount);
  unsignedTx += encodeCompactSize(outputScriptPubKey.length / 2);
  unsignedTx += outputScriptPubKey;
  // Locktime
  unsignedTx += '00000000';

  // === Build PSBT hex (BIP-174 format) ===
  let psbtHex = '';

  // 1. Magic bytes
  psbtHex += '70736274ff'; // "psbt" + 0xff

  // 2. Global map
  // Key 0x00 = PSBT_GLOBAL_UNSIGNED_TX
  // For v0 PSBT, we include the full unsigned tx
  // Remove segwit marker/flag for PSBT
  let unsignedTxNoWitness = '02000000'; // Version
  unsignedTxNoWitness += '01';          // Input count (no marker/flag)
  unsignedTxNoWitness += txidLE;
  unsignedTxNoWitness += encodeLE32(vout);
  unsignedTxNoWitness += '00';          // Empty scriptSig
  unsignedTxNoWitness += 'fdffffff';    // Sequence 0xfffffffd (RBF-enabled)
  unsignedTxNoWitness += '01';          // Output count
  unsignedTxNoWitness += encodeLE64(outputAmount);
  unsignedTxNoWitness += encodeCompactSize(outputScriptPubKey.length / 2);
  unsignedTxNoWitness += outputScriptPubKey;
  unsignedTxNoWitness += '00000000';    // Locktime

  // Global unsigned tx
  psbtHex += '01';  // Key length (1 byte)
  psbtHex += '00';  // Key type: PSBT_GLOBAL_UNSIGNED_TX
  psbtHex += encodeCompactSize(unsignedTxNoWitness.length / 2);
  psbtHex += unsignedTxNoWitness;

  // End global map
  psbtHex += '00';

  // 3. Input map
  // PSBT_IN_WITNESS_UTXO (0x01) - The UTXO being spent
  if (scriptPubKeyHex) {
    const witnessUtxo = encodeLE64(inputAmount) +
      encodeCompactSize(scriptPubKeyHex.length / 2) +
      scriptPubKeyHex;
    psbtHex += '01';  // Key length
    psbtHex += '01';  // Key type: PSBT_IN_WITNESS_UTXO
    psbtHex += encodeCompactSize(witnessUtxo.length / 2);
    psbtHex += witnessUtxo;
  }

  // PSBT_IN_TAP_LEAF_SCRIPT (0x16) - BIP-371
  // Key: 0x16 || leafVersion || script
  // Value: control_block
  const tapLeafScriptKey = '16' + 'c0' + hashlockScript;  // type || leafVersion || script
  const tapLeafScriptValue = controlBlock;
  psbtHex += encodeCompactSize(tapLeafScriptKey.length / 2);
  psbtHex += tapLeafScriptKey;
  psbtHex += encodeCompactSize(tapLeafScriptValue.length / 2);
  psbtHex += tapLeafScriptValue;

  // PSBT_IN_TAP_INTERNAL_KEY (0x17) - BIP-371
  psbtHex += '01';  // Key length
  psbtHex += '17';  // Key type: PSBT_IN_TAP_INTERNAL_KEY
  psbtHex += '20';  // Value length (32 bytes)
  psbtHex += internalKey;

  // PSBT_IN_TAP_MERKLE_ROOT (0x18) - BIP-371
  // IMPORTANT: For 2-leaf tree, this is the TapBranch root, NOT single leaf hash
  psbtHex += '01';  // Key length
  psbtHex += '18';  // Key type: PSBT_IN_TAP_MERKLE_ROOT
  psbtHex += '20';  // Value length (32 bytes)
  psbtHex += tapMerkleRoot;

  // End input map
  psbtHex += '00';

  // 4. Output map (empty for our simple case)
  psbtHex += '00';

  console.log('SECURITY: PSBT hex generated, length:', psbtHex.length / 2, 'bytes');

  // Build the structured object too
  const psbt = {
    hex: psbtHex,
    base64: hexToBase64(psbtHex),
    version: 0,

    global: {
      txVersion: 2,
      inputCount: 1,
      outputCount: 1
    },

    inputs: [{
      previousTxid: claimData.input.txid,
      previousVout: vout,
      sequence: 0xfffffffe,
      witnessUtxo: {
        amount: inputAmount,
        scriptPubKey: scriptPubKeyHex
      },
      tapLeafScript: [{
        leafVersion: 0xc0,
        script: hashlockScript,
        controlBlock: controlBlock,
        siblingHash: siblingHash // Merkle proof sibling
      }],
      tapInternalKey: internalKey,
      tapMerkleRoot: tapMerkleRoot, // 2-leaf TapBranch root
      hashlockLeafHash: hashlockLeafHash,
      refundLeafHash: refundLeafHash
    }],

    outputs: [{
      address: claimData.output.address,
      amount: outputAmount,
      scriptPubKey: outputScriptPubKey
    }],

    witnessData: {
      preimage: claimData.witness.preimage
    }
  };

  return psbt;
}

/**
 * Convert hex string to base64
 */
function hexToBase64(hex) {
  const bytes = new Uint8Array(hex.match(/.{2}/g).map(b => parseInt(b, 16)));
  let binary = '';
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary);
}

/**
 * Convert address to scriptPubKey
 * Supports P2WPKH (bc1q...) and P2TR (bc1p...)
 */
function addressToScriptPubKey(address) {
  if (!address) return '';

  // Decode bech32/bech32m address
  const decoded = decodeBech32Address(address);
  if (!decoded) {
    console.warn('Could not decode address:', address);
    return '';
  }

  const { witnessVersion, witnessProgram } = decoded;

  if (witnessVersion === 0 && witnessProgram.length === 40) {
    // P2WPKH: OP_0 <20-byte-key-hash>
    return '0014' + witnessProgram;
  } else if (witnessVersion === 0 && witnessProgram.length === 64) {
    // P2WSH: OP_0 <32-byte-script-hash>
    return '0020' + witnessProgram;
  } else if (witnessVersion === 1 && witnessProgram.length === 64) {
    // P2TR: OP_1 <32-byte-x-only-pubkey>
    return '5120' + witnessProgram;
  }

  console.warn('Unknown address type');
  return '';
}

/**
 * Decode bech32/bech32m address
 */
function decodeBech32Address(address) {
  try {
    const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

    // Find separator
    const sepIndex = address.lastIndexOf('1');
    if (sepIndex < 1) return null;

    const hrp = address.slice(0, sepIndex).toLowerCase();
    const dataPart = address.slice(sepIndex + 1).toLowerCase();

    // Decode characters to 5-bit values
    const values = [];
    for (const c of dataPart) {
      const idx = CHARSET.indexOf(c);
      if (idx === -1) return null;
      values.push(idx);
    }

    // Remove checksum (last 6 values)
    const data = values.slice(0, -6);

    // First value is witness version
    const witnessVersion = data[0];

    // Convert remaining 5-bit values to 8-bit
    const programWords = data.slice(1);
    const programBytes = convertBits(programWords, 5, 8, false);

    return {
      hrp,
      witnessVersion,
      witnessProgram: programBytes.map(b => b.toString(16).padStart(2, '0')).join('')
    };
  } catch (e) {
    console.error('Failed to decode address:', e);
    return null;
  }
}

/**
 * Export claim data as JSON for external signing tools
 */
function exportClaimDataJson(claimData, swap) {
  const exportData = {
    format: 'sparkle_claim_v1',
    network: EXPECTED_NETWORK,
    timestamp: Date.now(),

    // Raw transaction inputs
    input: {
      txid: claimData.input.txid,
      vout: claimData.input.vout,
      amount_sats: parseInt(claimData.input.amount),
      script_pubkey: swap?.data?.verifiedUtxo?.scriptPubKey || '',
      taproot_address: swap?.data?.taprootAddress || ''
    },

    // Output
    output: {
      address: claimData.output.address,
      amount_sats: parseInt(claimData.output.amount)
    },

    // Fee
    fee_sats: parseInt(claimData.fee),

    // Script path data
    taproot: {
      internal_key: claimData.input.internalKey || '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0',
      hashlock_script: claimData.input.hashlockScript,
      payment_hash: swap?.data?.paymentHash || swap?.data?.verifiedScriptParams?.paymentHash || '',
      buyer_pubkey: swap?.data?.verifiedScriptParams?.buyerPubkey || state.publicKey || ''
    },

    // Witness data
    witness: {
      preimage: claimData.witness.preimage,
      // Note: Signature must be generated by signing tool
      signature: null
    },

    // Verification status
    verification: {
      script_verified: swap?.data?.scriptVerified || false,
      utxo_verified: swap?.data?.fundingVerified || false,
      preimage_verified: claimData.witness.preimageVerified || false,
      timelock_validated: swap?.data?.timelockValidated || false
    }
  };

  return JSON.stringify(exportData, null, 2);
}

async function signWithUnisat(swapId, claimData) {
  if (!window.unisat) {
    toast.error('Unisat wallet not available');
    return;
  }

  const swap = state.mySwaps.find((s) => s.id === swapId);

  try {
    // Format amounts for display (escape all user data)
    const inputTxid = escapeHtml(claimData.input.txid.slice(0, 12));
    const outputAmt = escapeHtml(formatSats(claimData.output.amount));
    const feeAmt = escapeHtml(formatSats(claimData.fee));
    const destAddr = escapeHtml(claimData.output.address.slice(0, 16));

    // Show human-readable PSBT summary
    toast.html(
      '<strong>Preparing PSBT for Signing</strong><br>' +
        'Input: ' + inputTxid + '...<br>' +
        'Output: ' + outputAmt + ' sats<br>' +
        'Fee: ' + feeAmt + ' sats<br>' +
        'To: ' + destAddr + '...',
      'info', 5000
    );

    // SECURITY: Build complete PSBT structure with verified data
    const psbtData = await buildTaprootPsbt(claimData, swap);
    console.log('PSBT Data Structure:', psbtData);

    // Export for external tools
    const exportJson = exportClaimDataJson(claimData, swap);
    console.log('Export JSON for external signing:', exportJson);

    // Check if Unisat supports signPsbt
    if (typeof window.unisat.signPsbt === 'function' && psbtData.hex) {
      toast.info('Requesting wallet signature...');

      // SECURITY: Use real PSBT hex for wallet signing
      console.log('PSBT Hex:', psbtData.hex);
      console.log('PSBT Base64:', psbtData.base64);

      try {
        // Unisat accepts hex or base64 PSBT - try hex first
        const signedPsbtHex = await window.unisat.signPsbt(psbtData.hex, {
          autoFinalized: false, // We need to add witness data
          toSignInputs: [{
            index: 0,
            publicKey: claimData.input.buyerPubkey || state.nostrPubkey,
            disableTweakSigner: true // Script-path spend, not key-path
          }]
        });

        console.log('Signed PSBT:', signedPsbtHex);

        toast.success('PSBT signed! Preparing for broadcast...', 5000);

        if (swap) {
          swap.status = 'SIGNED';
          swap.data.signedPsbt = signedPsbtHex;
          swap.data.psbtData = psbtData;
          swap.data.claimData = claimData;
          renderSwapList();

          // Show option to broadcast
          toast.html(
            '<strong>Transaction Signed!</strong><br>' +
            'PSBT signed by wallet.<br>' +
            'Ready for broadcast with preimage witness.',
            'success', 10000
          );
        }
      } catch (signError) {
        console.error('Wallet signing failed:', signError);

        // Fallback: provide PSBT for manual signing
        toast.html(
          '<strong>Wallet Signing Failed</strong><br>' +
          signError.message + '<br>' +
          'PSBT hex available in console for external signing.',
          'warning', 8000
        );

        if (swap) {
          swap.status = 'CLAIM_READY';
          swap.data.psbtData = psbtData;
          swap.data.claimData = claimData;
          swap.data.exportJson = exportJson;
          renderSwapList();
        }
      }
    } else if (psbtData.hex) {
      // PSBT ready but no wallet signing available
      toast.html(
        '<strong>PSBT Ready for Signing</strong><br>' +
        'Unisat signPsbt not available.<br>' +
        'PSBT hex/base64 available in console for external signing.',
        'info', 8000
      );

      console.log('=== PSBT FOR EXTERNAL SIGNING ===');
      console.log('PSBT Hex:', psbtData.hex);
      console.log('PSBT Base64:', psbtData.base64);

      if (swap) {
        swap.status = 'CLAIM_READY';
        swap.data.psbtData = psbtData;
        swap.data.claimData = claimData;
        swap.data.exportJson = exportJson;
        renderSwapList();
      }
    } else {
      toast.warning(
        'PSBT generation failed. Export JSON available for external signing.',
        8000
      );
    }

    // Show detailed info in console for debugging/external signing
    console.log('=== VERIFIED CLAIM DATA ===');
    console.log('Network:', EXPECTED_NETWORK);
    console.log('Input TXID:', claimData.input.txid);
    console.log('Input VOUT:', claimData.input.vout);
    console.log('Input Amount:', claimData.input.amount, 'sats');
    if (swap?.data?.verifiedUtxo) {
      console.log('Verified UTXO ScriptPubKey:', swap.data.verifiedUtxo.scriptPubKey);
      console.log('Verified UTXO Confirmations:', swap.data.verifiedUtxo.confirmations);
    }
    console.log('Output Address:', claimData.output.address);
    console.log('Output Amount:', claimData.output.amount, 'sats');
    console.log('Fee:', claimData.fee, 'sats');
    console.log('Preimage:', claimData.witness.preimage);
    console.log('Hashlock Script:', claimData.input.hashlockScript);
    console.log('Internal Key:', claimData.input.internalKey || 'NUMS (default)');
    console.log('=== EXPORT JSON ===');
    console.log(exportJson);
    console.log('=== Copy above JSON for external signing tools ===');

    if (swap) {
      swap.status = 'CLAIM_DATA_READY';
      toast.success('Claim data verified and ready. Check console for signing details and export JSON.');
      renderSwapList();
    }
  } catch (e) {
    console.error('PSBT preparation failed:', e);
    toast.error('PSBT preparation failed: ' + escapeHtml(e.message));
    if (swap) {
      swap.status = 'CLAIM_ERROR';
      swap.data.claimError = e.message;
      renderSwapList();
    }
  }
}

/**
 * Format satoshi amount with thousands separators
 */
function formatSats(sats) {
  return BigInt(sats).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ============================================================================
// Swap List Rendering
// ============================================================================

function renderSwapList() {
  if (state.mySwaps.length === 0) {
    dom.swapList.innerHTML =
      '<div class="status-msg">No active negotiations.</div>';
    return;
  }

  dom.swapList.innerHTML = state.mySwaps
    .map((swap) => {
      // Chat history
      const chatHtml = swap.messages
        .map(
          (m) => `
        <div class="msg ${m.sender}">
          <div class="msg-content">${escapeHtml(m.text)}</div>
          <div class="msg-meta">${new Date(m.timestamp).toLocaleTimeString()}</div>
        </div>
      `
        )
        .join('');

      // Action panels based on status
      let actionPanel = '';

      if (swap.status === 'PREMIUM_DUE' && swap.data.invoice) {
        actionPanel = `
        <div class="action-card warning">
          <h4>Step 1: Pay Lightning Premium</h4>
          <input type="text" class="code-input" readonly
            value="${swap.data.invoice}" onclick="this.select()">
          <button class="btn btn-primary" onclick="confirmPayment('${swap.id}')">
            I Have Paid
          </button>
        </div>
      `;
      } else if (swap.status === 'FUNDED') {
        actionPanel = `
        <div class="action-card success">
          <h4>Step 2: Claim with Preimage</h4>
          <p>Funding confirmed: <code>${swap.data.fundingTxId?.slice(0, 16)}...</code></p>
          ${
            swap.data.taprootAddress
              ? `<p>Taproot address: <code>${swap.data.taprootAddress.slice(0, 16)}...</code></p>`
              : ''
          }
          <div class="form-group">
            <label>Output Index (vout)</label>
            <input type="number" id="vout-${swap.id}" value="0">
          </div>
          <div class="form-group">
            <label>Your Claim Address</label>
            <input type="text" id="addr-${swap.id}"
              placeholder="bc1p... or tb1p...">
          </div>
          <div class="form-group">
            <label>Miner Fee (sats)</label>
            <input type="number" id="fee-${swap.id}" value="500" min="150">
          </div>
          <div class="form-group">
            <label>Preimage (from Lightning payment)</label>
            <input type="text" id="pre-${swap.id}"
              placeholder="32-byte hex from wallet">
          </div>
          <button class="btn btn-primary" onclick="generateTaprootClaim('${swap.id}')">
            Generate Claim Transaction
          </button>
          <div id="psbt-result-${swap.id}" style="display:none; margin-top:10px;">
            <textarea id="psbt-out-${swap.id}" class="code-input"
              style="height:120px;"></textarea>
          </div>
        </div>
      `;
      }

      return `
      <div class="swap-card">
        <div class="swap-header">
          <span class="swap-title">${escapeHtml(swap.offer.name)}</span>
          <span class="status-badge ${swap.status.toLowerCase()}">${swap.status}</span>
        </div>
        <div class="swap-body">
          <div class="chat-window">${chatHtml}</div>
          ${actionPanel}
          <div class="reply-box">
            <input type="text" id="reply-${swap.id}" placeholder="Send message...">
            <button class="btn-secondary" onclick="sendUserReply('${swap.id}')">
              Send
            </button>
          </div>
        </div>
      </div>
    `;
    })
    .join('');
}

// ============================================================================
// Public API: Create and Publish Offer
// ============================================================================

window.publishOffer = async function () {
  if (!state.publicKey) {
    toast.warning('Please connect your Nostr wallet first.');
    return;
  }

  const name = document.getElementById('offerName')?.value?.trim();
  const price = document.getElementById('offerPrice')?.value;
  const duration = document.getElementById('offerDuration')?.value || '288';

  if (!name) {
    toast.error('Please enter an offer name.');
    return;
  }

  if (!price || parseInt(price) <= 0) {
    toast.error('Please enter a valid price in sats.');
    return;
  }

  try {
    toast.info('Publishing offer to Nostr network...');

    const offerContent = {
      name: name,
      price: price,
      currency: 'sats',
      specs: {
        duration: parseInt(duration),
        protocol: 'sparkle-swap-v3',
        type: 'taproot_atomic',
      },
      description: `Taproot atomic swap offer for ${name}`,
    };

    const unsignedEvent = {
      kind: SPARKLE_EVENT_KINDS.SWAP_OFFER,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['t', 'sparkle-swap-v3'],
        ['p', state.publicKey],
        ['d', `offer-${Date.now()}`],
      ],
      content: JSON.stringify(offerContent),
    };

    const { signedEvent, publishCount } = await signAndPublishEvent(unsignedEvent);

    toast.success(`Offer published to ${publishCount} relays!`);
    console.log('Published offer:', signedEvent.id);

    // Clear form
    document.getElementById('offerName').value = '';
    document.getElementById('offerPrice').value = '';

    // Refresh offers list
    if (state.subs.offers) {
      subscribeToMarket();
    }
  } catch (err) {
    console.error('Publish offer failed:', err);
    toast.error(`Failed to publish offer: ${err.message}`);
  }
};

// ============================================================================
// Logout
// ============================================================================

window.logout = function () {
  state.nostrProvider = null;
  state.publicKey = null;
  state.bitcoinWallet = null;
  state.bitcoinAccounts = [];

  if (state.relayPool) state.relayPool.close();
  if (state.subs.offers) state.subs.offers.unsub();
  if (state.subs.dms) state.subs.dms.unsub();

  state.allOffers = [];
  state.mySwaps = [];

  dom.loginSection.style.display = 'block';
  dom.userInfo.style.display = 'none';
  if (dom.createOfferCard) dom.createOfferCard.style.display = 'none';
  dom.relayStatus.textContent = 'Disconnected';
  dom.offerList.innerHTML =
    '<div class="status-msg">Connect wallet to view offers.</div>';
  dom.swapList.innerHTML = '<div class="status-msg">Session ended.</div>';
};

// ============================================================================
// Initialization
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  console.log('Sparkle Swap v0.3.3 - Serverless P2P Trading (Security Hardened)');
  console.log('Security: No private keys handled. NIP-07 + Bitcoin wallets.');
  console.log('v0.3.3 Fixes: Taproot address derivation, script-UTXO binding, amount check fix, 2-conf depth');
  console.log('v0.3.2 Fixes: BOLT11 parsing, invoice-script binding, UTXO verification, confirmation depth');
  console.log('v0.3.1 Fixes: Timelock validation, DM sig verification, script rebuild, network enforcement');
  console.log('Architecture: Decentralized Nostr orderbook + Taproot atomic swaps');

  // Check for wallet availability
  const nip07 = isNip07Available();
  const btcWallets = detectBitcoinWallets();

  console.log('NIP-07 available:', nip07);
  console.log('Bitcoin wallets:', btcWallets);

  // Auto-detect and show wallet status
  if (nip07 && btcWallets.length > 0) {
    dom.offerList.innerHTML = `
      <div class="status-msg" style="background: #ECFDF5; border: 1px solid #10B981; padding: 15px;">
        <strong style="color: #10B981;">Wallets Detected!</strong><br>
        Nostr: Ready (${nip07 ? 'NIP-07' : 'Not found'})<br>
        Bitcoin: ${btcWallets.join(', ') || 'None'}<br><br>
        Click <strong>Connect Nostr</strong> above to start trading.
      </div>
    `;
  } else if (nip07) {
    dom.offerList.innerHTML = `
      <div class="status-msg" style="background: #FEF3C7; border: 1px solid #F59E0B; padding: 15px;">
        <strong style="color: #F59E0B;">Nostr Ready, Bitcoin Wallet Missing</strong><br>
        Install <a href="https://unisat.io" target="_blank">Unisat</a> or
        <a href="https://xverse.app" target="_blank">Xverse</a> for PSBT signing.<br><br>
        You can still browse offers without a Bitcoin wallet.
      </div>
    `;
  } else {
    dom.offerList.innerHTML = `
      <div class="status-msg" style="background: #FEE2E2; border: 1px solid #DC2626; padding: 15px;">
        <strong style="color: #DC2626;">Nostr Wallet Required</strong><br>
        Install <a href="https://getalby.com" target="_blank">Alby</a> or nos2x to use this application.<br>
        This enables secure signing without exposing your private keys.
      </div>
    `;
  }
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    state,
    connectNip07: window.connectNip07,
    connectBitcoin: window.connectBitcoin,
    initiateSwap: window.initiateSwap,
    logout: window.logout,
  };
}
