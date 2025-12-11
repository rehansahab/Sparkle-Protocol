#!/usr/bin/env node
/**
 * Build Claim PSBT for Regtest Testing
 * Creates a PSBT that spends from the Taproot address using hashlock script
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ============================================================================
// Encoding Utilities
// ============================================================================

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
// Address Decoding
// ============================================================================

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function decodeBech32(address) {
  const sepIndex = address.lastIndexOf('1');
  const hrp = address.slice(0, sepIndex).toLowerCase();
  const dataPart = address.slice(sepIndex + 1).toLowerCase();

  const values = [];
  for (const c of dataPart) {
    const idx = CHARSET.indexOf(c);
    if (idx === -1) throw new Error('Invalid character');
    values.push(idx);
  }

  const data = values.slice(0, -6); // Remove checksum
  const witnessVersion = data[0];
  const witnessProgram = convertBits(data.slice(1), 5, 8, false);

  return { hrp, witnessVersion, witnessProgram: Buffer.from(witnessProgram) };
}

function convertBits(data, fromBits, toBits, pad) {
  let acc = 0, bits = 0;
  const ret = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) ret.push((acc << (toBits - bits)) & maxv);
  else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) {
    // Invalid padding
  }
  return ret;
}

function addressToScriptPubKey(address) {
  const { witnessVersion, witnessProgram } = decodeBech32(address);
  if (witnessVersion === 1 && witnessProgram.length === 32) {
    // P2TR: OP_1 <32-byte>
    return Buffer.concat([Buffer.from([0x51, 0x20]), witnessProgram]);
  } else if (witnessVersion === 0 && witnessProgram.length === 20) {
    // P2WPKH: OP_0 <20-byte>
    return Buffer.concat([Buffer.from([0x00, 0x14]), witnessProgram]);
  }
  throw new Error('Unsupported address type');
}

// ============================================================================
// PSBT Builder
// ============================================================================

function buildPsbt(config) {
  const {
    txid,
    vout,
    inputAmount,
    inputScriptPubKey,
    outputAddress,
    outputAmount,
    internalKey,
    hashlockScript,
    controlBlock,
    tapMerkleRoot
  } = config;

  // Build unsigned tx (no witness marker/flag for PSBT)
  let unsignedTx = Buffer.alloc(0);

  // Version (4 bytes LE)
  unsignedTx = Buffer.concat([unsignedTx, encodeLE32(2)]);

  // Input count
  unsignedTx = Buffer.concat([unsignedTx, Buffer.from([0x01])]);

  // Input: txid (LE) + vout + scriptSig (empty) + sequence
  const txidLE = reverseBuffer(Buffer.from(txid, 'hex'));
  unsignedTx = Buffer.concat([unsignedTx, txidLE]);
  unsignedTx = Buffer.concat([unsignedTx, encodeLE32(vout)]);
  unsignedTx = Buffer.concat([unsignedTx, Buffer.from([0x00])]); // Empty scriptSig
  unsignedTx = Buffer.concat([unsignedTx, Buffer.from([0xfd, 0xff, 0xff, 0xff])]); // nSequence 0xfffffffd

  // Output count
  unsignedTx = Buffer.concat([unsignedTx, Buffer.from([0x01])]);

  // Output: amount + scriptPubKey
  const outputScriptPubKey = addressToScriptPubKey(outputAddress);
  unsignedTx = Buffer.concat([unsignedTx, encodeLE64(outputAmount)]);
  unsignedTx = Buffer.concat([unsignedTx, encodeCompactSize(outputScriptPubKey.length)]);
  unsignedTx = Buffer.concat([unsignedTx, outputScriptPubKey]);

  // Locktime
  unsignedTx = Buffer.concat([unsignedTx, encodeLE32(0)]);

  // Build PSBT
  let psbt = Buffer.alloc(0);

  // Magic bytes
  psbt = Buffer.concat([psbt, Buffer.from('70736274ff', 'hex')]);

  // Global map: PSBT_GLOBAL_UNSIGNED_TX (0x00)
  psbt = Buffer.concat([psbt, Buffer.from([0x01])]); // Key length
  psbt = Buffer.concat([psbt, Buffer.from([0x00])]); // Key type
  psbt = Buffer.concat([psbt, encodeCompactSize(unsignedTx.length)]);
  psbt = Buffer.concat([psbt, unsignedTx]);

  // End global map
  psbt = Buffer.concat([psbt, Buffer.from([0x00])]);

  // Input map
  // PSBT_IN_WITNESS_UTXO (0x01)
  const witnessUtxo = Buffer.concat([
    encodeLE64(inputAmount),
    encodeCompactSize(inputScriptPubKey.length / 2),
    Buffer.from(inputScriptPubKey, 'hex')
  ]);
  psbt = Buffer.concat([psbt, Buffer.from([0x01])]); // Key length
  psbt = Buffer.concat([psbt, Buffer.from([0x01])]); // Key type
  psbt = Buffer.concat([psbt, encodeCompactSize(witnessUtxo.length)]);
  psbt = Buffer.concat([psbt, witnessUtxo]);

  // PSBT_IN_TAP_LEAF_SCRIPT (0x15) - BIP-371
  // Key: {0x15}|{control block}
  // Value: {script}|{leaf version}
  const tapLeafScriptKey = Buffer.concat([
    Buffer.from([0x15]),
    Buffer.from(controlBlock, 'hex')
  ]);
  const tapLeafScriptValue = Buffer.concat([
    Buffer.from(hashlockScript, 'hex'),
    Buffer.from([0xc0])  // leaf version
  ]);
  psbt = Buffer.concat([psbt, encodeCompactSize(tapLeafScriptKey.length)]);
  psbt = Buffer.concat([psbt, tapLeafScriptKey]);
  psbt = Buffer.concat([psbt, encodeCompactSize(tapLeafScriptValue.length)]);
  psbt = Buffer.concat([psbt, tapLeafScriptValue]);

  // PSBT_IN_TAP_INTERNAL_KEY (0x17)
  psbt = Buffer.concat([psbt, Buffer.from([0x01])]); // Key length
  psbt = Buffer.concat([psbt, Buffer.from([0x17])]); // Key type
  psbt = Buffer.concat([psbt, Buffer.from([0x20])]); // Value length (32)
  psbt = Buffer.concat([psbt, Buffer.from(internalKey, 'hex')]);

  // PSBT_IN_TAP_MERKLE_ROOT (0x18)
  psbt = Buffer.concat([psbt, Buffer.from([0x01])]); // Key length
  psbt = Buffer.concat([psbt, Buffer.from([0x18])]); // Key type
  psbt = Buffer.concat([psbt, Buffer.from([0x20])]); // Value length (32)
  psbt = Buffer.concat([psbt, Buffer.from(tapMerkleRoot, 'hex')]);

  // End input map
  psbt = Buffer.concat([psbt, Buffer.from([0x00])]);

  // Output map (empty)
  psbt = Buffer.concat([psbt, Buffer.from([0x00])]);

  return {
    hex: psbt.toString('hex'),
    base64: psbt.toString('base64')
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(60));
  console.log('Sparkle Protocol - Build Claim PSBT');
  console.log('='.repeat(60));
  console.log();

  // Load derived Taproot data
  const derivedPath = path.join(__dirname, 'derived-taproot.json');
  if (!fs.existsSync(derivedPath)) {
    console.error('ERROR: Run derive-taproot-address.js first');
    process.exit(1);
  }
  const derived = JSON.parse(fs.readFileSync(derivedPath, 'utf8'));

  // Load test vectors
  const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, 'taproot_vector.json'), 'utf8'));
  const v = vectors.testnet_vector;

  // Configuration - UPDATE THESE WITH REAL VALUES FROM REGTEST
  const config = {
    // Funding UTXO (update after funding)
    txid: v.funding_utxo.txid,
    vout: v.funding_utxo.vout,
    inputAmount: v.funding_utxo.amount_sats,
    inputScriptPubKey: '5120' + derived.outputKey, // P2TR scriptPubKey

    // Claim output
    outputAddress: v.claim_output.address.replace('tb1q', 'bcrt1q'), // Use regtest address
    outputAmount: v.claim_output.amount_sats,

    // Taproot data
    internalKey: v.inputs.internal_key,
    hashlockScript: v.inputs.hashlock_script,
    controlBlock: derived.controlBlock,
    tapMerkleRoot: derived.tapMerkleRoot
  };

  console.log('Configuration:');
  console.log('  TXID:        ', config.txid.slice(0, 16) + '...');
  console.log('  Vout:        ', config.vout);
  console.log('  Input Amount:', config.inputAmount, 'sats');
  console.log('  Output Addr: ', config.outputAddress.slice(0, 20) + '...');
  console.log('  Output Amt:  ', config.outputAmount, 'sats');
  console.log();

  // Build PSBT
  const psbt = buildPsbt(config);

  console.log('PSBT Generated:');
  console.log('-'.repeat(60));
  console.log();
  console.log('HEX:');
  console.log(psbt.hex);
  console.log();
  console.log('BASE64:');
  console.log(psbt.base64);
  console.log();

  // Save for analysis
  fs.writeFileSync(path.join(__dirname, 'claim-psbt.json'), JSON.stringify({
    hex: psbt.hex,
    base64: psbt.base64,
    config
  }, null, 2));
  console.log('Saved to: claim-psbt.json');
  console.log();

  console.log('Next steps:');
  console.log('  1. Update txid/vout with real funding UTXO');
  console.log('  2. Run: bitcoin-cli -regtest decodepsbt "' + psbt.base64.slice(0, 20) + '..."');
  console.log('  3. Run: bitcoin-cli -regtest analyzepsbt "' + psbt.base64.slice(0, 20) + '..."');
}

main().catch(console.error);
