/**
 * Sparkle Protocol - Swap Test
 *
 * This test demonstrates the full atomic swap flow:
 * 1. Generate preimage and payment_hash
 * 2. Create Taproot swap address
 * 3. (Simulate) Seller locks Ordinal
 * 4. (Simulate) Buyer pays Lightning invoice, learns preimage
 * 5. Buyer builds claim transaction
 * 6. Verify claim transaction is valid
 *
 * @module sparkle-protocol/tests/swap
 */

import { describe, it, expect } from 'vitest';
import {
  createSparkleSwapAddress,
  generatePreimage,
  verifyPreimage,
  calculateRefundLocktime,
  buildClaimTransaction,
  buildRefundTransaction,
  toHex,
  fromHex,
  type SparkleSwapAddress,
} from '../src/core/index.js';

// Test configuration
const TEST_NETWORK = 'testnet' as const;
const CURRENT_BLOCK_HEIGHT = 2_500_000; // Approximate testnet height

// Simulated keys (DO NOT use in production - these are for testing only)
// In production, these would come from user wallets
const TEST_BUYER_PRIVKEY = fromHex(
  '0000000000000000000000000000000000000000000000000000000000000001'
);
const TEST_BUYER_PUBKEY = fromHex(
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
);

const TEST_SELLER_PRIVKEY = fromHex(
  '0000000000000000000000000000000000000000000000000000000000000002'
);
const TEST_SELLER_PUBKEY = fromHex(
  '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5'
);

// Test destination addresses (testnet)
const BUYER_DESTINATION = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const SELLER_DESTINATION = 'tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7';

// Simulated funding transaction
const SIMULATED_FUNDING_TXID =
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SIMULATED_FUNDING_VOUT = 0;
const SIMULATED_FUNDING_AMOUNT = 10000n; // 10,000 sats

describe('Sparkle Protocol Atomic Swap', () => {
  let preimage: Uint8Array;
  let paymentHash: Uint8Array;
  let refundLocktime: number;
  let swapAddress: SparkleSwapAddress;

  describe('Preimage Generation', () => {
    it('should generate a valid preimage and payment hash', () => {
      const result = generatePreimage();
      preimage = result.preimage;
      paymentHash = result.paymentHash;

      expect(preimage).toBeInstanceOf(Uint8Array);
      expect(paymentHash).toBeInstanceOf(Uint8Array);
      expect(preimage.length).toBe(32);
      expect(paymentHash.length).toBe(32);

      console.log(`Preimage:     ${toHex(preimage)}`);
      console.log(`Payment Hash: ${toHex(paymentHash)}`);
    });

    it('should verify preimage matches payment hash', () => {
      const isValid = verifyPreimage(preimage, paymentHash);
      expect(isValid).toBe(true);
    });

    it('should reject invalid preimage', () => {
      const fakePreimage = new Uint8Array(32).fill(0);
      const isValid = verifyPreimage(fakePreimage, paymentHash);
      expect(isValid).toBe(false);
    });
  });

  describe('Refund Locktime', () => {
    it('should calculate refund locktime correctly', () => {
      refundLocktime = calculateRefundLocktime(CURRENT_BLOCK_HEIGHT);

      expect(refundLocktime).toBeGreaterThan(CURRENT_BLOCK_HEIGHT);
      expect(refundLocktime - CURRENT_BLOCK_HEIGHT).toBe(288); // Default 2-day window

      console.log(`Current block:   ${CURRENT_BLOCK_HEIGHT}`);
      console.log(`Refund locktime: ${refundLocktime}`);
      console.log(`Claim window:    ${refundLocktime - CURRENT_BLOCK_HEIGHT} blocks`);
    });
  });

  describe('Swap Address Creation', () => {
    it('should create a valid Taproot swap address', () => {
      swapAddress = createSparkleSwapAddress({
        paymentHash,
        buyerPubkey: TEST_BUYER_PUBKEY,
        sellerPubkey: TEST_SELLER_PUBKEY,
        refundLocktime,
        network: TEST_NETWORK,
      });

      expect(swapAddress.address).toMatch(/^tb1p/); // Testnet Taproot
      expect(swapAddress.hashlockScript).toBeInstanceOf(Uint8Array);
      expect(swapAddress.timelockScript).toBeInstanceOf(Uint8Array);

      console.log(`Swap Address: ${swapAddress.address}`);
      console.log(`Hashlock:     ${toHex(swapAddress.hashlockScript)}`);
      console.log(`Timelock:     ${toHex(swapAddress.timelockScript)}`);
    });
  });

  describe('Claim Transaction', () => {
    it('should build a valid claim transaction', () => {
      const claimResult = buildClaimTransaction({
        swapAddress,
        fundingTxid: SIMULATED_FUNDING_TXID,
        fundingVout: SIMULATED_FUNDING_VOUT,
        fundingAmount: SIMULATED_FUNDING_AMOUNT,
        preimage,
        buyerPrivkey: TEST_BUYER_PRIVKEY,
        destinationAddress: BUYER_DESTINATION,
        feeRate: 2,
        network: TEST_NETWORK,
      });

      expect(claimResult.txid).toMatch(/^[a-f0-9]{64}$/);
      expect(claimResult.txHex).toMatch(/^[a-f0-9]+$/);
      expect(claimResult.vsize).toBeGreaterThan(0);
      expect(claimResult.fee).toBeGreaterThan(0);
      expect(claimResult.outputAmount).toBeLessThan(Number(SIMULATED_FUNDING_AMOUNT));

      console.log(`Claim TXID:   ${claimResult.txid}`);
      console.log(`Size:         ${claimResult.vsize} vbytes`);
      console.log(`Fee:          ${claimResult.fee} sats`);
      console.log(`Output:       ${claimResult.outputAmount} sats`);
    });
  });

  describe('Refund Transaction', () => {
    it('should build a valid refund transaction', () => {
      const refundResult = buildRefundTransaction({
        swapAddress,
        fundingTxid: SIMULATED_FUNDING_TXID,
        fundingVout: SIMULATED_FUNDING_VOUT,
        fundingAmount: SIMULATED_FUNDING_AMOUNT,
        sellerPrivkey: TEST_SELLER_PRIVKEY,
        destinationAddress: SELLER_DESTINATION,
        feeRate: 2,
        network: TEST_NETWORK,
      });

      expect(refundResult.txid).toMatch(/^[a-f0-9]{64}$/);
      expect(refundResult.txHex).toMatch(/^[a-f0-9]+$/);
      expect(refundResult.locktime).toBe(refundLocktime);
      expect(refundResult.vsize).toBeGreaterThan(0);
      expect(refundResult.fee).toBeGreaterThan(0);

      console.log(`Refund TXID:  ${refundResult.txid}`);
      console.log(`Locktime:     ${refundResult.locktime}`);
      console.log(`Size:         ${refundResult.vsize} vbytes`);
      console.log(`Fee:          ${refundResult.fee} sats`);
    });
  });
});
