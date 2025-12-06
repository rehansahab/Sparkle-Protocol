/**
 * Sparkle Protocol - Auction Engine
 *
 * Pay-to-bid Lightning auctions for Bitcoin Ordinals.
 * Bids are placed via Lightning payments, with automatic refunds for non-winners.
 *
 * @module sparkle-protocol/auction
 * @version 0.3.0
 */

import { sha256 } from '@noble/hashes/sha256';
import { randomBytes } from '@noble/hashes/utils';
import { bytesToHex, hexToBytes } from '@noble/curves/abstract/utils';

// ============================================================================
// Types
// ============================================================================

export type AuctionStatus =
  | 'created'      // Auction created, not yet active
  | 'active'       // Accepting bids
  | 'ending'       // In final countdown (extension possible)
  | 'ended'        // No more bids, awaiting settlement
  | 'settled'      // Winner claimed the ordinal
  | 'cancelled'    // Auction cancelled, all bids refunded
  | 'expired';     // No bids received, expired

export interface AuctionConfig {
  /** Minimum bid amount in satoshis */
  minBidSats: bigint;
  /** Minimum increment over previous bid (satoshis) */
  minIncrementSats: bigint;
  /** Auction duration in seconds */
  durationSeconds: number;
  /** Extension time when bid placed near end (seconds) */
  extensionSeconds: number;
  /** Time before end when bids trigger extension (seconds) */
  extensionThresholdSeconds: number;
  /** Reserve price (auction fails if not met) */
  reservePriceSats?: bigint;
  /** Buy-now price (instant win) */
  buyNowPriceSats?: bigint;
}

export interface Bid {
  id: string;
  auctionId: string;
  bidderPubkey: string;
  amountSats: bigint;
  paymentHash: string;
  preimage?: string;  // Set when payment received
  lightningInvoice: string;
  status: 'pending' | 'paid' | 'refunded' | 'won';
  createdAt: number;
  paidAt?: number;
  refundedAt?: number;
}

export interface Auction {
  id: string;
  /** Seller's Nostr pubkey */
  sellerPubkey: string;
  /** Ordinal inscription ID being auctioned */
  inscriptionId: string;
  /** Auction configuration */
  config: AuctionConfig;
  /** Current status */
  status: AuctionStatus;
  /** All bids placed */
  bids: Bid[];
  /** Current highest bid */
  highestBid?: Bid;
  /** Auction start time (unix timestamp) */
  startedAt?: number;
  /** Original end time (may be extended) */
  originalEndAt?: number;
  /** Current end time (after extensions) */
  endAt?: number;
  /** Winning bid (after settlement) */
  winningBid?: Bid;
  /** Claim transaction ID (after settlement) */
  claimTxid?: string;
  /** Created timestamp */
  createdAt: number;
}

export interface CreateAuctionParams {
  sellerPubkey: string;
  inscriptionId: string;
  config: AuctionConfig;
}

export interface PlaceBidParams {
  auctionId: string;
  bidderPubkey: string;
  amountSats: bigint;
}

export interface PlaceBidResult {
  bid: Bid;
  invoice: string;
  paymentHash: string;
  expiresAt: number;
}

// ============================================================================
// Auction Engine Class
// ============================================================================

export class AuctionEngine {
  private auctions: Map<string, Auction> = new Map();
  private bidsByPaymentHash: Map<string, Bid> = new Map();

  // Callbacks for external integration
  public onBidReceived?: (auction: Auction, bid: Bid) => void;
  public onAuctionEnded?: (auction: Auction) => void;
  public onOutbid?: (auction: Auction, outbidBid: Bid, newBid: Bid) => void;

  /**
   * Create a new auction
   */
  createAuction(params: CreateAuctionParams): Auction {
    const id = bytesToHex(randomBytes(16));

    const auction: Auction = {
      id,
      sellerPubkey: params.sellerPubkey,
      inscriptionId: params.inscriptionId,
      config: params.config,
      status: 'created',
      bids: [],
      createdAt: Math.floor(Date.now() / 1000),
    };

    this.auctions.set(id, auction);
    return auction;
  }

  /**
   * Start an auction (make it active)
   */
  startAuction(auctionId: string): Auction {
    const auction = this.getAuction(auctionId);
    if (!auction) {
      throw new Error(`Auction ${auctionId} not found`);
    }

    if (auction.status !== 'created') {
      throw new Error(`Auction ${auctionId} cannot be started (status: ${auction.status})`);
    }

    const now = Math.floor(Date.now() / 1000);
    auction.status = 'active';
    auction.startedAt = now;
    auction.originalEndAt = now + auction.config.durationSeconds;
    auction.endAt = auction.originalEndAt;

    return auction;
  }

