# SPARKLE Protocol - Signet-First Testing Strategy

**Professional Approach:** Validate everything on Signet (free), then one mainnet proof.

---

## Why Signet First?

| Network | Cost | Risk | Proof Value |
|---------|------|------|-------------|
| Signet | Free | None | Validates all mechanics |
| Testnet3 | Free | Unreliable (spam/reorgs) | Limited |
| **Mainnet** | €150-200 | Real money | Final proof |

**Strategy:** Complete full E2E on Signet → One documented Mainnet swap

---

## Phase 1: Signet Setup (30 minutes)

### 1.1 Configure Bitcoin Core for Signet

Add to `bitcoin.conf`:
```ini
# Signet Configuration
signet=1
[signet]
rpcport=38332
rpcuser=sparkle
rpcpassword=sparkletest2024

# Optional: Use default signet
signetchallenge=
```

Restart Bitcoin Core:
```bash
bitcoind -signet -daemon
```

Verify:
```bash
bitcoin-cli -signet getblockchaininfo
# Should show: "chain": "signet"
```

### 1.2 Configure LND for Signet

Add to `lnd.conf`:
```ini
[Bitcoin]
bitcoin.active=true
bitcoin.signet=true
bitcoin.node=bitcoind

[Bitcoind]
bitcoind.rpchost=127.0.0.1:38332
bitcoind.rpcuser=sparkle
bitcoind.rpcpass=sparkletest2024
bitcoind.zmqpubrawblock=tcp://127.0.0.1:28332
bitcoind.zmqpubrawtx=tcp://127.0.0.1:28333

[routerrpc]
routerrpc.active=true
```

Start LND:
```bash
lnd --bitcoin.signet
```

Create wallet:
```bash
lncli --network=signet create
# Save the seed phrase!
```

### 1.3 Get Signet Coins (FREE)

**Option A: Signet Faucet**
```bash
# Get your address
lncli --network=signet newaddress p2tr

# Visit faucet
# https://signetfaucet.com
# https://alt.signetfaucet.com
# Paste address, get coins
```

**Option B: Mine Signet Blocks (if faucet is down)**
```bash
# Signet allows CPU mining for testing
bitcoin-cli -signet generatetoaddress 1 <your_address>
```

### 1.4 Configure ord for Signet

```bash
# Create ord signet wallet
ord --signet wallet create

# Get address for inscription
ord --signet wallet receive
```

---

## Phase 2: Create Test Inscription (15 minutes)

### 2.1 Create Test Content

```bash
# Create a simple test inscription
echo '{"p":"sparkle","v":"1.2","test":"signet","timestamp":"'$(date -Iseconds)'"}' > /tmp/sparkle-test.json
```

### 2.2 Inscribe on Signet

```bash
# Check you have enough sats (need ~10,000 for inscription + fees)
ord --signet wallet balance

# Inscribe
ord --signet wallet inscribe \
  --file /tmp/sparkle-test.json \
  --fee-rate 1 \
  --destination $(ord --signet wallet receive)

# Wait for confirmation (~10 min on signet)
# Get inscription ID
ord --signet wallet inscriptions
```

**RECORD:**
- `INSCRIPTION_ID`: ________________________________

---

## Phase 3: Open Lightning Channel (20 minutes)

### 3.1 Find a Signet Peer

Known Signet Lightning nodes:
```
# ACINQ Signet Node
03a78d60ff8f3a5eb6096e08c5c3a03f7e26c2ae973f040ac30f33ddbeb5a88ca2@54.89.83.135:39735

# If that doesn't work, check:
# https://mempool.space/signet/lightning
```

### 3.2 Connect and Open Channel

