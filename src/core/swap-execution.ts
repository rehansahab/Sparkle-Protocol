/**
 * Sparkle Protocol - Swap Execution Coordinator
 *
 * Orchestrates the complete atomic swap flow between seller and buyer.
 * This is the high-level API that ties together all the components.
 *
 * ATOMIC SWAP FLOW:
 * =================
 *
 * SELLER (has Ordinal, wants Lightning payment):
 * 1. generateSwapOffer() - Create swap parameters
 * 2. fundSwap() - Send Ordinal to swap address
 * 3. createInvoice() - Create Lightning invoice
 * 4. Wait for payment or timeout
 *
 * BUYER (has Lightning, wants Ordinal):
 * 1. verifySwapOffer() - Validate swap parameters
 * 2. verifyFunding() - Confirm Ordinal is in swap address
 * 3. payInvoice() - Pay Lightning invoice (external)
 * 4. claimOrdinal() - Use revealed preimage to claim
 *
 * TIMEOUT (if buyer doesn't pay):
 * - Seller calls refundSwap() after locktime expires
 *
 * @module sparkle-protocol/core/swap-execution
 * @version 0.2.0
 */

import {
  createSparkleSwapAddress,
  SparkleSwapAddress,
  NetworkType,
  NETWORKS,
} from './taproot-scripts.js';
import { buildClaimTransaction, ClaimTransactionResult } from './claim-transaction.js';
import { buildRefundTransaction, RefundTransactionResult, blocksUntilRefund } from './refund-transaction.js';
import {
  generateSwapSetup,
  SwapSetup,
  computePaymentHash,
  verifyPreimage,
  decodeBolt11,
  verifyInvoiceMatchesSwap,
} from './lightning-invoice.js';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

/**
 * Swap states
 */
export type SwapState =
  | 'created'      // Swap offer created, not yet funded
  | 'funded'       // Ordinal sent to swap address
  | 'invoiced'     // Lightning invoice created
  | 'paid'         // Lightning payment received (preimage revealed)
  | 'claimed'      // Buyer claimed the Ordinal
  | 'refunded'     // Seller reclaimed after timeout
  | 'expired';     // Swap expired without action

/**
 * Complete swap data structure
 */
export interface SparkleSwap {
  /** Unique swap identifier */
  id: string;
  /** Current state */
  state: SwapState;
  /** Creation timestamp */
  createdAt: number;

  // Parties
  /** Seller's compressed public key (33 bytes hex) */
  sellerPubkeyHex: string;
  /** Buyer's compressed public key (33 bytes hex) */
  buyerPubkeyHex: string;

  // Ordinal info
  /** Ordinal inscription ID */
  ordinalId: string;
  /** Price in satoshis */
  priceSats: bigint;

  // Cryptographic material
  /** Payment hash (32 bytes hex) */
  paymentHashHex: string;
  /** Preimage (32 bytes hex) - only known to seller initially */
  preimageHex?: string;

  // On-chain data
  /** Swap address (Taproot) */
  swapAddress: string;
  /** Refund locktime (block height) */
  refundLocktime: number;
  /** Funding transaction ID */
  fundingTxid?: string;
  /** Funding output index */
  fundingVout?: number;
  /** Amount locked in swap (sats) */
  fundingAmount?: bigint;

  // Lightning data
  /** BOLT11 invoice */
  bolt11Invoice?: string;

  // Settlement data
  /** Claim transaction ID */
  claimTxid?: string;
  /** Refund transaction ID */
  refundTxid?: string;

  // Network
  network: NetworkType;
}

/**
 * Parameters for creating a swap offer
 */
export interface CreateSwapOfferParams {
  /** Seller's compressed public key (33 bytes) */
  sellerPubkey: Uint8Array;
  /** Buyer's compressed public key (33 bytes) */
  buyerPubkey: Uint8Array;
  /** Ordinal inscription ID */
  ordinalId: string;
  /** Price in satoshis */
  priceSats: bigint;
  /** Blocks until refund is available (default: 144 = ~24 hours) */
  locktimeBlocks?: number;
  /** Current block height (required to calculate locktime) */
  currentBlockHeight: number;
  /** Network */
  network?: NetworkType;
}