  /**
   * Place a bid on an auction
   * Returns a Lightning invoice that must be paid to confirm the bid
   */
  placeBid(params: PlaceBidParams): PlaceBidResult {
    const auction = this.getAuction(params.auctionId);
    if (!auction) {
      throw new Error(`Auction ${params.auctionId} not found`);
    }

    // Validate auction is accepting bids
    if (auction.status !== 'active' && auction.status !== 'ending') {
      throw new Error(`Auction ${params.auctionId} is not accepting bids (status: ${auction.status})`);
    }

    // Check auction hasn't ended
    const now = Math.floor(Date.now() / 1000);
    if (auction.endAt && now >= auction.endAt) {
      throw new Error(`Auction ${params.auctionId} has ended`);
    }

    // Validate bid amount
    const minRequired = auction.highestBid
      ? auction.highestBid.amountSats + auction.config.minIncrementSats
      : auction.config.minBidSats;

    if (params.amountSats < minRequired) {
      throw new Error(
        `Bid must be at least ${minRequired} sats (current high: ${auction.highestBid?.amountSats || 0} + increment: ${auction.config.minIncrementSats})`
      );
    }

    // Generate payment hash for this bid
    const preimage = randomBytes(32);
    const paymentHash = bytesToHex(sha256(preimage));

    // Create bid
    const bid: Bid = {
      id: bytesToHex(randomBytes(16)),
      auctionId: params.auctionId,
      bidderPubkey: params.bidderPubkey,
      amountSats: params.amountSats,
      paymentHash,
      preimage: bytesToHex(preimage), // Store for later verification
      lightningInvoice: '', // Will be set by Lightning integration
      status: 'pending',
      createdAt: now,
    };

    // Generate Lightning invoice (placeholder - real implementation uses LND/CLN)
    const invoice = this.generateBidInvoice(auction, bid);
    bid.lightningInvoice = invoice;

    // Store bid
    auction.bids.push(bid);
    this.bidsByPaymentHash.set(paymentHash, bid);

    return {
      bid,
      invoice,
      paymentHash,
      expiresAt: now + 600, // 10 minute invoice expiry
    };
  }

  /**
   * Confirm bid payment received
   * Called when Lightning payment is detected
   */
  confirmBidPayment(paymentHash: string, preimage: string): Bid {
    const bid = this.bidsByPaymentHash.get(paymentHash);
    if (!bid) {
      throw new Error(`No bid found for payment hash ${paymentHash}`);
    }

    // Verify preimage matches
    const computedHash = bytesToHex(sha256(hexToBytes(preimage)));
    if (computedHash !== paymentHash) {
      throw new Error('Preimage does not match payment hash');
    }

    const auction = this.getAuction(bid.auctionId);
    if (!auction) {
      throw new Error(`Auction ${bid.auctionId} not found`);
    }

    // Mark bid as paid
    bid.status = 'paid';
    bid.paidAt = Math.floor(Date.now() / 1000);

    // Check if this is the new highest bid
    const previousHighest = auction.highestBid;
    if (!previousHighest || bid.amountSats > previousHighest.amountSats) {
      auction.highestBid = bid;

      // Notify about outbid
      if (previousHighest && this.onOutbid) {
        this.onOutbid(auction, previousHighest, bid);
      }

      // Check for auction extension
      this.checkExtension(auction);
    }

    // Check for buy-now
    if (auction.config.buyNowPriceSats && bid.amountSats >= auction.config.buyNowPriceSats) {
      this.endAuction(auction.id);
    }

    // Callback
    if (this.onBidReceived) {
      this.onBidReceived(auction, bid);
    }

    return bid;
  }

  /**
   * Check if auction should be extended (anti-sniping)
   */
  private checkExtension(auction: Auction): void {
    if (!auction.endAt) return;

    const now = Math.floor(Date.now() / 1000);
    const timeRemaining = auction.endAt - now;

    if (timeRemaining <= auction.config.extensionThresholdSeconds) {
      auction.endAt = now + auction.config.extensionSeconds;
      auction.status = 'ending';
    }
  }

  /**
   * End an auction (no more bids accepted)
   */
  endAuction(auctionId: string): Auction {
    const auction = this.getAuction(auctionId);
    if (!auction) {
      throw new Error(`Auction ${auctionId} not found`);
    }

    auction.status = 'ended';

    // Check if reserve was met
    if (auction.config.reservePriceSats && auction.highestBid) {
      if (auction.highestBid.amountSats < auction.config.reservePriceSats) {
        // Reserve not met - cancel and refund all bids
        return this.cancelAuction(auctionId);
      }
    }

    // Mark winning bid
    if (auction.highestBid) {
      auction.winningBid = auction.highestBid;
      auction.winningBid.status = 'won';
    }

    // Refund all non-winning bids
    for (const bid of auction.bids) {
      if (bid.status === 'paid' && bid.id !== auction.winningBid?.id) {
        this.refundBid(bid);
      }
    }

    // Callback
    if (this.onAuctionEnded) {
      this.onAuctionEnded(auction);
    }

    return auction;
  }

