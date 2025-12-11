#!/usr/bin/env node
/**
 * SPARKLE Protocol - Complete Mainnet Taproot Script-Path Spend
 *
 * Signs and broadcasts the claim transaction using the derived buyer key.
 */

const crypto = require('crypto');
const secp = require('@noble/secp256k1');
const { HDKey } = require('@scure/bip32');

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
// Constants from contract and funding
// ============================================================================

// Master xprv from Bitcoin Core wallet
const MASTER_XPRV = 'xprv9s21ZrQH143K3WdXLqQhU9ukthmrg8U1ZumJX7h6rpjgZap69Gp4iin6tBt4c9MhHA1WppuKKV51ow1C2kdRr6yUbmZYsmgQs1MyCLxBQa4';

// BIP86 Taproot derivation path for buyer key (index 1)
const DERIVATION_PATH = "m/86'/0'/0'/0/1";

// Contract data from contract-1765449742935.json
const CONTRACT = {
  preimage: '59bc06251f72768fe5e31ccdb7c2949fe351d9e67ee1bc76898671341f2fd22d',
  paymentHash: '02f87182ea2b8072ac76ff44a863583601753b95de696a7775b43fcbc6ead960',
  buyerPubkey: '86f4c588a351207179ac1b2311b9f7fc7260b7541fa7166997b2d7eca95e0d29',
  hashlockScript: 'a82002f87182ea2b8072ac76ff44a863583601753b95de696a7775b43fcbc6ead960882086f4c588a351207179ac1b2311b9f7fc7260b7541fa7166997b2d7eca95e0d29ac',
  controlBlock: 'c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0aa4841deffa14a691066f3675fe30a6a1d19eec58920946e23d4afd586d88440',
  outputKey: 'b9289ef4e1e27a5a1470b905ff438bc2b9ce8a1754bb816fccfa50261e6a3516'
};

// Funding transaction details
const FUNDING_TXID = '7739c731252bff34b35a7f4ba6b3f7f46494e67564c0fc8a50a2e5d11c2955b4';
const FUNDING_VOUT = 0;
const INPUT_AMOUNT = 15000n;
const OUTPUT_AMOUNT = 13500n;

// Output scriptPubKey (bc1q4ygjt4mcq3fhuenv0za09zt04cpvfrttls0cpr)
const OUTPUT_SCRIPTPUBKEY = Buffer.from('0014a91125d778045379e66c78baf2896fae02c48d6b', 'hex');

// Input scriptPubKey (bc1phy5faa8pufa959rshyzl7sutc2uuazsh2jaczm7vlfgzv8n2x5tqka2npl)
const INPUT_SCRIPTPUBKEY = Buffer.from('5120b9289ef4e1e27a5a1470b905ff438bc2b9ce8a1754bb816fccfa50261e6a3516', 'hex');

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
// Key Derivation
// ============================================================================

