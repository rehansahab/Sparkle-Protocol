/**
 * SPARKLE Protocol - Atomic Swap Module
 * Version: 0.3.8
 *
 * Core functions for Lightning-to-Ordinal atomic swaps using
 * inverted preimage pattern with Taproot script-path spending.
 */

const crypto = require('crypto');

// Bitcoin script opcodes
const OP = {
  FALSE: 0x00,
  PUSHDATA1: 0x4c,
  PUSHDATA2: 0x4d,
  IF: 0x63,
  ELSE: 0x67,
  ENDIF: 0x68,
  DROP: 0x75,
  DUP: 0x76,
  EQUAL: 0x87,
  EQUALVERIFY: 0x88,
  SHA256: 0xa8,
  CHECKSIG: 0xac,
  CHECKSEQUENCEVERIFY: 0xb2,
  CHECKLOCKTIMEVERIFY: 0xb1,
};

/**
 * Generate a random 32-byte preimage and its SHA256 hash
 * @returns {Object} { preimage: hex, paymentHash: hex }
 */
function generatePreimage() {
  const preimage = crypto.randomBytes(32);
  const paymentHash = crypto.createHash('sha256').update(preimage).digest();

  return {
    preimage: preimage.toString('hex'),
    paymentHash: paymentHash.toString('hex')
  };
}

/**
 * Compute SHA256 hash of a preimage
 * @param {string} preimageHex - 32-byte preimage in hex
 * @returns {string} SHA256 hash in hex
 */
function computePaymentHash(preimageHex) {
  const preimage = Buffer.from(preimageHex, 'hex');
  return crypto.createHash('sha256').update(preimage).digest('hex');
}

/**
 * Verify a preimage matches a payment hash
 * @param {string} preimageHex - Preimage to verify
 * @param {string} paymentHashHex - Expected hash
 * @returns {boolean}
 */
function verifyPreimage(preimageHex, paymentHashHex) {
  const computed = computePaymentHash(preimageHex);
  return computed === paymentHashHex.toLowerCase();
}

/**
 * Build hashlock script for buyer claim path
 * Script: OP_SHA256 <hash> OP_EQUALVERIFY <buyer_pubkey> OP_CHECKSIG
 *
 * @param {string} paymentHashHex - 32-byte payment hash
 * @param {string} buyerPubkeyHex - 32-byte x-only pubkey
 * @returns {Buffer} Script bytes
 */
function buildHashlockScript(paymentHashHex, buyerPubkeyHex) {
  const hash = Buffer.from(paymentHashHex, 'hex');
  const pubkey = Buffer.from(buyerPubkeyHex, 'hex');

  if (hash.length !== 32) throw new Error('Payment hash must be 32 bytes');
  if (pubkey.length !== 32) throw new Error('Pubkey must be 32 bytes (x-only)');

  return Buffer.concat([
    Buffer.from([OP.SHA256]),
    Buffer.from([0x20]), // push 32 bytes
    hash,
    Buffer.from([OP.EQUALVERIFY]),
    Buffer.from([0x20]), // push 32 bytes
    pubkey,
    Buffer.from([OP.CHECKSIG])
  ]);
}

/**
 * Build timelock script for seller refund path
 * Script: <timelock> OP_CHECKLOCKTIMEVERIFY OP_DROP <seller_pubkey> OP_CHECKSIG
 *
 * @param {number} timelock - Block height for refund
 * @param {string} sellerPubkeyHex - 32-byte x-only pubkey
 * @returns {Buffer} Script bytes
 */
function buildTimelockScript(timelock, sellerPubkeyHex) {
  const pubkey = Buffer.from(sellerPubkeyHex, 'hex');

  if (pubkey.length !== 32) throw new Error('Pubkey must be 32 bytes (x-only)');

  // Encode timelock as minimal push
  const timelockBuf = encodeScriptNumber(timelock);

  return Buffer.concat([
    timelockBuf,
    Buffer.from([OP.CHECKLOCKTIMEVERIFY, OP.DROP]),
    Buffer.from([0x20]), // push 32 bytes
    pubkey,
    Buffer.from([OP.CHECKSIG])
  ]);
}

