# Sparkle Protocol v0.3.1 - Security Verification Checklist

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
Look for: "Sparkle Swap v0.3.1 - Serverless P2P Trading (Security Hardened)"
Look for: "Security Fixes: Timelock validation, DM sig verification..."
```

- [ ] Version 0.3.1 displayed
- [ ] Security fixes message shown

---

## Test 2: Network Mismatch Blocking

**Setup:** Connect Bitcoin wallet on WRONG network (mainnet if app expects testnet)

**Expected:**
1. Red warning banner: "NETWORK MISMATCH - ACTIONS BLOCKED"
2. Trying to initiate swap shows: "BLOCKED: Network mismatch..."

- [ ] Warning banner appears with "ACTIONS BLOCKED"
- [ ] Swap initiation is blocked
- [ ] Claim action is blocked

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

## Test 8: Console Security Markers

**Search in sparkle-swap.js for "SECURITY:"**

```
Expected: 40+ security comments marking critical code paths
```

- [ ] Security markers present throughout code

---

## Quick Smoke Test Commands (Console)

Paste these in browser console after connecting wallet:

```javascript
// Check version
console.log('Version check:', document.title.includes('v0.3.1'));

// Check network mismatch flag exists
console.log('Network mismatch tracking:', 'networkMismatch' in state);

// Check replay protection exists
console.log('Replay protection:', state.seenEventIds instanceof Set);

// Check validation functions exist
console.log('validateSwapParameters:', typeof validateSwapParameters === 'function');
console.log('validateIncomingDM:', typeof validateIncomingDM === 'function');
console.log('verifyPreimage:', typeof verifyPreimage === 'function');
console.log('getCurrentBlockHeight:', typeof getCurrentBlockHeight === 'function');
```

**Expected:** All should return `true`

---

## Post-Test Verification

- [ ] No JavaScript errors in console (red text)
- [ ] All expected functions exist
- [ ] Network blocking works
- [ ] Version is 0.3.1

---

## Report Issues

If any test fails, document:
1. Which test failed
2. Expected vs actual behavior
3. Console errors (if any)
4. Browser and version

Report at: https://github.com/ProtocolSparkle/Sparkle-Protocol/issues
