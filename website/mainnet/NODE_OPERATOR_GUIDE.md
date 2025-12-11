# SPARKLE Protocol - Node Operator Testing Guide

## For AI/Operator with Access to Bitcoin Core & Lightning Nodes

This guide is for testing SPARKLE Protocol mainnet deployment with real nodes.

---

## Prerequisites Check

### 1. Verify Bitcoin Core is Running
```bash
bitcoin-cli getblockchaininfo
```
Expected: Returns blockchain info with `"chain": "main"` for mainnet

### 2. Verify Lightning Node (if testing atomic swaps)
```bash
# For LND
lncli getinfo

# For CLN (Core Lightning)
lightning-cli getinfo
```

### 3. Verify Wallet Balance
```bash
bitcoin-cli getbalance
```

---

## Test Scenario 1: Mainnet Contract Creation (No Funds Required)

### Step 1: Navigate to mainnet folder
```bash
cd /path/to/hostinger-deploy/mainnet
# Or on Windows:
cd C:\Users\sk84l\Downloads\PROTOCOL UPDATE\hostinger-deploy\mainnet
```

### Step 2: Install dependencies
```bash
npm install
```

### Step 3: Create a test contract with known keys
```bash
node sparkle-mainnet.js create \
  79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798 \
  c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5 \
  850000
```

**Parameters:**
- Buyer pubkey: secp256k1 generator point G (for testing only!)
- Seller pubkey: 2*G point
- Timeout: block 850000

### Step 4: Verify the output
- Should generate a `bc1p...` mainnet address
- Should create `contract-*.json` file
- Should show preimage (32 random bytes)

---

## Test Scenario 2: Regtest Full Cycle (Recommended First)

### Step 1: Ensure regtest is running
```bash
bitcoin-cli -regtest getblockchaininfo
```

### Step 2: Generate regtest address for testing
```bash
# Create wallet if needed
bitcoin-cli -regtest createwallet "sparkle_test"

# Get a new address
bitcoin-cli -regtest -rpcwallet=sparkle_test getnewaddress "" bech32m
```

### Step 3: Use the validated regtest test vectors

The following have been **validated end-to-end**:

```
Funding TXID: 0dffff168dd1cd5778953a29717429215d1422b4738779ccc2136ad419cfc474
Spend TXID:   d8f7bcb5108faf9a36a3dc30b45a24fd7c3f8831962db08103fa556c2c030d1e
Status:       CONFIRMED ✅
```

### Step 4: Create new regtest contract
```bash
# Modify sparkle-mainnet.js to use 'bcrt' prefix for regtest
# Or use the tests/derive-taproot-address.js script
cd ../tests
node derive-taproot-address.js
```

### Step 5: Fund the regtest Taproot address
```bash
# Mine some blocks to get coins
bitcoin-cli -regtest -generate 101

# Send to the Taproot address
bitcoin-cli -regtest -rpcwallet=sparkle_test sendtoaddress "bcrt1p..." 0.001

# Mine to confirm
bitcoin-cli -regtest -generate 1
```

### Step 6: Build and broadcast claim PSBT
```bash
# Get the funding txid
bitcoin-cli -regtest -rpcwallet=sparkle_test listtransactions

# Build the PSBT
node build-claim-psbt.js

# The PSBT base64 will be output
```

---

## Test Scenario 3: Testnet (Public Network, Free Coins)

### Step 1: Get testnet coins
Visit a testnet faucet:
- https://testnet-faucet.mempool.co/
- https://bitcoinfaucet.uo1.net/
- https://coinfaucet.eu/en/btc-testnet/

### Step 2: Create testnet contract
```bash
# Use tb1p... addresses (testnet bech32m)
# Modify CONFIG.hrp = 'tb' in sparkle-mainnet.js
node sparkle-mainnet.js create <buyer_pubkey> <seller_pubkey>
```

### Step 3: Fund and test
Same flow as mainnet but with testnet coins.

---

## Test Scenario 4: Mainnet (REAL BITCOIN - CAUTION!)

### ⚠️ WARNING: This uses real Bitcoin. Start with small amounts!

### Step 1: Generate real keys
```bash
# Generate buyer key (you control this)
bitcoin-cli getnewaddress "" bech32m
bitcoin-cli getaddressinfo <address>
# Use the 'pubkey' field (remove 02/03 prefix for x-only)

# Or use a hardware wallet for better security
```

### Step 2: Create mainnet contract
```bash
node sparkle-mainnet.js create <your_buyer_pubkey> <counterparty_seller_pubkey> 1008
```

