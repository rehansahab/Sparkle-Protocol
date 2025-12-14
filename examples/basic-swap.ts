/**
 * Sparkle Protocol - Basic Swap Example
 *
 * This example demonstrates a complete atomic swap flow:
 * 1. Seller creates lock address
 * 2. Seller locks inscription
 * 3. Buyer pays Lightning invoice
 * 4. Buyer claims with preimage
 *
 * Run: npx tsx examples/basic-swap.ts
 */

import {
  // Core functions
  createSparkleSwapAddress,
  generatePreimage,
  computePaymentHash,
  buildClaimTransaction,
  buildRefundTransaction,

  // Types
  type SparkleSwapParams,

  // Utilities
  toHex,
  fromHex,
} from '../src/index.js';

// Example keys (DO NOT use in production - generate your own!)
const EXAMPLE_SELLER_PUBKEY = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const EXAMPLE_BUYER_PUBKEY = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';

async function main() {
  console.log('🔐 Sparkle Protocol - Basic Swap Example\n');

  // Step 1: Generate preimage and payment hash
  console.log('Step 1: Generate preimage and payment hash');
  const { preimage, preimageHex } = generatePreimage();
  const paymentHash = computePaymentHash(preimage);
  const paymentHashHex = toHex(paymentHash);

  console.log(`  Preimage:     ${preimageHex}`);
  console.log(`  Payment Hash: ${paymentHashHex}\n`);

  // Step 2: Create the swap address
  console.log('Step 2: Create Taproot swap address');
  const currentBlock = 870000; // Example block height
  const timelockBlocks = 144; // 24 hours (144 blocks)

  const swapParams: SparkleSwapParams = {
    sellerPubkey: EXAMPLE_SELLER_PUBKEY,
    buyerPubkey: EXAMPLE_BUYER_PUBKEY,
    paymentHash: paymentHashHex,
    timelockHeight: currentBlock + timelockBlocks,
    network: 'mainnet',
  };

  const swapAddress = createSparkleSwapAddress(swapParams);

  console.log(`  Swap Address: ${swapAddress.address}`);
  console.log(`  Timelock:     Block ${swapParams.timelockHeight}`);
  console.log(`  Network:      ${swapParams.network}\n`);

  // Step 3: Seller locks inscription (simulated)
  console.log('Step 3: Seller locks inscription to swap address');
  console.log('  [In production: Seller broadcasts TX sending inscription to swap address]');
  console.log(`  Lock to: ${swapAddress.address}\n`);

  // Step 4: Buyer pays Lightning invoice (simulated)
  console.log('Step 4: Buyer pays Lightning invoice');
  console.log('  [In production: Buyer pays invoice, seller reveals preimage]');
  console.log(`  Payment Hash: ${paymentHashHex}\n`);

  // Step 5: Buyer claims with preimage
  console.log('Step 5: Buyer claims inscription with preimage');

  // In production, you would:
  // 1. Get the funding UTXO from the lock transaction
  // 2. Build the claim transaction
  // 3. Sign with buyer's key
  // 4. Broadcast

  const claimParams = {
    fundingTxid: '0000000000000000000000000000000000000000000000000000000000000000',
    fundingVout: 0,
    fundingAmount: 10000n, // satoshis
    preimage: preimageHex,
    buyerPubkey: EXAMPLE_BUYER_PUBKEY,
    buyerAddress: 'bc1qexampleaddress',
    swapAddress: swapAddress,
    feeRate: 10, // sats/vB
  };

  console.log('  Claim Parameters:');
  console.log(`    Preimage: ${claimParams.preimage}`);
  console.log(`    Buyer:    ${claimParams.buyerPubkey.slice(0, 20)}...`);
  console.log(`    To:       ${claimParams.buyerAddress}\n`);

  // Step 6: Alternative - Seller refund after timelock
  console.log('Step 6: (Alternative) Seller refund after timelock');
  console.log(`  Available after block: ${swapParams.timelockHeight}`);
  console.log('  [Seller can reclaim if buyer abandons]\n');

  console.log('✅ Swap flow complete!');
  console.log('\nKey Properties:');
  console.log('  • Atomic: Both parties succeed or neither does');
  console.log('  • Trustless: No intermediary required');
  console.log('  • Recoverable: Seller can always refund after timelock');
}

main().catch(console.error);