/**
 * Encode a number for Bitcoin script (minimal encoding)
 */
function encodeScriptNumber(n) {
  if (n === 0) return Buffer.from([0x00]);
  if (n >= 1 && n <= 16) return Buffer.from([0x50 + n]); // OP_1 through OP_16

  // For larger numbers, use minimal byte encoding
  const neg = n < 0;
  let abs = Math.abs(n);
  const result = [];

  while (abs > 0) {
    result.push(abs & 0xff);
    abs >>= 8;
  }

  // If high bit is set, add a byte for sign
  if (result[result.length - 1] & 0x80) {
    result.push(neg ? 0x80 : 0x00);
  } else if (neg) {
    result[result.length - 1] |= 0x80;
  }

  const buf = Buffer.from(result);
  return Buffer.concat([Buffer.from([buf.length]), buf]);
}

/**
 * Tagged hash for Taproot (BIP340/341)
 */
function taggedHash(tag, data) {
  const tagHash = crypto.createHash('sha256').update(tag).digest();
  return crypto.createHash('sha256')
    .update(tagHash)
    .update(tagHash)
    .update(data)
    .digest();
}

/**
 * Compute leaf hash for a Taproot script
 */
function computeLeafHash(script, leafVersion = 0xc0) {
  const leafData = Buffer.concat([
    Buffer.from([leafVersion]),
    Buffer.from([script.length]),
    script
  ]);
  return taggedHash('TapLeaf', leafData);
}

/**
 * Compute Taproot branch hash from two children
 */
function computeBranchHash(left, right) {
  // Lexicographic ordering
  const sorted = Buffer.compare(left, right) < 0
    ? Buffer.concat([left, right])
    : Buffer.concat([right, left]);
  return taggedHash('TapBranch', sorted);
}

/**
 * Compute Taproot tweak from internal key and merkle root
 */
function computeTweak(internalPubkey, merkleRoot) {
  const data = merkleRoot
    ? Buffer.concat([internalPubkey, merkleRoot])
    : internalPubkey;
  return taggedHash('TapTweak', data);
}

/**
 * Generate SPARKLE lock address with two spending paths
 *
 * @param {Object} params
 * @param {string} params.buyerPubkey - Buyer's x-only pubkey (hex)
 * @param {string} params.sellerPubkey - Seller's x-only pubkey (hex)
 * @param {string} params.paymentHash - SHA256 hash from buyer (hex)
 * @param {number} params.timelock - Block height for seller refund
 * @param {string} params.network - 'mainnet' or 'testnet'
 * @returns {Object} Address and control block data
 */
function generateLockAddress(params) {
  const { buyerPubkey, sellerPubkey, paymentHash, timelock, network } = params;

  // Build both scripts
  const hashlockScript = buildHashlockScript(paymentHash, buyerPubkey);
  const timelockScript = buildTimelockScript(timelock, sellerPubkey);

  // Compute leaf hashes
  const hashlockLeaf = computeLeafHash(hashlockScript);
  const timelockLeaf = computeLeafHash(timelockScript);

  // Compute merkle root (two leaves)
  const merkleRoot = computeBranchHash(hashlockLeaf, timelockLeaf);

  // Use unspendable internal key (NUMS point)
  // H = lift_x(SHA256("SPARKLE/v1"))
  const numsHash = crypto.createHash('sha256').update('SPARKLE/v1').digest();
  const internalPubkey = numsHash; // Simplified - in production use proper point lifting

  // Compute tweaked output key
  const tweak = computeTweak(internalPubkey, merkleRoot);

  // Build control blocks for both paths
  const hashlockControlBlock = buildControlBlock(internalPubkey, timelockLeaf, 0xc0);
  const timelockControlBlock = buildControlBlock(internalPubkey, hashlockLeaf, 0xc0);

  // Generate address (simplified - real impl needs secp256k1)
  const prefix = network === 'mainnet' ? 'bc1p' : 'tb1p';

  return {
    // Note: Real address computation requires secp256k1 point operations
    internalPubkey: internalPubkey.toString('hex'),
    merkleRoot: merkleRoot.toString('hex'),
    hashlockScript: hashlockScript.toString('hex'),
    timelockScript: timelockScript.toString('hex'),
    hashlockLeaf: hashlockLeaf.toString('hex'),
    timelockLeaf: timelockLeaf.toString('hex'),
    hashlockControlBlock: hashlockControlBlock.toString('hex'),
    timelockControlBlock: timelockControlBlock.toString('hex'),
    params: {
      buyerPubkey,
      sellerPubkey,
      paymentHash,
      timelock,
      network
    }
  };
}

