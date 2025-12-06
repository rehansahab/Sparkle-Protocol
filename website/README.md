<p align="center">
  <img src="assets/sparkle-logo.png" alt="Sparkle Protocol" width="120" height="120">
</p>

<h1 align="center">Sparkle Protocol</h1>

<p align="center">
  <strong>Serverless Ordinals OTC — Trustless P2P Trading via Nostr</strong>
</p>

<p align="center">
  <a href="https://sparkleprotocol.com"><img src="https://img.shields.io/badge/Status-Testnet%20Ready-brightgreen?style=flat-square" alt="Status"></a>
  <a href="https://sparkleprotocol.com/changelog.html"><img src="https://img.shields.io/badge/Version-0.3.0-blue?style=flat-square" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License"></a>
  <a href="https://github.com/ProtocolSparkle/Sparkles-Protocol"><img src="https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://sparkleprotocol.com"><img src="https://img.shields.io/badge/Bitcoin-Taproot-F7931A?style=flat-square&logo=bitcoin&logoColor=white" alt="Bitcoin"></a>
</p>

<p align="center">
  <a href="https://sparkleprotocol.com/swap.html">Try Demo</a> •
  <a href="https://sparkleprotocol.com/whitepaper.html">Whitepaper</a> •
  <a href="https://sparkleprotocol.com/developer-sdk.html">SDK Docs</a> •
  <a href="https://sparkleprotocol.com/spec.html">Technical Spec</a>
</p>

---

## Abstract

Sparkle Protocol enables **trustless atomic swaps for Bitcoin Ordinals** using Lightning Network payments. Trade inscriptions securely without intermediaries, custodial accounts, or private key exposure. The protocol leverages Taproot script paths with hashlock/timelock conditions to guarantee atomic settlement.

> **Testnet Phase**: This implementation is functional on Bitcoin testnet. Mainnet deployment requires completion of professional security audits.

---

## Protocol Overview

### Core Mechanism

The protocol implements a **Hash Time-Locked Contract (HTLC)** using Bitcoin's Taproot (P2TR) with the following Miniscript policy:

```
or_i(
  and_v(v:pk(BUYER), sha256(H)),    // Claim path: buyer reveals preimage
  and_v(v:pk(SELLER), older(N))      // Refund path: seller reclaims after timeout
)
```

### Swap Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   SELLER    │     │   NOSTR     │     │    BUYER    │
│  (Ordinal)  │     │   RELAYS    │     │  (Payment)  │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       │  1. List Ordinal  │                   │
       │──────────────────>│                   │
       │                   │                   │
       │                   │  2. Accept Offer  │
       │                   │<──────────────────│
       │                   │                   │
       │  3. Generate HTLC Address             │
       │<─────────────────────────────────────>│
       │                   │                   │
       │  4. Seller Deposits Ordinal to HTLC   │
       │──────────────────────────────────────>│
       │                   │                   │
       │  5. Buyer Pays Lightning Invoice      │
       │<──────────────────────────────────────│
       │                   │                   │
       │  6. Preimage Revealed, Buyer Claims   │
       │<──────────────────────────────────────│
       └───────────────────────────────────────┘
```

---

## Technical Specifications

### Codebase Metrics

| Metric | Value |
|--------|-------|
| Production Code | 8,500+ lines |
| Test Coverage | 95%+ |
| Unit Tests | 153/153 passing |
| Integration Tests | 4/4 passing |
| TypeScript Strict | Zero `any` types |

### Feature Implementation

| Component | Status | Description |
|-----------|--------|-------------|
| Taproot Atomic Swaps | ✅ Complete | P2TR with hashlock/timelock scripts |
| NIP-07 Integration | ✅ Complete | Nostr wallet signing (Alby, nos2x) |
| P2P Orderbook | ✅ Complete | Decentralized via Nostr relays |
| Pay-to-Bid Auctions | ✅ Complete | Lightning-secured bidding |
| Inscription Indexer | ✅ Complete | Ordinal discovery and validation |
| Lightning Connectors | ✅ Complete | LND and CLN support |
| Browser SDK | ✅ Complete | Unisat/Xverse PSBT signing |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser Client                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │   NIP-07     │  │   Unisat/    │  │   Sparkle SDK    │   │
│  │   Wallet     │  │   Xverse     │  │   (Taproot)      │   │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘   │
└─────────┼─────────────────┼───────────────────┼─────────────┘
          │                 │                   │
          ▼                 ▼                   ▼
   ┌─────────────┐   ┌─────────────┐   ┌─────────────────┐
   │   Nostr     │   │   Bitcoin   │   │   Lightning     │
   │   Relays    │   │   Network   │   │   Network       │
   └─────────────┘   └─────────────┘   └─────────────────┘
```

---

## Repository Structure

