/**
 * Sparkle Protocol - Coordinator Server Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CoordinatorServer,
  createCoordinator,
  DEFAULT_COORDINATOR_CONFIG,
  type Swap,
} from '../src/coordinator/coordinator-server.js';

describe('Sparkle Coordinator Server', () => {
  let coordinator: CoordinatorServer;

  beforeEach(() => {
    coordinator = createCoordinator();
  });

  describe('Swap Creation', () => {
    it('should create a swap', () => {
      const swap = coordinator.createSwap({
        inscriptionId: 'inscription123i0',
        priceSats: 50000n,
        sellerNostrPubkey: 'seller_pubkey_123',
        sellerBitcoinAddress: 'tb1qseller...',
      });

      expect(swap.id).toBeDefined();
      expect(swap.inscriptionId).toBe('inscription123i0');
      expect(swap.priceSats).toBe(50000n);
      expect(swap.seller.nostrPubkey).toBe('seller_pubkey_123');
      expect(swap.status).toBe('created');
    });

    it('should reject swap below minimum', () => {
      expect(() =>
        coordinator.createSwap({
          inscriptionId: 'inscription123i0',
          priceSats: 100n, // Below minimum
          sellerNostrPubkey: 'seller_pubkey_123',
          sellerBitcoinAddress: 'tb1qseller...',
        })
      ).toThrow('Minimum swap amount');
    });

    it('should reject swap above maximum', () => {
      expect(() =>
        coordinator.createSwap({
          inscriptionId: 'inscription123i0',
          priceSats: 1000000000000n, // Way above maximum
          sellerNostrPubkey: 'seller_pubkey_123',
          sellerBitcoinAddress: 'tb1qseller...',
        })
      ).toThrow('Maximum swap amount');
    });
  });

  describe('Swap Acceptance', () => {
    let swap: Swap;

    beforeEach(() => {
      swap = coordinator.createSwap({
        inscriptionId: 'inscription123i0',
        priceSats: 50000n,
        sellerNostrPubkey: 'seller_pubkey_123',
        sellerBitcoinAddress: 'tb1qseller...',
      });
    });

    it('should accept a swap', () => {
      const accepted = coordinator.acceptSwap({
        swapId: swap.id,
        buyerNostrPubkey: 'buyer_pubkey_456',
        buyerBitcoinAddress: 'tb1qbuyer...',
      });

      expect(accepted.buyer).toBeDefined();
      expect(accepted.buyer?.nostrPubkey).toBe('buyer_pubkey_456');
      expect(accepted.status).toBe('negotiating');
    });

    it('should not allow seller to accept own swap', () => {
      expect(() =>
        coordinator.acceptSwap({
          swapId: swap.id,
          buyerNostrPubkey: 'seller_pubkey_123', // Same as seller
          buyerBitcoinAddress: 'tb1qseller...',
        })
      ).toThrow('Cannot accept your own swap');
    });

    it('should not accept non-existent swap', () => {
      expect(() =>
        coordinator.acceptSwap({
          swapId: 'nonexistent',
          buyerNostrPubkey: 'buyer_pubkey_456',
          buyerBitcoinAddress: 'tb1qbuyer...',
        })
      ).toThrow('Swap not found');
    });
  });

  describe('Active Swaps', () => {
    it('should list active swaps', () => {
      coordinator.createSwap({
        inscriptionId: 'inscription1i0',
        priceSats: 50000n,
        sellerNostrPubkey: 'seller1',
        sellerBitcoinAddress: 'tb1q1...',
      });

      coordinator.createSwap({
        inscriptionId: 'inscription2i0',
        priceSats: 75000n,
        sellerNostrPubkey: 'seller2',
        sellerBitcoinAddress: 'tb1q2...',
      });

      const active = coordinator.getActiveSwaps();

      expect(active).toHaveLength(2);
    });

    it('should not include accepted swaps in active listing', () => {
      const swap = coordinator.createSwap({
        inscriptionId: 'inscription1i0',
        priceSats: 50000n,
        sellerNostrPubkey: 'seller1',
        sellerBitcoinAddress: 'tb1q1...',
      });

      coordinator.acceptSwap({
        swapId: swap.id,
        buyerNostrPubkey: 'buyer1',
        buyerBitcoinAddress: 'tb1qbuyer...',
      });

      const active = coordinator.getActiveSwaps();

      expect(active).toHaveLength(0);
    });
  });

  describe('State Export/Import', () => {
    it('should export and import state', () => {
      const swap = coordinator.createSwap({
        inscriptionId: 'inscription123i0',
        priceSats: 50000n,
        sellerNostrPubkey: 'seller_pubkey_123',
        sellerBitcoinAddress: 'tb1qseller...',
      });

      const state = coordinator.exportState();

      const newCoordinator = createCoordinator();
      newCoordinator.importState(state);

      const imported = newCoordinator.getSwap(swap.id);
      expect(imported).toBeDefined();
      expect(imported?.inscriptionId).toBe('inscription123i0');
    });
  });

  describe('WebSocket Message Handling', () => {
    it('should handle client connection', () => {
      let messages: string[] = [];

      const client = coordinator.handleConnection(
        'client1',
        (msg) => messages.push(msg),
        () => {}
      );

      expect(client.id).toBe('client1');
      expect(client.subscriptions.size).toBe(0);
    });

    it('should handle client disconnection', () => {
      coordinator.handleConnection(
        'client1',
        () => {},
        () => {}
      );

      coordinator.handleDisconnection('client1');

      // No error should be thrown
    });
  });
});
