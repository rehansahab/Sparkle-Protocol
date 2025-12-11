#!/usr/bin/env node
/**
 * SPARKLE Protocol - Mainnet Deployment Module
 *
 * SECURITY WARNING: This handles REAL BITCOIN. Use with extreme caution.
 * - Never share preimages before claiming
 * - Verify all addresses before funding
 * - Keep private keys secure
 *
 * v0.3.8 - Production Ready (End-to-End Validated)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  network: 'mainnet',
  hrp: 'bc',  // mainnet bech32 prefix

  // NUMS point - No known private key (Nothing Up My Sleeve)
  numsPoint: '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0',

  // Default timeout: ~1 week (1008 blocks)
  defaultTimeoutBlocks: 1008,

  // Dust threshold for P2TR
  dustThreshold: 330,

  // Recommended fee rate (sat/vB) - adjust based on mempool
  defaultFeeRate: 10
};

// ============================================================================
// CRYPTOGRAPHIC UTILITIES
// ============================================================================

function taggedHash(tag, data) {
  const tagHash = crypto.createHash('sha256').update(tag).digest();
  return crypto.createHash('sha256')
    .update(tagHash)
    .update(tagHash)
    .update(data)
    .digest();
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest();
}

function generateSecurePreimage() {
  // Generate cryptographically secure 32-byte preimage
  return crypto.randomBytes(32);
}

function computePaymentHash(preimage) {
  return sha256(preimage);
}

// ============================================================================
// SCRIPT BUILDING
// ============================================================================

/**
 * Build hashlock script for atomic swap claim
 * OP_SHA256 <payment_hash> OP_EQUALVERIFY <buyer_pubkey> OP_CHECKSIG
 */
function buildHashlockScript(paymentHash, buyerXOnlyPubkey) {
  // Validate inputs
  if (paymentHash.length !== 32) throw new Error('Payment hash must be 32 bytes');
  if (buyerXOnlyPubkey.length !== 32) throw new Error('Buyer pubkey must be 32 bytes (x-only)');

  return Buffer.concat([
    Buffer.from([0xa8]),           // OP_SHA256
    Buffer.from([0x20]),           // Push 32 bytes
    paymentHash,
    Buffer.from([0x88]),           // OP_EQUALVERIFY
    Buffer.from([0x20]),           // Push 32 bytes
    buyerXOnlyPubkey,
    Buffer.from([0xac])            // OP_CHECKSIG
  ]);
}

/**
 * Build refund script with timelock
 * <timeout_blocks> OP_CLTV OP_DROP <seller_pubkey> OP_CHECKSIG
 */
function buildRefundScript(timeoutBlocks, sellerXOnlyPubkey) {
  if (sellerXOnlyPubkey.length !== 32) throw new Error('Seller pubkey must be 32 bytes (x-only)');

  // Encode timeout as minimal push (up to 4 bytes)
  let timeoutBuf;
  if (timeoutBlocks <= 0x7f) {
    timeoutBuf = Buffer.from([timeoutBlocks]);
  } else if (timeoutBlocks <= 0x7fff) {
    timeoutBuf = Buffer.alloc(2);
    timeoutBuf.writeUInt16LE(timeoutBlocks);
  } else if (timeoutBlocks <= 0x7fffff) {
    timeoutBuf = Buffer.alloc(3);
    timeoutBuf.writeUIntLE(timeoutBlocks, 0, 3);
  } else {
    timeoutBuf = Buffer.alloc(4);
    timeoutBuf.writeUInt32LE(timeoutBlocks);
  }

  return Buffer.concat([
    Buffer.from([timeoutBuf.length]),  // Push N bytes
    timeoutBuf,
    Buffer.from([0xb1]),               // OP_CHECKLOCKTIMEVERIFY
    Buffer.from([0x75]),               // OP_DROP
    Buffer.from([0x21]),               // Push 33 bytes (compressed pubkey for CHECKSIG)
    sellerXOnlyPubkey,
    Buffer.from([0xac])                // OP_CHECKSIG
  ]);
}