```
sparkle-protocol/
├── src/
│   ├── core/               # Taproot swap primitives
│   │   ├── taproot.ts      # P2TR address generation
│   │   ├── htlc.ts         # Hashlock/timelock logic
│   │   └── psbt.ts         # Transaction building
│   ├── auction/            # Pay-to-bid auction engine
│   ├── indexer/            # Inscription discovery
│   ├── lightning/          # LND/CLN connectors
│   ├── coordinator/        # WebSocket relay (optional)
│   └── browser/            # Wallet integrations
├── tests/                  # Vitest test suite
├── scripts/                # Build tooling
├── website/                # sparkleprotocol.com
└── dist/                   # Compiled output
```

---

## Installation

### From Source

```bash
git clone https://github.com/ProtocolSparkle/Sparkles-Protocol.git
cd Sparkles-Protocol
npm install
npm run build
npm test
```

### NPM Package

```bash
npm install sparkle-protocol  # Coming soon
```

---

## Usage

### Browser Integration

```html
<script src="js/sparkle-browser.js"></script>
<script>
  // Generate cryptographic preimage
  const { preimage, paymentHash } = SparkleProtocol.generatePreimage();

  // Create atomic swap address
  const swapAddress = SparkleProtocol.createSparkleSwapAddress({
    buyerPubkey: '02abc...',
    sellerPubkey: '03def...',
    paymentHash,
    refundLocktime: currentBlock + 288,  // ~48 hours
    network: 'testnet'
  });
</script>
```

### Node.js / TypeScript

```typescript
import {
  createSparkleSwapAddress,
  buildClaimTransaction,
  generatePreimage
} from 'sparkle-protocol';

// Initialize swap
const { preimage, paymentHash } = generatePreimage();

const swap = createSparkleSwapAddress({
  buyerPubkey: buyerKey,
  sellerPubkey: sellerKey,
  paymentHash,
  refundLocktime: currentBlock + 288,
  network: 'testnet'
});

// After Lightning payment settles, claim the ordinal
const claimTx = buildClaimTransaction({
  swapAddress: swap.address,
  preimage,
  buyerPrivkey,
  destinationAddress: 'tb1q...'
});
```

---

## Security Model

### Trust Assumptions

| Component | Trust Level | Rationale |
|-----------|-------------|-----------|
| Bitcoin Network | Trustless | Consensus-enforced settlement |
| Lightning Network | Trustless | HTLC atomicity guarantees |
| Nostr Relays | Untrusted | Message transport only |
| Wallet Extensions | Minimal | Signing only, no key custody |

### Security Properties

- **No Private Keys**: Protocol never handles or stores private keys
- **Atomic Settlement**: HTLCs ensure all-or-nothing trade execution
- **Timeout Protection**: Refund paths activate after locktime expiry
- **Censorship Resistance**: Multiple relay fallbacks prevent blocking

### Known Limitations

> **Free Option Problem**: Between ordinal deposit and Lightning payment, the buyer holds a "free option" on price movement. Mitigated by short timelock windows (48 hours recommended).

---

## Development Roadmap

| Phase | Status | Description |
|-------|--------|-------------|
| Foundation | ✅ Complete | Core SDK, atomic swap primitives |
| Hardening | ✅ Complete | Auction engine, indexer, Lightning |
| Security Audit | 🔄 Planned | Professional third-party review |
| Testnet Beta | 🔄 Q2 2025 | Public testnet deployment |
| Mainnet | 🔄 Q3-Q4 2025 | Production release |

---

## Contributing

We welcome contributions from the community.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/improvement`)
3. Run tests (`npm test`)
4. Submit a pull request

Please read our contribution guidelines before submitting PRs.

---

## License

- **Source Code**: [MIT License](LICENSE)
- **Documentation**: CC0 1.0 Universal (Public Domain)

---

## Contact

<table>
  <tr>
    <td><strong>Website</strong></td>
    <td><a href="https://sparkleprotocol.com">sparkleprotocol.com</a></td>
  </tr>
  <tr>
    <td><strong>Email</strong></td>
    <td><a href="mailto:sparkle@sparkleprotocol.com">sparkle@sparkleprotocol.com</a></td>
  </tr>
  <tr>
    <td><strong>GitHub</strong></td>
    <td><a href="https://github.com/ProtocolSparkle/Sparkles-Protocol">ProtocolSparkle/Sparkles-Protocol</a></td>
  </tr>
  <tr>
    <td><strong>X / Twitter</strong></td>
    <td><a href="https://x.com/SparkleProtocol">@SparkleProtocol</a></td>
  </tr>
</table>

---

<p align="center">
  <strong>Sparkle Protocol v0.3.0</strong><br>
  <em>Created by David A. Michael</em><br>
  <sub>Trustless. Serverless. Permissionless.</sub>
</p>
