#!/usr/bin/env node
/**
 * Sparkle Protocol - CLI Tool
 *
 * Command-line interface for creating and executing atomic swaps.
 * Use this for manual testnet testing before frontend integration.
 *
 * Commands:
 *   offer     - Create a new swap offer (seller)
 *   verify    - Verify a swap offer (buyer)
 *   claim     - Build claim transaction (buyer)
 *   refund    - Build refund transaction (seller)
 *   decode    - Decode a BOLT11 invoice
 *   keygen    - Generate a new keypair for testing
 *
 * @module sparkle-protocol/cli
 * @version 0.3.0
 */

import {
  createSwapOffer,
  getPublicOffer,
  verifySwapOffer,
  recordFunding,
  buildClaimForBuyer,
  buildRefundForSeller,
  getSwapStatus,
  generateSwapSetup,
  decodeBolt11,
  verifyPreimage,
  type SwapOfferPublic,
  type NetworkType,
} from '../core/index.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { secp256k1 } from '@noble/curves/secp256k1';

// ============================================================================
// ARGUMENT PARSING
// ============================================================================

const args = process.argv.slice(2);
const command = args[0];

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true';
      result[key] = value;
      if (value !== 'true') i++;
    }
  }
  return result;
}

function printUsage() {
  console.log(`
Sparkle Protocol CLI v0.3.0
===========================

Usage: sparkle <command> [options]

Commands:

  offer     Create a new swap offer (seller side)
            --ordinal <id>          Ordinal inscription ID
            --price <sats>          Price in satoshis
            --buyer-pubkey <hex>    Buyer's compressed pubkey (33 bytes hex)
            --seller-pubkey <hex>   Seller's compressed pubkey (33 bytes hex)
            --locktime-blocks <n>   Blocks until refund (default: 144)
            --current-height <n>    Current block height
            --network <net>         Network: mainnet|testnet|regtest (default: testnet)

  verify    Verify a swap offer (buyer side)
            --offer <json>          Swap offer JSON (or path to file)
            --my-pubkey <hex>       Your compressed pubkey to verify

  claim     Build claim transaction (buyer side)
            --offer <json>          Swap offer JSON
            --funding-txid <hex>    Funding transaction ID
            --funding-vout <n>      Funding output index (default: 0)
            --funding-amount <sats> Amount in the funding output
            --preimage <hex>        32-byte preimage from Lightning payment
            --privkey <hex>         Your 32-byte private key
            --destination <addr>    Destination address for the Ordinal
            --fee-rate <n>          Fee rate in sats/vbyte (default: 2)

  refund    Build refund transaction (seller side)
            --offer <json>          Swap offer JSON
            --funding-txid <hex>    Funding transaction ID
            --funding-vout <n>      Funding output index (default: 0)
            --funding-amount <sats> Amount in the funding output
            --privkey <hex>         Your 32-byte private key
            --destination <addr>    Destination address for refund
            --current-height <n>    Current block height
            --fee-rate <n>          Fee rate in sats/vbyte (default: 2)

  decode    Decode a BOLT11 Lightning invoice
            --invoice <bolt11>      BOLT11 invoice string

  keygen    Generate a new keypair for testing
            --network <net>         Network for address format (default: testnet)

Examples:

  # Generate test keypair
  sparkle keygen --network testnet

  # Create swap offer
  sparkle offer --ordinal abc123i0 --price 50000 \\
    --buyer-pubkey 0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798 \\
    --seller-pubkey 02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5 \\
    --current-height 2500000 --network testnet

  # Verify offer
  sparkle verify --offer '{"swapAddress":"tb1p..."}' \\
    --my-pubkey 0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798

  # Decode invoice to check payment_hash
  sparkle decode --invoice lntb500u1p...

  # Build claim transaction
  sparkle claim --offer '{"swapAddress":"tb1p..."}' \\
    --funding-txid abc123 --funding-amount 10000 \\
    --preimage deadbeef... --privkey 0123... --destination tb1q...
`);
}

// ============================================================================
// COMMANDS
// ============================================================================

