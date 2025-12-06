# Security Policy

## Scope

This security policy covers the **Sparkle Protocol specification** and documentation website. Since no production implementation exists, this policy primarily addresses:

1. Documentation accuracy regarding security claims
2. Website security (XSS, injection, etc.)
3. Example code security in documentation

## Current Security Status

| Aspect | Status |
|--------|--------|
| Protocol Specification | **Unaudited** - Theoretical only |
| Formal Proofs | **Not peer-reviewed** |
| Reference Implementation | **Does not exist** |
| Website Code | Basic XSS protection implemented |
| Dependencies | Standard browser APIs only |

## Important Warnings

### Protocol Security

The Sparkle Protocol specification describes theoretical security properties that have **NOT** been:

- Implemented in production code
- Tested against real attacks
- Audited by security professionals
- Peer-reviewed by cryptographers

**Do not rely on the security claims in this documentation for real economic value.**

### Trust Model

The protocol, if implemented, would have the following trust assumptions:

| Component | Trust Level | Risk |
|-----------|-------------|------|
| Coordinator | Can censor, cannot steal | Liveness risk |
| Lightning Network | Standard LN risks | Routing, channels |
| Bitcoin Network | Trustless | Confirmation times |
| User's Wallet | Full trust required | Key management |

## Known Limitations

### Coordinator Trust

The Sparkle Protocol relies on a coordinator that:
- **CAN** refuse to process trades (censorship)
- **CAN** go offline (liveness failure)
- **CANNOT** steal funds (cryptographic guarantee)

Mitigation: Run your own coordinator or use bonded/reputable coordinators.

### Timing Attacks

Delta-safe timelocks are designed to prevent race conditions, but:
- Network congestion can delay transactions
- Fee market volatility affects confirmation times
- Clock skew between parties could cause issues

### Free Option Problem

Without the premium mechanism, buyers could:
- Lock seller's funds indefinitely
- Wait for price movements before deciding
- Abandon trades at no cost

Mitigation: Non-refundable 1% deposit (specified in protocol).

## Reporting Security Issues

### For Documentation Issues

If you find security-related errors in the documentation:

1. **Do NOT** create a public GitHub issue
2. Email details to the maintainer
3. Allow 90 days for response before public disclosure

### For Website Vulnerabilities

If you find XSS, injection, or other web vulnerabilities:

1. Create a GitHub issue (these don't affect user funds)
2. Or email if you prefer private disclosure

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Suggested fix (if any)

## Security Best Practices for Users

If you experiment with Sparkle Protocol concepts:

### Key Management

- **NEVER** share private keys
- Use dedicated testnet keys for experimentation
- Store keys in hardware wallets for any mainnet activity

### Testnet First

- Always test on Bitcoin testnet first
- Use testnet Lightning nodes
- Never use mainnet until protocol is audited

### Verify Everything

- Check transaction details before signing
- Verify addresses character-by-character
- Don't trust, verify (inspect PSBTs)

## Code Security in Examples

The example code in documentation follows these practices:

### XSS Protection

```javascript
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
```

### Input Validation

All user inputs should be validated:
- Private keys: hex or bech32 format check
- Addresses: format and checksum validation
- Amounts: BigInt for precision, range checks
- Transaction IDs: 64-character hex validation

### No Secrets in Code

- No hardcoded private keys
- No API keys or secrets
- All sensitive data entered by user at runtime

## Dependencies

The website uses minimal dependencies:

| Dependency | Purpose | Risk |
|------------|---------|------|
| NostrTools | Nostr protocol | Well-audited library |
| BitcoinJS | PSBT generation | Industry standard |
| None else | - | Minimal attack surface |

## Future Security Measures

If the protocol is ever implemented:

1. **Independent Security Audit** (~$50,000-100,000)
2. **Bug Bounty Program** (~$25,000 pool)
3. **Formal Verification** where applicable
4. **Testnet Deployment** for 6+ months before mainnet
5. **Gradual Mainnet Rollout** with limits

## Changelog

| Date | Change |
|------|--------|
| 2025-01 | Initial security policy |
| 2025-01 | Added XSS protection to swap-v2.js |
| 2025-01 | Added input validation for PSBT generation |

## Contact

For security concerns:
- GitHub: [ProtocolSparkle/Sparkles-Protocol](https://github.com/ProtocolSparkle/Sparkles-Protocol)
- Create a private security advisory on GitHub

---

*This security policy is for an experimental, unimplemented protocol specification. No security guarantees are made.*
