/**
 * Sparkle Protocol - Core Module
 *
 * The foundational components for Lightning-atomic Ordinal swaps.
 *
 * @module sparkle-protocol/core
 * @version 0.3.0
 */

// Taproot Script Generation
export {
  createSparkleSwapAddress,
  createHashlockScript,
  createTimelockScript,
  generatePreimage,
  verifyPreimage,
  calculateRefundLocktime,
  NETWORKS,
  type NetworkType,
  type SparkleSwapParams,
  type SparkleSwapAddress,
  toHex,
  fromHex,
  sha256,
  bytesToHex,
  hexToBytes,
} from './taproot-scripts.js';

// Claim Transaction (Buyer)
export {
  buildClaimTransaction,
  buildClaimTransactionFromHex,
  estimateClaimVsize,
  type ClaimTransactionParams,
  type ClaimTransactionResult,
} from './claim-transaction.js';

// Refund Transaction (Seller)
export {
  buildRefundTransaction,
  buildRefundTransactionFromHex,
  estimateRefundVsize,
  isRefundAvailable,
  blocksUntilRefund,
  estimateTimeUntilRefund,
  type RefundTransactionParams,
  type RefundTransactionResult,
} from './refund-transaction.js';

// Lightning Invoice
export {
  generatePreimage as generateLightningPreimage,
  computePaymentHash,
  verifyPreimage as verifyLightningPreimage,
  decodeBolt11,
  verifyInvoiceMatchesSwap,
  generateSwapSetup,
  extractAndVerifyPreimage,
  createInvoiceLND,
  type Bolt11Invoice,
  type CreateInvoiceParams,
  type InvoiceResult,
  type SwapSetup,
} from './lightning-invoice.js';

// Swap Execution Coordinator
export {
  createSwapOffer,
  getPublicOffer,
  verifySwapOffer,
  recordFunding,
  recordInvoice,
  verifyBeforePayment,
  recordPayment,
  buildClaimForBuyer,
  buildRefundForSeller,
  recordClaim,
  recordRefund,
  getSwapStatus,
  type SwapState,
  type SparkleSwap,
  type CreateSwapOfferParams,
  type SwapOfferPublic,
} from './swap-execution.js';