/**
 * SELLER: Create a new swap offer
 *
 * Generates all cryptographic material and the swap address.
 * The seller should then:
 * 1. Send the Ordinal to the swap address
 * 2. Create a Lightning invoice with the payment hash
 * 3. Share the offer with the buyer
 *
 * @param params - Swap offer parameters
 * @returns Complete swap data (seller should save preimage securely!)
 */
export function createSwapOffer(params: CreateSwapOfferParams): SparkleSwap {
  const network = params.network || 'testnet';
  const locktimeBlocks = params.locktimeBlocks || 144; // ~24 hours default
  const refundLocktime = params.currentBlockHeight + locktimeBlocks;

  // Generate cryptographic material
  const setup = generateSwapSetup();

  // Create the swap address
  const swapAddressData = createSparkleSwapAddress({
    paymentHash: setup.paymentHash,
    buyerPubkey: params.buyerPubkey,
    sellerPubkey: params.sellerPubkey,
    refundLocktime,
    network,
  });

  // Generate unique ID
  const id = bytesToHex(sha256(new TextEncoder().encode(
    `${setup.paymentHashHex}-${Date.now()}-${Math.random()}`
  ))).slice(0, 16);

  return {
    id,
    state: 'created',
    createdAt: Date.now(),

    sellerPubkeyHex: bytesToHex(params.sellerPubkey),
    buyerPubkeyHex: bytesToHex(params.buyerPubkey),

    ordinalId: params.ordinalId,
    priceSats: params.priceSats,

    paymentHashHex: setup.paymentHashHex,
    preimageHex: setup.preimageHex, // Seller keeps this secret!

    swapAddress: swapAddressData.address,
    refundLocktime,

    network,
  };
}

/**
 * Swap offer for sharing with buyer (without preimage)
 */
export interface SwapOfferPublic {
  id: string;
  sellerPubkeyHex: string;
  buyerPubkeyHex: string;
  ordinalId: string;
  priceSats: string; // String for JSON safety
  paymentHashHex: string;
  swapAddress: string;
  refundLocktime: number;
  network: NetworkType;
}

/**
 * Get public swap offer data (safe to share with buyer)
 *
 * @param swap - Full swap data
 * @returns Public offer without preimage
 */
export function getPublicOffer(swap: SparkleSwap): SwapOfferPublic {
  return {
    id: swap.id,
    sellerPubkeyHex: swap.sellerPubkeyHex,
    buyerPubkeyHex: swap.buyerPubkeyHex,
    ordinalId: swap.ordinalId,
    priceSats: swap.priceSats.toString(),
    paymentHashHex: swap.paymentHashHex,
    swapAddress: swap.swapAddress,
    refundLocktime: swap.refundLocktime,
    network: swap.network,
  };
}

/**
 * BUYER: Verify a swap offer
 *
 * Reconstructs the swap address from parameters and verifies it matches.
 * This ensures the seller can't cheat by using wrong parameters.
 *
 * @param offer - Public swap offer
 * @param buyerPubkey - Buyer's own public key (to verify)
 * @returns true if offer is valid
 */
export function verifySwapOffer(
  offer: SwapOfferPublic,
  buyerPubkey: Uint8Array
): { valid: boolean; error?: string } {
  try {
    // Verify buyer pubkey matches
    if (bytesToHex(buyerPubkey) !== offer.buyerPubkeyHex) {
      return { valid: false, error: 'Buyer pubkey mismatch' };
    }

    // Reconstruct the swap address
    const reconstructed = createSparkleSwapAddress({
      paymentHash: hexToBytes(offer.paymentHashHex),
      buyerPubkey: buyerPubkey,
      sellerPubkey: hexToBytes(offer.sellerPubkeyHex),
      refundLocktime: offer.refundLocktime,
      network: offer.network,
    });

    // Verify address matches
    if (reconstructed.address !== offer.swapAddress) {
      return { valid: false, error: 'Swap address mismatch - possible tampering' };
    }

    return { valid: true };
  } catch (e: any) {
    return { valid: false, error: e.message };
  }
}

/**
 * SELLER: Record funding transaction
 *
 * After sending the Ordinal to the swap address, record the details.
 *
 * @param swap - Swap data
 * @param fundingTxid - Transaction ID of the funding TX
 * @param fundingVout - Output index (usually 0)
 * @param fundingAmount - Amount in satoshis
 * @returns Updated swap
 */