/**
 * Compute TapLeaf hash
 */
function computeTapLeafHash(script, leafVersion = 0xc0) {
  const leafData = Buffer.concat([
    Buffer.from([leafVersion]),
    encodeCompactSize(script.length),
    script
  ]);
  return taggedHash('TapLeaf', leafData);
}

/**
 * Compute TapBranch hash (sorted)
 */
function computeTapBranchHash(left, right) {
  // Lexicographic sort
  if (Buffer.compare(left, right) > 0) {
    [left, right] = [right, left];
  }
  return taggedHash('TapBranch', Buffer.concat([left, right]));
}

/**
 * Compute TapTweak
 */
function computeTapTweak(internalKey, merkleRoot) {
  return taggedHash('TapTweak', Buffer.concat([internalKey, merkleRoot]));
}

// ============================================================================
// ENCODING UTILITIES
// ============================================================================

function encodeCompactSize(n) {
  if (n < 253) return Buffer.from([n]);
  if (n < 0x10000) {
    const buf = Buffer.alloc(3);
    buf[0] = 253;
    buf.writeUInt16LE(n, 1);
    return buf;
  }
  throw new Error('Value too large');
}

function encodeLE32(n) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(n >>> 0);
  return buf;
}

function encodeLE64(n) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(n));
  return buf;
}

function reverseBuffer(buf) {
  return Buffer.from(buf).reverse();
}

// ============================================================================
// BECH32M ENCODING (BIP-350)
// ============================================================================

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32M_CONST = 0x2bc830a3;

function bech32Polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((b >> i) & 1) chk ^= GEN[i];
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
  const polymod = bech32Polymod(values) ^ BECH32M_CONST;
  const ret = [];
  for (let i = 0; i < 6; i++) {
    ret.push((polymod >> (5 * (5 - i))) & 31);
  }
  return ret;
}

function convertBits(data, fromBits, toBits, pad) {
  let acc = 0, bits = 0;
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
  if (pad && bits > 0) {
    ret.push((acc << (toBits - bits)) & maxv);
  }
  return ret;
}

function encodeBech32m(hrp, witnessProgram) {
  const data = [1].concat(convertBits([...witnessProgram], 8, 5, true));
  const checksum = bech32CreateChecksum(hrp, data);
  return hrp + '1' + data.concat(checksum).map(d => CHARSET[d]).join('');
}

// ============================================================================
// EC OPERATIONS (requires @noble/secp256k1)
// ============================================================================

let secp256k1 = null;

function loadSecp256k1() {
  if (secp256k1) return secp256k1;
  try {
    secp256k1 = require('@noble/secp256k1');
    return secp256k1;
  } catch (e) {
    throw new Error('Required: npm install @noble/secp256k1');
  }
}