async function cmdOffer(opts: Record<string, string>) {
  const required = ['ordinal', 'price', 'buyer-pubkey', 'seller-pubkey', 'current-height'];
  for (const r of required) {
    if (!opts[r]) {
      console.error(`Error: --${r} is required`);
      process.exit(1);
    }
  }

  const network = (opts['network'] || 'testnet') as NetworkType;
  const locktimeBlocks = parseInt(opts['locktime-blocks'] || '144');

  const swap = createSwapOffer({
    sellerPubkey: hexToBytes(opts['seller-pubkey']),
    buyerPubkey: hexToBytes(opts['buyer-pubkey']),
    ordinalId: opts['ordinal'],
    priceSats: BigInt(opts['price']),
    locktimeBlocks,
    currentBlockHeight: parseInt(opts['current-height']),
    network,
  });

  const publicOffer = getPublicOffer(swap);

  console.log('\n=== SWAP OFFER CREATED ===\n');
  console.log('SELLER: Save this preimage securely (needed if Lightning payment fails):');
  console.log(`  Preimage: ${swap.preimageHex}`);
  console.log('');
  console.log('PUBLIC OFFER (share with buyer):');
  console.log(JSON.stringify(publicOffer, null, 2));
  console.log('');
  console.log('NEXT STEPS:');
  console.log(`1. Send the Ordinal to: ${swap.swapAddress}`);
  console.log(`2. Create Lightning invoice with payment_hash: ${swap.paymentHashHex}`);
  console.log(`   LND: lncli addinvoice --hash ${swap.paymentHashHex} --amt ${opts['price']}`);
  console.log(`3. Share the invoice and public offer with the buyer`);
  console.log('');
}

async function cmdVerify(opts: Record<string, string>) {
  if (!opts['offer'] || !opts['my-pubkey']) {
    console.error('Error: --offer and --my-pubkey are required');
    process.exit(1);
  }

  let offer: SwapOfferPublic;
  try {
    offer = JSON.parse(opts['offer']);
  } catch {
    console.error('Error: Invalid offer JSON');
    process.exit(1);
  }

  const myPubkey = hexToBytes(opts['my-pubkey']);
  const result = verifySwapOffer(offer, myPubkey);

  console.log('\n=== OFFER VERIFICATION ===\n');
  if (result.valid) {
    console.log('✓ Offer is VALID');
    console.log('');
    console.log('Swap Details:');
    console.log(`  Ordinal: ${offer.ordinalId}`);
    console.log(`  Price: ${offer.priceSats} sats`);
    console.log(`  Swap Address: ${offer.swapAddress}`);
    console.log(`  Payment Hash: ${offer.paymentHashHex}`);
    console.log(`  Refund Locktime: Block ${offer.refundLocktime}`);
    console.log(`  Network: ${offer.network}`);
    console.log('');
    console.log('NEXT STEPS:');
    console.log('1. Verify the Ordinal is at the swap address (check blockchain)');
    console.log('2. Verify the Lightning invoice payment_hash matches');
    console.log('3. Pay the Lightning invoice');
    console.log('4. Use the revealed preimage to claim');
  } else {
    console.log('✗ Offer is INVALID');
    console.log(`  Error: ${result.error}`);
    console.log('');
    console.log('DO NOT PROCEED - This offer may be fraudulent');
  }
  console.log('');
}

async function cmdClaim(opts: Record<string, string>) {
  const required = ['offer', 'funding-txid', 'funding-amount', 'preimage', 'privkey', 'destination'];
  for (const r of required) {
    if (!opts[r]) {
      console.error(`Error: --${r} is required`);
      process.exit(1);
    }
  }

  let offer: SwapOfferPublic;
  try {
    offer = JSON.parse(opts['offer']);
  } catch {
    console.error('Error: Invalid offer JSON');
    process.exit(1);
  }

  // Reconstruct swap data for claim
  const swap = {
    id: offer.id,
    state: 'paid' as const,
    createdAt: Date.now(),
    sellerPubkeyHex: offer.sellerPubkeyHex,
    buyerPubkeyHex: offer.buyerPubkeyHex,
    ordinalId: offer.ordinalId,
    priceSats: BigInt(offer.priceSats),
    paymentHashHex: offer.paymentHashHex,
    preimageHex: opts['preimage'],
    swapAddress: offer.swapAddress,
    refundLocktime: offer.refundLocktime,
    fundingTxid: opts['funding-txid'],
    fundingVout: parseInt(opts['funding-vout'] || '0'),
    fundingAmount: BigInt(opts['funding-amount']),
    network: offer.network,
  };

  // Verify preimage
  const preimage = hexToBytes(opts['preimage']);
  const paymentHash = hexToBytes(offer.paymentHashHex);
  if (!verifyPreimage(preimage, paymentHash)) {
    console.error('Error: Preimage does not match payment hash!');
    process.exit(1);
  }

  const feeRate = parseInt(opts['fee-rate'] || '2');

  try {
    const result = buildClaimForBuyer(
      swap,
      hexToBytes(opts['privkey']),
      opts['destination'],
      feeRate
    );

    console.log('\n=== CLAIM TRANSACTION BUILT ===\n');
    console.log(`TXID: ${result.txid}`);
    console.log(`Size: ${result.vsize} vbytes`);
    console.log(`Fee: ${result.fee} sats`);
    console.log(`Output: ${result.outputAmount} sats to ${opts['destination']}`);
    console.log('');
    console.log('RAW TRANSACTION (broadcast this):');
    console.log(result.txHex);
    console.log('');
    console.log('BROADCAST COMMAND:');
    console.log(`bitcoin-cli -testnet sendrawtransaction ${result.txHex}`);
    console.log('');
  } catch (e: any) {
    console.error(`Error building claim: ${e.message}`);
    process.exit(1);
  }
}

