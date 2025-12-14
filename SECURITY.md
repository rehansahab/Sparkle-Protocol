# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Sparkle Protocol, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Email details to: security@sparkleprotocol.com
3. Include steps to reproduce the vulnerability
4. Allow reasonable time for a fix before disclosure

## Scope

This policy covers:
- Protocol specification vulnerabilities
- SDK implementation bugs
- Cryptographic weaknesses

## Security Considerations

### Timelock Selection
- Choose appropriate timelocks based on transaction value
- Minimum recommended: 6 blocks for low-value swaps
- High-value swaps: 24+ blocks

### Preimage Handling
- Never reuse preimages across swaps
- Generate preimages with cryptographically secure random number generators
- Clear preimage data from memory after use

### Key Management
- Never expose private keys in transactions or logs
- Use hardware wallets for high-value operations
- Verify all addresses before broadcasting transactions

## Acknowledgments

We appreciate responsible disclosure and will acknowledge security researchers who help improve the protocol.
