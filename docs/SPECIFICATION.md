# SPARKLE Protocol Specification

**Version:** 1.0.0
**Status:** Production Proven (Mainnet Validated)

## Overview

SPARKLE Protocol enables trustless atomic swaps of Bitcoin Ordinals (inscriptions) using Lightning Network payments. The protocol ensures that either both parties receive what they expect, or neither party loses anything.

## Core Mechanism: Sparkle Swap

The Sparkle Swap uses a Taproot address with two spending conditions:

### Spending Paths

1. **Claim Path (Buyer)**: Requires knowledge of the Lightning payment preimage
2. **Refund Path (Seller)**: Available after timelock expiration

### Script Structure

```
Taproot Internal Key: Seller's pubkey

Leaf 1 (Claim): OP_SHA256 <payment_hash> OP_EQUALVERIFY <buyer_pubkey> OP_CHECKSIG
Leaf 2 (Refund): <timelock> OP_CHECKLOCKTIMEVERIFY OP_DROP <seller_pubkey> OP_CHECKSIG
```

## Protocol Flow

### Phase 1: Setup
1. Seller creates Lightning hold invoice with `payment_hash = SHA256(preimage)`
2. Seller constructs Taproot lock address with claim/refund paths
3. Seller locks inscription to the Taproot address
4. Lock transaction confirms on-chain

### Phase 2: Execution
5. Buyer pays Lightning invoice (payment held, not settled)
6. Buyer constructs claim transaction using revealed preimage
7. Buyer broadcasts claim transaction
8. Claim transaction confirms, transferring inscription to buyer
9. Seller settles Lightning invoice, receiving payment

### Phase 3: Refund (if buyer abandons)
- If buyer doesn't pay: Seller waits for timelock, broadcasts refund transaction
- Seller recovers inscription, no payment occurs

## Security Properties

| Property | Guarantee |
|----------|-----------|
| Atomicity | Payment and transfer occur together or not at all |
| Non-custodial | No third party holds funds or inscriptions |
| Trustless | No trust required between buyer and seller |
| Cryptographic binding | SHA256(preimage) = payment_hash |

## Timelock Recommendations

| Use Case | Recommended Timelock |
|----------|---------------------|
| Fast swaps | 6 blocks (~1 hour) |
| Standard | 12 blocks (~2 hours) |
| High-value | 24+ blocks (~4+ hours) |

## Transaction Requirements

### Lock Transaction
- Output: P2TR (Taproot) to swap address
- Must include inscription (ordinal) in first satoshi

### Claim Transaction
- Input: Lock transaction output
- Witness: Signature + Preimage + Claim script
- Output: Buyer's address

### Refund Transaction
- Input: Lock transaction output (after timelock)
- Witness: Signature + Refund script
- nLockTime: Must be >= timelock height
- Output: Seller's address

## References

- [BIP-340: Schnorr Signatures](https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki)
- [BIP-341: Taproot](https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki)
- [BOLT-11: Lightning Invoices](https://github.com/lightning/bolts/blob/master/11-payment-encoding.md)
- [Ordinals Protocol](https://docs.ordinals.com/)