```bash
# Connect to peer
lncli --network=signet connect 03a78d60ff8f3a5eb6096e08c5c3a03f7e26c2ae973f040ac30f33ddbeb5a88ca2@54.89.83.135:39735

# Open channel (100,000 sats)
lncli --network=signet openchannel \
  --node_key=03a78d60ff8f3a5eb6096e08c5c3a03f7e26c2ae973f040ac30f33ddbeb5a88ca2 \
  --local_amt=100000 \
  --push_amt=0

# Wait for 3 confirmations (~30 min)
lncli --network=signet pendingchannels
lncli --network=signet listchannels
```

**RECORD:**
- `CHANNEL_POINT`: ________________________________

---

## Phase 4: Execute Full Atomic Swap (30 minutes)

### 4.1 Generate Buyer Preimage

```javascript
// Run: node -e "..."
const crypto = require('crypto');
const preimage = crypto.randomBytes(32);
const hash = crypto.createHash('sha256').update(preimage).digest();
console.log('PREIMAGE:', preimage.toString('hex'));
console.log('PAYMENT_HASH:', hash.toString('hex'));
```

**RECORD:**
- `PREIMAGE`: ________________________________
- `PAYMENT_HASH`: ________________________________

### 4.2 Create Hold Invoice (Seller Side)

```bash
lncli --network=signet addholdinvoice \
  --hash=$PAYMENT_HASH \
  --amt=10000 \
  --memo="SPARKLE Signet Test"
```

**RECORD:**
- `BOLT11`: lntbs________________________________

### 4.3 Generate Lock Address

```javascript
// Using sparkle-swap.js
const sparkle = require('./mainnet/sparkle-swap.js');

const lockData = sparkle.generateLockAddress({
  buyerPubkey: 'BUYER_XONLY_PUBKEY',
  sellerPubkey: 'SELLER_XONLY_PUBKEY',
  paymentHash: 'PAYMENT_HASH',
  timelock: CURRENT_HEIGHT + 144,
  network: 'signet'  // Note: signet uses tb1p prefix like testnet
});

console.log('Lock address data:', JSON.stringify(lockData, null, 2));
```

### 4.4 Lock Inscription

```bash
# Send inscription to lock address
ord --signet wallet send \
  --fee-rate 1 \
  $LOCK_ADDRESS \
  $INSCRIPTION_ID

# Wait for confirmation
# Record the TXID
```

**RECORD:**
- `LOCK_TXID`: ________________________________

### 4.5 Pay Hold Invoice (Buyer Side)

```bash
# From a DIFFERENT node (or use keysend simulation)
lncli --network=signet payinvoice $BOLT11

# Check invoice status on seller side
lncli --network=signet lookupinvoice $PAYMENT_HASH
# Should show: "state": "ACCEPTED"
```

### 4.6 Construct Sweep PSBT

```javascript
// Build the sweep transaction
const sweepParams = {
  lockUtxo: {
    txid: 'LOCK_TXID',
    vout: 0,
    value: 546,
    scriptPubKey: '5120...'  // From lock TX output
  },
  fundingUtxo: {
    txid: 'FUNDING_TXID',
    vout: 0,
    value: 10000,
    scriptPubKey: '5120...'
  },
  preimage: 'PREIMAGE_HEX',
  buyerPubkey: 'BUYER_PUBKEY',
  sellerPubkey: 'SELLER_PUBKEY',
  paymentHash: 'PAYMENT_HASH',
  timelock: TIMELOCK_HEIGHT,
  buyerAddress: 'tb1p...buyer',
  changeAddress: 'tb1p...change',
  feeRate: 1,
  network: 'signet'
};

// This requires full PSBT construction (use sparkle-swap.js from website)
```

### 4.7 Sign and Broadcast Sweep

```bash
# Sign PSBT with ord wallet
ord --signet wallet sign --psbt $PSBT_HEX

# Finalize and broadcast
bitcoin-cli -signet finalizepsbt $SIGNED_PSBT
bitcoin-cli -signet sendrawtransaction $RAW_TX
```

**RECORD:**
- `SWEEP_TXID`: ________________________________

