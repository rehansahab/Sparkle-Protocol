# Sparkle Protocol

**Serverless Ordinals OTC - Trustless P2P Trading via Nostr**

[![Status](https://img.shields.io/badge/Status-Testnet%20Ready-green)](https://sparkleprotocol.com)
[![Version](https://img.shields.io/badge/Version-0.3.0-blue)](https://sparkleprotocol.com/changelog.html)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

## Overview

Sparkle Protocol enables **trustless atomic swaps for Bitcoin Ordinals** using Lightning Network payments. Trade securely without middlemen, accounts, or exposing private keys.

> **Testnet Ready**: The protocol is functional on testnet. Mainnet usage requires additional security audits.

## What This Is

- A **working protocol** for trustless ordinal trading via Lightning
- **TypeScript SDK** with Taproot atomic swap primitives (v0.3.0)
- **P2P orderbook** via Nostr relays (no central server)
- **Browser wallet integration** (NIP-07 for Nostr, Unisat/Xverse for Bitcoin)

## Key Features

| Feature | Status |
|---------|--------|
| Taproot Atomic Swaps | ✅ Complete |
| NIP-07 Wallet Integration | ✅ Complete |
| P2P Orderbook (Nostr) | ✅ Complete |
| Pay-to-Bid Auctions | ✅ Complete |
| Inscription Indexer | ✅ Complete |
| Lightning Connectors (LND/CLN) | ✅ Complete |
| Testnet Demo | ✅ Live |

## Quick Links

| Document | Description |
|----------|-------------|
| [Try Demo](https://sparkleprotocol.com/swap.html) | Live testnet swap interface |
| [Whitepaper](https://sparkleprotocol.com/whitepaper.html) | Full protocol specification |
| [Developer SDK](https://sparkleprotocol.com/developer-sdk.html) | Integration guide |
| [Technical Spec](https://sparkleprotocol.com/spec.html) | JSON schemas and SIPs |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Browser Client                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │  NIP-07     │  │   Unisat/   │  │  Sparkle SDK    │  │
│  │  (Nostr)    │  │   Xverse    │  │  (Taproot)      │  │
│  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘  │
└─────────┼────────────────┼──────────────────┼───────────┘
          │                │                  │
          ▼                ▼                  ▼
   ┌────────────┐   ┌────────────┐   ┌────────────────┐
   │   Nostr    │   │  Bitcoin   │   │   Lightning    │
   │   Relays   │   │  Network   │   │   Network      │
   └────────────┘   └────────────┘   └────────────────┘
```

## Project Structure

```
sparkle-protocol/           # TypeScript SDK
├── src/
│   ├── core/               # Taproot swap primitives
│   ├── auction/            # Pay-to-bid auction engine
│   ├── indexer/            # Inscription discovery
│   ├── lightning/          # LND/CLN connectors
│   ├── coordinator/        # WebSocket server (optional)
│   └── browser/            # Wallet integrations
├── tests/                  # Vitest test suite
└── dist/                   # Compiled output

hostinger-deploy/           # Website
├── swap.html               # P2P swap interface
├── sparkle-swap.js         # Frontend logic
├── js/sparkle-browser.js   # Browser SDK bundle
└── ...                     # Documentation pages
```

## Installation

### NPM Package (Coming Soon)
```bash
npm install sparkle-protocol
```

### From Source
```bash
git clone https://github.com/ProtocolSparkle/Sparkles-Protocol.git
cd sparkle-protocol
npm install
npm run build
npm test
```

## Usage

### Browser (Script Tag)
```html
<script src="js/sparkle-browser.js"></script>
<script>
  const { preimage, paymentHash } = SparkleProtocol.generatePreimage();
  const swapAddress = SparkleProtocol.createSparkleSwapAddress({
    buyerPubkey: '...',
    sellerPubkey: '...',
    paymentHash,
    refundLocktime: currentBlock + 288,
    network: 'testnet'
  });
</script>
```

### Node.js / TypeScript
```typescript
import { createSparkleSwapAddress, buildClaimTransaction } from 'sparkle-protocol';

const swap = createSparkleSwapAddress({
  buyerPubkey: buyerKey,
  sellerPubkey: sellerKey,
  paymentHash,
  refundLocktime: currentBlock + 288,
  network: 'testnet'
});
```

## Security

- **No Private Keys**: The protocol NEVER handles private keys
- **NIP-07**: Nostr identity via browser extensions (Alby, nos2x)
- **Unisat/Xverse**: PSBT signing via wallet providers
- **Atomic Settlement**: HTLCs ensure all-or-nothing trades

## Contributing

1. Fork the repository
2. Create a feature branch
3. Run tests: `npm test`
4. Submit a pull request

## License

- **Code**: MIT License
- **Documentation**: CC0 1.0 Universal (Public Domain)

## Contact

- **Website**: [sparkleprotocol.com](https://sparkleprotocol.com)
- **GitHub**: [ProtocolSparkle/Sparkles-Protocol](https://github.com/ProtocolSparkle/Sparkles-Protocol)
- **X/Twitter**: [@SparkleProtocol](https://x.com/SparkleProtocol)

---

*Sparkle Protocol v0.3.0 - Created by David A. Michael*
