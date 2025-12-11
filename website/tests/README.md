# Sparkle Protocol Test Suite

Version: 0.3.8

## Overview

This test suite validates the critical security components of Sparkle Protocol:
- **Taproot derivation** (BIP-341/342)
- **PSBT construction** (BIP-174/371)
- **BOLT11 invoice verification**

## Files

| File | Description |
|------|-------------|
| `taproot_vector.json` | Deterministic Taproot/PSBT test vectors |
| `bolt11-vectors.json` | Valid/invalid Lightning invoice scenarios |
| `psbt-validate.js` | Node.js validation script |

## Quick Start

```bash
# Install dependencies
npm install @noble/secp256k1 @noble/hashes

# Run validation
node tests/psbt-validate.js
```

## Test Vectors

### Taproot Vector (`taproot_vector.json`)

Contains deterministic inputs for both testnet and mainnet:
- `internal_key`: NUMS point (no known private key)
- `hashlock_script`: OP_SHA256 <hash> OP_EQUALVERIFY <pubkey> OP_CHECKSIG
- `refund_script`: <timeout> OP_CLTV OP_DROP <pubkey> OP_CHECKSIG
- `funding_utxo`: Sample UTXO data
- `claim_output`: Destination address and amount

Expected outputs are computed and validated:
- TapLeaf hashes (tagged hash with leafVersion)
- TapBranch/TapMerkleRoot (lexicographic ordering)
- TapTweak and output key with parity
- Control block structure

### BOLT11 Vectors (`bolt11-vectors.json`)

Test scenarios for invoice validation:

| Scenario | Expected |
|----------|----------|
| Valid signature + payee | PASS |
| Invalid payee | FAIL |
| Invalid signature | FAIL |
| Wrong payment_hash | FAIL |
| Wrong amount | FAIL |
| Expired invoice | FAIL |
| Network mismatch | FAIL |

## Validation Rules

| Rule | Value | Description |
|------|-------|-------------|
| Dust threshold | 330 sats | P2TR standard |
| Min confirmations | 2 | Funding UTXO |
| nSequence | 0xfffffffd | RBF-enabled |
| TAP_LEAF_SCRIPT type | 0x16 | BIP-371 |
| ScriptPubKey prefix | 5120 | P2TR |

## PSBT Structure (BIP-371)

```
PSBT_IN_WITNESS_UTXO (0x01)
  Key: 0x01
  Value: amount (8 bytes LE) || scriptPubKey

PSBT_IN_TAP_LEAF_SCRIPT (0x16)
  Key: 0x16 || leafVersion || script
  Value: control_block

PSBT_IN_TAP_INTERNAL_KEY (0x17)
  Key: 0x17
  Value: internal_key (32 bytes)

PSBT_IN_TAP_MERKLE_ROOT (0x18)
  Key: 0x18
  Value: tap_merkle_root (32 bytes)
```

## Control Block Structure

```
First byte: (leafVersion & 0xfe) | (parity & 0x01)
  - leafVersion: 0xc0 for Tapscript
  - parity: 0 if Q.y is even, 1 if odd (from OUTPUT key)

Followed by:
  - internal_key (32 bytes, x-only)
  - merkle_path (32 bytes per sibling)
```

## Cross-Validation

For full PSBT validation, install bitcoinjs-lib:

```bash
npm install bitcoinjs-lib tiny-secp256k1
```

The validation script will compare generated PSBTs against bitcoinjs-lib reference implementation.

## Security Formulas

### Time-Bandit Safety
```
Safe_CLTV = CurrentHeight + (InvoiceExpirySecs / 600) + 12
```
Refund timelock must be > Safe_CLTV.

### BOLT11 Message Hash
```
message = SHA256(hrp_utf8 || data_5bit_words_as_bytes)
```
Single SHA256, not double-hashed.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All tests passed |
| 1 | One or more tests failed |

## Contributing

When modifying Taproot/PSBT/BOLT11 code:
1. Run `node tests/psbt-validate.js` before committing
2. Update test vectors if behavior intentionally changes
3. Ensure all validation rules match code constants
