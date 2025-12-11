#!/usr/bin/env node
/**
 * Derive Taproot Address for Regtest Testing
 * Uses the test vectors to compute the actual address
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ============================================================================
// Tagged Hash (BIP-340/341)
// ============================================================================

function taggedHash(tag, data) {
  const tagHash = crypto.createHash('sha256').update(tag).digest();
  return crypto.createHash('sha256').update(Buffer.concat([tagHash, tagHash, data])).digest();
}

function computeTapLeafHash(script, leafVersion = 0xc0) {
  const scriptBuf = Buffer.from(script, 'hex');
  let compactSize;
  if (scriptBuf.length < 253) {
    compactSize = Buffer.from([scriptBuf.length]);
  } else {
    compactSize = Buffer.alloc(3);
    compactSize[0] = 253;
    compactSize.writeUInt16LE(scriptBuf.length, 1);
  }
  return taggedHash('TapLeaf', Buffer.concat([Buffer.from([leafVersion]), compactSize, scriptBuf]));
}

function computeTapBranch(left, right) {
  const l = left.toString('hex'), r = right.toString('hex');
  return l < r ?
    taggedHash('TapBranch', Buffer.concat([left, right])) :
    taggedHash('TapBranch', Buffer.concat([right, left]));
}

// ============================================================================
// Bech32m Encoding (BIP-350)
// ============================================================================

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32M_CONST = 0x2bc830a3;

function bech32Polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((b >> i) & 1) chk ^= GEN[i];
    }
  }
  return chk;
}

function bech32HrpExpand(hrp) {
  const ret = [];
  for (const c of hrp) ret.push(c.charCodeAt(0) >> 5);
  ret.push(0);
  for (const c of hrp) ret.push(c.charCodeAt(0) & 31);
  return ret;
}

function bech32CreateChecksum(hrp, data) {
  const values = [...bech32HrpExpand(hrp), ...data];
  const polymod = bech32Polymod([...values, 0, 0, 0, 0, 0, 0]) ^ BECH32M_CONST;
  return [0,1,2,3,4,5].map(i => (polymod >> (5 * (5 - i))) & 31);
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
  return ret;
}

function encodeBech32m(hrp, data) {
  const data5bit = convertBits(data, 8, 5, true);
  const values = [1, ...data5bit]; // witness version 1
  const checksum = bech32CreateChecksum(hrp, values);
  return hrp + '1' + [...values, ...checksum].map(v => CHARSET[v]).join('');
}

// ============================================================================
// EC Operations (simplified - for full validation use @noble/secp256k1)
// ============================================================================

async function tweakPublicKey(pubkeyHex, tweakHex) {
  try {
    const secp = require('@noble/secp256k1');

    // Use Point class (newer API) or ProjectivePoint (older API)
    const PointClass = secp.ProjectivePoint || secp.Point;

    if (PointClass) {
      // Construct compressed pubkey hex (02 || x-only key)
      const compressedHex = '02' + pubkeyHex;
      const P = PointClass.fromHex(compressedHex);
      const tweakScalar = BigInt('0x' + tweakHex);
      const tG = PointClass.BASE.multiply(tweakScalar);
      const Q = P.add(tG);
      const Qaffine = Q.toAffine ? Q.toAffine() : Q;
      const yCoord = Qaffine.y || Q.y;
      const xCoord = Qaffine.x || Q.x;
      const parity = (yCoord & 1n) === 1n ? 1 : 0;
      const key = xCoord.toString(16).padStart(64, '0');
      return { key, parity };
    }

    // Fallback: use getPublicKey for tweak * G, then add
    // This is a simplified approach
    const tweakPub = secp.getPublicKey(Buffer.from(tweakHex, 'hex'), true);
    // For full implementation, would need proper point addition
    throw new Error('Point class not found - need different approach');

  } catch (e) {
    console.error('EC Error:', e.message);
    console.error('Install @noble/secp256k1: npm install @noble/secp256k1');
    process.exit(1);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(60));
  console.log('Sparkle Protocol - Taproot Address Derivation');
  console.log('='.repeat(60));
  console.log();

  // Load test vectors
  const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, 'taproot_vector.json'), 'utf8'));
  const v = vectors.testnet_vector.inputs;

  console.log('Inputs:');
  console.log('  Internal Key:', v.internal_key.slice(0, 20) + '...');
  console.log('  Payment Hash:', v.payment_hash.slice(0, 20) + '...');
  console.log();

  // Compute leaf hashes
  const hashlockLeafHash = computeTapLeafHash(v.hashlock_script, 0xc0);
  const refundLeafHash = computeTapLeafHash(v.refund_script, 0xc0);

  console.log('Leaf Hashes:');
  console.log('  Hashlock:', hashlockLeafHash.toString('hex'));
  console.log('  Refund:  ', refundLeafHash.toString('hex'));
  console.log();

  // Compute merkle root
  const tapMerkleRoot = computeTapBranch(hashlockLeafHash, refundLeafHash);
  console.log('TapMerkleRoot:', tapMerkleRoot.toString('hex'));

  // Compute tweak
  const tapTweak = taggedHash('TapTweak', Buffer.concat([
    Buffer.from(v.internal_key, 'hex'),
    tapMerkleRoot
  ]));
  console.log('TapTweak:     ', tapTweak.toString('hex'));

  // Tweak the key
  const { key: outputKey, parity } = await tweakPublicKey(v.internal_key, tapTweak.toString('hex'));
  console.log('Output Key:   ', outputKey);
  console.log('Parity:       ', parity);
  console.log();

  // Generate addresses for all networks
  const networks = {
    regtest: 'bcrt',
    testnet: 'tb',
    mainnet: 'bc'
  };

  console.log('Taproot Addresses:');
  console.log('-'.repeat(60));

  for (const [network, hrp] of Object.entries(networks)) {
    const address = encodeBech32m(hrp, Buffer.from(outputKey, 'hex'));
    console.log(`  ${network.padEnd(8)}: ${address}`);
  }

  console.log();
  console.log('Control Block (for hashlock spend):');
  const firstByte = (0xc0 & 0xfe) | (parity & 0x01);
  // For hashlock spend, the sibling is ALWAYS the refund leaf hash
  const siblingHash = refundLeafHash.toString('hex');

  const controlBlock = firstByte.toString(16).padStart(2, '0') + v.internal_key + siblingHash;
  console.log('  First byte: 0x' + firstByte.toString(16));
  console.log('  Full:      ', controlBlock.slice(0, 40) + '...');
  console.log();

  // Save for use by other scripts
  const derivation = {
    outputKey,
    parity,
    tapMerkleRoot: tapMerkleRoot.toString('hex'),
    tapTweak: tapTweak.toString('hex'),
    controlBlock,
    siblingHash,
    addresses: {}
  };

  for (const [network, hrp] of Object.entries(networks)) {
    derivation.addresses[network] = encodeBech32m(hrp, Buffer.from(outputKey, 'hex'));
  }

  fs.writeFileSync(
    path.join(__dirname, 'derived-taproot.json'),
    JSON.stringify(derivation, null, 2)
  );
  console.log('Saved to: derived-taproot.json');
}

main().catch(console.error);