### 4.8 Extract Preimage and Settle

```bash
# Get sweep transaction details
bitcoin-cli -signet getrawtransaction $SWEEP_TXID true

# Extract preimage from witness (index 1)
# Verify: SHA256(preimage) == payment_hash

# Settle hold invoice
lncli --network=signet settleinvoice $PREIMAGE_HEX
```

### 4.9 Verify Final State

```bash
# Buyer should have inscription
ord --signet wallet inscriptions

# Seller should have Lightning payment
lncli --network=signet listinvoices | grep $PAYMENT_HASH
# Status should be "SETTLED"
```

---

## Phase 5: Document Signet Proof

### Test Results Template

```
=== SPARKLE PROTOCOL SIGNET VALIDATION ===

Date: ________________
Validator: ________________

INFRASTRUCTURE:
[ ] Bitcoin Core Signet: Block ________
[ ] LND Signet: Synced
[ ] ord Signet: Working
[ ] Lightning Channel: ________ sats

ATOMIC SWAP:
[ ] Preimage generated: ________________
[ ] Payment hash: ________________
[ ] Hold invoice created: lntbs________________
[ ] Inscription locked (txid): ________________
[ ] Invoice paid (state: ACCEPTED)
[ ] Sweep broadcast (txid): ________________
[ ] Preimage extracted from witness
[ ] Invoice settled (state: SETTLED)
[ ] Inscription received by buyer

VERIFICATION LINKS:
- Lock TX: https://mempool.space/signet/tx/________________
- Sweep TX: https://mempool.space/signet/tx/________________

RESULT: [ ] PASS  [ ] FAIL
```

---

## Phase 6: Mainnet Proof (After Signet Success)

Once Signet is validated, repeat with **real money**:

### 6.1 Fund Mainnet LND

```bash
# Get mainnet deposit address
lncli newaddress p2tr

# Send €150-200 worth of BTC (~150,000 sats)
# From exchange or existing wallet
```

### 6.2 Open Mainnet Channel

```bash
# Find a well-connected node (1ML, Amboss)
# Open 100,000 sat channel
lncli openchannel --node_key=<pubkey> --local_amt=100000
```

### 6.3 Execute Same Flow

Repeat Phase 4 steps on mainnet with:
- Real inscription (can be a cheap one)
- Real Lightning payment
- Document all TXIDs

### 6.4 Publish Mainnet Proof

```
MAINNET VALIDATION COMPLETE

Lock TX: https://mempool.space/tx/________________
Sweep TX: https://mempool.space/tx/________________
Lightning: Invoice settled with preimage from on-chain witness

SPARKLE Protocol: PRODUCTION VALIDATED
```

---

## Troubleshooting

### "No route found" for Lightning payment
- Your channel needs inbound liquidity
- Solution: Open channel with `--push_amt` to give peer some sats
- Or use a service like Lightning Loop

### "Hold invoice not supported"
- Ensure `routerrpc.active=true` in lnd.conf
- Restart LND after config change

### "Inscription not found"
- Wait for more confirmations
- Verify ord is synced: `ord --signet server`

### "Timelock not reached" for refund
- Wait for block height to exceed timelock
- Check current height: `bitcoin-cli -signet getblockcount`

---

## Estimated Timeline

| Phase | Duration |
|-------|----------|
| Signet Setup | 30 min |
| Create Inscription | 15 min + confirmation |
| Open Channel | 20 min + 3 confirmations |
| Execute Swap | 30 min |
| Document | 15 min |
| **Total Signet** | **~2 hours** |
| Mainnet (after) | ~1 hour |

---

## Success Criteria

**Signet Validation Complete When:**
1. Inscription locked at Taproot address
2. Hold invoice paid (funds held)
3. Sweep TX reveals preimage in witness
4. Invoice settled with extracted preimage
5. Buyer has inscription, Seller has payment
6. All TXIDs documented

**This proves the protocol works atomically.**
