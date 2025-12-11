<p align="center">
  <a href="https://sparkleprotocol.com">
    <img src="assets/sparkle-logo.png" alt="Sparkle Protocol" width="120" height="120">
  </a>
</p>

<h1 align="center">Sparkle Protocol</h1>

<p align="center">
  <strong>Serverless Ordinals OTC — Trustless P2P Trading via Nostr</strong>
</p>

<p align="center">
  <a href="https://sparkleprotocol.com"><img src="https://img.shields.io/badge/Status-Mainnet%20Validated-brightgreen?style=flat-square" alt="Status"></a>
  <a href="https://sparkleprotocol.com/changelog.html"><img src="https://img.shields.io/badge/Version-0.3.8-blue?style=flat-square" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License"></a>
  <a href="https://github.com/ProtocolSparkle/Sparkles-Protocol"><img src="https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://sparkleprotocol.com"><img src="https://img.shields.io/badge/Bitcoin-Taproot-F7931A?style=flat-square&logo=bitcoin&logoColor=white" alt="Bitcoin"></a>
</p>

<p align="center">
  <a href="https://sparkleprotocol.com/swap.html">Try Demo</a> •
  <a href="https://sparkleprotocol.com/whitepaper.html">Whitepaper</a> •
  <a href="https://sparkleprotocol.com/developer-sdk.html">SDK Docs</a> •
  <a href="https://sparkleprotocol.com/spec.html">Technical Spec</a> •
  <a href="docs/PRODUCTION_FREEZE.md">Frozen Spec</a>
</p>

---

## Abstract

Sparkle Protocol enables **trustless atomic swaps for Bitcoin Ordinals** using Lightning Network payments. Trade inscriptions securely without intermediaries, custodial accounts, or private key exposure. The protocol leverages Taproot script paths with hashlock/timelock conditions to guarantee atomic settlement.

> **Production Candidate v1.0**: Core SDK frozen. Safety gates enforced. See [docs/PRODUCTION_FREEZE.md](docs/PRODUCTION_FREEZE.md).

---

## Production Candidate v1.0 — What Makes Sparkle Different

### The Lightning Pivot (Core Innovation)

**Seller provides Hold Invoice** — the app never generates payment hashes.

```
Seller's Lightning Node → Generates Hold Invoice → Payment Hash extracted
                       → Hash used in Taproot hashlock script
                       → Buyer pays invoice → Preimage revealed → Ordinal unlocked
```

This architectural choice means:
- No custodial key management
- No server-side hash generation
- Atomic settlement guaranteed by Lightning

### The 5-Point Safety Gate

Every PSBT construction **REFUSES** unless ALL gates pass:

| Gate | Check | Purpose |
|------|-------|---------|
| **Gate 1** | Funding UTXO exists | Fees from external funding, not Ordinal |
| **Gate 2** | Output[0] = Input[0] value | Ordinal preservation (no fee burn) |
| **Gate 3** | Affiliates ≤3, each ≤5%, total ≤10% | Anti-griefing caps |
| **Gate 4** | Timelock > InvoiceExpiry + 12 blocks | Time-bandit protection |
| **Gate 5** | Lock UTXO matches Indexer truth | Ownership verification |

### Four Provider Interfaces

Clean separation of concerns — swap pure SDK code, plug your own backends:

```typescript
interface IndexerProvider { }   // Hiro, OrdinalsBot, custom
interface SignerProvider { }    // NIP-07 (Alby, nos2x)
interface WalletProvider { }    // UniSat, Xverse, OKX
interface LightningProvider { } // WebLN, LND REST, CLN
```

### Ghost Desk (Private OTC)

NIP-17 Gift Wrap + NIP-44 XChaCha20-Poly1305 encryption for completely private trades:

- No public offers on relays
- Sender, recipient, content all hidden
- Anti-correlation timestamp jitter

### Affiliate Fee Rail

Protocol-level support for creator royalties and marketplace fees:
- Max 3 affiliates per transaction
- Max 5% (500 bps) per affiliate
- Max 10% (1000 bps) total
- Enforced at PSBT construction (Gate 3)

---

## What Sparkle is NOT

| NOT This | Why |
|----------|-----|
| Custodial escrow | No custody — Taproot scripts enforce settlement |
| Generic PSBT builder | 5-Point Safety Gate prevents unsafe transactions |
| Marketplace with listing fees | P2P via Nostr — no middleman |
| API-dependent service | Serverless — works with any relay/indexer |

---

## Current Status

