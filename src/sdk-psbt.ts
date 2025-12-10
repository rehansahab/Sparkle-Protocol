/**
 * Sparkle Protocol - PSBT Builder
 *
 * Implements the 5-Point Safety Gate for sweep transaction construction.
 * This module REFUSES to build a PSBT unless ALL safety checks pass.
 *
 * @module sparkle-protocol/psbt
 * @version 1.0.0-rc.1
 */

import * as btc from '@scure/btc-signer';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils';

import type {
  SweepPsbtParams,
  PsbtResult,
} from './sdk-types.js';

import {
  NUMS_INTERNAL_KEY,
  TAPROOT_LEAF_VERSION,
  RBF_SEQUENCE,
  SAFETY_BUFFER_BLOCKS,
  BLOCK_TIME_SECONDS,
  MAX_AFFILIATES,
  MAX_AFFILIATE_BPS,
  MAX_TOTAL_AFFILIATE_BPS,
  DUST_THRESHOLD,
  ESTIMATED_SWEEP_VBYTES,
  BPS_DIVISOR,
} from './sdk-constants.js';

// =============================================================================
// NETWORK CONFIG
// =============================================================================

const NETWORKS = {
  mainnet: btc.NETWORK,
  testnet: btc.TEST_NETWORK,
} as const;

// =============================================================================
// 5-POINT SAFETY GATE PSBT BUILDER
// =============================================================================

/**
 * Construct Sweep PSBT with 5-Point Safety Gate
 *
 * This function WILL NOT return a PSBT unless ALL safety gates pass.
 * It is the final line of defense before a transaction is signed.
 *
 * THE 5 GATES:
 * 1. Ordinal Preservation - Output[0].value === Input[0].value
 * 2. Funding Isolation - All fees from funding UTXO, not Ordinal
 * 3. Affiliate Compliance - Count ≤3, Individual ≤5%, Total ≤10%
 * 4. Safety Delta - Timelock > InvoiceExpiry + 12 blocks
 * 5. Ownership Verification - Lock UTXO matches indexer truth
 *
 * @param params - Sweep parameters with all required safety data
 * @returns PSBT result or throws SafetyGateError
 */