function derivePrivateKey(xprv, path) {
  const hdKey = HDKey.fromExtendedKey(xprv);
  const derived = hdKey.derive(path);
  return derived.privateKey;
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

function computeScriptPathSighash(inputIndex, prevouts, amounts, scriptPubKeys, tapLeafHash) {
  // epoch
  let sigMsg = Buffer.from([0x00]);

  // hash_type (0x00 = SIGHASH_DEFAULT for Taproot)
  sigMsg = Buffer.concat([sigMsg, Buffer.from([0x00])]);

  // nVersion
  sigMsg = Buffer.concat([sigMsg, encodeLE32(2)]);

  // nLockTime
  sigMsg = Buffer.concat([sigMsg, encodeLE32(0)]);

  // sha_prevouts
  const prevoutsData = Buffer.concat(prevouts.map((p) =>
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
  console.log('SPARKLE Protocol - Complete Mainnet Script-Path Spend');
  console.log('='.repeat(60));
  console.log();

  // Derive the buyer private key
  console.log('Deriving buyer private key from HD wallet...');
  const buyerPrivKey = derivePrivateKey(MASTER_XPRV, DERIVATION_PATH);
  console.log('Buyer x-only pubkey:', CONTRACT.buyerPubkey);

  // Verify derived key matches expected pubkey
  const derivedPubkey = Buffer.from(secp.getPublicKey(buyerPrivKey, true)).slice(1).toString('hex');
  if (derivedPubkey !== CONTRACT.buyerPubkey) {
    console.error('ERROR: Derived pubkey does not match expected!');
    console.error('Derived:', derivedPubkey);
    console.error('Expected:', CONTRACT.buyerPubkey);
    process.exit(1);
  }
  console.log('Key derivation verified ✓');
  console.log();

  // Verify preimage
  const preimageBuffer = Buffer.from(CONTRACT.preimage, 'hex');
  const computedHash = sha256(preimageBuffer).toString('hex');
  if (computedHash !== CONTRACT.paymentHash) {
    console.error('ERROR: Preimage does not match payment hash!');
    console.error('SHA256(preimage):', computedHash);
    console.error('Expected:', CONTRACT.paymentHash);
    process.exit(1);
  }
  console.log('Preimage verification ✓');
  console.log('  SHA256(' + CONTRACT.preimage.slice(0, 16) + '...) = ' + CONTRACT.paymentHash.slice(0, 16) + '...');
  console.log();

  // Compute the tap leaf hash for hashlock script
  const hashlockScript = Buffer.from(CONTRACT.hashlockScript, 'hex');
  const tapLeafHash = computeTapLeafHash(hashlockScript);
  console.log('TapLeaf Hash:', tapLeafHash.toString('hex'));

  // Compute the sighash
  const prevouts = [{ txid: FUNDING_TXID, vout: FUNDING_VOUT }];
  const amounts = [INPUT_AMOUNT];
  const scriptPubKeys = [INPUT_SCRIPTPUBKEY];

  const sighash = computeScriptPathSighash(0, prevouts, amounts, scriptPubKeys, tapLeafHash);
  console.log('Sighash:', sighash.toString('hex'));

  // Sign with Schnorr
  console.log('Signing transaction...');
  const signature = await schnorr.sign(sighash, buyerPrivKey);
  console.log('Signature:', Buffer.from(signature).toString('hex'));

  // Build the witness stack for script-path spend:
  // witness = [signature, preimage, script, control_block]
  const controlBlock = Buffer.from(CONTRACT.controlBlock, 'hex');
  const witnessStack = [
    Buffer.from(signature),  // 64 bytes Schnorr signature
    preimageBuffer,          // 32 bytes preimage
    hashlockScript,          // The script being executed
    controlBlock             // Control block for script path
  ];

  console.log('\nWitness Stack:');
  witnessStack.forEach((item, i) => {
    console.log(`  [${i}] ${item.length} bytes: ${item.toString('hex').slice(0, 40)}${item.length > 20 ? '...' : ''}`);
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
  console.log('SUMMARY:');
  console.log('='.repeat(60));
  console.log('Input:  ', Number(INPUT_AMOUNT), 'sats from', FUNDING_TXID.slice(0, 16) + '...:' + FUNDING_VOUT);
  console.log('Output: ', Number(OUTPUT_AMOUNT), 'sats to bc1q4ygjt4mcq3fhuenv0za09zt04cpvfrttls0cpr');
  console.log('Fee:    ', Number(INPUT_AMOUNT - OUTPUT_AMOUNT), 'sats');
  console.log();

  console.log('='.repeat(60));
  console.log('NEXT STEPS (MAINNET - BE CAREFUL!):');
  console.log('='.repeat(60));
  console.log('\n1. WAIT for funding tx to confirm (currently in mempool)');
  console.log('\n2. Decode and verify the transaction:');
  console.log('   bitcoin-cli decoderawtransaction "' + tx.toString('hex').slice(0, 40) + '..."');
  console.log('\n3. Test mempool acceptance:');
  console.log('   bitcoin-cli testmempoolaccept \'["' + tx.toString('hex').slice(0, 40) + '..."]\'');
  console.log('\n4. Broadcast (ONLY after funding tx confirms!):');
  console.log('   bitcoin-cli sendrawtransaction "' + tx.toString('hex').slice(0, 40) + '..."');

  // Save to file
  const fs = require('fs');
  const path = require('path');
  const outputFile = path.join(__dirname, 'signed-tx-mainnet.json');
  fs.writeFileSync(outputFile, JSON.stringify({
    network: 'mainnet',
    hex: tx.toString('hex'),
    witness: witnessStack.map(w => w.toString('hex')),
    sighash: sighash.toString('hex'),
    signature: Buffer.from(signature).toString('hex'),
    fundingTxid: FUNDING_TXID,
    fundingVout: FUNDING_VOUT,
    inputAmount: Number(INPUT_AMOUNT),
    outputAmount: Number(OUTPUT_AMOUNT),
    fee: Number(INPUT_AMOUNT - OUTPUT_AMOUNT),
    claimAddress: 'bc1q4ygjt4mcq3fhuenv0za09zt04cpvfrttls0cpr'
  }, null, 2));
  console.log('\nSaved to:', outputFile);
}

main().catch(console.error);
