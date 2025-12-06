/**
 * Sparkle Protocol - Claim Transaction Builder
 *
 * Builds the transaction that allows the buyer to claim the Ordinal
 * using the preimage revealed by the Lightning payment.
 *
 * @module sparkle-protocol/core/claim-transaction
 * @version 0.2.0
 */

import * as btc from '@scure/btc-signer';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils';
import {
  SparkleSwapAddress,
  NETWORKS,
  NetworkType,
  verifyPreimage,
  toHex,
  fromHex,
} from './taproot-scripts.js';

/**
 * Parameters for creating a claim transaction
 */
export interface ClaimTransactionParams {
  /** The Sparkle swap address data */
  swapAddress: SparkleSwapAddress;
  /** The funding transaction ID (hex) */
  fundingTxid: string;
  /** The output index in the funding transaction */
  fundingVout: number;
  /** The amount in satoshis locked in the swap */
  fundingAmount: bigint;
  /** The preimage that unlocks the hashlock (32 bytes) */
  preimage: Uint8Array;
  /** The buyer's private key (32 bytes) */
  buyerPrivkey: Uint8Array;
  /** The destination address for the Ordinal */
  destinationAddress: string;
  /** Fee rate in sats/vbyte */
  feeRate: number;
  /** Network to use */
  network?: NetworkType;
}

/**
 * Result from building a claim transaction
 */
export interface ClaimTransactionResult {
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
}

/**
 * Estimate the vsize of a claim transaction
 *
 * Taproot script-path spend with hashlock:
 * - Input: ~100 vbytes (control block + script + signature + preimage)
 * - Output: ~43 vbytes (P2TR output)
 * - Overhead: ~10 vbytes
 *
 * Total: ~153 vbytes (conservative estimate)
 */
export function estimateClaimVsize(): number {
  return 160; // Conservative estimate
}

/**
 * Build a claim transaction for the buyer
 *
 * This transaction spends the hashlock path of the Taproot output,
 * proving knowledge of the preimage and buyer's signature.
 *
 * @param params - The claim transaction parameters
 * @returns The signed transaction ready to broadcast
 */
export function buildClaimTransaction(
  params: ClaimTransactionParams
): ClaimTransactionResult {
  const network = NETWORKS[params.network || 'testnet'];

  // Validate preimage length
  if (params.preimage.length !== 32) {
    throw new Error('Preimage must be 32 bytes');
  }

  // Validate private key length
  if (params.buyerPrivkey.length !== 32) {
    throw new Error('Buyer private key must be 32 bytes');
  }

  // Verify preimage matches payment hash (fail early with clear error)
  if (!verifyPreimage(params.preimage, params.swapAddress.params.paymentHash)) {
    throw new Error(
      'Preimage does not match payment hash. ' +
      'SHA256(preimage) must equal the payment_hash used to create the swap address.'
    );
  }

  // Calculate fee
  const estimatedVsize = estimateClaimVsize();
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

  // Get the hashlock leaf (first leaf in the tree)
  const hashlockLeaf = params.swapAddress.leaves[0];

  // Create the transaction with allowUnknownInputs for custom scripts
  const tx = new btc.Transaction({
    allowUnknownOutputs: true,
    allowUnknownInputs: true,
  });

  // Add input (the locked Ordinal)
  tx.addInput({
    txid: params.fundingTxid,
    index: params.fundingVout,
    witnessUtxo: {
      script: params.swapAddress.outputScript,
      amount: params.fundingAmount,
    },
    // Taproot script path spend - use the properly formatted tapLeafScript
    tapLeafScript: params.swapAddress.tapLeafScript,
    tapInternalKey: params.swapAddress.internalPubkey,
  });

  // Add output (to buyer's destination)
  tx.addOutputAddress(params.destinationAddress, outputAmount, network);

  // Sign using signIdx for custom script support
  tx.signIdx(params.buyerPrivkey, 0);

  // Get the signature from tapScriptSig
  const input = tx.getInput(0);
  if (!input.tapScriptSig || input.tapScriptSig.length === 0) {
    throw new Error('Failed to create signature for hashlock spend');
  }
  const signature = input.tapScriptSig[0][1];

  // Build the witness stack for hashlock spend:
  // [signature, preimage, script, controlBlock]
  const witness = [
    signature,
    params.preimage,
    hashlockLeaf.script,
    hashlockLeaf.controlBlock,
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
  };
}

/**
 * Simplified claim transaction builder
 *
 * Use this when you have all parameters as hex strings
 */
export function buildClaimTransactionFromHex(params: {
  fundingTxid: string;
  fundingVout: number;
  fundingAmountSats: number;
  preimageHex: string;
  buyerPrivkeyHex: string;
  destinationAddress: string;
  feeRateSatsPerVbyte: number;
  paymentHashHex: string;
  buyerPubkeyHex: string;
  sellerPubkeyHex: string;
  refundLocktime: number;
  network?: NetworkType;
}): ClaimTransactionResult {
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

  return buildClaimTransaction({
    swapAddress,
    fundingTxid: params.fundingTxid,
    fundingVout: params.fundingVout,
    fundingAmount: BigInt(params.fundingAmountSats),
    preimage: fromHex(params.preimageHex),
    buyerPrivkey: fromHex(params.buyerPrivkeyHex),
    destinationAddress: params.destinationAddress,
    feeRate: params.feeRateSatsPerVbyte,
    network: params.network,
  });
}

// Re-export utilities
export { toHex, fromHex };