async function cmdRefund(opts: Record<string, string>) {
  const required = ['offer', 'funding-txid', 'funding-amount', 'privkey', 'destination', 'current-height'];
  for (const r of required) {
    if (!opts[r]) {
      console.error(`Error: --${r} is required`);
      process.exit(1);
    }
  }

  let offer: SwapOfferPublic;
  try {
    offer = JSON.parse(opts['offer']);
  } catch {
    console.error('Error: Invalid offer JSON');
    process.exit(1);
  }

  // Reconstruct swap data for refund
  const swap = {
    id: offer.id,
    state: 'funded' as const,
    createdAt: Date.now(),
    sellerPubkeyHex: offer.sellerPubkeyHex,
    buyerPubkeyHex: offer.buyerPubkeyHex,
    ordinalId: offer.ordinalId,
    priceSats: BigInt(offer.priceSats),
    paymentHashHex: offer.paymentHashHex,
    swapAddress: offer.swapAddress,
    refundLocktime: offer.refundLocktime,
    fundingTxid: opts['funding-txid'],
    fundingVout: parseInt(opts['funding-vout'] || '0'),
    fundingAmount: BigInt(opts['funding-amount']),
    network: offer.network,
  };

  const currentHeight = parseInt(opts['current-height']);
  const feeRate = parseInt(opts['fee-rate'] || '2');

  try {
    const result = buildRefundForSeller(
      swap,
      hexToBytes(opts['privkey']),
      opts['destination'],
      feeRate,
      currentHeight
    );

    console.log('\n=== REFUND TRANSACTION BUILT ===\n');
    console.log(`TXID: ${result.txid}`);
    console.log(`Size: ${result.vsize} vbytes`);
    console.log(`Fee: ${result.fee} sats`);
    console.log(`Locktime: ${result.locktime} (cannot be mined before this block)`);
    console.log(`Output: ${result.outputAmount} sats to ${opts['destination']}`);
    console.log('');
    console.log('RAW TRANSACTION (broadcast after locktime):');
    console.log(result.txHex);
    console.log('');
    console.log('BROADCAST COMMAND:');
    console.log(`bitcoin-cli -testnet sendrawtransaction ${result.txHex}`);
    console.log('');
  } catch (e: any) {
    console.error(`Error building refund: ${e.message}`);
    process.exit(1);
  }
}

async function cmdDecode(opts: Record<string, string>) {
  if (!opts['invoice']) {
    console.error('Error: --invoice is required');
    process.exit(1);
  }

  try {
    const decoded = decodeBolt11(opts['invoice']);

    console.log('\n=== INVOICE DECODED ===\n');
    console.log(`Network: ${decoded.network}`);
    console.log(`Payment Hash: ${bytesToHex(decoded.paymentHash)}`);
    if (decoded.amountSat) {
      console.log(`Amount: ${decoded.amountSat} sats`);
    }
    console.log('');
    console.log('Use this payment_hash to verify it matches your swap offer.');
    console.log('');
  } catch (e: any) {
    console.error(`Error decoding invoice: ${e.message}`);
    process.exit(1);
  }
}

async function cmdKeygen(opts: Record<string, string>) {
  // Generate random private key
  const privkeyBytes = new Uint8Array(32);
  crypto.getRandomValues(privkeyBytes);

  // Derive public key
  const pubkeyBytes = secp256k1.getPublicKey(privkeyBytes, true); // compressed

  console.log('\n=== NEW KEYPAIR GENERATED ===\n');
  console.log('⚠️  FOR TESTING ONLY - DO NOT USE FOR REAL FUNDS ⚠️');
  console.log('');
  console.log(`Private Key (32 bytes hex):`);
  console.log(`  ${bytesToHex(privkeyBytes)}`);
  console.log('');
  console.log(`Public Key (33 bytes compressed hex):`);
  console.log(`  ${bytesToHex(pubkeyBytes)}`);
  console.log('');
  console.log('Save the private key securely. You will need it to sign transactions.');
  console.log('Share only the public key with counterparties.');
  console.log('');
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    process.exit(0);
  }

  const opts = parseArgs(args.slice(1));

  switch (command) {
    case 'offer':
      await cmdOffer(opts);
      break;
    case 'verify':
      await cmdVerify(opts);
      break;
    case 'claim':
      await cmdClaim(opts);
      break;
    case 'refund':
      await cmdRefund(opts);
      break;
    case 'decode':
      await cmdDecode(opts);
      break;
    case 'keygen':
      await cmdKeygen(opts);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((e) => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
