# Sparkle Protocol - End-to-End Swap Test Script

**Version:** 1.2.1
**Network:** Testnet (signet) first, then Mainnet
**Purpose:** Validate complete atomic swap with Lightning hold invoices

---

## Prerequisites

### Required Node Access
```bash
# Verify you have access to:
bitcoin-cli -testnet getblockchaininfo    # Bitcoin Core
ord --signet wallet balance               # Ord indexer
lncli --network=testnet getinfo           # LND with routerrpc
```

### Required Tools
- Node.js 18+
- @noble/hashes (for SHA256)
- sparkle-swap.js (from this repo)

---

## Test 1: Complete Inverted Preimage Swap

### Step 1.1: Setup Test Wallets

```bash
# Create buyer wallet (if not exists)
ord --signet wallet create buyer-test

# Create seller wallet (if not exists)
ord --signet wallet create seller-test

# Fund seller wallet with testnet BTC
# (Use faucet: https://signetfaucet.com)

# Get seller's address for funding
ord --signet wallet --name seller-test receive
```

### Step 1.2: Inscribe a Test Ordinal (Seller)

```bash
# Create a simple test inscription
echo '{"p":"sparkle","v":"1.2","test":true}' > /tmp/test-inscription.json

# Inscribe it
ord --signet wallet --name seller-test inscribe \
  --file /tmp/test-inscription.json \
  --fee-rate 2

# Wait for confirmation and get inscription ID
ord --signet wallet --name seller-test inscriptions
# Note the INSCRIPTION_ID (format: txid:vout or inscription number)
```

### Step 1.3: Buyer Generates Preimage

```javascript
// Run this in Node.js
const { sha256 } = require('@noble/hashes/sha256');
const { bytesToHex, randomBytes } = require('@noble/hashes/utils');
const crypto = require('crypto');

// Generate 32-byte random preimage
const preimage = crypto.randomBytes(32);
const preimageHex = preimage.toString('hex');

// Compute payment hash
const paymentHash = bytesToHex(sha256(preimage));

console.log('=== BUYER PREIMAGE DATA ===');
console.log('Preimage (KEEP SECRET):', preimageHex);
console.log('Payment Hash (share with seller):', paymentHash);
console.log('');
console.log('SAVE THESE VALUES!');

// Output:
// Preimage: <64 hex chars>
// Payment Hash: <64 hex chars>
```

**RECORD:**
- `PREIMAGE`: ________________________________
- `PAYMENT_HASH`: ________________________________

### Step 1.4: Get Buyer's Public Key

```bash
# Buyer's x-only pubkey (32 bytes)
ord --signet wallet --name buyer-test pubkey
# Or from Bitcoin Core:
bitcoin-cli -testnet getaddressinfo <buyer_address> | jq -r '.pubkey'
```

**RECORD:**
- `BUYER_PUBKEY`: ________________________________

### Step 1.5: Seller Creates Lock Address

```javascript
// seller-create-lock.js
const { generateTaprootAddress } = require('./sparkle-swap.js');

const params = {
  buyerPubkey: 'BUYER_PUBKEY_HERE',           // 32-byte x-only
  sellerPubkey: 'SELLER_PUBKEY_HERE',         // 32-byte x-only
  paymentHash: 'PAYMENT_HASH_HERE',           // From buyer
  timelock: CURRENT_BLOCK_HEIGHT + 144,       // 24 hours
  network: 'testnet'
};

// Get current block height
// bitcoin-cli -testnet getblockcount

const result = generateTaprootAddress(params);
console.log('=== LOCK ADDRESS ===');
console.log('Address:', result.address);
console.log('Hashlock Script:', result.hashlockScript);
console.log('Timelock Script:', result.timelockScript);
console.log('Control Block:', result.controlBlock);
console.log('Internal Key:', result.internalPubkey);
```

**RECORD:**
- `LOCK_ADDRESS`: tb1p________________________________
- `CONTROL_BLOCK`: ________________________________
- `HASHLOCK_SCRIPT`: ________________________________

