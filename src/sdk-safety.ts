/**
 * Sparkle Protocol - Safety Validation
 *
 * Pre-payment validation to ensure offers are safe before Lightning payment.
 * These checks run BEFORE the buyer pays to prevent unsafe situations.
 *
 * @module sparkle-protocol/safety
 * @version 1.0.0-rc.1
 */

import type {
  SparkleOfferContent,
  ValidationResult,
  ValidationContext,
  Affiliate,
} from './sdk-types.js';

import {
  SAFETY_BUFFER_BLOCKS,
  BLOCK_TIME_SECONDS,
  MAX_AFFILIATES,
  MAX_AFFILIATE_BPS,
  MAX_TOTAL_AFFILIATE_BPS,
  PROTOCOL_VERSION,
} from './sdk-constants.js';

// =============================================================================
// OFFER VALIDATION
// =============================================================================

/**
 * Validate a Sparkle offer against all safety invariants
 *
 * This should be called BEFORE the buyer pays the Lightning invoice.
 * It checks:
 * 1. Time-Bandit safety delta (timelock > invoice expiry + buffer)
 * 2. Inscription ownership (UTXO matches indexer truth)
 * 3. Value consistency (claimed value matches actual)
 * 4. Protocol version compatibility
 *
 * @param offer - The Sparkle offer to validate
 * @param context - Validation context with current state
 * @returns Validation result with errors if invalid
 */
export async function validateOffer(
  offer: SparkleOfferContent,
  context: ValidationContext
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // =========================================================================
  // 1. TIME-BANDIT SAFETY DELTA
  // =========================================================================
  // The Bitcoin timelock MUST extend beyond Lightning invoice expiry
  // by at least SAFETY_BUFFER_BLOCKS to prevent front-running attacks.

  const nowUnix = Math.floor(Date.now() / 1000);
  const secondsToExpiry = Math.max(0, context.invoiceExpiryUnix - nowUnix);

  // Convert seconds to estimated blocks
  const estimatedExpiryBlock =
    context.currentBlockHeight + Math.ceil(secondsToExpiry / BLOCK_TIME_SECONDS);

  // Calculate minimum safe timelock
  const minimumSafeTimelock = estimatedExpiryBlock + SAFETY_BUFFER_BLOCKS;

  if (offer.timelock <= minimumSafeTimelock) {
    errors.push('DELTA_TOO_SMALL');
  }

  // =========================================================================
  // 2. INSCRIPTION OWNERSHIP VERIFICATION
  // =========================================================================
  // The inscription ID in the offer must match the indexer's data.

  if (context.indexerData.inscriptionId !== offer.asset.inscriptionId) {
    errors.push('ORDINAL_MISMATCH');
  }

  // =========================================================================
  // 3. VALUE CONSISTENCY
  // =========================================================================
  // The claimed UTXO value must match the indexer's truth.

  if (context.indexerData.outputValue !== offer.asset.value) {
    errors.push('VALUE_MISMATCH');
  }

  // =========================================================================
  // 4. UTXO LOCATION VERIFICATION
  // =========================================================================
  // The lock UTXO must be at the location the indexer reports.

  if (
    context.indexerData.txid !== offer.asset.txid ||
    context.indexerData.vout !== offer.asset.vout
  ) {
    errors.push('OWNERSHIP_MISMATCH');
  }

  // =========================================================================
  // 5. PROTOCOL VERSION
  // =========================================================================

  if (offer.v !== PROTOCOL_VERSION) {
    errors.push('UNSUPPORTED_VERSION');
  }

  // =========================================================================
  // 6. AFFILIATE VALIDATION (Non-blocking warnings)
  // =========================================================================

  if (offer.affiliates && offer.affiliates.length > 0) {
    const affiliateResult = validateAffiliates(offer.affiliates);
    if (!affiliateResult.isValid) {
      // Affiliate violations are errors, not warnings
      errors.push(...affiliateResult.errors);
    }
  }

  // =========================================================================
  // WARNINGS (Non-fatal)
  // =========================================================================

  // Warn if invoice expiry is very soon
  if (secondsToExpiry < 600) {
    warnings.push('INVOICE_EXPIRING_SOON');
  }

  // Warn if price seems unusually low or high
  if (offer.priceSats < 1000) {
    warnings.push('PRICE_VERY_LOW');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

// =============================================================================
// AFFILIATE VALIDATION
// =============================================================================

/**
 * Validate affiliate configuration against protocol limits
 *
 * Hard limits (enforced):
 * - Max 3 affiliates total
 * - Max 5% (500 bps) per affiliate
 * - Max 10% (1000 bps) total
 *
 * @param affiliates - Array of affiliate configurations
 * @returns Validation result
 */
export function validateAffiliates(affiliates: Affiliate[]): ValidationResult {
  const errors: string[] = [];

  // Check count limit
  if (affiliates.length > MAX_AFFILIATES) {
    errors.push('AFFILIATE_COUNT_EXCEEDED');
  }

  // Check individual and total limits
  let totalBps = 0;

  for (const affiliate of affiliates) {
    if (affiliate.bps > MAX_AFFILIATE_BPS) {
      errors.push('AFFILIATE_BPS_EXCEEDED');
    }
    totalBps += affiliate.bps;
  }

  if (totalBps > MAX_TOTAL_AFFILIATE_BPS) {
    errors.push('TOTAL_BPS_EXCEEDED');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Calculate the minimum safe timelock for an offer
 *
 * @param currentBlockHeight - Current blockchain height
 * @param invoiceExpiryUnix - Invoice expiry timestamp
 * @returns Minimum safe timelock block height
 */
export function calculateMinimumSafeTimelock(
  currentBlockHeight: number,
  invoiceExpiryUnix: number
): number {
  const nowUnix = Math.floor(Date.now() / 1000);
  const secondsToExpiry = Math.max(0, invoiceExpiryUnix - nowUnix);
  const estimatedExpiryBlock =
    currentBlockHeight + Math.ceil(secondsToExpiry / BLOCK_TIME_SECONDS);

  // Add safety buffer + 1 (must be strictly greater)
  return estimatedExpiryBlock + SAFETY_BUFFER_BLOCKS + 1;
}

/**
 * Verify that a payment hash matches the offer
 *
 * @param offerPaymentHash - Payment hash from offer
 * @param invoicePaymentHash - Payment hash from decoded invoice
 * @returns true if they match
 */
export function verifyPaymentHashMatch(
  offerPaymentHash: string,
  invoicePaymentHash: string
): boolean {
  // Normalize to lowercase for comparison
  return offerPaymentHash.toLowerCase() === invoicePaymentHash.toLowerCase();
}
