/**
 * Sparkle Protocol - Refund Transaction Builder
 *
 * Builds the transaction that allows the seller to reclaim the Ordinal
 * after the timeout expires (if buyer didn't claim).
 *
 * @module sparkle-protocol/core/refund-transaction
 * @version 0.2.0
 */

import * as btc from '@scure/btc-signer';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils';
import {
  SparkleSwapAddress,
  NETWORKS,
  NetworkType,
  toHex,
  fromHex,
} from './taproot-scripts.js';

/**
 * Parameters for creating a refund transaction
 */
export interface RefundTransactionParams {
  /** The Sparkle swap address data */
  swapAddress: SparkleSwapAddress;
  /** The funding transaction ID (hex) */
  fundingTxid: string;
  /** The output index in the funding transaction */
  fundingVout: number;
  /** The amount in satoshis locked in the swap */
  fundingAmount: bigint;
  /** The seller's private key (32 bytes) */
  sellerPrivkey: Uint8Array;
  /** The destination address for the refund */
  destinationAddress: string;
  /** Fee rate in sats/vbyte */
  feeRate: number;
  /** Network to use */
  network?: NetworkType;
}

/**
 * Result from building a refund transaction
 */
export interface RefundTransactionResult {
  /** The signed transaction in hex format */
  txHex: string;
  /** The transaction ID */
  txid: string;
  /** The transaction size in vbytes */
  vsize: number;
  /** The fee paid in satoshis */
  fee: bigint;
  /** The amount sent to destination */
  outputAmount: bigint;
  /** The locktime set on the transaction */
  locktime: number;
}

/**
 * Estimate the vsize of a refund transaction
 *
 * Taproot script-path spend with timelock:
 * - Input: ~80 vbytes (control block + script + signature)
 * - Output: ~43 vbytes (P2TR output)
 * - Overhead: ~10 vbytes
 *
 * Total: ~133 vbytes (conservative estimate)
 */
export function estimateRefundVsize(): number {
  return 140; // Conservative estimate
}

/**
 * Build a refund transaction for the seller
 *
 * This transaction spends the timelock path of the Taproot output,
 * allowing the seller to reclaim their Ordinal after the timeout.
 *
 * IMPORTANT: This transaction can only be mined after the refund locktime
 * has passed. Attempting to broadcast before then will fail.
 *
 * @param params - The refund transaction parameters
 * @returns The signed transaction ready to broadcast (after locktime)
 */
export function buildRefundTransaction(
  params: RefundTransactionParams
): RefundTransactionResult {
  const network = NETWORKS[params.network || 'testnet'];

  // Validate private key length
  if (params.sellerPrivkey.length !== 32) {
    throw new Error('Seller private key must be 32 bytes');
  }

  // Get the refund locktime from swap params
  const locktime = params.swapAddress.params.refundLocktime;

  // Calculate fee
  const estimatedVsize = estimateRefundVsize();
  const fee = BigInt(Math.ceil(estimatedVsize * params.feeRate));

  // Calculate output amount
  const outputAmount = params.fundingAmount - fee;

  // Dust limit check (330 sats for P2TR)
  if (outputAmount < 330n) {
    throw new Error(
      `Output amount ${outputAmount} is below dust limit (330 sats). ` +
        `Input: ${params.fundingAmount}, Fee: ${fee}`
    );
  }

  // Get the timelock leaf (second leaf in the tree)
  const timelockLeaf = params.swapAddress.leaves[1];

  // Create the transaction with locktime and allowUnknownInputs for custom scripts
  const tx = new btc.Transaction({
    lockTime: locktime,
    allowUnknownOutputs: true,
    allowUnknownInputs: true,
  });

  // Add input (the locked Ordinal)
  // Sequence must be less than 0xffffffff to enable locktime
  tx.addInput({
    txid: params.fundingTxid,
    index: params.fundingVout,
    sequence: 0xfffffffe, // Enable locktime
    witnessUtxo: {
      script: params.swapAddress.outputScript,
      amount: params.fundingAmount,
    },
    // Taproot script path spend - use the properly formatted tapLeafScript
    tapLeafScript: params.swapAddress.tapLeafScript,
    tapInternalKey: params.swapAddress.internalPubkey,
  });

  // Add output (back to seller)
  tx.addOutputAddress(params.destinationAddress, outputAmount, network);

  // Sign using signIdx for custom script support
  tx.signIdx(params.sellerPrivkey, 0);

  // Get the signature from tapScriptSig
  const input = tx.getInput(0);
  if (!input.tapScriptSig || input.tapScriptSig.length === 0) {
    throw new Error('Failed to create signature for timelock spend');
  }
  const signature = input.tapScriptSig[0][1];

  // Build the witness stack for timelock spend:
  // [signature, script, controlBlock]
  // (no preimage needed - just signature, the locktime is enforced by consensus)
  const witness = [
    signature,
    timelockLeaf.script,
    timelockLeaf.controlBlock,
  ];

  // Set the final witness
  tx.updateInput(0, { finalScriptWitness: witness });

  // Get the final transaction
  const finalTx = tx.extract();

  return {
    txHex: bytesToHex(finalTx),
    txid: tx.id,
    vsize: tx.vsize,
    fee,
    outputAmount,
    locktime,
  };
}