| Component | Status | Notes |
|-----------|--------|-------|
| **SDK Core** | ✅ Frozen | `src/sdk-*.ts` — types, constants, safety, PSBT |
| **Adapters** | ✅ Complete | `src/adapters/` — Hiro, NIP-07, UniSat, WebLN |
| **Ghost Desk** | ✅ Complete | NIP-17/NIP-44 private messaging |
| **Safety Gates** | ✅ Enforced | All 5 gates implemented |
| **Tests** | ✅ All passing | Core + hardening tests |
| **Mainnet** | ✅ Validated | [Confirmed on-chain](https://mempool.space/tx/1dcbeb24cbdbd60befed91d8ecbf2a067dad3dcc5b1b8d179bb16dfab481e994) |

---

## Repository Structure

```
sparkle-protocol/
├── src/
│   ├── sdk-constants.ts      # Protocol constants (FROZEN)
│   ├── sdk-types.ts          # SparkleOfferContent, providers (FROZEN)
│   ├── sdk-providers.ts      # Indexer/Signer/Wallet/Lightning interfaces
│   ├── sdk-safety.ts         # Pre-payment validation
│   ├── sdk-psbt.ts           # 5-Point Safety Gate PSBT builder
│   ├── sdk-ghost-desk.ts     # NIP-17/NIP-44 private messaging
│   ├── adapters/             # Production provider implementations
│   │   ├── hiro-indexer.ts   # Hiro API adapter
│   │   ├── nip07-signer.ts   # NIP-07 Nostr signer
│   │   ├── unisat-wallet.ts  # UniSat/OKX wallet
│   │   └── webln-lightning.ts# WebLN Lightning adapter
│   ├── core/                 # Legacy Taproot primitives
│   ├── auction/              # Pay-to-bid auction engine
│   ├── indexer/              # Inscription discovery
│   ├── lightning/            # LND/CLN connectors
│   └── browser/              # Legacy wallet integrations
├── docs/
│   └── PRODUCTION_FREEZE.md  # Binding production specification
├── tests/                    # Vitest test suite
└── website/                  # sparkleprotocol.com
```

---

## Quick Start

### Production SDK (Recommended)

```typescript
import {
  SparkleSDK,
  createSparkleSDK,
  validateOffer,
  constructSweepPsbt,
  GhostDesk
} from 'sparkle-protocol';

// Initialize with default adapters
const sdk = createSparkleSDK('testnet');

// Validate offer before payment
const result = await sdk.validateOffer(offer, invoiceExpiryUnix);
if (!result.isValid) {
  console.error('Unsafe offer:', result.errors);
  return;
}

// Construct sweep PSBT (5-Point Safety Gate enforced)
const psbt = await sdk.constructSweepPsbt({
  lockUtxo,
  fundingUtxo,
  buyerPubkey,
  // ... all params validated
});
```

### Custom Providers

```typescript
import {
  SparkleSDK,
  IndexerProvider,
  SignerProvider
} from 'sparkle-protocol';

// Implement your own providers
class MyIndexer implements IndexerProvider {
  async getInscriptionData(id: string) { /* ... */ }
  async getBlockHeight() { /* ... */ }
}

const sdk = new SparkleSDK({
  indexer: new MyIndexer(),
  signer: new MyNip07Signer(),
  wallet: new MyWallet(),
  lightning: new MyLightning(),
  network: 'mainnet'
});
```

---

## Frozen Data Model

```typescript
interface SparkleOfferContent {
  v: '1.1';                           // Protocol version
  network: 'mainnet' | 'testnet';
  asset: {
    txid: string;                     // UTXO containing Ordinal
    vout: number;
    value: number;                    // Sats in UTXO
    inscriptionId: string;
  };
  priceSats: number;                  // Lightning payment amount
  paymentHash: string;                // From Seller's Hold Invoice
  timelock: number;                   // Refund block height
  sellerPubkey: string;               // x-only (32-byte hex)
  buyerPubkey: string;                // x-only (32-byte hex)
  affiliates?: Affiliate[];           // Optional fee outputs
}
```

---

## Security Model

### Trust Assumptions

| Component | Trust Level | Rationale |
|-----------|-------------|-----------|
| Bitcoin Network | Trustless | Consensus-enforced settlement |
| Lightning Network | Trustless | HTLC atomicity guarantees |
| Nostr Relays | Untrusted | Message transport only |
| Indexer APIs | Verified | Gate 5 validates against indexer truth |
| Wallet Extensions | Minimal | Signing only, no key custody |

### Safety Guarantees

- **Ordinal Preservation**: Output[0].value === Input[0].value (Gate 2)
- **Fee Isolation**: Fees from funding UTXO, never from Ordinal (Gate 1)
- **Time-Bandit Protection**: 12-block safety buffer (Gate 4)
- **Affiliate Caps**: Hard limits prevent fee manipulation (Gate 3)
- **Ownership Verification**: Indexer truth check (Gate 5)

---

## Development

```bash
git clone https://github.com/ProtocolSparkle/Sparkles-Protocol.git
cd Sparkles-Protocol
npm install
npm run build
npm test
```

---

## License

- **Source Code**: [MIT License](LICENSE)
- **Documentation**: CC0 1.0 Universal

---

## Contact

| | |
|---|---|
| **Website** | [sparkleprotocol.com](https://sparkleprotocol.com) |
| **GitHub** | [ProtocolSparkle/Sparkle-Protocol](https://github.com/ProtocolSparkle/Sparkle-Protocol) |
| **X / Twitter** | [@SparkleProtocol](https://x.com/SparkleProtocol) |

---

<p align="center">
  <strong>Sparkle Protocol v1.0.0-rc.1</strong><br>
  <em>Created by David A. Michael</em><br>
  <sub>Trustless. Serverless. Permissionless.</sub>
</p>
