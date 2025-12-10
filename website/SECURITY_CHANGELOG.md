# Sparkle Protocol Security Changelog

## v0.3.1 (December 2024) - Security Hardening Release

This release addresses all critical and high-priority findings from the independent security review conducted in December 2024.

---

### Critical Fixes

#### 1. Timelock Validation Now Enforced (CVE-CLASS: Time-Bandit Attack)
**Before:** `validateSwapParameters()` was defined but never called - dead code.
**After:** `validateInvoiceTimelock()` is called when invoice received (line 1040). Blocks swap if timelock is unsafe.

```javascript
// Now enforced at invoice receipt
validateInvoiceTimelock(invoice, swap).then(result => {
  if (!result.valid) {
    swap.status = 'SAFETY_BLOCKED';
    toast.error(`SECURITY: ${result.message}`);
  }
});
```

#### 2. DM Signature Verification Added (CVE-CLASS: Message Spoofing)
**Before:** Incoming Nostr DMs were processed without any verification.
**After:** `validateIncomingDM()` checks:
- Signature validity (Schnorr via NostrTools)
- P-tag matches current user
- Timestamp freshness (max 1 hour old)
- Replay protection (event ID tracking)

```javascript
// Validation before processing any DM
const validation = await validateIncomingDM(event);
if (!validation.valid) {
  console.warn(`DM rejected: ${validation.reason}`);
  return;
}
```

#### 3. Script Tree Validation Rebuilt Locally (CVE-CLASS: Backdoor Insertion)
**Before:** `verifyScriptTree()` only checked for substring matches, trusted peer-supplied data.
**After:** Scripts are rebuilt from scratch locally and compared:
- `buildHashlockScript()` reconstructs buyer claim path
- `buildRefundScript()` reconstructs seller refund path
- NUMS internal key verified against known constant
- Block height fetched from trusted source (mempool.space/blockstream.info)

```javascript
// Local script reconstruction
const expectedHashlockScript = buildHashlockScript(paymentHash, buyerPubkey);
if (receivedHashlock !== expectedHashlockScript) {
  return { valid: false, reason: 'Hashlock script mismatch - possible backdoor' };
}
```

#### 4. Claim Flow Enhanced with Real Verification (CVE-CLASS: Value Manipulation)
**Before:** `generateTaprootClaim()` used offer price, not actual UTXO value.
**After:**
- `fetchUtxoValue()` queries indexer for real UTXO amount
- `verifyPreimage()` confirms preimage hashes to payment hash
- Address format validated against expected network
- Script verification required before claim allowed

---

### High-Priority Fixes

#### 5. Network Mismatch Blocks Actions
**Before:** Only showed warning banner, allowed actions to proceed.
**After:** `state.networkMismatch` flag blocks `initiateSwap()` and `generateTaprootClaim()`.

```javascript
if (state.networkMismatch) {
  toast.error('BLOCKED: Network mismatch. Switch wallet to correct network.');
  return;
}
```

#### 6. NIP-65 Relay Discovery Integrated
**Before:** `getEnhancedRelayList()` was defined but not used in subscriptions.
**After:** `subscribeToMarket()` and `subscribeToDMs()` now use discovered relays.

```javascript
// Dynamic relay discovery
activeRelays = await getEnhancedRelayList();
state.subs.offers = state.relayPool.sub(activeRelays, [...]);
```

#### 7. CDN Script Version Pinned
**Before:** nostr-tools loaded without version pinning or integrity check.
**After:** Version locked to 1.17.0 with SRI generation instructions provided.

---

### New Security Functions Added

| Function | Purpose | Location |
|----------|---------|----------|
| `validateIncomingDM()` | Signature, timestamp, replay checks | Line 934 |
| `validateInvoiceTimelock()` | Time-bandit attack prevention | Line 249 |
| `verifyPreimage()` | SHA256 hash verification | Line 1520 |
| `fetchUtxoValue()` | Indexer-based UTXO validation | Line 1553 |
| `getCurrentBlockHeight()` | Trusted block height fetch | Line 181 |
| `buildHashlockScript()` | Local script reconstruction | Line 1233 |
| `buildRefundScript()` | Local script reconstruction | Line 1245 |
| `clearNetworkWarning()` | Network state management | Line 673 |

---

### Security Markers

The codebase now contains **40+ SECURITY comments** marking critical validation points. Search for `SECURITY:` to audit all security-relevant code paths.

---

### Remaining Recommendations

1. **Self-host nostr-tools** - Eliminate CDN dependency entirely
2. **Add bitcoinjs-lib** - Enable real PSBT construction and signing
3. **Add bolt11 library** - Proper Lightning invoice parsing
4. **Unit tests** - Automated testing for security functions
5. **Security audit** - Independent review of v0.3.1 fixes

---

### Verification Checklist

- [ ] Console shows "v0.3.1 - Security Hardened"
- [ ] Network mismatch shows "ACTIONS BLOCKED" message
- [ ] Swap blocked when wallet on wrong network
- [ ] Invoice triggers timelock validation toast
- [ ] Script tree verification shows block count
- [ ] DM from unknown sender logged to console
- [ ] Claim blocked if script not verified

---

**Report Issues:** https://github.com/anthropics/sparkle-protocol/issues