export function recordFunding(
  swap: SparkleSwap,
  fundingTxid: string,
  fundingVout: number,
  fundingAmount: bigint
): SparkleSwap {
  return {
    ...swap,
    state: 'funded',
    fundingTxid,
    fundingVout,
    fundingAmount,
  };
}

/**
 * SELLER: Record Lightning invoice
 *
 * @param swap - Swap data
 * @param bolt11Invoice - BOLT11 invoice string
 * @returns Updated swap
 */
export function recordInvoice(
  swap: SparkleSwap,
  bolt11Invoice: string
): SparkleSwap {
  // Verify invoice payment hash matches swap
  const decoded = decodeBolt11(bolt11Invoice);
  if (bytesToHex(decoded.paymentHash) !== swap.paymentHashHex) {
    throw new Error('Invoice payment_hash does not match swap payment_hash');
  }

  return {
    ...swap,
    state: 'invoiced',
    bolt11Invoice,
  };
}

/**
 * BUYER: Verify funding and invoice before paying
 *
 * @param offer - Public swap offer
 * @param fundingTxid - Funding transaction ID
 * @param fundingVout - Funding output index
 * @param bolt11Invoice - Lightning invoice
 * @returns Verification result
 */
export function verifyBeforePayment(
  offer: SwapOfferPublic,
  fundingTxid: string,
  fundingVout: number,
  bolt11Invoice: string
): { valid: boolean; error?: string; warnings: string[] } {
  const warnings: string[] = [];

  try {
    // Verify invoice payment hash matches swap
    const decoded = decodeBolt11(bolt11Invoice);
    if (bytesToHex(decoded.paymentHash) !== offer.paymentHashHex) {
      return {
        valid: false,
        error: 'Invoice payment_hash does not match swap - DO NOT PAY',
        warnings,
      };
    }

    // Verify invoice amount matches price
    if (decoded.amountSat !== undefined) {
      const priceSats = BigInt(offer.priceSats);
      if (decoded.amountSat !== priceSats) {
        return {
          valid: false,
          error: `Invoice amount (${decoded.amountSat}) does not match price (${priceSats})`,
          warnings,
        };
      }
    } else {
      warnings.push('Invoice has no amount specified - verify manually');
    }

    // Check network matches
    if (decoded.network !== offer.network) {
      return {
        valid: false,
        error: `Network mismatch: invoice is ${decoded.network}, swap is ${offer.network}`,
        warnings,
      };
    }

    // Note: In production, you'd also verify the funding TX on-chain
    // to confirm the Ordinal is actually at the swap address
    warnings.push('Remember to verify funding TX on-chain before paying');

    return { valid: true, warnings };
  } catch (e: any) {
    return { valid: false, error: e.message, warnings };
  }
}

/**
 * Record payment received (preimage revealed)
 *
 * @param swap - Swap data
 * @param preimageHex - Revealed preimage
 * @returns Updated swap
 */
export function recordPayment(
  swap: SparkleSwap,
  preimageHex: string
): SparkleSwap {
  // Verify preimage
  const preimage = hexToBytes(preimageHex);
  const paymentHash = hexToBytes(swap.paymentHashHex);

  if (!verifyPreimage(preimage, paymentHash)) {
    throw new Error('Invalid preimage');
  }

  return {
    ...swap,
    state: 'paid',
    preimageHex,
  };
}

/**
 * BUYER: Build and get claim transaction
 *
 * After paying the Lightning invoice and receiving the preimage,
 * the buyer can claim the Ordinal.
 *
 * @param swap - Swap data (must have preimage from payment)
 * @param buyerPrivkey - Buyer's private key (32 bytes)
 * @param destinationAddress - Where to send the Ordinal
 * @param feeRate - Fee rate in sats/vbyte
 * @returns Claim transaction result
 */
export function buildClaimForBuyer(
  swap: SparkleSwap,
  buyerPrivkey: Uint8Array,
  destinationAddress: string,
  feeRate: number
): ClaimTransactionResult {
  if (!swap.preimageHex) {
    throw new Error('Preimage not available - has the invoice been paid?');
  }
  if (!swap.fundingTxid || swap.fundingVout === undefined || !swap.fundingAmount) {
    throw new Error('Funding transaction details not available');
  }

  // Reconstruct swap address data
  const swapAddress = createSparkleSwapAddress({
    paymentHash: hexToBytes(swap.paymentHashHex),
    buyerPubkey: hexToBytes(swap.buyerPubkeyHex),
    sellerPubkey: hexToBytes(swap.sellerPubkeyHex),
    refundLocktime: swap.refundLocktime,
    network: swap.network,
  });

  return buildClaimTransaction({
    swapAddress,
    fundingTxid: swap.fundingTxid,
    fundingVout: swap.fundingVout,
    fundingAmount: swap.fundingAmount,
    preimage: hexToBytes(swap.preimageHex),
    buyerPrivkey,
    destinationAddress,
    feeRate,
    network: swap.network,
  });
}

