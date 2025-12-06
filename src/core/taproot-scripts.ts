/**
 * Sparkle Protocol - Taproot Script Generator
 *
 * Creates the hashlock + timelock Taproot address for atomic swaps.
 *
 * Two spending paths:
 * 1. HASHLOCK (buyer claim): Requires preimage + buyer signature
 * 2. TIMELOCK (seller refund): Requires timeout expired + seller signature
 *
 * @module sparkle-protocol/core/taproot-scripts
 * @version 0.2.0
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import * as btc from '@scure/btc-signer';

// Network configuration
export const NETWORKS = {
  mainnet: btc.NETWORK,
  testnet: btc.TEST_NETWORK,
  signet: {
    ...btc.TEST_NETWORK,
    bech32: 'tb', // Signet uses same prefix as testnet
  },
} as const;

export type NetworkType = keyof typeof NETWORKS;


/**
 * Parameters for creating a Sparkle swap address
 */
export interface SparkleSwapParams {
  /** SHA256 hash of the preimage (same as Lightning payment_hash) */
  paymentHash: Uint8Array;
  /** Buyer's public key (compressed, 33 bytes) */
  buyerPubkey: Uint8Array;
  /** Seller's public key (compressed, 33 bytes) */
  sellerPubkey: Uint8Array;
  /** Block height after which seller can refund */
  refundLocktime: number;
  /** Network to use */
  network?: NetworkType;
}

/**
 * Result from creating a Sparkle swap address
 */
export interface SparkleSwapAddress {
  /** The Taproot address to send the Ordinal to */
  address: string;
  /** The internal pubkey used for Taproot */
  internalPubkey: Uint8Array;
  /** The hashlock script (for buyer claim) */
  hashlockScript: Uint8Array;
  /** The timelock script (for seller refund) */
  timelockScript: Uint8Array;
  /** The full output script */
  outputScript: Uint8Array;
  /** Taproot tree structure for spending */
  taprootTree: any;
  /** Formatted tapLeafScript for transaction inputs */
  tapLeafScript: any;
  /** Tap merkle root for the tree */
  tapMerkleRoot: Uint8Array;
  /** List of leaves with control blocks */
  leaves: any;
  /** Parameters used to create this address */
  params: SparkleSwapParams;
}


/**
 * Create the hashlock script for buyer claim path
 *
 * Script: OP_SHA256 <payment_hash> OP_EQUALVERIFY <buyer_pubkey> OP_CHECKSIG
 *
 * To spend: <signature> <preimage>
 */
export function createHashlockScript(
  paymentHash: Uint8Array,
  buyerPubkey: Uint8Array
): Uint8Array {
  // Validate inputs
  if (paymentHash.length !== 32) {
    throw new Error('Payment hash must be 32 bytes');
  }
  if (buyerPubkey.length !== 33 && buyerPubkey.length !== 32) {
    throw new Error('Buyer pubkey must be 32 or 33 bytes');
  }

  // For Taproot, we use x-only pubkey (32 bytes)
  const xOnlyPubkey = buyerPubkey.length === 33
    ? buyerPubkey.slice(1)
    : buyerPubkey;

  // Build the script using library's Script.encode
  // OP_SHA256 <32-byte hash> OP_EQUALVERIFY <32-byte pubkey> OP_CHECKSIG
  return btc.Script.encode([
    'SHA256',
    paymentHash,
    'EQUALVERIFY',
    xOnlyPubkey,
    'CHECKSIG',
  ]);
}

/**
 * Encode a number as minimal Bitcoin script number (CScriptNum format)
 */
function encodeScriptNumber(n: number): Uint8Array {
  if (n === 0) return new Uint8Array([]);

  const neg = n < 0;
  let abs = Math.abs(n);
  const bytes: number[] = [];

  while (abs > 0) {
    bytes.push(abs & 0xff);
    abs >>>= 8;
  }

  // If high bit set, add extra byte for sign
  if (bytes[bytes.length - 1] & 0x80) {
    bytes.push(neg ? 0x80 : 0x00);
  } else if (neg) {
    bytes[bytes.length - 1] |= 0x80;
  }

  return new Uint8Array(bytes);
}

/**
 * Create the timelock script for seller refund path
 *
 * Script: <locktime> OP_CHECKLOCKTIMEVERIFY OP_DROP <seller_pubkey> OP_CHECKSIG
 *
 * To spend: <signature> (after locktime)
 */