### Step 1.6: Seller Locks Inscription

```bash
# Send the inscription to the lock address
ord --signet wallet --name seller-test send \
  --fee-rate 2 \
  $LOCK_ADDRESS \
  $INSCRIPTION_ID

# Wait for confirmation (at least 1 block)
# Note the funding TXID
```

**RECORD:**
- `LOCK_TXID`: ________________________________
- `LOCK_VOUT`: 0 (usually)

### Step 1.7: Verify Lock UTXO

```bash
# Confirm the inscription is at the lock address
ord --signet wallet --name seller-test inscriptions

# Verify UTXO exists
bitcoin-cli -testnet gettxout $LOCK_TXID $LOCK_VOUT
```

### Step 1.8: Seller Creates Hold Invoice

```bash
# Using LND routerrpc to create hold invoice
# The payment hash MUST match the buyer's hash

lncli --network=testnet addholdinvoice \
  --hash=$PAYMENT_HASH \
  --amt=10000 \
  --memo="Sparkle Swap Test - Inscription $INSCRIPTION_ID"

# This returns a BOLT11 invoice
# Note: Standard lncli may not support hold invoices
# You may need to use the gRPC API directly:

# Alternative using gRPC:
# grpcurl -d '{
#   "hash": "<payment_hash_bytes>",
#   "value": 10000,
#   "memo": "Sparkle Swap Test"
# }' localhost:10009 routerrpc.Router.AddHoldInvoice
```

**RECORD:**
- `BOLT11_INVOICE`: lntb________________________________

### Step 1.9: Buyer Pays Hold Invoice

```bash
# Buyer pays the invoice (funds are HELD, not settled)
lncli --network=testnet payinvoice $BOLT11_INVOICE

# Check payment status - should show "IN_FLIGHT" or "ACCEPTED"
lncli --network=testnet listpayments | grep $PAYMENT_HASH
```

### Step 1.10: Buyer Constructs Sweep PSBT

```javascript
// buyer-sweep.js
const { buildTaprootPsbt } = require('./sparkle-swap.js');

const sweepParams = {
  // Lock UTXO (contains the ordinal)
  lockUtxo: {
    txid: 'LOCK_TXID_HERE',
    vout: 0,
    value: 546,  // Inscription sat value
    scriptPubKey: '5120...'  // P2TR scriptPubKey of lock address
  },

  // Funding UTXO (for fees) - from buyer's wallet
  fundingUtxo: {
    txid: 'FUNDING_TXID_HERE',
    vout: 0,
    value: 10000,  // Enough for fees
    scriptPubKey: '5120...'
  },

  // Preimage (THE SECRET!)
  preimage: 'PREIMAGE_HERE',

  // Keys
  buyerPubkey: 'BUYER_PUBKEY_HERE',
  sellerPubkey: 'SELLER_PUBKEY_HERE',

  // Contract params
  paymentHash: 'PAYMENT_HASH_HERE',
  timelock: TIMELOCK_BLOCK_HEIGHT,

  // Destinations
  buyerAddress: 'tb1p...',  // Where ordinal goes
  changeAddress: 'tb1p...', // Change from funding

  // Fees
  feeRate: 2,

  network: 'testnet'
};

const psbt = buildTaprootPsbt(sweepParams);
console.log('=== UNSIGNED PSBT ===');
console.log(psbt.psbtHex);
```

### Step 1.11: Buyer Signs and Broadcasts

```bash
# Sign the funding input (input 1) with wallet
# Input 0 is the contract spend (uses preimage witness, not signature)

# Using ord wallet:
ord --signet wallet --name buyer-test sign --psbt $PSBT_HEX

# Or using Bitcoin Core:
bitcoin-cli -testnet walletprocesspsbt $PSBT_HEX

# Finalize and extract
bitcoin-cli -testnet finalizepsbt $SIGNED_PSBT

# Broadcast
bitcoin-cli -testnet sendrawtransaction $RAW_TX
```