export async function constructSweepPsbt(
  params: SweepPsbtParams
): Promise<PsbtResult> {
  const network = NETWORKS[params.network || 'testnet'];

  // =========================================================================
  // 🛡️ GATE 1: FUNDING EXISTENCE & ISOLATION
  // =========================================================================
  // Fees MUST come from a separate funding UTXO, NOT the Ordinal UTXO.
  // This prevents accidental burning of the Ordinal as fees.

  if (!params.fundingUtxo) {
    throw new SafetyGateError(
      'GATE_1_FAILED',
      'Funding UTXO missing. All fees must use external funding.'
    );
  }

  if (!params.fundingUtxo.scriptPubKey) {
    throw new SafetyGateError(
      'GATE_1_FAILED',
      'Funding UTXO missing scriptPubKey - required for signing.'
    );
  }

  // =========================================================================
  // 🛡️ GATE 2: ORDINAL PRESERVATION (Enforced in output construction)
  // =========================================================================
  // We enforce this by setting Output[0].value = Input[0].value exactly.
  // No fee deduction from the Ordinal UTXO is permitted.

  const ordinalValue = params.lockUtxo.value;

  // =========================================================================
  // 🛡️ GATE 3: AFFILIATE COMPLIANCE
  // =========================================================================

  const affiliates = params.affiliates || [];

  if (affiliates.length > MAX_AFFILIATES) {
    throw new SafetyGateError(
      'GATE_3_FAILED',
      `Affiliate count ${affiliates.length} exceeds maximum ${MAX_AFFILIATES}`
    );
  }

  let totalBps = 0;
  for (const aff of affiliates) {
    if (aff.bps > MAX_AFFILIATE_BPS) {
      throw new SafetyGateError(
        'GATE_3_FAILED',
        `Affiliate BPS ${aff.bps} exceeds maximum ${MAX_AFFILIATE_BPS} (5%)`
      );
    }
    totalBps += aff.bps;
  }

  if (totalBps > MAX_TOTAL_AFFILIATE_BPS) {
    throw new SafetyGateError(
      'GATE_3_FAILED',
      `Total affiliate BPS ${totalBps} exceeds maximum ${MAX_TOTAL_AFFILIATE_BPS} (10%)`
    );
  }

  // =========================================================================
  // 🛡️ GATE 4: SAFETY DELTA (Time-Bandit Protection)
  // =========================================================================
  // Bitcoin timelock MUST extend beyond Lightning invoice expiry + buffer.

  const nowUnix = Math.floor(Date.now() / 1000);
  const secondsToExpiry = Math.max(0, params.invoiceExpiryUnix - nowUnix);
  const estimatedExpiryBlock =
    params.currentBlockHeight + Math.ceil(secondsToExpiry / BLOCK_TIME_SECONDS);
  const minimumSafeTimelock = estimatedExpiryBlock + SAFETY_BUFFER_BLOCKS;

  if (params.timelock <= minimumSafeTimelock) {
    throw new SafetyGateError(
      'GATE_4_FAILED',
      `Unsafe timelock delta. Current: ${params.timelock}, ` +
      `Minimum safe: ${minimumSafeTimelock + 1}. ` +
      `Increase timelock by at least ${minimumSafeTimelock - params.timelock + 1} blocks.`
    );
  }

  // =========================================================================
  // 🛡️ GATE 5: OWNERSHIP VERIFICATION
  // =========================================================================
  // The lock UTXO must match the indexer's authoritative data.

  if (
    params.lockUtxo.txid !== params.indexerData.txid ||
    params.lockUtxo.vout !== params.indexerData.vout
  ) {
    throw new SafetyGateError(
      'GATE_5_FAILED',
      `Lock UTXO (${params.lockUtxo.txid}:${params.lockUtxo.vout}) ` +
      `does not match indexer truth (${params.indexerData.txid}:${params.indexerData.vout})`
    );
  }

  // =========================================================================
  // ✅ ALL GATES PASSED - CONSTRUCT TRANSACTION
  // =========================================================================

  // 1. Reconstruct Taproot scripts
  const buyerPubkeyBytes = toXOnly(hexToBytes(params.buyerPubkey));
  const sellerPubkeyBytes = toXOnly(hexToBytes(params.sellerPubkey));
  const paymentHashBytes = hexToBytes(params.paymentHash);
  const numsInternal = hexToBytes(NUMS_INTERNAL_KEY);

  // Hashlock script: OP_SHA256 <hash> OP_EQUALVERIFY <buyer_pubkey> OP_CHECKSIG
  const swapScript = btc.Script.encode([
    'SHA256',
    paymentHashBytes,
    'EQUALVERIFY',
    buyerPubkeyBytes,
    'CHECKSIG',
  ]);

  // Timelock script: <locktime> OP_CLTV OP_DROP <seller_pubkey> OP_CHECKSIG
  const refundScript = btc.Script.encode([
    encodeScriptNumber(params.timelock),
    'CHECKLOCKTIMEVERIFY',
    'DROP',
    sellerPubkeyBytes,
    'CHECKSIG',
  ]);

  // Create Taproot tree
  const taprootTree = [
    { script: swapScript, leafVersion: TAPROOT_LEAF_VERSION },
    { script: refundScript, leafVersion: TAPROOT_LEAF_VERSION },
  ] as const;

  const p2tr = btc.p2tr(
    numsInternal,
    taprootTree as any,
    network,
    true
  ) as any;

  // 2. Build transaction
  const tx = new btc.Transaction();

  // Input 0: Lock UTXO (Ordinal)
  tx.addInput({
    txid: params.lockUtxo.txid,
    index: params.lockUtxo.vout,
    sequence: RBF_SEQUENCE,
    witnessUtxo: {
      script: p2tr.script,
      amount: BigInt(params.lockUtxo.value),
    },
  } as any);

  // Input 1: Funding UTXO
  tx.addInput({
    txid: params.fundingUtxo.txid,
    index: params.fundingUtxo.vout,
    sequence: RBF_SEQUENCE,
    witnessUtxo: {
      script: hexToBytes(params.fundingUtxo.scriptPubKey),
      amount: BigInt(params.fundingUtxo.value),
    },
  });

  // Output 0: Buyer receives Ordinal (GATE 2 ENFORCEMENT)
  // Value is EXACTLY the lock UTXO value - no fees deducted
  tx.addOutputAddress(params.buyerAddress, BigInt(ordinalValue), network);

  // Calculate funding budget
  let fundingBudget = params.fundingUtxo.value;

  // Affiliate outputs (from funding, not Ordinal)
  for (const aff of affiliates) {
    const payout = Math.floor((params.priceSats * aff.bps) / BPS_DIVISOR);
    if (payout > DUST_THRESHOLD) {
      tx.addOutputAddress(aff.address, BigInt(payout), network);
      fundingBudget -= payout;
    }
  }

  // Calculate miner fee
  const minerFee = Math.ceil(ESTIMATED_SWEEP_VBYTES * params.feeRate);
  fundingBudget -= minerFee;

  // Check sufficient funding
  if (fundingBudget < 0) {
    throw new SafetyGateError(
      'FUNDING_INSUFFICIENT',
      `Funding UTXO (${params.fundingUtxo.value} sats) insufficient. ` +
      `Short by ${Math.abs(fundingBudget)} sats.`
    );
  }

  // Change output
  if (fundingBudget > DUST_THRESHOLD) {
    tx.addOutputAddress(params.changeAddress, BigInt(fundingBudget), network);
  }

  // 3. Create PSBT
  const psbt = tx.toPSBT();
  const psbtHex = bytesToHex(psbt);

  return {
    psbtHex,
    estimatedVsize: ESTIMATED_SWEEP_VBYTES,
    totalFee: minerFee,
    effectiveFeeRate: params.feeRate,
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Convert pubkey to x-only (32 bytes)
 */
function toXOnly(pubkey: Uint8Array): Uint8Array {
  if (pubkey.length === 32) return pubkey;
  if (pubkey.length === 33) return pubkey.slice(1);
  throw new Error(`Invalid pubkey length: ${pubkey.length}`);
}

/**
 * Encode number as Bitcoin script number
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

  if (bytes[bytes.length - 1] & 0x80) {
    bytes.push(neg ? 0x80 : 0x00);
  } else if (neg) {
    bytes[bytes.length - 1] |= 0x80;
  }

  return new Uint8Array(bytes);
}

// =============================================================================
// SAFETY GATE ERROR
// =============================================================================

/**
 * Custom error for safety gate failures
 */
export class SafetyGateError extends Error {
  public readonly gate: string;
  public readonly details: string;

  constructor(gate: string, details: string) {
    super(`Safety Gate Failed [${gate}]: ${details}`);
    this.name = 'SafetyGateError';
    this.gate = gate;
    this.details = details;
  }
}

// =============================================================================
// PREIMAGE FINALIZATION
// =============================================================================

/**
 * Finalize PSBT with preimage for broadcast
 *
 * After wallet signs Input 1 (funding), this function:
 * 1. Adds the preimage to the witness stack for Input 0
 * 2. Finalizes the transaction
 * 3. Returns raw transaction hex for broadcast
 *
 * @param signedPsbtHex - PSBT with Input 1 signed by wallet
 * @param preimage - The preimage (32-byte hex) revealed by Lightning payment
 * @param buyerPrivkey - Buyer's private key for signing Input 0
 * @returns Raw transaction hex ready for broadcast
 */
export async function finalizeSweepWithPreimage(
  signedPsbtHex: string,
  preimage: string,
  buyerPrivkey: Uint8Array
): Promise<string> {
  // This will be implemented to:
  // 1. Parse the signed PSBT
  // 2. Sign Input 0 with buyer's key
  // 3. Add preimage to witness stack
  // 4. Finalize and extract raw tx

  // For now, return placeholder
  throw new Error('finalizeSweepWithPreimage: Implementation in progress');
}
