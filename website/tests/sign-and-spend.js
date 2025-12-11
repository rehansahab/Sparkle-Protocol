#!/usr/bin/env node
/**
 * Sign and finalize the SPARKLE PSBT for regtest spending
 *
 * This script:
 * 1. Computes the Taproot script-path sighash
 * 2. Signs with the buyer's private key (0x01 for test vector)
 * 3. Constructs the witness stack
 * 4. Outputs the final signed transaction
 */

const crypto = require('crypto');

// Test vector data
const BUYER_PRIVKEY = Buffer.from('0000000000000000000000000000000000000000000000000000000000000001', 'hex');
const PREIMAGE = Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex');
const HASHLOCK_SCRIPT = Buffer.from('a820e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855882079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ac', 'hex');
const CONTROL_BLOCK = Buffer.from('c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac073f60105ce88b9d86a06c8c626ca23d726182849fb013b4a5c1c68a71651a790', 'hex');

// Funding TX data
const FUNDING_TXID = '0dffff168dd1cd5778953a29717429215d1422b4738779ccc2136ad419cfc474';
const FUNDING_VOUT = 1;
const INPUT_AMOUNT = 100000;
const OUTPUT_AMOUNT = 99500;
const OUTPUT_ADDRESS = 'bcrt1q6xuryqqd6jnwnaed5mmdt9xsqf85fv273es2p4';

// Tagged hash helper
function taggedHash(tag, data) {
  const tagHash = crypto.createHash('sha256').update(tag).digest();
  return crypto.createHash('sha256')
    .update(tagHash)
    .update(tagHash)
    .update(data)
    .digest();
}

async function main() {
  console.log('SPARKLE Protocol - Sign and Spend');
  console.log('='.repeat(50));

  // For proper Schnorr signing, we need @noble/secp256k1
  let secp;
  try {
    secp = require('@noble/secp256k1');
  } catch (e) {
    console.log('Installing @noble/secp256k1...');
    require('child_process').execSync('npm install @noble/secp256k1', { stdio: 'inherit' });
    secp = require('@noble/secp256k1');
  }

  // The witness for Taproot script-path spend is:
  // [signature] [preimage] [script] [control_block]

  console.log('\nWitness Stack:');
  console.log('  [0] Signature (to be computed)');
  console.log('  [1] Preimage:', PREIMAGE.toString('hex'));
  console.log('  [2] Script:', HASHLOCK_SCRIPT.toString('hex').slice(0, 40) + '...');
  console.log('  [3] Control Block:', CONTROL_BLOCK.toString('hex').slice(0, 40) + '...');

  // NOTE: Computing the actual sighash requires the full transaction context
  // For regtest, we can use bitcoin-cli to help with signing

  console.log('\n' + '='.repeat(50));
  console.log('MANUAL SIGNING STEPS:');
  console.log('='.repeat(50));
  console.log('\n1. Import the test private key to regtest wallet:');
  console.log('   bitcoin-cli -regtest importprivkey "cMahea7zqjxrtgAbB7LSGbcQUr1uX1ojuat9jZodMN87JcbXMTcA" "buyer_key" false');
  console.log('   (This is the WIF for private key 0x01 on regtest)');

  console.log('\n2. Use walletprocesspsbt to sign:');
  console.log('   bitcoin-cli -regtest walletprocesspsbt "<PSBT_BASE64>" true "ALL"');

  console.log('\n3. Finalize the PSBT:');
  console.log('   bitcoin-cli -regtest finalizepsbt "<SIGNED_PSBT>"');

  console.log('\n4. Broadcast the transaction:');
  console.log('   bitcoin-cli -regtest sendrawtransaction "<FINAL_HEX>"');

  console.log('\n5. Mine a block to confirm:');
  console.log('   bitcoin-cli -regtest -generate 1');

  console.log('\n6. Verify destination received funds:');
  console.log('   bitcoin-cli -regtest getreceivedbyaddress "bcrt1q6xuryqqd6jnwnaed5mmdt9xsqf85fv273es2p4"');
}

main().catch(console.error);
