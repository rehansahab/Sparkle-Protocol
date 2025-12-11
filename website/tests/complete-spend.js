#!/usr/bin/env node
/**
 * SPARKLE Protocol - Complete Taproot Script-Path Spend
 *
 * This script creates a fully signed transaction that spends from the funded
 * Taproot address using the hashlock script path.
 */

const crypto = require('crypto');
const secp = require('@noble/secp256k1');

// Configure sha256 for noble/secp256k1 v3
const sha256Fn = (...msgs) => {
  const hash = crypto.createHash('sha256');
  for (const msg of msgs) hash.update(msg);
  return Uint8Array.from(hash.digest());
};
secp.hashes.sha256 = sha256Fn;
secp.hashes.hmacSha256 = (key, ...msgs) => {
  const hmac = crypto.createHmac('sha256', key);
  for (const msg of msgs) hmac.update(msg);
  return Uint8Array.from(hmac.digest());
};

const { schnorr } = secp;

// ============================================================================
// Constants
// ============================================================================

const BUYER_PRIVKEY = Buffer.from('0000000000000000000000000000000000000000000000000000000000000001', 'hex');
const PREIMAGE = Buffer.alloc(0); // Empty preimage - SHA256('') = e3b0c44298fc1c...
const HASHLOCK_SCRIPT = Buffer.from('a820e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855882079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ac', 'hex');
const CONTROL_BLOCK = Buffer.from('c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0199b06e6a887386c338db88eac1b69a90e2c2aa268265100871dc34ebfccc792', 'hex');

const FUNDING_TXID = '0dffff168dd1cd5778953a29717429215d1422b4738779ccc2136ad419cfc474';
const FUNDING_VOUT = 1;
const INPUT_AMOUNT = 100000n;
const OUTPUT_AMOUNT = 99500n;
const OUTPUT_SCRIPTPUBKEY = Buffer.from('0014d1b832000dd4a6e9f72da6f6d594d0024f44b15e', 'hex');
const INPUT_SCRIPTPUBKEY = Buffer.from('5120b71e1da5436cfaaa3d3e17c50b95bebf6556894c50311f8bb1e4a80f40642b64', 'hex');

// ============================================================================
// Helper Functions
// ============================================================================

function taggedHash(tag, data) {
  const tagHash = crypto.createHash('sha256').update(tag).digest();
  return crypto.createHash('sha256')
    .update(tagHash)
    .update(tagHash)
    .update(data)
    .digest();
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest();
}

function encodeCompactSize(n) {
  if (n < 253) return Buffer.from([n]);
  if (n < 0x10000) {
    const buf = Buffer.alloc(3);
    buf[0] = 253;
    buf.writeUInt16LE(n, 1);
    return buf;
  }
  throw new Error('Value too large');
}

function encodeLE32(n) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(n >>> 0);
  return buf;
}

function encodeLE64(n) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(n));
  return buf;
}

function reverseBuffer(buf) {
  return Buffer.from(buf).reverse();
}

// ============================================================================
// Taproot Sighash Computation (BIP-341)
// ============================================================================

function computeTapLeafHash(script, leafVersion = 0xc0) {
  const compactSize = encodeCompactSize(script.length);
  return taggedHash('TapLeaf', Buffer.concat([
    Buffer.from([leafVersion]),
    compactSize,
    script
  ]));
}

