# SPARKLE Protocol - Mainnet Deployment Guide

## ⚠️ SECURITY WARNING

**THIS HANDLES REAL BITCOIN. PROCEED WITH EXTREME CAUTION.**

- Start with small amounts to test
- Never share preimages before claiming
- Verify all addresses before funding
- Keep private keys and preimages secure
- Understand the timelock before funding

---

## Prerequisites

```bash
cd mainnet
npm install @noble/secp256k1
```

---

## Quick Start

### Step 1: Create Swap Contract

```bash
node sparkle-mainnet.js create <buyer_pubkey> <seller_pubkey> [timeout_blocks]
```

**Parameters:**
- `buyer_pubkey`: 32-byte x-only pubkey (64 hex chars) - can claim with preimage
- `seller_pubkey`: 32-byte x-only pubkey (64 hex chars) - can refund after timeout
- `timeout_blocks`: Block height for refund (default: 1008 = ~1 week)

**Example:**
```bash
node sparkle-mainnet.js create \
  79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798 \
  c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5 \
  1008
```

**Output:**
- Mainnet Taproot address (`bc1p...`)
- Contract JSON file with all parameters
- **SECRET PREIMAGE** - Keep this safe!

### Step 2: Fund the Taproot Address

Send BTC to the generated `bc1p...` address.

**Recommended:** Wait for 2+ confirmations before claiming.

### Step 3: Build Claim PSBT

```bash
node sparkle-mainnet.js claim <contract.json> <txid> <vout> <amount> <claim_address> [fee_rate]
```

**Parameters:**
- `contract.json`: Contract file from Step 1
- `txid`: Funding transaction ID
- `vout`: Output index (usually 0)
- `amount`: Exact amount in satoshis
- `claim_address`: Where to send the funds
- `fee_rate`: Sat/vB (default: 10, check mempool.space)

**Example:**
```bash
node sparkle-mainnet.js claim \
  contract-1702300000000.json \
  a1b2c3d4e5f6... \
  0 \
  100000 \
  bc1qyouraddress... \
  15
```

### Step 4: Sign and Broadcast

The PSBT needs:
1. **Preimage** added to witness
2. **Schnorr signature** from buyer's key

**Using Bitcoin Core:**
```bash
# Decode to verify
bitcoin-cli decodepsbt "<PSBT_BASE64>"

# If you have the private key in wallet
bitcoin-cli walletprocesspsbt "<PSBT_BASE64>"

# Finalize
bitcoin-cli finalizepsbt "<SIGNED_PSBT>"

# Broadcast
bitcoin-cli sendrawtransaction "<FINAL_HEX>"
```

**Using a wallet (Xverse, Unisat):**
1. Import the PSBT
2. Sign with your key
3. Broadcast

---

## Atomic Swap Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    SPARKLE ATOMIC SWAP                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  SELLER (has Ordinal)              BUYER (has Lightning BTC)   │
│                                                                 │
│  1. ◄─────────── Buyer creates preimage (secret) ───────────   │
│                  payment_hash = SHA256(preimage)                │
│                                                                 │
│  2. Seller creates ──────────────────────────────────────────►  │
│     Taproot address with:                                       │
│     - Hashlock: buyer can claim with preimage                   │
│     - Timelock: seller can refund after N blocks                │
│                                                                 │
│  3. ◄─────────── Buyer funds Taproot address ────────────────   │
│                  (locks BTC for Ordinal)                        │
│                                                                 │
│  4. Seller transfers Ordinal ────────────────────────────────►  │
│     (via inscription transfer)                                  │
│                                                                 │
│  5. ◄─────────── Buyer reveals preimage to claim BTC ────────   │
│                  (unlocks hashlock)                             │
│                                                                 │
│  ════════════════════════════════════════════════════════════   │
│  RESULT: Buyer has Ordinal, Seller has BTC                     │
│  TRUSTLESS: No intermediary needed                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Fee Estimation

Check current fee rates at: https://mempool.space

| Priority | Fee Rate | Confirmation Time |
|----------|----------|-------------------|
| Low      | 1-5 sat/vB | Hours to days |
| Medium   | 10-20 sat/vB | ~1 hour |
| High     | 30-50 sat/vB | Next block |

**Taproot script-path spend:** ~150 vbytes

---

## Security Checklist

- [ ] Using fresh, random preimage (not test vectors)
- [ ] Preimage stored securely and backed up
- [ ] Buyer pubkey is YOUR key (you control private key)
- [ ] Timeout gives enough time to claim
- [ ] Fee rate appropriate for urgency
- [ ] Verified address before funding
- [ ] Started with small test amount first

---

## Troubleshooting

### "Output below dust threshold"
- Increase funding amount or decrease fee rate

### PSBT rejected by wallet
- Verify the PSBT structure with `bitcoin-cli decodepsbt`
- Check wallet supports Taproot script-path spending

### Transaction not confirming
- RBF is enabled (nSequence 0xfffffffd)
- Can bump fee if needed

### Timelock expired before claim
- Seller can now refund using the refund script path
- Buyer should claim BEFORE timeout

---

## Contract File Structure

```json
{
  "network": "mainnet",
  "version": "0.3.8",
  "address": "bc1p...",
  "outputKey": "...",
  "paymentHash": "...",
  "preimage": "KEEP SECRET!",
  "scripts": {
    "hashlock": "...",
    "refund": "..."
  },
  "taproot": {
    "internalKey": "...",
    "merkleRoot": "...",
    "controlBlock": "..."
  },
  "params": {
    "buyerPubkey": "...",
    "sellerPubkey": "...",
    "timeoutBlocks": 1008
  }
}
```

---

## Support

- GitHub: https://github.com/ProtocolSparkle/Sparkle-Protocol
- Issues: Report bugs and questions

---

**SPARKLE Protocol v0.3.8 - Production Ready**