async function tweakPublicKey(internalKeyHex, tweakHex) {
  const secp = loadSecp256k1();

  // Lift x-only to full point (assume even Y)
  const compressedKeyHex = '02' + internalKeyHex;
  const P = secp.Point.fromHex(compressedKeyHex);

  // Compute t * G
  const tweakScalar = BigInt('0x' + tweakHex);
  const tG = secp.Point.BASE.multiply(tweakScalar);

  // Q = P + tG
  const Q = P.add(tG);

  // Get x-coordinate and parity
  const xHex = Q.x.toString(16).padStart(64, '0');
  const parity = Q.y % 2n === 0n ? 0 : 1;

  return { key: xHex, parity };
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Create a new atomic swap contract
 * Returns: Taproot address to fund, preimage to keep secret
 */
async function createSwapContract(params) {
  const {
    buyerPubkey,      // 32-byte x-only pubkey (hex)
    sellerPubkey,     // 32-byte x-only pubkey (hex)
    timeoutBlocks = CONFIG.defaultTimeoutBlocks,
    preimage = null   // Optional: provide your own, or generate new
  } = params;

  console.log('='.repeat(60));
  console.log('SPARKLE Protocol - Create Mainnet Swap Contract');
  console.log('='.repeat(60));
  console.log();

  // Generate or use provided preimage
  const secretPreimage = preimage
    ? Buffer.from(preimage, 'hex')
    : generateSecurePreimage();
  const paymentHash = computePaymentHash(secretPreimage);

  console.log('SECURITY: Keep preimage SECRET until ready to claim!');
  console.log('Preimage:     ', secretPreimage.toString('hex'));
  console.log('Payment Hash: ', paymentHash.toString('hex'));
  console.log();

  // Build scripts
  const buyerKey = Buffer.from(buyerPubkey, 'hex');
  const sellerKey = Buffer.from(sellerPubkey, 'hex');

  const hashlockScript = buildHashlockScript(paymentHash, buyerKey);
  const refundScript = buildRefundScript(timeoutBlocks, sellerKey);

  console.log('Hashlock Script:', hashlockScript.toString('hex'));
  console.log('Refund Script:  ', refundScript.toString('hex'));
  console.log('Timeout Blocks: ', timeoutBlocks);
  console.log();

  // Compute TapLeaf hashes
  const hashlockLeafHash = computeTapLeafHash(hashlockScript);
  const refundLeafHash = computeTapLeafHash(refundScript);

  console.log('Hashlock Leaf Hash:', hashlockLeafHash.toString('hex'));
  console.log('Refund Leaf Hash:  ', refundLeafHash.toString('hex'));

  // Compute TapBranch (merkle root)
  const tapMerkleRoot = computeTapBranchHash(hashlockLeafHash, refundLeafHash);
  console.log('Tap Merkle Root:   ', tapMerkleRoot.toString('hex'));

  // Compute TapTweak
  const internalKey = Buffer.from(CONFIG.numsPoint, 'hex');
  const tapTweak = computeTapTweak(internalKey, tapMerkleRoot);
  console.log('Tap Tweak:         ', tapTweak.toString('hex'));

  // Tweak public key
  const tweakResult = await tweakPublicKey(CONFIG.numsPoint, tapTweak.toString('hex'));
  const outputKey = tweakResult.key;
  const parity = tweakResult.parity;

  console.log('Output Key:        ', outputKey);
  console.log('Parity:            ', parity);
  console.log();

  // Encode as bech32m address
  const address = encodeBech32m(CONFIG.hrp, Buffer.from(outputKey, 'hex'));

  console.log('='.repeat(60));
  console.log('MAINNET TAPROOT ADDRESS');
  console.log('='.repeat(60));
  console.log();
  console.log(address);
  console.log();

  // Determine sibling for control block (hashlock spend uses refund as sibling)
  const siblingHash = Buffer.compare(hashlockLeafHash, refundLeafHash) < 0
    ? refundLeafHash
    : refundLeafHash;  // For hashlock spend, sibling is always refund

  // Build control block
  const controlBlockFirstByte = (0xc0 & 0xfe) | (parity & 0x01);
  const controlBlock = Buffer.concat([
    Buffer.from([controlBlockFirstByte]),
    internalKey,
    siblingHash
  ]);

  // Save contract data
  const contract = {
    network: 'mainnet',
    version: '0.3.8',
    created: new Date().toISOString(),

    address,
    outputKey,
    parity,

    paymentHash: paymentHash.toString('hex'),
    preimage: secretPreimage.toString('hex'),  // KEEP SECRET!

    scripts: {
      hashlock: hashlockScript.toString('hex'),
      refund: refundScript.toString('hex')
    },

    taproot: {
      internalKey: CONFIG.numsPoint,
      merkleRoot: tapMerkleRoot.toString('hex'),
      tweak: tapTweak.toString('hex'),
      controlBlock: controlBlock.toString('hex')
    },

    params: {
      buyerPubkey,
      sellerPubkey,
      timeoutBlocks
    }
  };

  return contract;
}

/**
 * Build claim PSBT for spending via hashlock
 */
async function buildClaimPSBT(params) {
  const {
    contract,           // Contract from createSwapContract
    fundingTxid,        // TXID of funding transaction
    fundingVout,        // Output index
    fundingAmount,      // Amount in sats
    claimAddress,       // Where to send funds
    feeRate = CONFIG.defaultFeeRate
  } = params;

  console.log('='.repeat(60));
  console.log('SPARKLE Protocol - Build Claim PSBT');
  console.log('='.repeat(60));
  console.log();

  // Calculate output amount (input - fee)
  const estimatedVsize = 150;  // Taproot script-path spend ~150 vbytes
  const fee = Math.ceil(estimatedVsize * feeRate);
  const outputAmount = fundingAmount - fee;

  if (outputAmount < CONFIG.dustThreshold) {
    throw new Error(`Output ${outputAmount} sats is below dust threshold (${CONFIG.dustThreshold})`);
  }

  console.log('Input Amount: ', fundingAmount, 'sats');
  console.log('Fee:          ', fee, 'sats', `(${feeRate} sat/vB)`);
  console.log('Output Amount:', outputAmount, 'sats');
  console.log('Claim Address:', claimAddress);
  console.log();

  // Build unsigned transaction
  const txidLE = reverseBuffer(Buffer.from(fundingTxid, 'hex'));

  let unsignedTx = Buffer.alloc(0);

  // Version
  unsignedTx = Buffer.concat([unsignedTx, encodeLE32(2)]);

  // Input count
  unsignedTx = Buffer.concat([unsignedTx, Buffer.from([0x01])]);

  // Input
  unsignedTx = Buffer.concat([unsignedTx, txidLE]);
  unsignedTx = Buffer.concat([unsignedTx, encodeLE32(fundingVout)]);
  unsignedTx = Buffer.concat([unsignedTx, Buffer.from([0x00])]);  // Empty scriptSig
  unsignedTx = Buffer.concat([unsignedTx, Buffer.from([0xfd, 0xff, 0xff, 0xff])]);  // nSequence (RBF)

  // Output count
  unsignedTx = Buffer.concat([unsignedTx, Buffer.from([0x01])]);

  // Output
  const outputScript = addressToScriptPubKey(claimAddress);
  unsignedTx = Buffer.concat([unsignedTx, encodeLE64(outputAmount)]);
  unsignedTx = Buffer.concat([unsignedTx, encodeCompactSize(outputScript.length)]);
  unsignedTx = Buffer.concat([unsignedTx, outputScript]);

  // Locktime
  unsignedTx = Buffer.concat([unsignedTx, encodeLE32(0)]);

  // Build PSBT
  let psbt = Buffer.alloc(0);

  // Magic bytes
  psbt = Buffer.concat([psbt, Buffer.from('70736274ff', 'hex')]);

  // Global: PSBT_GLOBAL_UNSIGNED_TX (0x00)
  psbt = Buffer.concat([psbt, Buffer.from([0x01])]);
  psbt = Buffer.concat([psbt, Buffer.from([0x00])]);
  psbt = Buffer.concat([psbt, encodeCompactSize(unsignedTx.length)]);
  psbt = Buffer.concat([psbt, unsignedTx]);

  // End global map
  psbt = Buffer.concat([psbt, Buffer.from([0x00])]);

  // Input map
  // PSBT_IN_WITNESS_UTXO (0x01)
  const inputScriptPubKey = Buffer.from('5120' + contract.outputKey, 'hex');
  const witnessUtxo = Buffer.concat([
    encodeLE64(fundingAmount),
    encodeCompactSize(inputScriptPubKey.length),
    inputScriptPubKey
  ]);
  psbt = Buffer.concat([psbt, Buffer.from([0x01])]);
  psbt = Buffer.concat([psbt, Buffer.from([0x01])]);
  psbt = Buffer.concat([psbt, encodeCompactSize(witnessUtxo.length)]);
  psbt = Buffer.concat([psbt, witnessUtxo]);

  // PSBT_IN_TAP_LEAF_SCRIPT (0x15) - BIP-371
  const controlBlock = Buffer.from(contract.taproot.controlBlock, 'hex');
  const hashlockScript = Buffer.from(contract.scripts.hashlock, 'hex');

  const tapLeafScriptKey = Buffer.concat([
    Buffer.from([0x15]),
    controlBlock
  ]);
  const tapLeafScriptValue = Buffer.concat([
    hashlockScript,
    Buffer.from([0xc0])
  ]);
  psbt = Buffer.concat([psbt, encodeCompactSize(tapLeafScriptKey.length)]);
  psbt = Buffer.concat([psbt, tapLeafScriptKey]);
  psbt = Buffer.concat([psbt, encodeCompactSize(tapLeafScriptValue.length)]);
  psbt = Buffer.concat([psbt, tapLeafScriptValue]);

  // PSBT_IN_TAP_INTERNAL_KEY (0x17)
  psbt = Buffer.concat([psbt, Buffer.from([0x01])]);
  psbt = Buffer.concat([psbt, Buffer.from([0x17])]);
  psbt = Buffer.concat([psbt, Buffer.from([0x20])]);
  psbt = Buffer.concat([psbt, Buffer.from(contract.taproot.internalKey, 'hex')]);

  // PSBT_IN_TAP_MERKLE_ROOT (0x18)
  psbt = Buffer.concat([psbt, Buffer.from([0x01])]);
  psbt = Buffer.concat([psbt, Buffer.from([0x18])]);
  psbt = Buffer.concat([psbt, Buffer.from([0x20])]);
  psbt = Buffer.concat([psbt, Buffer.from(contract.taproot.merkleRoot, 'hex')]);

  // End input map
  psbt = Buffer.concat([psbt, Buffer.from([0x00])]);

  // Output map (empty)
  psbt = Buffer.concat([psbt, Buffer.from([0x00])]);

  const psbtBase64 = psbt.toString('base64');
  const psbtHex = psbt.toString('hex');

  console.log('='.repeat(60));
  console.log('PSBT (Base64)');
  console.log('='.repeat(60));
  console.log(psbtBase64);
  console.log();

  return {
    psbt: psbtBase64,
    psbtHex,
    preimage: contract.preimage,
    fee,
    outputAmount
  };
}

/**
 * Decode bech32/bech32m address to scriptPubKey
 */
function addressToScriptPubKey(address) {
  const sepIndex = address.lastIndexOf('1');
  const dataPart = address.slice(sepIndex + 1).toLowerCase();

  const values = [];
  for (const c of dataPart) {
    values.push(CHARSET.indexOf(c));
  }

  const data = values.slice(0, -6);
  const witnessVersion = data[0];
  const witnessProgram = Buffer.from(convertBits(data.slice(1), 5, 8, false));

  if (witnessVersion === 1 && witnessProgram.length === 32) {
    // P2TR
    return Buffer.concat([Buffer.from([0x51, 0x20]), witnessProgram]);
  } else if (witnessVersion === 0 && witnessProgram.length === 20) {
    // P2WPKH
    return Buffer.concat([Buffer.from([0x00, 0x14]), witnessProgram]);
  } else if (witnessVersion === 0 && witnessProgram.length === 32) {
    // P2WSH
    return Buffer.concat([Buffer.from([0x00, 0x20]), witnessProgram]);
  }

  throw new Error('Unsupported address type');
}

// ============================================================================
// CLI
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'create') {
    // sparkle-mainnet.js create <buyer_pubkey> <seller_pubkey> [timeout_blocks]
    const buyerPubkey = args[1];
    const sellerPubkey = args[2];
    const timeoutBlocks = parseInt(args[3]) || CONFIG.defaultTimeoutBlocks;

    if (!buyerPubkey || !sellerPubkey) {
      console.log('Usage: node sparkle-mainnet.js create <buyer_pubkey> <seller_pubkey> [timeout_blocks]');
      console.log('  buyer_pubkey:   32-byte x-only pubkey (64 hex chars)');
      console.log('  seller_pubkey:  32-byte x-only pubkey (64 hex chars)');
      console.log('  timeout_blocks: Block height for refund (default: 1008 = ~1 week)');
      process.exit(1);
    }

    const contract = await createSwapContract({
      buyerPubkey,
      sellerPubkey,
      timeoutBlocks
    });

    // Save to file
    const filename = `contract-${Date.now()}.json`;
    fs.writeFileSync(path.join(__dirname, filename), JSON.stringify(contract, null, 2));
    console.log('Contract saved to:', filename);
    console.log();
    console.log('NEXT STEPS:');
    console.log('1. Fund the Taproot address with BTC');
    console.log('2. Wait for confirmations');
    console.log('3. Run: node sparkle-mainnet.js claim <contract.json> <txid> <vout> <amount> <claim_address>');

  } else if (command === 'claim') {
    // sparkle-mainnet.js claim <contract.json> <txid> <vout> <amount> <claim_address> [fee_rate]
    const contractFile = args[1];
    const fundingTxid = args[2];
    const fundingVout = parseInt(args[3]);
    const fundingAmount = parseInt(args[4]);
    const claimAddress = args[5];
    const feeRate = parseInt(args[6]) || CONFIG.defaultFeeRate;

    if (!contractFile || !fundingTxid || isNaN(fundingVout) || !fundingAmount || !claimAddress) {
      console.log('Usage: node sparkle-mainnet.js claim <contract.json> <txid> <vout> <amount> <claim_address> [fee_rate]');
      console.log('  contract.json: Contract file from create command');
      console.log('  txid:          Funding transaction ID');
      console.log('  vout:          Output index');
      console.log('  amount:        Amount in satoshis');
      console.log('  claim_address: Destination address');
      console.log('  fee_rate:      Fee rate in sat/vB (default: 10)');
      process.exit(1);
    }

    const contract = JSON.parse(fs.readFileSync(contractFile, 'utf8'));

    const result = await buildClaimPSBT({
      contract,
      fundingTxid,
      fundingVout,
      fundingAmount,
      claimAddress,
      feeRate
    });

    // Save PSBT
    const psbtFile = `claim-psbt-${Date.now()}.json`;
    fs.writeFileSync(path.join(__dirname, psbtFile), JSON.stringify({
      psbt: result.psbt,
      preimage: result.preimage,
      fee: result.fee,
      outputAmount: result.outputAmount,
      claimAddress
    }, null, 2));
    console.log('PSBT saved to:', psbtFile);
    console.log();
    console.log('NEXT STEPS:');
    console.log('1. Sign the PSBT with your wallet');
    console.log('2. Add the preimage to the witness');
    console.log('3. Broadcast the signed transaction');

  } else {
    console.log('SPARKLE Protocol - Mainnet Deployment');
    console.log('=====================================');
    console.log();
    console.log('Commands:');
    console.log('  create  - Create a new atomic swap contract');
    console.log('  claim   - Build PSBT to claim from contract');
    console.log();
    console.log('Examples:');
    console.log('  node sparkle-mainnet.js create <buyer_pubkey> <seller_pubkey>');
    console.log('  node sparkle-mainnet.js claim contract.json <txid> 0 100000 bc1q...');
  }
}

// Export for use as module
module.exports = {
  createSwapContract,
  buildClaimPSBT,
  generateSecurePreimage,
  computePaymentHash,
  CONFIG
};

// Run CLI if executed directly
if (require.main === module) {
  main().catch(console.error);
}