export function createTimelockScript(
  refundLocktime: number,
  sellerPubkey: Uint8Array
): Uint8Array {
  // Validate inputs
  if (refundLocktime <= 0) {
    throw new Error('Refund locktime must be positive');
  }
  if (sellerPubkey.length !== 33 && sellerPubkey.length !== 32) {
    throw new Error('Seller pubkey must be 32 or 33 bytes');
  }

  // For Taproot, we use x-only pubkey (32 bytes)
  const xOnlyPubkey = sellerPubkey.length === 33
    ? sellerPubkey.slice(1)
    : sellerPubkey;

  // Encode locktime as minimal script number bytes
  const locktimeBytes = encodeScriptNumber(refundLocktime);

  // Build the script using library's Script.encode
  // <locktime> OP_CLTV OP_DROP <32-byte pubkey> OP_CHECKSIG
  return btc.Script.encode([
    locktimeBytes,
    'CHECKLOCKTIMEVERIFY',
    'DROP',
    xOnlyPubkey,
    'CHECKSIG',
  ]);
}

/**
 * Create a Sparkle swap Taproot address
 *
 * This address has two spending paths:
 * 1. Hashlock: Buyer can claim with preimage + signature
 * 2. Timelock: Seller can refund after timeout + signature
 *
 * @param params - The swap parameters
 * @returns The Taproot address and related data
 */
export function createSparkleSwapAddress(
  params: SparkleSwapParams
): SparkleSwapAddress {
  const network = NETWORKS[params.network || 'testnet'];

  // Create the two scripts
  const hashlockScript = createHashlockScript(
    params.paymentHash,
    params.buyerPubkey
  );

  const timelockScript = createTimelockScript(
    params.refundLocktime,
    params.sellerPubkey
  );

  // Create Taproot tree with both scripts as leaves
  // Using taprootListToTree for proper tree structure
  const taprootTree = [
    { script: hashlockScript, leafVersion: 0xc0 },
    { script: timelockScript, leafVersion: 0xc0 },
  ] as const;

  // Use an unspendable internal pubkey (NUMS point)
  // This is standard practice when only script paths should be used
  // H = lift_x(SHA256("TaprootNothing"))
  const UNSPENDABLE_PUBKEY = hexToBytes(
    '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0'
  );

  // Create the Taproot output
  // allowUnknownOutputs=true enables custom HTLC scripts
  // Use 'any' to access runtime properties not fully typed
  const p2tr = btc.p2tr(
    UNSPENDABLE_PUBKEY,
    taprootTree as any,
    network,
    true // allowUnknownOutputs - required for custom hashlock/timelock scripts
  ) as any;

  return {
    address: p2tr.address!,
    internalPubkey: UNSPENDABLE_PUBKEY,
    hashlockScript,
    timelockScript,
    outputScript: p2tr.script,
    taprootTree: taprootTree as any,
    tapLeafScript: p2tr.tapLeafScript,
    tapMerkleRoot: p2tr.tapMerkleRoot!,
    leaves: p2tr.leaves,
    params,
  };
}

/**
 * Generate a random preimage and its hash
 *
 * @returns Object with preimage and paymentHash
 */
export function generatePreimage(): {
  preimage: Uint8Array;
  paymentHash: Uint8Array;
} {
  // Generate 32 random bytes for preimage
  const preimage = crypto.getRandomValues(new Uint8Array(32));

  // Hash it to get payment_hash
  const paymentHash = sha256(preimage);

  return { preimage, paymentHash };
}

/**
 * Verify that a preimage matches a payment hash
 *
 * @param preimage - The preimage to verify
 * @param paymentHash - The expected hash
 * @returns true if SHA256(preimage) === paymentHash
 */
export function verifyPreimage(
  preimage: Uint8Array,
  paymentHash: Uint8Array
): boolean {
  const computed = sha256(preimage);
  return bytesToHex(computed) === bytesToHex(paymentHash);
}

/**
 * Convert a hex string to Uint8Array
 */
export function fromHex(hexString: string): Uint8Array {
  return hexToBytes(hexString);
}

/**
 * Convert Uint8Array to hex string
 */
export function toHex(bytes: Uint8Array): string {
  return bytesToHex(bytes);
}

/**
 * Calculate recommended refund locktime
 *
 * Sparkle Protocol recommends:
 * - Minimum 144 blocks (24 hours) for claim window
 * - Refund locktime = current_height + 288 blocks (48 hours)
 *
 * This provides delta-safe timelocks with 2x margin
 *
 * @param currentBlockHeight - Current Bitcoin block height
 * @param claimWindowBlocks - Blocks for buyer to claim (default 144 = 24h)
 * @returns Recommended refund locktime
 */
export function calculateRefundLocktime(
  currentBlockHeight: number,
  claimWindowBlocks: number = 144
): number {
  // Refund locktime = current + 2x claim window (delta-safe)
  return currentBlockHeight + (claimWindowBlocks * 2);
}

// Export utilities
export { sha256, bytesToHex, hexToBytes };