### Step 3: Verify the address before funding
```bash
# Decode and verify
bitcoin-cli decodescript "5120<output_key>"
```

### Step 4: Fund with small amount first
```bash
# Send minimal amount (e.g., 10000 sats)
bitcoin-cli -rpcwallet=<wallet> sendtoaddress "bc1p..." 0.0001
```

### Step 5: Wait for confirmations
```bash
# Check transaction status
bitcoin-cli getrawtransaction <txid> true
```

### Step 6: Build claim PSBT
```bash
node sparkle-mainnet.js claim contract.json <funding_txid> <vout> <amount_sats> <destination_address>
```

### Step 7: Sign the PSBT
```bash
# Decode first to verify
bitcoin-cli decodepsbt "<psbt_base64>"

# Analyze
bitcoin-cli analyzepsbt "<psbt_base64>"

# Sign (if key is in wallet)
bitcoin-cli walletprocesspsbt "<psbt_base64>"

# Finalize
bitcoin-cli finalizepsbt "<signed_psbt>"
```

### Step 8: Broadcast
```bash
bitcoin-cli sendrawtransaction "<final_hex>"
```

---

## Validation Commands

### Verify PSBT Structure
```bash
bitcoin-cli decodepsbt "<base64>" | jq '.inputs[0]'
```

Expected fields:
- `witness_utxo`: Present with correct amount
- `tap_internal_key`: 50929b74c1a04954... (NUMS)
- `tap_merkle_root`: Present
- `tap_scripts`: Contains hashlock script with control block

### Verify Taproot Address
```bash
# Get scriptPubKey
bitcoin-cli getaddressinfo "bc1p..."

# Should show:
# - scriptPubKey starting with 5120
# - witness_version: 1
# - witness_program: <output_key>
```

### Verify Transaction After Broadcast
```bash
bitcoin-cli getrawtransaction <txid> true | jq '.vout'
```

---

## Troubleshooting

### "Insufficient funds"
```bash
bitcoin-cli getbalance
bitcoin-cli listunspent
```

### "PSBT not fully signed"
- Ensure the signing key is in the wallet
- For script-path spends, may need manual witness construction

### "Non-mandatory-script-verify-flag"
- Script execution failed
- Check preimage is correct: `SHA256(preimage) == payment_hash`
- Check signature is valid for the buyer pubkey

### "Dust output"
- Output amount too low (< 330 sats for P2TR)
- Increase amount or decrease fee

### RBF bump fee
```bash
bitcoin-cli bumpfee <txid>
```

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `mainnet/sparkle-mainnet.js` | Main CLI tool |
| `mainnet/contract-*.json` | Generated contract data |
| `tests/taproot_vector.json` | Validated test vectors |
| `tests/derived-taproot.json` | Computed derivation data |
| `tests/claim-psbt.json` | Generated PSBT |

---

## Expected Test Results

### Regtest (Already Validated ✅)
```
Funding TX: 0dffff168dd1cd5778953a29717429215d1422b4738779ccc2136ad419cfc474
Spend TX:   d8f7bcb5108faf9a36a3dc30b45a24fd7c3f8831962db08103fa556c2c030d1e
Amount:     99,500 sats received at destination
Status:     CONFIRMED
```

### Testnet (Pending)
```
Status: Not yet tested
Action: Fund tb1p... address and complete spend cycle
```

### Mainnet (Pending)
```
Status: Not yet tested
Action: Start with small amount (10k-50k sats) for initial test
```

---

## Report Template

After testing, please report:

```
## SPARKLE Protocol Test Report

**Network:** [regtest/testnet/mainnet]
**Date:** YYYY-MM-DD

### Contract Creation
- [ ] sparkle-mainnet.js runs without errors
- [ ] bc1p.../tb1p.../bcrt1p... address generated
- [ ] contract.json saved correctly

### Funding
- Funding TXID:
- Amount: sats
- Confirmations:

### PSBT Generation
- [ ] decodepsbt succeeds
- [ ] analyzepsbt shows no errors
- TAP_LEAF_SCRIPT present: [yes/no]
- TAP_INTERNAL_KEY present: [yes/no]

### Spend
- Spend TXID:
- Destination received: sats
- [ ] Transaction confirmed

### Issues Found
-

### Conclusion
- [ ] PASSED
- [ ] FAILED (reason: )
```

---

## Contact

Report issues or results to the main conversation.

**SPARKLE Protocol v0.3.8 - Mainnet Ready**
