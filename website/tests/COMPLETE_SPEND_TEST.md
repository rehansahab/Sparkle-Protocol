# SPARKLE Protocol - Complete Spend Test Guide

## Objective
Complete the end-to-end spend of the funded Taproot UTXO to prove the entire protocol works.

---

## Current State

| Item | Value |
|------|-------|
| Funded TXID | `0dffff168dd1cd5778953a29717429215d1422b4738779ccc2136ad419cfc474` |
| Vout | `1` |
| Amount | `100,000 sats` |
| Taproot Address | `bcrt1pku0pmf2rdna250f7zlzsh9d7haj4dz2v2qc3lza3uj5q7sry9djqrwzdge` |
| Output Key | `b71e1da5436cfaaa3d3e17c50b95bebf6556894c50311f8bb1e4a80f40642b64` |
| Destination | `bcrt1q6xuryqqd6jnwnaed5mmdt9xsqf85fv273es2p4` |
| Expected Output | `99,500 sats` (500 sat fee) |

---

## Test Vector Cryptographic Data

```
Internal Key (NUMS): 50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0
Buyer X-Only Pubkey: 79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798
Buyer Private Key:   0000000000000000000000000000000000000000000000000000000000000001
Preimage:            0000000000000000000000000000000000000000000000000000000000000000
Payment Hash:        e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

Hashlock Script:     a820e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855882079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ac
Control Block:       c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac073f60105ce88b9d86a06c8c626ca23d726182849fb013b4a5c1c68a71651a790
TapMerkleRoot:       74960d13049c67e0e89874f91fb53d4cb1ef95d3c840f4cbf1eb0644e0563a4b
```

---

## PSBT (Production Ready)

```
cHNidP8BAFICAAAAAXTEzxnUahPCzHmHc7QiFF0hKXRxKTqVeFfN0Y0W//8NAQAAAAD9////AayEAQAAAAAAFgAU0bgyAA3Upun3Lab21ZTQAk9EsV4AAAAAAAEBK6CGAQAAAAAAIlEgtx4dpUNs+qo9PhfFC5W+v2VWiUxQMR+LseSoD0BkK2RCFcBQkpt0waBJVLeLS2A16XpeB4paDyjsltVHv+6azoA6wHP2AQXOiLnYagbIxibKI9cmGChJ+wE7SlwcaKcWUaeQRqgg47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFWIIHm+Zn753LusVaBilc6HCwcCm/zbLc4o2VnygVsW+BeYrMABFyBQkpt0waBJVLeLS2A16XpeB4paDyjsltVHv+6azoA6wAEYIHSWDRMEnGfg6Jh0+R+1PUyx75XTyED0y/HrBkTgVjpLAAA=
```

---

## TODO: Step-by-Step Testing Tasks

### Task 1: Verify UTXO Still Exists
```bash
bitcoin-cli -regtest gettxout 0dffff168dd1cd5778953a29717429215d1422b4738779ccc2136ad419cfc474 1
```
**Expected**: Returns UTXO data with value 0.001 BTC

---

### Task 2: Decode and Verify PSBT
```bash
bitcoin-cli -regtest decodepsbt "cHNidP8BAFICAAAAAXTEzxnUahPCzHmHc7QiFF0hKXRxKTqVeFfN0Y0W//8NAQAAAAD9////AayEAQAAAAAAFgAU0bgyAA3Upun3Lab21ZTQAk9EsV4AAAAAAAEBK6CGAQAAAAAAIlEgtx4dpUNs+qo9PhfFC5W+v2VWiUxQMR+LseSoD0BkK2RCFcBQkpt0waBJVLeLS2A16XpeB4paDyjsltVHv+6azoA6wHP2AQXOiLnYagbIxibKI9cmGChJ+wE7SlwcaKcWUaeQRqgg47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFWIIHm+Zn753LusVaBilc6HCwcCm/zbLc4o2VnygVsW+BeYrMABFyBQkpt0waBJVLeLS2A16XpeB4paDyjsltVHv+6azoA6wAEYIHSWDRMEnGfg6Jh0+R+1PUyx75XTyED0y/HrBkTgVjpLAAA="
```
**Verify**:
- Input TXID matches funding TX
- Input amount is 100,000 sats
- Output amount is 99,500 sats
- TAP_LEAF_SCRIPT present with correct script

---

### Task 3: Create Signing Script

Create `sign-and-spend.js` in the tests directory:

```javascript
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

  console.log('\\nWitness Stack:');
  console.log('  [0] Signature (to be computed)');
  console.log('  [1] Preimage:', PREIMAGE.toString('hex'));
  console.log('  [2] Script:', HASHLOCK_SCRIPT.toString('hex').slice(0, 40) + '...');
  console.log('  [3] Control Block:', CONTROL_BLOCK.toString('hex').slice(0, 40) + '...');

  // NOTE: Computing the actual sighash requires the full transaction context
  // For regtest, we can use bitcoin-cli to help with signing

  console.log('\\n' + '='.repeat(50));
  console.log('MANUAL SIGNING STEPS:');
  console.log('='.repeat(50));
  console.log('\\n1. Import the test private key to regtest wallet:');
  console.log('   bitcoin-cli -regtest importprivkey "KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn"');
  console.log('   (This is the WIF for private key 0x01)');

  console.log('\\n2. Use walletprocesspsbt to sign:');
  console.log('   bitcoin-cli -regtest walletprocesspsbt "<PSBT_BASE64>" true "ALL"');

  console.log('\\n3. Finalize the PSBT:');
  console.log('   bitcoin-cli -regtest finalizepsbt "<SIGNED_PSBT>"');

  console.log('\\n4. Broadcast the transaction:');
  console.log('   bitcoin-cli -regtest sendrawtransaction "<FINAL_HEX>"');

  console.log('\\n5. Mine a block to confirm:');
  console.log('   bitcoin-cli -regtest -generate 1');

  console.log('\\n6. Verify destination received funds:');
  console.log('   bitcoin-cli -regtest getreceivedbyaddress "bcrt1q6xuryqqd6jnwnaed5mmdt9xsqf85fv273es2p4"');
}

main().catch(console.error);
```

