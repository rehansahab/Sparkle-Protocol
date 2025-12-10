# Sparkle Protocol v0.3.2 - Security Verification Checklist

Use this checklist to verify all security fixes are working correctly.

---

## Pre-Test Setup

- [ ] Open `swap.html` in Chrome/Firefox
- [ ] Open Developer Tools (F12)
- [ ] Go to Console tab
- [ ] Clear console (Ctrl+L)

---

## Test 1: Version Verification

**Expected:** Console shows security-hardened version

```
Look for: "Sparkle Swap v0.3.2 - Serverless P2P Trading (Security Hardened)"
Look for: "v0.3.2 Fixes: BOLT11 parsing, invoice-script binding, UTXO verification..."
Look for: "v0.3.1 Fixes: Timelock validation, DM sig verification..."
```

- [ ] Version 0.3.2 displayed
- [ ] v0.3.2 security fixes message shown
- [ ] v0.3.1 security fixes message shown

---

## Test 2: Network Mismatch Blocking & Self-Clear

**Setup:** Connect Bitcoin wallet on WRONG network (mainnet if app expects testnet)

**Expected:**
1. Red warning banner: "NETWORK MISMATCH - ACTIONS BLOCKED"
2. Trying to initiate swap shows: "BLOCKED: Network mismatch..."

**NEW in v0.3.2:** Switch wallet to correct network
- Warning should clear automatically
- Actions should become unblocked

- [ ] Warning banner appears with "ACTIONS BLOCKED"
- [ ] Swap initiation is blocked
- [ ] Claim action is blocked
- [ ] Warning clears when wallet switches to correct network (NEW)

---

## Test 3: Wallet Detection

**Expected:** Page shows wallet status on load

- [ ] Nostr wallet detection message shown
- [ ] Bitcoin wallet detection message shown
- [ ] Correct wallet names displayed (Unisat, Xverse, etc.)

---

## Test 4: Relay Connection

**Expected:** After connecting Nostr wallet

```
Console should show:
- "Connected: wss://relay.damus.io"
- "Connected: wss://relay.primal.net"
- Possibly: "NIP-65: Using X relays (Y discovered)"
```

- [ ] Multiple relays connected
- [ ] NIP-65 discovery attempted (may show 0 discovered)
- [ ] Relay status shows "Active (X/Y)"

---

## Test 5: DM Validation (Manual)

**Note:** This requires a real swap negotiation to test fully

**Expected behavior when DM received:**
- Console logs rejection reason if invalid
- Valid DMs processed normally

**Rejection reasons to look for:**
- "Missing required event fields"
- "Duplicate event (replay attack prevention)"
- "Event too old (possible replay attack)"
- "Invalid signature"

- [ ] Understand DM validation is active (check console for any rejections)

---

## Test 6: Script Tree Verification (Simulated)

**If you have an active swap:**
- When script_tree received, should see toast: "Script tree verified! X blocks until timeout"

**Rejection cases would show:**
- "SECURITY ALERT: Script Mismatch"
- Specific reason (e.g., "Buyer pubkey does not match your key")

- [ ] Understand script verification is active

---

## Test 7: Claim Safety Gates

**When attempting to claim (with active swap):**

1. **Script not verified:** "BLOCKED: Script tree has not been verified"
2. **Timelock not validated:** "BLOCKED: Timelock safety has not been validated"
3. **Network mismatch:** "BLOCKED: Network mismatch..."
4. **Invalid preimage:** "SECURITY: Preimage does not match payment hash!"
5. **Wrong address format:** "BLOCKED: Address does not match [network] format"

- [ ] Understand claim requires multiple validations

---

## Test 8: Funding UTXO Verification (NEW in v0.3.2)

**When txid received from counterparty:**

1. Status should show "VERIFYING_FUNDING" initially
2. Console shows: "SECURITY: Verifying funding UTXO..."
3. If UTXO doesn't exist: "Cannot verify funding: UTXO not found"
4. If address mismatch: "CRITICAL: Funding UTXO address mismatch!"
5. If insufficient confirmations: "Insufficient confirmations..."
6. On success: "Funding verified: X sats, Y confirmations"

- [ ] Funding goes through verification state before FUNDED
- [ ] Address mismatch would be caught
- [ ] Confirmation depth is checked

---

## Test 9: Invoice Validation (NEW in v0.3.2)

**When Lightning invoice is received:**

1. BOLT11 invoice is decoded (not just parsed superficially)
2. Payment hash is extracted and validated
3. Invoice expiry is validated
4. Invoice amount is validated against offer price
5. Invoice network matches expected network

**Console should show:**
- "SECURITY: Decoded BOLT11 invoice"
- "Payment hash from invoice: ..."
- Validation errors if any mismatches

- [ ] Invoice parsing extracts real payment_hash
- [ ] Invoice network is validated
- [ ] Invoice amount is validated

---

## Test 10: Console Security Markers

**Search in sparkle-swap.js for "SECURITY:"**

```
Expected: 50+ security comments marking critical code paths
```

- [ ] Security markers present throughout code

---

## Quick Smoke Test Commands (Console)

Paste these in browser console after connecting wallet:

```javascript
// Check version
console.log('Version check:', document.title.includes('v0.3.2'));

// Check network mismatch flag exists
console.log('Network mismatch tracking:', 'networkMismatch' in state);

// Check replay protection exists
console.log('Replay protection:', state.seenEventIds instanceof Set);

// Check validation functions exist
console.log('validateSwapParameters:', typeof validateSwapParameters === 'function');
console.log('validateIncomingDM:', typeof validateIncomingDM === 'function');
console.log('verifyPreimage:', typeof verifyPreimage === 'function');
console.log('getCurrentBlockHeight:', typeof getCurrentBlockHeight === 'function');

// NEW v0.3.2 functions
console.log('decodeLightningInvoice:', typeof decodeLightningInvoice === 'function');
console.log('verifyFundingUtxo:', typeof verifyFundingUtxo === 'function');
console.log('buildTaprootPsbt:', typeof buildTaprootPsbt === 'function');
```

**Expected:** All should return `true`

---

## Post-Test Verification

- [ ] No JavaScript errors in console (red text)
- [ ] All expected functions exist
- [ ] Network blocking works
- [ ] Network warning self-clears on correct network
- [ ] Version is 0.3.2

---

## v0.3.2 Security Fixes Summary

1. **Real BOLT11 Invoice Parsing** - Extracts payment_hash, expiry, amount, network from invoice
2. **Invoice-Script Binding** - Validates invoice payment_hash matches script payment_hash
3. **Funding UTXO Verification** - Verifies UTXO address matches expected Taproot address
4. **Confirmation Depth Check** - Requires minimum confirmations before marking FUNDED
5. **Network Mismatch Self-Clear** - Warning clears automatically on correct network
6. **Enhanced PSBT Framework** - Control block computation, TapLeaf hashing, JSON export

---

## Report Issues

If any test fails, document:
1. Which test failed
2. Expected vs actual behavior
3. Console errors (if any)
4. Browser and version

Report at: https://github.com/ProtocolSparkle/Sparkle-Protocol/issues
