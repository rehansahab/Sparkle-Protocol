# Changelog

All notable changes to Sparkle Protocol will be documented in this file.

## [1.0.0] - 2025-12-14

### Mainnet Validated Release

This release marks the first production-proven version of Sparkle Protocol, validated with a successful atomic swap on Bitcoin mainnet.

### Mainnet Proof
- **Lock TX**: [a3c6b08ed820194ee...](https://mempool.space/tx/a3c6b08ed820194ee3274a3eae945071c2ed33105b41db207cd16c9661de28a7)
- **Sweep TX**: [9422e6cb358295d86...](https://mempool.space/tx/9422e6cb358295d86ad6d73bc0566c869aa0be8290c60598be205f4eea9ce50b)

### Features
- **Sparkle Swap**: Trustless atomic swaps using Taproot hashlock/timelock scripts
- **Lightning Integration**: BOLT11 invoice decoding and payment hash verification
- **Wallet Adapters**: Support for Unisat, Xverse, and Alby wallets
- **Settlement Watcher**: Automatic preimage detection and settlement
- **Ghost Desk**: Private messaging via Nostr gift wrapping (NIP-59)
- **Safety Gates**: Comprehensive validation before transaction broadcast
- **Test Vectors**: Full test suite with cryptographic verification

### SDK Exports
- Core swap primitives (`createSparkleSwapAddress`, `buildClaimTransaction`, `buildRefundTransaction`)
- Provider interfaces (Indexer, Signer, Wallet, Lightning, Nostr)
- Safety validation (`validateOffer`, `calculateMinimumSafeTimelock`)
- PSBT construction (`constructSweepPsbt`, `finalizeSweepWithPreimage`)
- High-level SDK (`SparkleSDK`, `createSparkleSDK`)

### Security
- Taproot script-path spending (BIP-341)
- SHA256 hashlocks bound to Lightning payment hashes
- CLTV timelocks for seller refund protection
- No private key exposure in browser

## [0.3.0] - 2025-12-01

### Pre-release
- Initial TypeScript SDK implementation
- Core Taproot script generation
- Basic claim/refund transaction builders
- Test suite foundation

---

For more details, see the [GitHub repository](https://github.com/ProtocolSparkle/Sparkle-Protocol).