/**
 * SELLER: Build and get refund transaction
 *
 * If the buyer doesn't pay before the locktime, the seller can reclaim.
 *
 * @param swap - Swap data
 * @param sellerPrivkey - Seller's private key (32 bytes)
 * @param destinationAddress - Where to send the Ordinal back
 * @param feeRate - Fee rate in sats/vbyte
 * @param currentBlockHeight - Current block height (to check if refund is available)
 * @returns Refund transaction result
 */
export function buildRefundForSeller(
  swap: SparkleSwap,
  sellerPrivkey: Uint8Array,
  destinationAddress: string,
  feeRate: number,
  currentBlockHeight: number
): RefundTransactionResult {
  if (!swap.fundingTxid || swap.fundingVout === undefined || !swap.fundingAmount) {
    throw new Error('Funding transaction details not available');
  }

  const blocksRemaining = blocksUntilRefund(swap.refundLocktime, currentBlockHeight);
  if (blocksRemaining > 0) {
    throw new Error(
      `Refund not yet available. ${blocksRemaining} blocks remaining ` +
      `(~${blocksRemaining * 10} minutes)`
    );
  }

  // Reconstruct swap address data
  const swapAddress = createSparkleSwapAddress({
    paymentHash: hexToBytes(swap.paymentHashHex),
    buyerPubkey: hexToBytes(swap.buyerPubkeyHex),
    sellerPubkey: hexToBytes(swap.sellerPubkeyHex),
    refundLocktime: swap.refundLocktime,
    network: swap.network,
  });

  return buildRefundTransaction({
    swapAddress,
    fundingTxid: swap.fundingTxid,
    fundingVout: swap.fundingVout,
    fundingAmount: swap.fundingAmount,
    sellerPrivkey,
    destinationAddress,
    feeRate,
    network: swap.network,
  });
}

/**
 * Record claim transaction
 */
export function recordClaim(swap: SparkleSwap, claimTxid: string): SparkleSwap {
  return {
    ...swap,
    state: 'claimed',
    claimTxid,
  };
}

/**
 * Record refund transaction
 */
export function recordRefund(swap: SparkleSwap, refundTxid: string): SparkleSwap {
  return {
    ...swap,
    state: 'refunded',
    refundTxid,
  };
}

/**
 * Get human-readable swap status
 */
export function getSwapStatus(swap: SparkleSwap, currentBlockHeight?: number): string {
  const lines: string[] = [];

  lines.push(`Swap ID: ${swap.id}`);
  lines.push(`State: ${swap.state.toUpperCase()}`);
  lines.push(`Ordinal: ${swap.ordinalId}`);
  lines.push(`Price: ${swap.priceSats} sats`);
  lines.push(`Swap Address: ${swap.swapAddress}`);
  lines.push(`Network: ${swap.network}`);

  if (swap.fundingTxid) {
    lines.push(`Funding TX: ${swap.fundingTxid}:${swap.fundingVout}`);
  }

  if (currentBlockHeight) {
    const remaining = blocksUntilRefund(swap.refundLocktime, currentBlockHeight);
    if (remaining > 0) {
      lines.push(`Refund available in: ${remaining} blocks (~${remaining * 10} min)`);
    } else {
      lines.push(`Refund: AVAILABLE NOW`);
    }
  }

  if (swap.bolt11Invoice) {
    lines.push(`Invoice: ${swap.bolt11Invoice.slice(0, 40)}...`);
  }

  if (swap.claimTxid) {
    lines.push(`Claim TX: ${swap.claimTxid}`);
  }

  if (swap.refundTxid) {
    lines.push(`Refund TX: ${swap.refundTxid}`);
  }

  return lines.join('\n');
}

// Re-export for convenience
export { generateSwapSetup, verifyPreimage, decodeBolt11 };
export type { SwapSetup };