**RECORD:**
- `SWEEP_TXID`: ________________________________

### Step 1.12: Seller Detects Preimage

```bash
# Watch for the lock UTXO to be spent
bitcoin-cli -testnet gettxout $LOCK_TXID $LOCK_VOUT
# Returns null when spent

# Get the spending transaction
bitcoin-cli -testnet getrawtransaction $SWEEP_TXID true

# Extract witness from input 0
# The witness stack for hashlock spend is:
# [0] signature (64 bytes)
# [1] preimage (32 bytes) <-- THIS IS WHAT WE NEED
# [2] script
# [3] control block
```

```javascript
// extract-preimage.js
const { extractPreimageFromWitness } = require('./sparkle-swap.js');

const txHex = 'RAW_TX_HEX_HERE';
const preimage = extractPreimageFromWitness(txHex, 0); // input index 0

console.log('=== EXTRACTED PREIMAGE ===');
console.log('Preimage:', preimage);

// Verify it matches
const { sha256 } = require('@noble/hashes/sha256');
const { bytesToHex, hexToBytes } = require('@noble/hashes/utils');
const computedHash = bytesToHex(sha256(hexToBytes(preimage)));
console.log('Computed Hash:', computedHash);
console.log('Expected Hash:', 'PAYMENT_HASH_HERE');
console.log('Match:', computedHash === 'PAYMENT_HASH_HERE');
```

### Step 1.13: Seller Settles Hold Invoice

```bash
# Convert preimage to base64 for lncli
PREIMAGE_B64=$(echo -n $PREIMAGE_HEX | xxd -r -p | base64)

# Settle the hold invoice
lncli --network=testnet settleinvoice $PREIMAGE_B64

# Or using gRPC:
# grpcurl -d '{
#   "preimage": "<preimage_bytes>"
# }' localhost:10009 routerrpc.Router.SettleInvoice

# Verify invoice is settled
lncli --network=testnet listinvoices | grep $PAYMENT_HASH
# Status should be "SETTLED"
```

### Step 1.14: Verify Final State

```bash
# BUYER: Verify inscription received
ord --signet wallet --name buyer-test inscriptions
# Should show the inscription at buyer's address

# SELLER: Verify payment received
lncli --network=testnet channelbalance
# Balance should have increased by invoice amount

# BOTH: Verify atomicity
# - Buyer has inscription OR funds returned
# - Seller has payment OR inscription returned
```

---

## Test 2: Refund Path (Seller Reclaims After Timeout)

### Step 2.1: Setup (Same as Test 1, Steps 1.1-1.7)
But use a SHORT timelock: `current_height + 6` (about 1 hour)

### Step 2.2: DO NOT Pay Invoice
Buyer intentionally does not pay.

### Step 2.3: Wait for Timelock

```bash
# Monitor block height
bitcoin-cli -testnet getblockcount

# Wait until height > timelock
```

### Step 2.4: Seller Broadcasts Refund

```javascript
// seller-refund.js
const { buildRefundPsbt } = require('./sparkle-swap.js');

const refundParams = {
  lockUtxo: { txid: 'LOCK_TXID', vout: 0, value: 546 },
  sellerPubkey: 'SELLER_PUBKEY',
  sellerAddress: 'tb1p...',  // Where to return inscription
  timelock: TIMELOCK_HEIGHT,
  timelockScript: 'TIMELOCK_SCRIPT',
  controlBlock: 'CONTROL_BLOCK',
  feeRate: 2,
  network: 'testnet'
};

const psbt = buildRefundPsbt(refundParams);
console.log(psbt.psbtHex);
```

```bash
# Sign and broadcast refund
ord --signet wallet --name seller-test sign --psbt $REFUND_PSBT
bitcoin-cli -testnet sendrawtransaction $SIGNED_REFUND_TX
```

### Step 2.5: Verify Refund

```bash
# Inscription should be back with seller
ord --signet wallet --name seller-test inscriptions
```

