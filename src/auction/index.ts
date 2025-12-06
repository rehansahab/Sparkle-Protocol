/**
 * Sparkle Protocol - Auction Module
 *
 * Pay-to-bid Lightning auctions for Bitcoin Ordinals.
 *
 * @module sparkle-protocol/auction
 * @version 0.3.0
 */

export {
  AuctionEngine,
  createAuctionEngine,
  DEFAULT_AUCTION_CONFIG,
  type Auction,
  type AuctionConfig,
  type AuctionStatus,
  type Bid,
  type CreateAuctionParams,
  type PlaceBidParams,
  type PlaceBidResult,
} from './auction-engine.js';
