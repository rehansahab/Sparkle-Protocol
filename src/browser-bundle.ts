/**
 * Sparkle Protocol - Browser Bundle
 *
 * Client-side SDK for browser integration.
 * Includes wallet integrations and core swap primitives.
 *
 * @module sparkle-protocol/browser
 * @version 0.3.0
 */

// Core exports for browser
export {
  generatePreimage,
  verifyPreimage,
  calculateRefundLocktime,
  type SwapPreimage,
} from './core/lightning-invoice.js';

export {
  createSparkleSwapAddress,
  createHashlockScript,
  createTimelockScript,
  type SwapAddressParams,
  type SwapAddressResult,
} from './core/taproot-scripts.js';

export {
  buildClaimTransaction,
  type ClaimTransactionParams,
  type ClaimTransactionResult,
} from './core/claim-transaction.js';

export {
  buildRefundTransaction,
  type RefundTransactionParams,
  type RefundTransactionResult,
} from './core/refund-transaction.js';

// Browser wallet integrations
export * from './browser/index.js';

// ============================================================================
// Types only (implementations run server-side)
// ============================================================================

// Auction types
export type AuctionStatus = 'created' | 'active' | 'ended' | 'settled' | 'cancelled';
export type BidStatus = 'pending' | 'paid' | 'refunded' | 'won';

export interface AuctionConfig {
  minBidSats: bigint;
  bidIncrementSats: bigint;
  reservePriceSats?: bigint;
  buyNowPriceSats?: bigint;
  durationMs: number;
  extensionMs: number;
  antiSnipeWindowMs: number;
}

export interface Bid {
  id: string;
  auctionId: string;
  bidderPubkey: string;
  amountSats: bigint;
  status: BidStatus;
  preimage?: string;
  paymentHash: string;
  createdAt: number;
  paidAt?: number;
}

export interface Auction {
  id: string;
  sellerPubkey: string;
  inscriptionId: string;
  config: AuctionConfig;
  status: AuctionStatus;
  bids: Bid[];
  highestBid?: Bid;
  winningBid?: Bid;
  createdAt: number;
  startedAt?: number;
  endAt?: number;
  settledAt?: number;
  claimTxid?: string;
}

// Coordinator types
export type SwapStatus =
  | 'created'
  | 'negotiating'
  | 'funded'
  | 'invoice_created'
  | 'paid'
  | 'claiming'
  | 'completed'
  | 'refunded'
  | 'expired'
  | 'cancelled';

export interface SwapParticipant {
  nostrPubkey: string;
  bitcoinAddress?: string;
  lastSeen: number;
}

export interface Swap {
  id: string;
  inscriptionId: string;
  priceSats: bigint;
  seller: SwapParticipant;
  buyer?: SwapParticipant;
  status: SwapStatus;
  swapAddress?: string;
  paymentHash?: string;
  preimage?: string;
  lightningInvoice?: string;
  fundingTxid?: string;
  fundingVout?: number;
  claimTxid?: string;
  refundTxid?: string;
  createdAt: number;
  expiresAt: number;
  completedAt?: number;
}

export type WSMessageType =
  | 'auth'
  | 'subscribe'
  | 'unsubscribe'
  | 'create_swap'
  | 'accept_swap'
  | 'fund_swap'
  | 'create_invoice'
  | 'confirm_payment'
  | 'claim'
  | 'cancel'
  | 'get_swaps'
  | 'ping';

export interface WSMessage {
  id?: string;
  type: WSMessageType;
  payload?: Record<string, unknown>;
}

export interface WSResponse {
  id?: string;
  type: WSMessageType;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

// Default configs
export const DEFAULT_AUCTION_CONFIG: AuctionConfig = {
  minBidSats: 10000n,
  bidIncrementSats: 1000n,
  durationMs: 24 * 60 * 60 * 1000, // 24 hours
  extensionMs: 10 * 60 * 1000, // 10 minutes
  antiSnipeWindowMs: 5 * 60 * 1000, // 5 minutes
};

export const DEFAULT_COORDINATOR_CONFIG = {
  minSwapSats: 1000n,
  maxSwapSats: 100000000n,
  swapTimeoutMs: 2 * 60 * 60 * 1000,
  requireAuth: true,
};

// Version
export const VERSION = '0.3.0';
