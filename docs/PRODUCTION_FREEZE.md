# Sparkle Protocol — Production Freeze Specification v1.0

**Status**: FROZEN
**Version**: 1.0.0-rc.1
**Date**: December 2024
**Author**: David A. Michael

---

## 1. Overview

This document defines the **binding specification** for Sparkle Protocol Production Candidate v1.0. All implementations MUST conform to these rules. Changes require a version bump and formal review.

---

## 2. Core Architecture

### 2.1 The Lightning Pivot

**CRITICAL RULE**: The Seller MUST provide a Hold Invoice from their Lightning node. The application NEVER generates payment hashes.

```
Seller's Node → Hold Invoice → Payment Hash extracted
             → Hash used in Taproot hashlock
             → Buyer pays → Preimage revealed → Ordinal unlocked
```

**Rationale**: This eliminates custodial key management and ensures atomic settlement is guaranteed by Lightning Network infrastructure, not application code.

### 2.2 Sealed Contract Model

All swap contracts are **sealed** — both buyer and seller pubkeys are fixed at creation time:

```typescript
interface SparkleOfferContent {
  v: '1.1';
  network: 'mainnet' | 'testnet';
  asset: {
    txid: string;
    vout: number;
    value: number;
    inscriptionId: string;
  };
  priceSats: number;
  paymentHash: string;       // From Seller's Hold Invoice
  timelock: number;          // Absolute block height
  sellerPubkey: string;      // x-only (32 bytes hex)
  buyerPubkey: string;       // x-only (32 bytes hex) - REQUIRED
  affiliates?: Affiliate[];
}
```

---

## 3. The 5-Point Safety Gate

Every PSBT construction MUST pass ALL five gates. Failure on any gate results in transaction rejection.

### Gate 1: Funding Isolation

```typescript
if (!params.fundingUtxo || !params.fundingUtxo.scriptPubKey) {
  throw new SafetyGateError('GATE_1_FAILED',
    'Funding UTXO missing. Fees must use external funds.');
}
```

**Purpose**: Miner fees come from a separate funding UTXO, NOT the Ordinal UTXO.

### Gate 2: Ordinal Preservation

```typescript
// Output[0].value === Input[0].value
psbt.addOutput({
  address: params.buyerAddress,
  value: params.lockUtxo.value  // EXACT - no fee deduction
});
```

**Purpose**: The Ordinal's satoshi value is preserved exactly. No accidental fee burn.

### Gate 3: Affiliate Compliance

```typescript
const MAX_AFFILIATES = 3;
const MAX_AFFILIATE_BPS = 500;      // 5%
const MAX_TOTAL_AFFILIATE_BPS = 1000; // 10%

if (affiliates.length > MAX_AFFILIATES) throw Error;
if (aff.bps > MAX_AFFILIATE_BPS) throw Error;
if (totalBps > MAX_TOTAL_AFFILIATE_BPS) throw Error;
```

**Purpose**: Prevents fee manipulation and griefing attacks.

### Gate 4: Safety Delta (Time-Bandit Protection)

```typescript
const SAFETY_BUFFER_BLOCKS = 12; // ~2 hours

const estimatedExpiryBlock = currentBlock +
  Math.ceil(secondsToExpiry / 600);
const minimumSafeTimelock = estimatedExpiryBlock + SAFETY_BUFFER_BLOCKS;

if (params.timelock <= minimumSafeTimelock) {
  throw new SafetyGateError('GATE_4_FAILED', 'Unsafe timelock delta');
}
```

**Purpose**: Bitcoin timelock must extend beyond Lightning invoice expiry plus buffer.

### Gate 5: Ownership Verification

```typescript
if (params.lockUtxo.txid !== params.indexerData.txid ||
    params.lockUtxo.vout !== params.indexerData.vout) {
  throw new SafetyGateError('GATE_5_FAILED',
    'Lock UTXO does not match indexer truth');
}
```

**Purpose**: Validates that the claimed Ordinal actually exists at the specified UTXO.

---

## 4. Provider Interfaces

All external I/O MUST go through these four provider interfaces:

### 4.1 IndexerProvider

```typescript
interface IndexerProvider {
  validateOwnership(inscriptionId: string, utxo: UTXO): Promise<boolean>;
  getInscriptionData(inscriptionId: string): Promise<IndexerData>;
  getBlockHeight(): Promise<number>;
  broadcastTx(txHex: string): Promise<string>;
  getTransaction(txid: string): Promise<TxDetails | null>;
  isConfirmed(txid: string, minConfirmations?: number): Promise<boolean>;
}
```

### 4.2 SignerProvider

```typescript
interface SignerProvider {
  getPublicKey(): Promise<string>;
  signEvent(event: NostrEventTemplate): Promise<NostrEvent>;
  encrypt(recipientPubkey: string, content: string): Promise<string>;
  decrypt(senderPubkey: string, ciphertext: string): Promise<string>;
}
```

### 4.3 WalletProvider