/**
 * Check if refund is available based on current block height
 *
 * @param refundLocktime - The locktime set in the swap
 * @param currentBlockHeight - The current Bitcoin block height
 * @returns true if refund transaction can be broadcast
 */
export function isRefundAvailable(
  refundLocktime: number,
  currentBlockHeight: number
): boolean {
  return currentBlockHeight >= refundLocktime;
}

/**
 * Calculate blocks remaining until refund is available
 *
 * @param refundLocktime - The locktime set in the swap
 * @param currentBlockHeight - The current Bitcoin block height
 * @returns Number of blocks remaining (0 if already available)
 */
export function blocksUntilRefund(
  refundLocktime: number,
  currentBlockHeight: number
): number {
  const remaining = refundLocktime - currentBlockHeight;
  return remaining > 0 ? remaining : 0;
}

/**
 * Estimate time until refund is available
 *
 * @param blocksRemaining - Number of blocks until refund
 * @param avgBlockTimeMinutes - Average block time (default 10 for Bitcoin)
 * @returns Estimated time in minutes
 */
export function estimateTimeUntilRefund(
  blocksRemaining: number,
  avgBlockTimeMinutes: number = 10
): number {
  return blocksRemaining * avgBlockTimeMinutes;
}

/**
 * Simplified refund transaction builder
 *
 * Use this when you have all parameters as hex strings
 */
export function buildRefundTransactionFromHex(params: {
  fundingTxid: string;
  fundingVout: number;
  fundingAmountSats: number;
  sellerPrivkeyHex: string;
  destinationAddress: string;
  feeRateSatsPerVbyte: number;
  paymentHashHex: string;
  buyerPubkeyHex: string;
  sellerPubkeyHex: string;
  refundLocktime: number;
  network?: NetworkType;
}): RefundTransactionResult {
  // Import here to avoid circular dependency
  const { createSparkleSwapAddress } = require('./taproot-scripts.js');

  // Recreate the swap address
  const swapAddress = createSparkleSwapAddress({
    paymentHash: fromHex(params.paymentHashHex),
    buyerPubkey: fromHex(params.buyerPubkeyHex),
    sellerPubkey: fromHex(params.sellerPubkeyHex),
    refundLocktime: params.refundLocktime,
    network: params.network,
  });

  return buildRefundTransaction({
    swapAddress,
    fundingTxid: params.fundingTxid,
    fundingVout: params.fundingVout,
    fundingAmount: BigInt(params.fundingAmountSats),
    sellerPrivkey: fromHex(params.sellerPrivkeyHex),
    destinationAddress: params.destinationAddress,
    feeRate: params.feeRateSatsPerVbyte,
    network: params.network,
  });
}

// Re-export utilities
export { toHex, fromHex };