---

## Test 3: Fee Bumping Under Mempool Congestion

### Step 3.1: Create Swap with LOW Fee Rate

```javascript
// Use fee rate of 1 sat/vB (minimum)
const sweepParams = {
  // ... same as Test 1
  feeRate: 1  // Very low
};
```

### Step 3.2: Broadcast and Observe Stuck TX

```bash
# TX will likely not confirm quickly
bitcoin-cli -testnet getmempoolentry $SWEEP_TXID
# Note the "descendantfees" and "ancestorfees"
```

### Step 3.3: Apply CPFP Bump

```javascript
// cpfp-bump.js
const { createCpfpBump } = require('./sparkle-swap.js');

const cpfpParams = {
  parentTxid: 'SWEEP_TXID',
  parentVout: 1,  // Change output index
  targetFeeRate: 10,  // Higher fee rate
  walletUtxos: [/* buyer's UTXOs */]
};

const cpfpTx = createCpfpBump(cpfpParams);
```

```bash
# Broadcast CPFP child
bitcoin-cli -testnet sendrawtransaction $CPFP_TX

# Both parent and child should confirm together
```

### Step 3.4: Alternative: RBF Bump

```bash
# If original TX was RBF-enabled (nSequence < 0xfffffffe)
# Create replacement with higher fee

bitcoin-cli -testnet bumpfee $SWEEP_TXID '{"fee_rate": 10}'
```

---

## Test Results Template

```
=== SPARKLE PROTOCOL E2E TEST RESULTS ===

Date: ____________
Network: testnet / mainnet
Tester: ____________

TEST 1: Complete Swap
[ ] Buyer generated preimage: ____________
[ ] Payment hash verified: ____________
[ ] Lock address created: tb1p____________
[ ] Inscription locked (txid): ____________
[ ] Hold invoice created: lntb____________
[ ] Buyer paid invoice (status: IN_FLIGHT)
[ ] Sweep PSBT constructed
[ ] Sweep broadcast (txid): ____________
[ ] Preimage extracted from witness: ____________
[ ] Hold invoice settled
[ ] Buyer received inscription: YES / NO
[ ] Seller received payment: YES / NO
[ ] ATOMIC SWAP SUCCESSFUL: YES / NO

TEST 2: Refund Path
[ ] Lock created with short timelock
[ ] Timelock expired at block: ____________
[ ] Refund broadcast (txid): ____________
[ ] Inscription returned to seller: YES / NO

TEST 3: Fee Bumping
[ ] Low-fee TX broadcast (txid): ____________
[ ] CPFP/RBF applied (txid): ____________
[ ] Confirmation achieved: YES / NO
[ ] Time to confirm: ______ blocks

FINAL VERDICT: PASS / FAIL
Notes: ____________________________________________
```

---

## Mainnet Execution

**ONLY after ALL testnet tests pass:**

1. Repeat Test 1 with REAL inscription and REAL sats
2. Use conservative timelock (144+ blocks)
3. Use appropriate fee rate for current mempool
4. Document all TXIDs for proof

**Mainnet Proof Required:**
- Lock TX: `https://mempool.space/tx/<lock_txid>`
- Sweep TX: `https://mempool.space/tx/<sweep_txid>`
- Lightning payment proof (settled invoice)

---

## Troubleshooting

### "Hold invoice not supported"
Your LND may not have `routerrpc` enabled. Check `lnd.conf`:
```
[routerrpc]
routerrpc.active=true
```

### "Inscription not found at lock address"
- Wait for more confirmations
- Verify the inscription was sent to the correct address
- Check `ord` indexer is synced

### "Preimage verification failed"
- Ensure you're extracting witness[1] from input 0
- Verify the preimage is 32 bytes (64 hex chars)
- Check SHA256 computation

### "Sweep TX rejected"
- Verify timelock hasn't expired
- Check control block matches
- Verify witness stack order: [sig, preimage, script, control_block]
