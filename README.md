<p align="center">
  <img src="assets/sparkle-logo.png" alt="Sparkle Protocol" width="120" height="120">
</p>

<h1 align="center">Sparkle Protocol</h1>

<p align="center">
  <strong>Trustless Atomic Swaps for Bitcoin Ordinals via Lightning Network</strong>
</p>

<p align="center">
  <a href="#mainnet-proof"><img src="https://img.shields.io/badge/Status-Mainnet%20Validated-brightgreen?style=flat-square" alt="Status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License"></a>
  <img src="https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Bitcoin-Taproot-F7931A?style=flat-square&logo=bitcoin&logoColor=white" alt="Bitcoin">
</p>

<p align="center">
  <a href="https://sparkleprotocol.com">Website</a> |
  <a href="docs/SPECIFICATION.md">Specification</a> |
  <a href="proofs/">Mainnet Proofs</a>
</p>

---

## Overview

Sparkle Protocol enables **trustless atomic swaps for Bitcoin Ordinals** using Lightning Network payments. Trade inscriptions securely without intermediaries, custodial accounts, or private key exposure.

**TL;DR:** Pay Lightning, get Ordinal. Trustless. No custody risk.

---

## Mainnet Proof

The protocol has been validated on Bitcoin mainnet with a complete atomic swap:

| Component | Transaction ID |
|-----------|---------------|
| **Lock TX** | [a3c6b08ed820194ee...](https://mempool.space/tx/a3c6b08ed820194ee3274a3eae945071c2ed33105b41db207cd16c9661de28a7) |
| **Sweep TX** | [9422e6cb358295d86...](https://mempool.space/tx/9422e6cb358295d86ad6d73bc0566c869aa0be8290c60598be205f4eea9ce50b) |

See [proofs/SPARKLE_MAINNET_COMPLETE_PROOF_REPORT.md](proofs/SPARKLE_MAINNET_COMPLETE_PROOF_REPORT.md) for full verification details.

---

## How It Works

### The Sparkle Swap Mechanism

```
1. Seller creates Lightning hold invoice
2. Seller locks inscription in Taproot address with:
   - Claim path: requires preimage (revealed when buyer pays)
   - Refund path: available after timelock (if buyer abandons)
3. Buyer pays Lightning invoice
4. Payment reveals preimage
5. Buyer uses preimage to claim inscription
6. Seller receives Lightning payment

Result: Atomic exchange - both succeed or neither does
```

### Security Properties

| Property | Guarantee |
|----------|-----------|
| **Atomicity** | Payment and transfer occur together or not at all |
| **Non-custodial** | No third party holds funds or inscriptions |
| **Trustless** | No trust required between buyer and seller |
| **Recoverable** | Seller can always reclaim via timelock refund |

---

## Repository Structure

```
Sparkle-Protocol/
├── docs/               # Protocol documentation
├── proofs/             # Mainnet validation evidence
├── src/                # TypeScript SDK source
├── tests/              # Test suite
├── LICENSE             # MIT License
├── SECURITY.md         # Security policy
└── README.md
```

---

## Test Results

| Test | Status |
|------|--------|
| Refund Path (Timelock) | **PASS** |
| Double-Spend Prevention | **PASS** |
| CPFP Fee Recovery | **PASS** |
| Edge Cases | **DOCUMENTED** |

See [proofs/TEST_RESULTS.json](proofs/TEST_RESULTS.json) for details.

---

## Technical Specification

The protocol uses:
- **Taproot (BIP-341)** for script-path spending
- **SHA256 hashlocks** bound to Lightning payment hashes
- **CLTV timelocks** for seller refund protection
- **Hold invoices** for atomic settlement

Full specification: [docs/SPECIFICATION.md](docs/SPECIFICATION.md)

---

## Security

For security issues, please see [SECURITY.md](SECURITY.md).

---

## License

MIT License - see [LICENSE](LICENSE)

---

## Links

- **Website:** https://sparkleprotocol.com
- **Mainnet Proof:** [proofs/](proofs/)
- **Specification:** [docs/SPECIFICATION.md](docs/SPECIFICATION.md)