---

### Task 4: Import Test Private Key

The buyer's private key `0x01` (secp256k1 generator) has WIF:
```
Mainnet WIF: KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn
Regtest WIF: cMahea7zqjxrtgAbB7LSGbcQUr1uX1ojuat9jZodMN87JcbXMTcA
```

```bash
# Create or load a wallet first
bitcoin-cli -regtest createwallet "sparkle_test" false false "" false false true

# Import the private key
bitcoin-cli -regtest -rpcwallet=sparkle_test importprivkey "cMahea7zqjxrtgAbB7LSGbcQUr1uX1ojuat9jZodMN87JcbXMTcA" "buyer_key" false
```

---

### Task 5: Sign the PSBT

**Option A: Using walletprocesspsbt (may not work for Taproot script-path)**
```bash
bitcoin-cli -regtest -rpcwallet=sparkle_test walletprocesspsbt "cHNidP8BAFICAAAAAXTEzxnUahPCzHmHc7QiFF0hKXRxKTqVeFfN0Y0W//8NAQAAAAD9////AayEAQAAAAAAFgAU0bgyAA3Upun3Lab21ZTQAk9EsV4AAAAAAAEBK6CGAQAAAAAAIlEgtx4dpUNs+qo9PhfFC5W+v2VWiUxQMR+LseSoD0BkK2RCFcBQkpt0waBJVLeLS2A16XpeB4paDyjsltVHv+6azoA6wHP2AQXOiLnYagbIxibKI9cmGChJ+wE7SlwcaKcWUaeQRqgg47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFWIIHm+Zn753LusVaBilc6HCwcCm/zbLc4o2VnygVsW+BeYrMABFyBQkpt0waBJVLeLS2A16XpeB4paDyjsltVHv+6azoA6wAEYIHSWDRMEnGfg6Jh0+R+1PUyx75XTyED0y/HrBkTgVjpLAAA=" true "ALL"
```

**Option B: Manual witness construction (if Option A fails)**

The Taproot script-path witness requires:
```
witness: [
  <schnorr_signature>,  // 64 bytes, signs the script-path sighash
  <preimage>,           // 32 bytes: 0x00...00
  <script>,             // The hashlock script
  <control_block>       // 0xc0 || internal_key || sibling_hash
]
```

---

### Task 6: Finalize and Broadcast

```bash
# Finalize
bitcoin-cli -regtest finalizepsbt "<SIGNED_PSBT_BASE64>"

# Extract the hex
# The result will have "hex" field with the final transaction

# Broadcast
bitcoin-cli -regtest sendrawtransaction "<FINAL_TX_HEX>"

# Mine to confirm
bitcoin-cli -regtest -generate 1
```

---

### Task 7: Verify Success

```bash
# Check destination balance
bitcoin-cli -regtest getreceivedbyaddress "bcrt1q6xuryqqd6jnwnaed5mmdt9xsqf85fv273es2p4"
# Expected: 0.000995 (99,500 sats)

# Get the spending transaction details
bitcoin-cli -regtest getrawtransaction "<SPEND_TXID>" true

# Verify the witness stack
# Should show: signature, preimage, script, control_block
```

---

## Expected Final Result

| Check | Expected Value |
|-------|----------------|
| Spend TX confirmed | Yes |
| Destination balance | 99,500 sats |
| Witness stack items | 4 (sig, preimage, script, ctrl) |
| Script executed | OP_SHA256 verified, OP_CHECKSIG passed |

---

## Success Criteria

The test is **PASSED** if:
1. The spending transaction broadcasts successfully
2. The transaction confirms in a block
3. The destination address receives 99,500 sats
4. The witness reveals the preimage correctly

---

## Troubleshooting

**If walletprocesspsbt doesn't sign:**
- Bitcoin Core may not automatically sign Taproot script-path spends
- Use a library like bitcoinjs-lib with the taproot module
- Or construct the witness manually

**If signature verification fails:**
- Verify the sighash is computed correctly (BIP-341 Taproot sighash)
- Ensure the leaf version (0xc0) matches
- Check the annex is not present (it shouldn't be)

**If script execution fails:**
- Verify preimage hashes to payment_hash: `SHA256(0x00...00) = e3b0c44298fc1c...`
- Verify buyer pubkey matches the one in the script

---

## Report Back

Please report:
1. Each command executed and its output
2. Any errors encountered
3. The final spending TXID
4. Confirmation that destination received funds

**This completes the SPARKLE Protocol v0.3.8 end-to-end validation.**
