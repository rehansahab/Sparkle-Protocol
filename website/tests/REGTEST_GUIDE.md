# Sparkle Protocol Regtest Testing Guide

Complete guide to test Taproot atomic swaps on Bitcoin regtest.

## Prerequisites

1. **Bitcoin Core 24.0+** (with Taproot support)
   - Download: https://bitcoincore.org/en/download/
   - Or use: `choco install bitcoin-core` (Windows)

2. **Node.js 18+** for validation scripts

---

## Step 1: Start Bitcoin Core in Regtest Mode

### Windows (PowerShell)
```powershell
# Create data directory
mkdir C:\bitcoin-regtest

# Start bitcoind in regtest mode
bitcoind -regtest -daemon -datadir=C:\bitcoin-regtest -server -rpcuser=YOUR_USERNAME -rpcpassword=YOUR_PASSWORD

# Wait 2-3 seconds for startup
Start-Sleep -Seconds 3
```

### Linux/Mac
```bash
mkdir ~/.bitcoin-regtest
bitcoind -regtest -daemon -datadir=~/.bitcoin-regtest -server -rpcuser=YOUR_USERNAME -rpcpassword=YOUR_PASSWORD
sleep 3
```

---

## Step 2: Create Wallet & Generate Coins

```bash
# Create a wallet
bitcoin-cli -regtest -rpcuser=YOUR_USERNAME -rpcpassword=YOUR_PASSWORD createwallet "sparkle_test"

# Generate 101 blocks (coins mature after 100 confirmations)
bitcoin-cli -regtest -rpcuser=YOUR_USERNAME -rpcpassword=YOUR_PASSWORD -generate 101

# Check balance (should be 50 BTC from first block)
bitcoin-cli -regtest -rpcuser=YOUR_USERNAME -rpcpassword=YOUR_PASSWORD getbalance
```

---

## Step 3: Get Test Addresses

```bash
# Get a bech32m (Taproot) address for receiving change
bitcoin-cli -regtest -rpcuser=YOUR_USERNAME -rpcpassword=YOUR_PASSWORD getnewaddress "change" "bech32m"

# Get a legacy address for comparison
bitcoin-cli -regtest -rpcuser=YOUR_USERNAME -rpcpassword=YOUR_PASSWORD getnewaddress "legacy" "legacy"
```

Save these addresses - you'll need them.

---

## Step 4: Create Sparkle Taproot Address

Use the test vectors from `taproot_vector.json`:

```
Internal Key (NUMS): 50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0
Payment Hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
Preimage: 0000000000000000000000000000000000000000000000000000000000000000
```

Run the Taproot derivation script to get the address:

```bash
cd tests
node derive-taproot-address.js
```

This will output the regtest Taproot address (bcrt1p...).

---

## Step 5: Fund the Taproot Address

```bash
# Send 0.001 BTC (100,000 sats) to the Taproot address
bitcoin-cli -regtest -rpcuser=YOUR_USERNAME -rpcpassword=YOUR_PASSWORD sendtoaddress "bcrt1p[YOUR_TAPROOT_ADDRESS]" 0.001

# Mine a block to confirm
bitcoin-cli -regtest -rpcuser=YOUR_USERNAME -rpcpassword=YOUR_PASSWORD -generate 1

# Get the txid and vout
bitcoin-cli -regtest -rpcuser=YOUR_USERNAME -rpcpassword=YOUR_PASSWORD listunspent 1 9999999 '["bcrt1p[YOUR_TAPROOT_ADDRESS]"]'
```

---

## Step 6: Build the Claim PSBT

Update `taproot_vector.json` with the real funding UTXO:
- `txid`: From step 5
- `vout`: From step 5
- `amount_sats`: 100000

Run the PSBT builder:

```bash
node build-claim-psbt.js
```

This outputs:
- PSBT hex
- PSBT base64

---

## Step 7: Analyze the PSBT

```bash
# Decode and analyze
bitcoin-cli -regtest -rpcuser=YOUR_USERNAME -rpcpassword=YOUR_PASSWORD decodepsbt "BASE64_PSBT_HERE"

# Check it's valid structure
bitcoin-cli -regtest -rpcuser=YOUR_USERNAME -rpcpassword=YOUR_PASSWORD analyzepsbt "BASE64_PSBT_HERE"
```

---

## Step 8: Sign the PSBT (Manual for Script-Path)

For Taproot script-path spending, you need to provide:
1. The preimage (for hashlock path)
2. A signature from the buyer's key

Since we're using test keys, we can sign with bitcoinjs-lib:

```bash
node sign-claim-psbt.js
```

---

## Step 9: Finalize and Broadcast

```bash
# Finalize the PSBT
bitcoin-cli -regtest -rpcuser=YOUR_USERNAME -rpcpassword=YOUR_PASSWORD finalizepsbt "SIGNED_PSBT_BASE64"

# Broadcast the transaction
bitcoin-cli -regtest -rpcuser=YOUR_USERNAME -rpcpassword=YOUR_PASSWORD sendrawtransaction "FINAL_TX_HEX"

# Mine a block
bitcoin-cli -regtest -rpcuser=YOUR_USERNAME -rpcpassword=YOUR_PASSWORD -generate 1

# Verify it confirmed
bitcoin-cli -regtest -rpcuser=YOUR_USERNAME -rpcpassword=YOUR_PASSWORD gettransaction "TXID"
```

---

## Step 10: Test Refund Path (Optional)

To test the refund/timeout path:

```bash
# Mine blocks until timeout height is reached
bitcoin-cli -regtest -rpcuser=YOUR_USERNAME -rpcpassword=YOUR_PASSWORD -generate 100

# Build refund PSBT (uses refund script instead of hashlock)
node build-refund-psbt.js

# Sign with seller's key and broadcast
```

---

## Quick Commands Reference

```bash
# Alias for convenience (add to profile)
alias btc="bitcoin-cli -regtest -rpcuser=YOUR_USERNAME -rpcpassword=YOUR_PASSWORD"

# Common commands
btc getblockcount          # Current block height
btc getbalance             # Wallet balance
btc -generate 1            # Mine 1 block
btc listunspent            # List UTXOs
btc getnewaddress "" bech32m  # New Taproot address
btc decodepsbt "..."       # Decode PSBT
btc decoderawtransaction "..." # Decode raw tx
```

---

## Cleanup

```bash
# Stop bitcoind
bitcoin-cli -regtest -rpcuser=YOUR_USERNAME -rpcpassword=YOUR_PASSWORD stop

# Delete regtest data (fresh start)
rm -rf C:\bitcoin-regtest\regtest   # Windows
rm -rf ~/.bitcoin-regtest/regtest   # Linux/Mac
```

---

## Expected Results

| Test | Expected |
|------|----------|
| Taproot address derivation | bcrt1p... matches computed |
| PSBT structure | analyzepsbt returns "next: signer" |
| Hashlock claim | Tx confirms, funds move to buyer |
| Refund claim | After timeout, funds return to seller |

---

## Troubleshooting

**"Connection refused"**
- bitcoind not running, start it first

**"Insufficient funds"**
- Generate more blocks: `-generate 101`

**"Bad signature"**
- Check key matches script pubkey
- Verify preimage hashes to payment_hash

**"Non-final"**
- nSequence must be 0xfffffffd
- Check locktime if using CLTV