function computeScriptPathSighash(txData, inputIndex, prevouts, amounts, scriptPubKeys, tapLeafHash, extFlag = 0) {
  // epoch
  let sigMsg = Buffer.from([0x00]);

  // hash_type (0x00 = SIGHASH_DEFAULT for Taproot)
  sigMsg = Buffer.concat([sigMsg, Buffer.from([0x00])]);

  // nVersion
  sigMsg = Buffer.concat([sigMsg, encodeLE32(2)]);

  // nLockTime
  sigMsg = Buffer.concat([sigMsg, encodeLE32(0)]);

  // sha_prevouts
  const prevoutsData = Buffer.concat(prevouts.map((p, i) =>
    Buffer.concat([reverseBuffer(Buffer.from(p.txid, 'hex')), encodeLE32(p.vout)])
  ));
  sigMsg = Buffer.concat([sigMsg, sha256(prevoutsData)]);

  // sha_amounts
  const amountsData = Buffer.concat(amounts.map(a => encodeLE64(a)));
  sigMsg = Buffer.concat([sigMsg, sha256(amountsData)]);

  // sha_scriptpubkeys
  const spksData = Buffer.concat(scriptPubKeys.map(spk =>
    Buffer.concat([encodeCompactSize(spk.length), spk])
  ));
  sigMsg = Buffer.concat([sigMsg, sha256(spksData)]);

  // sha_sequences
  const seqData = encodeLE32(0xfffffffd);
  sigMsg = Buffer.concat([sigMsg, sha256(seqData)]);

  // sha_outputs
  const outputData = Buffer.concat([
    encodeLE64(OUTPUT_AMOUNT),
    encodeCompactSize(OUTPUT_SCRIPTPUBKEY.length),
    OUTPUT_SCRIPTPUBKEY
  ]);
  sigMsg = Buffer.concat([sigMsg, sha256(outputData)]);

  // spend_type = (ext_flag * 2) + annex_present = (1 * 2) + 0 = 0x02 for script-path
  sigMsg = Buffer.concat([sigMsg, Buffer.from([0x02])]);

  // input_index
  sigMsg = Buffer.concat([sigMsg, encodeLE32(inputIndex)]);

  // For script path spend:
  // tapleaf_hash
  sigMsg = Buffer.concat([sigMsg, tapLeafHash]);

  // key_version (always 0)
  sigMsg = Buffer.concat([sigMsg, Buffer.from([0x00])]);

  // codesep_pos (0xffffffff = no OP_CODESEPARATOR)
  sigMsg = Buffer.concat([sigMsg, encodeLE32(0xffffffff)]);

  return taggedHash('TapSighash', sigMsg);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(60));
  console.log('SPARKLE Protocol - Complete Taproot Script-Path Spend');
  console.log('='.repeat(60));
  console.log();

  // Compute the tap leaf hash for our hashlock script
  const tapLeafHash = computeTapLeafHash(HASHLOCK_SCRIPT);
  console.log('TapLeaf Hash:', tapLeafHash.toString('hex'));

  // Compute the sighash
  const prevouts = [{ txid: FUNDING_TXID, vout: FUNDING_VOUT }];
  const amounts = [INPUT_AMOUNT];
  const scriptPubKeys = [INPUT_SCRIPTPUBKEY];

  const sighash = computeScriptPathSighash(
    null, 0, prevouts, amounts, scriptPubKeys, tapLeafHash
  );
  console.log('Sighash:', sighash.toString('hex'));

  // Sign with Schnorr
  const signature = await schnorr.sign(sighash, BUYER_PRIVKEY);
  console.log('Signature:', Buffer.from(signature).toString('hex'));

  // Build the witness stack for script-path spend:
  // witness = [signature, preimage, script, control_block]
  const witnessStack = [
    Buffer.from(signature),  // 64 bytes Schnorr signature
    PREIMAGE,                // 32 bytes preimage
    HASHLOCK_SCRIPT,         // The script being executed
    CONTROL_BLOCK            // Control block for script path
  ];

  console.log('\nWitness Stack:');
  witnessStack.forEach((item, i) => {
    console.log(`  [${i}] ${item.length} bytes: ${item.toString('hex').slice(0, 40)}...`);
  });

  // Build the complete signed transaction
  let tx = Buffer.alloc(0);

  // Version (4 bytes)
  tx = Buffer.concat([tx, encodeLE32(2)]);

  // Witness marker and flag
  tx = Buffer.concat([tx, Buffer.from([0x00, 0x01])]);

  // Input count
  tx = Buffer.concat([tx, Buffer.from([0x01])]);

  // Input: txid (LE) + vout + scriptSig (empty) + sequence
  tx = Buffer.concat([tx, reverseBuffer(Buffer.from(FUNDING_TXID, 'hex'))]);
  tx = Buffer.concat([tx, encodeLE32(FUNDING_VOUT)]);
  tx = Buffer.concat([tx, Buffer.from([0x00])]); // Empty scriptSig
  tx = Buffer.concat([tx, encodeLE32(0xfffffffd)]); // nSequence (RBF enabled)

  // Output count
  tx = Buffer.concat([tx, Buffer.from([0x01])]);

  // Output: amount + scriptPubKey
  tx = Buffer.concat([tx, encodeLE64(OUTPUT_AMOUNT)]);
  tx = Buffer.concat([tx, encodeCompactSize(OUTPUT_SCRIPTPUBKEY.length)]);
  tx = Buffer.concat([tx, OUTPUT_SCRIPTPUBKEY]);

  // Witness
  tx = Buffer.concat([tx, encodeCompactSize(witnessStack.length)]);
  for (const item of witnessStack) {
    tx = Buffer.concat([tx, encodeCompactSize(item.length)]);
    tx = Buffer.concat([tx, item]);
  }

  // Locktime
  tx = Buffer.concat([tx, encodeLE32(0)]);

  console.log('\n' + '='.repeat(60));
  console.log('SIGNED TRANSACTION HEX:');
  console.log('='.repeat(60));
  console.log(tx.toString('hex'));
  console.log();

  console.log('Transaction size:', tx.length, 'bytes');
  console.log();

  console.log('='.repeat(60));
  console.log('NEXT STEPS:');
  console.log('='.repeat(60));
  console.log('\n1. Broadcast the transaction:');
  console.log('   bitcoin-cli -regtest sendrawtransaction "' + tx.toString('hex').slice(0, 40) + '..."');
  console.log('\n2. Mine a block:');
  console.log('   bitcoin-cli -regtest -generate 1');
  console.log('\n3. Verify funds received:');
  console.log('   bitcoin-cli -regtest getreceivedbyaddress "bcrt1q6xuryqqd6jnwnaed5mmdt9xsqf85fv273es2p4"');

  // Save to file
  const fs = require('fs');
  const path = require('path');
  fs.writeFileSync(path.join(__dirname, 'signed-tx.json'), JSON.stringify({
    hex: tx.toString('hex'),
    witness: witnessStack.map(w => w.toString('hex')),
    sighash: sighash.toString('hex'),
    signature: Buffer.from(signature).toString('hex')
  }, null, 2));
  console.log('\nSaved to: signed-tx.json');
}

main().catch(console.error);