```typescript
interface WalletProvider {
  connect(): Promise<string>;
  disconnect(): Promise<void>;
  isConnected(): Promise<boolean>;
  getAddress(): Promise<string>;
  getPublicKey(): Promise<string>;
  getFundingUtxo(amountSats: number): Promise<FundingUTXO>;
  getUtxos(): Promise<UTXO[]>;
  signPsbtInput(psbtHex: string, inputIndex: number): Promise<string>;
  getNetwork(): Promise<'mainnet' | 'testnet'>;
}
```

### 4.4 LightningProvider

```typescript
interface LightningProvider {
  decodeInvoice(invoice: string): Promise<DecodedInvoice>;
  payInvoice(invoice: string): Promise<PaymentResult>;
  isAvailable(): Promise<boolean>;
  enable(): Promise<void>;
}
```

---

## 5. Protocol Constants (FROZEN)

```typescript
// Cryptographic
export const NUMS_INTERNAL_KEY =
  '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0';
export const TAPROOT_LEAF_VERSION = 0xc0;
export const RBF_SEQUENCE = 0xfffffffd;

// Safety
export const SAFETY_BUFFER_BLOCKS = 12;
export const BLOCK_TIME_SECONDS = 600;

// Affiliate Caps
export const MAX_AFFILIATES = 3;
export const MAX_AFFILIATE_BPS = 500;
export const MAX_TOTAL_AFFILIATE_BPS = 1000;
export const BPS_DIVISOR = 10000;

// Transaction
export const DUST_THRESHOLD = 546;
export const ESTIMATED_SWEEP_VBYTES = 250;

// Protocol
export const PROTOCOL_VERSION = '1.1';
```

---

## 6. Ghost Desk (Private OTC)

### 6.1 Encryption Stack

- **NIP-17**: Gift Wrap outer envelope (kind 1059)
- **NIP-44**: XChaCha20-Poly1305 content encryption
- **NIP-59**: Timestamp jitter for anti-correlation

### 6.2 Message Structure

```
Gift Wrap (kind 1059, ephemeral key)
  └── Seal (kind 13, sender's key)
       └── Rumor (unsigned, actual content)
            └── GhostDeskMessage { type, payload, timestamp }
```

### 6.3 Message Types

```typescript
type GhostDeskMessageType =
  | 'offer'    // SparkleOfferContent
  | 'invoice'  // BOLT11 response
  | 'accept'   // Acceptance
  | 'reject'   // Rejection
  | 'message'; // Negotiation
```

---

## 7. Nostr Event Kinds

| Kind | Purpose |
|------|---------|
| 8888 | Sparkle Offer (public) |
| 1059 | Gift Wrap (NIP-17) |
| 13 | Seal (NIP-17) |
| 10002 | Relay List (NIP-65) |

---

## 8. Swap Lifecycle States

```typescript
type SwapState =
  | 'created'   // Offer created
  | 'funded'    // Ordinal locked
  | 'invoiced'  // Invoice published
  | 'paid'      // Preimage revealed
  | 'claimed'   // Buyer claimed
  | 'refunded'  // Seller reclaimed
  | 'expired';  // Timeout without action
```

---

## 9. Error Codes

```typescript
const SAFETY_ERRORS = {
  DELTA_TOO_SMALL: 'DELTA_TOO_SMALL',
  ORDINAL_MISMATCH: 'ORDINAL_MISMATCH',
  VALUE_MISMATCH: 'VALUE_MISMATCH',
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
  FUNDING_MISSING: 'FUNDING_MISSING',
  FUNDING_INSUFFICIENT: 'FUNDING_INSUFFICIENT',
  AFFILIATE_COUNT_EXCEEDED: 'AFFILIATE_COUNT_EXCEEDED',
  AFFILIATE_BPS_EXCEEDED: 'AFFILIATE_BPS_EXCEEDED',
  TOTAL_BPS_EXCEEDED: 'TOTAL_BPS_EXCEEDED',
  OWNERSHIP_MISMATCH: 'OWNERSHIP_MISMATCH',
  INVOICE_EXPIRED: 'INVOICE_EXPIRED',
  INVOICE_HASH_MISMATCH: 'INVOICE_HASH_MISMATCH',
};
```

---

## 10. Compliance Checklist

For an implementation to be considered compliant:

- [ ] Lightning Pivot: App never generates payment hashes
- [ ] Sealed Contracts: buyerPubkey required at creation
- [ ] Gate 1: Funding isolation enforced
- [ ] Gate 2: Ordinal preservation enforced
- [ ] Gate 3: Affiliate caps enforced
- [ ] Gate 4: 12-block safety buffer enforced
- [ ] Gate 5: Indexer verification enforced
- [ ] Providers: All four interfaces implemented
- [ ] Constants: NUMS key and limits match spec
- [ ] Ghost Desk: NIP-17/NIP-44 encryption (if private offers supported)

---

## 11. Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0-rc.1 | Dec 2024 | Initial frozen spec |

---

**END OF SPECIFICATION**
