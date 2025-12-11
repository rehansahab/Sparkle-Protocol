#!/usr/bin/env node
/**
 * Debug script to verify Taproot computations
 */

const crypto = require('crypto');

function taggedHash(tag, data) {
  const tagHash = crypto.createHash('sha256').update(tag).digest();
  return crypto.createHash('sha256')
    .update(tagHash)
    .update(tagHash)
    .update(data)
    .digest();
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

function computeTapLeafHash(script, leafVersion = 0xc0) {
  const compactSize = encodeCompactSize(script.length);
  const data = Buffer.concat([
    Buffer.from([leafVersion]),
    compactSize,
    script
  ]);
  console.log('TapLeaf input:', data.toString('hex'));
  return taggedHash('TapLeaf', data);
}

function computeTapBranchHash(a, b) {
  // Sort lexicographically
  const sorted = Buffer.compare(a, b) < 0 ? [a, b] : [b, a];
  return taggedHash('TapBranch', Buffer.concat(sorted));
}

// Test vector data
const HASHLOCK_SCRIPT = Buffer.from('a820e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855882079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ac', 'hex');
const REFUND_SCRIPT = Buffer.from('0350f70cb17521c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5ac', 'hex');
const INTERNAL_KEY = Buffer.from('50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0', 'hex');
const EXPECTED_OUTPUT_KEY = Buffer.from('b71e1da5436cfaaa3d3e17c50b95bebf6556894c50311f8bb1e4a80f40642b64', 'hex');
const CONTROL_BLOCK = Buffer.from('c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac073f60105ce88b9d86a06c8c626ca23d726182849fb013b4a5c1c68a71651a790', 'hex');

console.log('='.repeat(60));
console.log('TAPROOT VERIFICATION DEBUG');
console.log('='.repeat(60));

console.log('\n--- Script Lengths ---');
console.log('Hashlock script length:', HASHLOCK_SCRIPT.length, 'bytes');
console.log('Refund script length:', REFUND_SCRIPT.length, 'bytes');

console.log('\n--- TapLeaf Hashes ---');
const hashlockLeafHash = computeTapLeafHash(HASHLOCK_SCRIPT);
console.log('Hashlock TapLeaf hash:', hashlockLeafHash.toString('hex'));

const refundLeafHash = computeTapLeafHash(REFUND_SCRIPT);
console.log('Refund TapLeaf hash:', refundLeafHash.toString('hex'));

console.log('\n--- Control Block Analysis ---');
const cbLeafVersion = CONTROL_BLOCK[0];
const cbInternalKey = CONTROL_BLOCK.subarray(1, 33);
const cbSiblingHash = CONTROL_BLOCK.subarray(33, 65);
console.log('Control block leaf version:', '0x' + cbLeafVersion.toString(16));
console.log('Control block internal key:', cbInternalKey.toString('hex'));
console.log('Control block sibling hash:', cbSiblingHash.toString('hex'));

console.log('\n--- Sibling Hash Comparison ---');
console.log('Sibling from control block:', cbSiblingHash.toString('hex'));
console.log('Hashlock leaf hash:        ', hashlockLeafHash.toString('hex'));
console.log('Refund leaf hash:          ', refundLeafHash.toString('hex'));

if (cbSiblingHash.equals(refundLeafHash)) {
  console.log('✓ Sibling matches REFUND script TapLeaf (correct)');
} else if (cbSiblingHash.equals(hashlockLeafHash)) {
  console.log('✗ Sibling matches HASHLOCK script TapLeaf (wrong!)');
} else {
  console.log('✗ Sibling matches neither script (very wrong!)');
}

console.log('\n--- Merkle Root Computation ---');
// For script-path spend, we need to compute merkle root from:
// 1. TapLeaf hash of the script we're executing
// 2. The sibling hash from the control block
const merkleRoot = computeTapBranchHash(hashlockLeafHash, cbSiblingHash);
console.log('Computed Merkle Root:', merkleRoot.toString('hex'));

// Expected from test vector
console.log('Expected Merkle Root: 74960d13049c67e0e89874f91fb53d4cb1ef95d3c840f4cbf1eb0644e0563a4b');

console.log('\n--- TapTweak Computation ---');
const tapTweakData = Buffer.concat([INTERNAL_KEY, merkleRoot]);
const tapTweak = taggedHash('TapTweak', tapTweakData);
console.log('TapTweak:', tapTweak.toString('hex'));

console.log('\n--- Expected Output Key ---');
console.log('Expected output key:', EXPECTED_OUTPUT_KEY.toString('hex'));
console.log('\nNote: To compute actual output key, need to do point addition:');
console.log('Q = P + t*G where P is internal key, t is tapTweak');
console.log('This requires secp256k1 point operations.');

// Let's use noble secp256k1 to compute the actual output key
const secp = require('@noble/secp256k1');

// Configure sha256
secp.hashes.sha256 = (...msgs) => {
  const hash = crypto.createHash('sha256');
  for (const msg of msgs) hash.update(msg);
  return Uint8Array.from(hash.digest());
};
secp.hashes.hmacSha256 = (key, ...msgs) => {
  const hmac = crypto.createHmac('sha256', key);
  for (const msg of msgs) hmac.update(msg);
  return Uint8Array.from(hmac.digest());
};

// Compute tweaked key
// The internal key is x-only, we need to lift it to a point
const Point = secp.Point;

// For x-only pubkey, we assume even y coordinate
const internalPoint = Point.fromHex('02' + INTERNAL_KEY.toString('hex'));
console.log('\nInternal point lifted:', internalPoint.toHex());

// t*G
const tG = Point.BASE.multiply(BigInt('0x' + tapTweak.toString('hex')));
console.log('t*G:', tG.toHex());

// Q = P + t*G
const Q = internalPoint.add(tG);
console.log('\nComputed output point:', Q.toHex());

// Get x-only (32 bytes)
const computedOutputKey = Q.toRawBytes(true).subarray(1);
console.log('Computed output key (x-only):', Buffer.from(computedOutputKey).toString('hex'));
console.log('Expected output key:         ', EXPECTED_OUTPUT_KEY.toString('hex'));

if (Buffer.from(computedOutputKey).equals(EXPECTED_OUTPUT_KEY)) {
  console.log('\n✓ OUTPUT KEY MATCHES!');
} else {
  console.log('\n✗ OUTPUT KEY MISMATCH!');
  console.log('The control block or script data may be incorrect.');
}
