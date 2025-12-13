# SPARKLE Protocol - Mainnet Atomic Lock Proof

## Overview

SPARKLE enables trustless atomic swaps between Bitcoin Ordinal inscriptions and Lightning Network payments. This directory contains proof of successful mainnet execution.

## Quick Verification

### Darkita #1 Inscription
```
Inscription: 16d7a2d5e542ca56ea3cd77fc9d650acf7fef2ce5a9c488a4e981d59bdd96d60i0
Lock TX:     a3c6b08ed820194ee3274a3eae945071c2ed33105b41db207cd16c9661de28a7
Sweep TX:    9422e6cb358295d86ad6d73bc0566c869aa0be8290c60598be205f4eea9ce50b
```

### Test Inscription
```
Inscription: 35c76a80416fa00016e920a2d6ced21222b3fd0ab10862ecf9949a19e09362fdi0
Lock TX:     4cfa38681569b802c827283f0c9f74f2d909d0245d86d34f76889f8accd24cc0
Sweep TX:    65d1c34d6e992f3bac0f9552ea4f2bb2b47850b3816efd52b41fddcace7c6c5c
```

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                    SPARKLE ATOMIC SWAP FLOW                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. LOCK PHASE                                                  │
│     ┌──────────────┐      ┌──────────────┐                     │
│     │ Inscription  │ ──── │ Lock Address │                     │
│     │    UTXO      │      │  (Protocol)  │                     │
│     └──────────────┘      └──────────────┘                     │
│           +                                                     │
│     ┌──────────────┐      ┌──────────────┐                     │
│     │  Cardinal    │ ──── │    Change    │                     │
│     │    UTXO      │      │   Address    │                     │
│     └──────────────┘      └──────────────┘                     │
│                                                                 │
│  2. PAYMENT PHASE (Lightning Network)                           │
│     ┌──────────────────────────────────────┐                   │
│     │  Buyer pays invoice with HTLC        │                   │
│     │  Hash = SHA256(preimage)             │                   │
│     └──────────────────────────────────────┘                   │
│                                                                 │
│  3. CLAIM/SWEEP PHASE                                           │
│     ┌──────────────┐      ┌──────────────┐                     │
│     │ Lock Address │ ──── │ Buyer Wallet │ (if payment made)   │
│     └──────────────┘      └──────────────┘                     │
│           OR                                                    │
│     ┌──────────────┐      ┌──────────────┐                     │
│     │ Lock Address │ ──── │Seller Wallet │ (if timeout)        │
│     └──────────────┘      └──────────────┘                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Key Features

| Feature | Description |
|---------|-------------|
| **Ordinal Safe** | Inscription always first input/output |
| **Trustless** | No custody required |
| **Atomic** | All-or-nothing execution |
| **Lightning Ready** | HTLC preimage/hash binding |

## Transaction Structure

```javascript
// Lock Transaction
inputs: [
  { inscription: true, position: 0 },  // FIRST for ordinal safety
  { cardinal: true, position: 1 }       // Fee funding
]
outputs: [
  { lockAddress: true, position: 0 },   // FIRST for ordinal safety
  { changeAddress: true, position: 1 }  // Cardinal change
]
```

## Files

| File | Description |
|------|-------------|
| `SPARKLE_MAINNET_PROOF_REPORT.md` | Full technical report |
| `sparkle-test-lock.js` | Test inscription lock script |
| `sparkle-darkita-lock.js` | Darkita #1 lock script |
| `sparkle-sweep.js` | Generic sweep script |
| `sparkle-darkita-sweep.js` | Darkita #1 sweep script |
| `sparkle_test_*.json` | Session data files |

## Verify On-Chain

```bash
# Verify lock transaction
bitcoin-cli getrawtransaction a3c6b08ed820194ee3274a3eae945071c2ed33105b41db207cd16c9661de28a7 1

# Verify sweep transaction
bitcoin-cli getrawtransaction 9422e6cb358295d86ad6d73bc0566c869aa0be8290c60598be205f4eea9ce50b 1
```

## Block Explorer

- [Lock TX (mempool.space)](https://mempool.space/tx/a3c6b08ed820194ee3274a3eae945071c2ed33105b41db207cd16c9661de28a7)
- [Sweep TX (mempool.space)](https://mempool.space/tx/9422e6cb358295d86ad6d73bc0566c869aa0be8290c60598be205f4eea9ce50b)
- [Darkita #1 (ordinals.com)](https://ordinals.com/inscription/16d7a2d5e542ca56ea3cd77fc9d650acf7fef2ce5a9c488a4e981d59bdd96d60i0)

## Security

- Inscriptions always positioned as first input/output (ordinal safety)
- Cardinal UTXOs used for fee funding (never spend inscription sats)
- 330 sat postage preserved through all transactions
- Preimage/hash cryptographic binding for payment verification

## License

MIT License - SPARKLE Protocol 2025
