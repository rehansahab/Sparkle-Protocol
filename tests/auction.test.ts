/**
 * Sparkle Protocol - Auction Engine Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AuctionEngine,
  createAuctionEngine,
  DEFAULT_AUCTION_CONFIG,
  type Auction,
  type Bid,
} from '../src/auction/auction-engine.js';

describe('Sparkle Auction Engine', () => {
  let engine: AuctionEngine;

  beforeEach(() => {
    engine = createAuctionEngine();
  });

  describe('Auction Creation', () => {
    it('should create an auction with default config', () => {
      const auction = engine.createAuction({
        sellerPubkey: 'seller123',
        inscriptionId: 'inscription123i0',
        config: DEFAULT_AUCTION_CONFIG,
      });

      expect(auction.id).toBeDefined();
      expect(auction.sellerPubkey).toBe('seller123');
      expect(auction.inscriptionId).toBe('inscription123i0');
      expect(auction.status).toBe('created');
      expect(auction.bids).toHaveLength(0);
    });

    it('should create an auction with custom config', () => {
      const auction = engine.createAuction({
        sellerPubkey: 'seller123',
        inscriptionId: 'inscription123i0',
        config: {
          ...DEFAULT_AUCTION_CONFIG,
          minBidSats: 50000n,
          reservePriceSats: 100000n,
        },
      });

      expect(auction.config.minBidSats).toBe(50000n);
      expect(auction.config.reservePriceSats).toBe(100000n);
    });
  });

  describe('Auction Lifecycle', () => {
    it('should start an auction', () => {
      const auction = engine.createAuction({
        sellerPubkey: 'seller123',
        inscriptionId: 'inscription123i0',
        config: DEFAULT_AUCTION_CONFIG,
      });

      const started = engine.startAuction(auction.id);

      expect(started.status).toBe('active');
      expect(started.startedAt).toBeDefined();
      expect(started.endAt).toBeDefined();
    });

    it('should not start an already started auction', () => {
      const auction = engine.createAuction({
        sellerPubkey: 'seller123',
        inscriptionId: 'inscription123i0',
        config: DEFAULT_AUCTION_CONFIG,
      });

      engine.startAuction(auction.id);

      expect(() => engine.startAuction(auction.id)).toThrow();
    });
  });

  describe('Bidding', () => {
    let auction: Auction;

    beforeEach(() => {
      auction = engine.createAuction({
        sellerPubkey: 'seller123',
        inscriptionId: 'inscription123i0',
        config: DEFAULT_AUCTION_CONFIG,
      });
      engine.startAuction(auction.id);
    });

    it('should place a valid bid', () => {
      const result = engine.placeBid({
        auctionId: auction.id,
        bidderPubkey: 'bidder123',
        amountSats: 15000n,
      });

      expect(result.bid).toBeDefined();
      expect(result.bid.amountSats).toBe(15000n);
      expect(result.bid.status).toBe('pending');
      expect(result.paymentHash).toBeDefined();
      expect(result.invoice).toBeDefined();
    });

    it('should reject bid below minimum', () => {
      expect(() =>
        engine.placeBid({
          auctionId: auction.id,
          bidderPubkey: 'bidder123',
          amountSats: 5000n, // Below minimum of 10000
        })
      ).toThrow();
    });

    it('should reject bid below increment', () => {
      // Place first bid
      const result1 = engine.placeBid({
        auctionId: auction.id,
        bidderPubkey: 'bidder1',
        amountSats: 15000n,
      });

      // Confirm payment
      engine.confirmBidPayment(result1.paymentHash, result1.bid.preimage!);

      // Try to place bid that doesn't meet increment
      expect(() =>
        engine.placeBid({
          auctionId: auction.id,
          bidderPubkey: 'bidder2',
          amountSats: 15500n, // Only 500 more, need 1000 increment
        })
      ).toThrow();
    });

    it('should update highest bid after payment confirmation', () => {
      const result = engine.placeBid({
        auctionId: auction.id,
        bidderPubkey: 'bidder123',
        amountSats: 20000n,
      });

      const confirmed = engine.confirmBidPayment(result.paymentHash, result.bid.preimage!);

      expect(confirmed.status).toBe('paid');

      const updated = engine.getAuction(auction.id)!;
      expect(updated.highestBid?.id).toBe(result.bid.id);
    });
  });

  describe('Auction Settlement', () => {
    let auction: Auction;

    beforeEach(() => {
      auction = engine.createAuction({
        sellerPubkey: 'seller123',
        inscriptionId: 'inscription123i0',
        config: DEFAULT_AUCTION_CONFIG,
      });
      engine.startAuction(auction.id);
    });

    it('should end auction and mark winner', () => {
      // Place and confirm bid
      const result = engine.placeBid({
        auctionId: auction.id,
        bidderPubkey: 'bidder123',
        amountSats: 25000n,
      });
      engine.confirmBidPayment(result.paymentHash, result.bid.preimage!);

      // End auction
      const ended = engine.endAuction(auction.id);

      expect(ended.status).toBe('ended');
      expect(ended.winningBid).toBeDefined();
      expect(ended.winningBid?.bidderPubkey).toBe('bidder123');
    });

    it('should record settlement', () => {
      const result = engine.placeBid({
        auctionId: auction.id,
        bidderPubkey: 'bidder123',
        amountSats: 25000n,
      });
      engine.confirmBidPayment(result.paymentHash, result.bid.preimage!);
      engine.endAuction(auction.id);

      const settled = engine.recordSettlement(auction.id, 'claim_txid_123');

      expect(settled.status).toBe('settled');
      expect(settled.claimTxid).toBe('claim_txid_123');
    });
  });

  describe('Auction Queries', () => {
    it('should get active auctions', () => {
      const auction1 = engine.createAuction({
        sellerPubkey: 'seller1',
        inscriptionId: 'inscription1i0',
        config: DEFAULT_AUCTION_CONFIG,
      });
      engine.startAuction(auction1.id);

      const auction2 = engine.createAuction({
        sellerPubkey: 'seller2',
        inscriptionId: 'inscription2i0',
        config: DEFAULT_AUCTION_CONFIG,
      });
      // Not started

      const active = engine.getActiveAuctions();

      expect(active).toHaveLength(1);
      expect(active[0].id).toBe(auction1.id);
    });

    it('should get auctions by seller', () => {
      engine.createAuction({
        sellerPubkey: 'seller1',
        inscriptionId: 'inscription1i0',
        config: DEFAULT_AUCTION_CONFIG,
      });

      engine.createAuction({
        sellerPubkey: 'seller1',
        inscriptionId: 'inscription2i0',
        config: DEFAULT_AUCTION_CONFIG,
      });

      engine.createAuction({
        sellerPubkey: 'seller2',
        inscriptionId: 'inscription3i0',
        config: DEFAULT_AUCTION_CONFIG,
      });

      const seller1Auctions = engine.getAuctionsBySeller('seller1');
      expect(seller1Auctions).toHaveLength(2);
    });
  });

  describe('State Export/Import', () => {
    it('should export and import state', () => {
      const auction = engine.createAuction({
        sellerPubkey: 'seller123',
        inscriptionId: 'inscription123i0',
        config: DEFAULT_AUCTION_CONFIG,
      });
      engine.startAuction(auction.id);

      const state = engine.exportState();

      const newEngine = createAuctionEngine();
      newEngine.importState(state);

      const imported = newEngine.getAuction(auction.id);
      expect(imported).toBeDefined();
      expect(imported?.sellerPubkey).toBe('seller123');
    });
  });
});