  /**
   * Cancel an auction and refund all bids
   */
  cancelAuction(auctionId: string): Auction {
    const auction = this.getAuction(auctionId);
    if (!auction) {
      throw new Error(`Auction ${auctionId} not found`);
    }

    auction.status = 'cancelled';

    // Refund all paid bids
    for (const bid of auction.bids) {
      if (bid.status === 'paid') {
        this.refundBid(bid);
      }
    }

    return auction;
  }

  /**
   * Refund a bid via Lightning
   */
  private refundBid(bid: Bid): void {
    // In real implementation, this would trigger a Lightning payment back to bidder
    bid.status = 'refunded';
    bid.refundedAt = Math.floor(Date.now() / 1000);
    console.log(`Refunding bid ${bid.id}: ${bid.amountSats} sats to ${bid.bidderPubkey}`);
  }

  /**
   * Record settlement (winning bid claimed the ordinal)
   */
  recordSettlement(auctionId: string, claimTxid: string): Auction {
    const auction = this.getAuction(auctionId);
    if (!auction) {
      throw new Error(`Auction ${auctionId} not found`);
    }

    if (auction.status !== 'ended') {
      throw new Error(`Auction ${auctionId} is not ended (status: ${auction.status})`);
    }

    auction.status = 'settled';
    auction.claimTxid = claimTxid;

    return auction;
  }

  /**
   * Get auction by ID
   */
  getAuction(id: string): Auction | undefined {
    return this.auctions.get(id);
  }

  /**
   * Get all active auctions
   */
  getActiveAuctions(): Auction[] {
    return Array.from(this.auctions.values()).filter(
      (a) => a.status === 'active' || a.status === 'ending'
    );
  }

  /**
   * Get auctions by seller
   */
  getAuctionsBySeller(sellerPubkey: string): Auction[] {
    return Array.from(this.auctions.values()).filter(
      (a) => a.sellerPubkey === sellerPubkey
    );
  }

  /**
   * Get bids by bidder
   */
  getBidsByBidder(bidderPubkey: string): Bid[] {
    const bids: Bid[] = [];
    for (const auction of this.auctions.values()) {
      for (const bid of auction.bids) {
        if (bid.bidderPubkey === bidderPubkey) {
          bids.push(bid);
        }
      }
    }
    return bids;
  }

  /**
   * Check and end any expired auctions
   */
  processExpiredAuctions(): Auction[] {
    const ended: Auction[] = [];
    const now = Math.floor(Date.now() / 1000);

    for (const auction of this.auctions.values()) {
      if (
        (auction.status === 'active' || auction.status === 'ending') &&
        auction.endAt &&
        now >= auction.endAt
      ) {
        if (auction.bids.length === 0) {
          auction.status = 'expired';
        } else {
          this.endAuction(auction.id);
        }
        ended.push(auction);
      }
    }

    return ended;
  }

  /**
   * Generate Lightning invoice for a bid (placeholder)
   */
  private generateBidInvoice(auction: Auction, bid: Bid): string {
    // In real implementation, this calls LND/CLN to generate invoice
    // with the specific payment_hash from the bid
    const mockInvoice = `lnbc${bid.amountSats}n1p...${bid.paymentHash.slice(0, 20)}`;
    return mockInvoice;
  }

  /**
   * Export auction state (for persistence)
   */
  exportState(): { auctions: Auction[] } {
    return {
      auctions: Array.from(this.auctions.values()),
    };
  }

  /**
   * Import auction state (for persistence)
   */
  importState(state: { auctions: Auction[] }): void {
    this.auctions.clear();
    this.bidsByPaymentHash.clear();

    for (const auction of state.auctions) {
      this.auctions.set(auction.id, auction);
      for (const bid of auction.bids) {
        this.bidsByPaymentHash.set(bid.paymentHash, bid);
      }
    }
  }
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_AUCTION_CONFIG: AuctionConfig = {
  minBidSats: 10000n,           // 10,000 sats minimum
  minIncrementSats: 1000n,       // 1,000 sat increments
  durationSeconds: 86400,        // 24 hours
  extensionSeconds: 600,         // 10 minute extension
  extensionThresholdSeconds: 300, // Extend if bid in last 5 minutes
};

// ============================================================================
// Factory Function
// ============================================================================

export function createAuctionEngine(): AuctionEngine {
  return new AuctionEngine();
}