/**
 * Build control block for script-path spend
 */
function buildControlBlock(internalPubkey, siblingHash, leafVersion) {
  return Buffer.concat([
    Buffer.from([leafVersion]), // c0 for tapscript v0
    internalPubkey,
    siblingHash
  ]);
}

/**
 * Extract preimage from a sweep transaction witness
 *
 * @param {string} txHex - Raw transaction hex
 * @param {number} inputIndex - Input index to check
 * @returns {string|null} Preimage hex or null
 */
function extractPreimageFromWitness(txHex, inputIndex = 0) {
  const tx = Buffer.from(txHex, 'hex');

  // Simple witness extraction (production code should use proper TX parsing)
  // Witness stack for hashlock: [signature, preimage, script, control_block]

  // This is simplified - real implementation needs proper transaction parsing
  // The preimage is the second witness element (index 1) for hashlock spends

  console.log('Transaction hex length:', tx.length);
  console.log('Looking for 32-byte preimage in witness...');

  // In a real implementation, parse the transaction properly
  // For now, return placeholder
  return null;
}

/**
 * Build witness stack for hashlock (buyer claim) spend
 *
 * @param {string} signature - 64-byte Schnorr signature (hex)
 * @param {string} preimage - 32-byte preimage (hex)
 * @param {string} script - Hashlock script (hex)
 * @param {string} controlBlock - Control block (hex)
 * @returns {Array<Buffer>} Witness stack
 */
function buildHashlockWitness(signature, preimage, script, controlBlock) {
  return [
    Buffer.from(signature, 'hex'),
    Buffer.from(preimage, 'hex'),
    Buffer.from(script, 'hex'),
    Buffer.from(controlBlock, 'hex')
  ];
}

/**
 * Build witness stack for timelock (seller refund) spend
 *
 * @param {string} signature - 64-byte Schnorr signature (hex)
 * @param {string} script - Timelock script (hex)
 * @param {string} controlBlock - Control block (hex)
 * @returns {Array<Buffer>} Witness stack
 */
function buildTimelockWitness(signature, script, controlBlock) {
  return [
    Buffer.from(signature, 'hex'),
    Buffer.from(script, 'hex'),
    Buffer.from(controlBlock, 'hex')
  ];
}

/**
 * Estimate transaction vsize for fee calculation
 */
function estimateTxVsize(numInputs, numOutputs, hasWitness = true) {
  // P2TR input with script-path spend: ~107 vB
  // P2TR output: 43 vB
  const baseSize = 10; // version + locktime
  const inputSize = hasWitness ? 107 : 57;
  const outputSize = 43;

  return baseSize + (numInputs * inputSize) + (numOutputs * outputSize);
}

/**
 * Calculate fee for a transaction
 */
function calculateFee(vsize, feeRate) {
  return Math.ceil(vsize * feeRate);
}

// Export all functions
module.exports = {
  // Preimage operations
  generatePreimage,
  computePaymentHash,
  verifyPreimage,

  // Script building
  buildHashlockScript,
  buildTimelockScript,

  // Taproot operations
  computeLeafHash,
  computeBranchHash,
  computeTweak,
  taggedHash,

  // Address generation
  generateLockAddress,
  buildControlBlock,

  // Witness building
  buildHashlockWitness,
  buildTimelockWitness,
  extractPreimageFromWitness,

  // Fee estimation
  estimateTxVsize,
  calculateFee,

  // Constants
  OP
};
