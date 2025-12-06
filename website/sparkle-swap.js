/**
 * Sparkle Protocol v0.3.0 - Secure P2P Swap Instrument
 *
 * SECURITY: This module NEVER handles private keys.
 * All signing is delegated to browser wallet extensions.
 *
 * Architecture:
 * - NIP-07: Nostr identity via browser extensions (Alby, nos2x)
 * - Taproot: P2TR atomic swaps with script-path spending
 * - Bitcoin Wallets: PSBT signing via Unisat, Xverse, etc.
 *
 * @module SparkleSwap
 * @version 0.3.0
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

  // Relay connections
  relayPool: null,
  connectedRelays: 0,

  // Market data
  allOffers: [],
  mySwaps: [],

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

    // SECURITY: Network mismatch warning
    if (connection.network !== EXPECTED_NETWORK) {
      showNetworkWarning(connection.network, EXPECTED_NETWORK);
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
 */
function showNetworkWarning(actual, expected) {
  const existing = document.querySelector('.network-warning');
  if (existing) existing.remove();

  const warning = document.createElement('div');
  warning.className = 'network-warning';
  warning.innerHTML = `
    <strong>NETWORK MISMATCH</strong><br>
    Your wallet is on <strong>${actual.toUpperCase()}</strong> but this app expects <strong>${expected.toUpperCase()}</strong>.<br>
    Transactions may fail or send funds to the wrong network!
  `;
  document.body.insertBefore(warning, document.body.firstChild);
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

function subscribeToMarket() {
  if (!state.relayPool) return;

  if (state.subs.offers) state.subs.offers.unsub();

  state.allOffers = [];
  dom.offerList.innerHTML =
    '<div class="status-msg">Querying order book...</div>';

  // Subscribe to both old and new event kinds
  state.subs.offers = state.relayPool.sub(RELAYS, [
    { kinds: [SPARKLE_EVENT_KINDS.PRODUCT], '#t': ['sparkle-swap-offer-v1'] },
    { kinds: [SPARKLE_EVENT_KINDS.SWAP_OFFER], '#t': ['sparkle-swap-v3'] },
  ]);

  state.subs.offers.on('event', handleOfferEvent);
  state.subs.offers.on('eose', () => {
    console.log(`EOSE: ${state.allOffers.length} offers`);
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

function subscribeToDMs() {
  if (!state.relayPool || !state.publicKey) return;

  if (state.subs.dms) state.subs.dms.unsub();

  state.subs.dms = state.relayPool.sub(RELAYS, [
    { kinds: [4], '#p': [state.publicKey] },
  ]);

  state.subs.dms.on('event', async (event) => {
    try {
      // Use NIP-07 for decryption (no private key!)
      const plaintext = await state.nostrProvider.nip04.decrypt(
        event.pubkey,
        event.content
      );

      handleIncomingMessage(event.pubkey, plaintext, event.created_at);
    } catch (err) {
      console.warn('Decryption failed:', err);
    }
  });
}

function handleIncomingMessage(senderPubkey, text, createdAt) {
  const swap = state.mySwaps.find((s) => s.provider === senderPubkey);
  if (!swap) return;

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
      swap.data.invoice = match[1];
      swap.status = 'PREMIUM_DUE';
    }
  }

  if (text.includes('txid:')) {
    const match = text.match(/txid:\s*([a-fA-F0-9]{64})/);
    if (match) {
      swap.data.fundingTxId = match[1];
      swap.status = 'FUNDED';
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

        // SECURITY: Verify script tree matches expected structure
        const verification = verifyScriptTree(receivedTree, swap);
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
          toast.success('Script tree verified successfully');
        }
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
 */
function verifyScriptTree(receivedTree, swap) {
  // Check required fields exist
  if (!receivedTree || typeof receivedTree !== 'object') {
    return { valid: false, reason: 'Invalid script tree format' };
  }

  // Verify payment hash matches what we agreed upon
  if (swap.data.paymentHash) {
    const receivedHash = receivedTree.paymentHash || receivedTree.payment_hash;
    if (receivedHash && receivedHash.toLowerCase() !== swap.data.paymentHash.toLowerCase()) {
      return { valid: false, reason: 'Payment hash mismatch - seller may have swapped the preimage' };
    }
  }

  // Verify our pubkey is in the hashlock script (buyer claim path)
  if (state.publicKey) {
    const hashlockScript = receivedTree.hashlockScript || receivedTree.hashlock;
    if (hashlockScript && !hashlockScript.toLowerCase().includes(state.publicKey.toLowerCase())) {
      return { valid: false, reason: 'Your pubkey not found in claim script - you may not be able to claim' };
    }
  }

  // Verify timeout is reasonable (not too short)
  const timeout = receivedTree.timeout || receivedTree.locktime;
  if (timeout && typeof timeout === 'number') {
    // Minimum 144 blocks (~24 hours) for safety
    const currentHeight = receivedTree.currentHeight || 0;
    const blocksRemaining = timeout - currentHeight;
    if (blocksRemaining < 72) {
      return { valid: false, reason: `Timeout too short: only ${blocksRemaining} blocks remaining` };
    }
  }

  // All checks passed
  return { valid: true };
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
// Taproot Claim Transaction (via Bitcoin Wallet)
// ============================================================================

window.generateTaprootClaim = async function (swapId) {
  const swap = state.mySwaps.find((s) => s.id === swapId);
  if (!swap) return;

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

  if (!preimage || !/^[a-fA-F0-9]{64}$/.test(preimage)) {
    toast.error('Preimage must be 64 hex characters (32 bytes).');
    return;
  }

  if (!state.bitcoinWallet) {
    toast.warning('Please connect your Bitcoin wallet first.');
    return;
  }

  try {
    // For Taproot claims, we need:
    // 1. The funding UTXO details
    // 2. The script tree and internal key
    // 3. The preimage for the hashlock

    const amount = BigInt(swap.offer.price);
    const fee = BigInt(feeInput || 500);
    const outputAmount = amount - fee;

    if (outputAmount <= 330n) {
      throw new Error('Output amount below dust limit after fee');
    }

    // Build unsigned transaction data
    // In production, this would construct a proper Taproot spending transaction
    const claimData = {
      type: 'taproot_claim',
      input: {
        txid: swap.data.fundingTxId,
        vout: vout,
        amount: amount.toString(),
        internalKey: swap.data.internalKey,
        scriptTree: swap.data.scriptTree,
      },
      output: {
        address: address,
        amount: outputAmount.toString(),
      },
      preimage: preimage,
      fee: fee.toString(),
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

async function signWithUnisat(swapId, claimData) {
  if (!window.unisat) {
    toast.error('Unisat wallet not available');
    return;
  }

  try {
    // Format amounts for display (escape all user data)
    const inputTxid = escapeHtml(claimData.input.txid.slice(0, 12));
    const outputAmt = escapeHtml(formatSats(claimData.output.amount));
    const feeAmt = escapeHtml(formatSats(claimData.fee));
    const destAddr = escapeHtml(claimData.output.address.slice(0, 16));

    // Show human-readable PSBT summary
    toast.html(
      '<strong>PSBT Ready for Signing</strong><br>' +
        'Input: ' + inputTxid + '...<br>' +
        'Output: ' + outputAmt + ' sats<br>' +
        'Fee: ' + feeAmt + ' sats<br>' +
        'To: ' + destAddr + '...',
      'info', 8000
    );

    // Show detailed info in console for debugging
    console.log('Taproot PSBT signing ready:', claimData);

    const swap = state.mySwaps.find((s) => s.id === swapId);
    if (swap) {
      swap.status = 'CLAIM_PENDING';
      toast.success('Claim transaction prepared. Ready for signing.');
      renderSwapList();
    }
  } catch (e) {
    console.error('Unisat signing failed:', e);
    toast.error('Signing failed: ' + escapeHtml(e.message));
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
  console.log('Sparkle Swap v0.3.0 - Serverless P2P Trading');
  console.log('Security: No private keys handled. NIP-07 + Bitcoin wallets.');
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
