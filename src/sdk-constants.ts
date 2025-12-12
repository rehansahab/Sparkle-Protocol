/**
 * Sparkle Protocol - SDK Constants
 *
 * FROZEN: These values are part of the Production v1.0 spec.
 * Do not modify without protocol upgrade.
 *
 * @module sparkle-protocol/constants
 * @version 1.0.0-rc.1
 */

// =============================================================================
// CRYPTOGRAPHIC CONSTANTS
// =============================================================================

/**
 * NUMS (Nothing Up My Sleeve) Internal Key
 *
 * Standard: lift_x(SHA256("TaprootNothing"))
 * Used to create unspendable key path, forcing script path execution.
 */
export const NUMS_INTERNAL_KEY =
  '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0';

/**
 * Taproot Leaf Version (BIP-341)
 * 0xC0 is standard for TapScript
 */
export const TAPROOT_LEAF_VERSION = 0xc0;

/**
 * RBF Sequence (BIP-125)
 * Enables Replace-By-Fee for stuck transactions
 */
export const RBF_SEQUENCE = 0xfffffffd;

// =============================================================================
// SAFETY CONSTANTS
// =============================================================================

/**
 * Safety Buffer for Time-Bandit Attack Prevention
 *
 * The Bitcoin timelock must extend beyond Lightning invoice expiry
 * by at least this many blocks to prevent front-running attacks.
 *
 * CRITICAL: 12 blocks is insufficient due to block time variance.
 * Lightning uses Unix time, Bitcoin uses block height. If hashrate
 * spikes, 12 blocks can occur in <60 minutes.
 *
 * Production Spec: 72 blocks (~12 hours) - accounts for extreme variance
 */
export const SAFETY_BUFFER_BLOCKS = 72;

/**
 * Average Bitcoin block time in seconds
 * Used for time/block conversions
 */
export const BLOCK_TIME_SECONDS = 600;

/**
 * Minimum Claim Window
 *
 * Recommended minimum blocks for buyer to claim after payment.
 * Protocol recommends 144 blocks (24 hours) minimum.
 */
export const MIN_CLAIM_WINDOW_BLOCKS = 144;

/**
 * Default Refund Locktime
 *
 * Default blocks until seller can refund (2x claim window = 48 hours)
 */
export const DEFAULT_LOCKTIME_BLOCKS = 288;

// =============================================================================
// AFFILIATE CONSTANTS (HARD LIMITS)
// =============================================================================

/**
 * Maximum number of affiliate outputs
 *
 * Includes: Creator fee + Marketplace fee + Referral (?ref=)
 */
export const MAX_AFFILIATES = 3;

/**
 * Maximum basis points per individual affiliate
 *
 * 500 bps = 5%
 */
export const MAX_AFFILIATE_BPS = 500;

/**
 * Maximum total affiliate basis points
 *
 * 1000 bps = 10%
 */
export const MAX_TOTAL_AFFILIATE_BPS = 1000;

/**
 * Basis points divisor
 */
export const BPS_DIVISOR = 10000;

// =============================================================================
// TRANSACTION CONSTANTS
// =============================================================================

/**
 * Bitcoin dust threshold (satoshis)
 *
 * Outputs below this value are considered dust and may be rejected.
 */
export const DUST_THRESHOLD = 546;

/**
 * Estimated virtual bytes for Sparkle sweep transaction
 *
 * 2 inputs (1 Taproot script path, 1 funding witness)
 * ~3 outputs (ordinal, affiliates, change)
 */
export const ESTIMATED_SWEEP_VBYTES = 250;

/**
 * Minimum relay fee (sats/vB)
 *
 * Transactions below this rate may not propagate
 */
export const MIN_RELAY_FEE = 1;

/**
 * Default fee rate (sats/vB)
 *
 * Conservative default for normal network conditions
 */
export const DEFAULT_FEE_RATE = 10;

/**
 * Ordinal-safe sat value
 *
 * Standard value for Ordinal UTXOs (preserves inscription)
 */
export const ORDINAL_SAT_VALUE = 546;

// =============================================================================
// PROTOCOL VERSION
// =============================================================================

/**
 * Current protocol version
 * v1.2 = Inverted preimage flow (buyer-generated)
 */
export const PROTOCOL_VERSION = '1.2' as const;

/**
 * Supported networks
 */
export const SUPPORTED_NETWORKS = ['mainnet', 'testnet'] as const;

// =============================================================================
// NOSTR CONSTANTS
// =============================================================================

/**
 * Sparkle Offer Event Kind
 *
 * Custom Nostr event kind for Sparkle offers
 */
export const KIND_SPARKLE_OFFER = 8888;

/**
 * NIP-17 Gift Wrap Kind
 *
 * Outer envelope for private messages
 */
export const KIND_GIFT_WRAP = 1059;

/**
 * NIP-17 Seal Kind
 *
 * Middle envelope signed by sender
 */
export const KIND_SEAL = 13;

/**
 * NIP-65 Relay List Metadata Kind
 */
export const KIND_RELAY_LIST = 10002;

/**
 * Default Nostr relays
 */
export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.nostr.band',
] as const;

// =============================================================================
// ERROR CODES
// =============================================================================

export const SAFETY_ERRORS = {
  DELTA_TOO_SMALL: 'DELTA_TOO_SMALL',
  ORDINAL_MISMATCH: 'ORDINAL_MISMATCH',
  VALUE_MISMATCH: 'VALUE_MISMATCH',
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
  FUNDING_MISSING: 'FUNDING_MISSING',
  FUNDING_INSUFFICIENT: 'FUNDING_INSUFFICIENT',
  AFFILIATE_COUNT_EXCEEDED: 'AFFILIATE_COUNT_EXCEEDED',
  AFFILIATE_BPS_EXCEEDED: 'AFFILIATE_BPS_EXCEEDED',
  TOTAL_BPS_EXCEEDED: 'TOTAL_BPS_EXCEEDED',
  OWNERSHIP_MISMATCH: 'OWNERSHIP_MISMATCH',
  INVOICE_EXPIRED: 'INVOICE_EXPIRED',
  INVOICE_HASH_MISMATCH: 'INVOICE_HASH_MISMATCH',
} as const;

export type SafetyError = typeof SAFETY_ERRORS[keyof typeof SAFETY_ERRORS];

// =============================================================================
// FEE BUMPING CONSTANTS (C4 - Confirmation Race Conditions)
// =============================================================================

/**
 * Fee Bumping Thresholds
 *
 * ADDRESSING AUDIT FINDING C4: "Fee-bumping and confirmation race conditions"
 *
 * These constants define when and how to bump transaction fees.
 */

/**
 * Minimum fee bump increment (BIP-125)
 *
 * RBF replacement must pay at least this much more per vByte
 */
export const MIN_RBF_INCREMENT = 1; // sats/vByte

/**
 * Recommended fee bump multiplier
 *
 * When bumping fees, multiply current rate by this factor
 */
export const FEE_BUMP_MULTIPLIER = 1.5;

/**
 * CPFP child transaction estimated vsize
 *
 * A minimal CPFP child spending a P2TR output
 */
export const CPFP_CHILD_VSIZE = 110;

/**
 * Maximum fee rate to prevent overpaying
 *
 * Safety cap to prevent accidentally paying excessive fees
 */
export const MAX_FEE_RATE = 500; // sats/vByte

/**
 * Fee rate urgency thresholds
 *
 * Used to determine when fee bumping is needed
 */
export const FEE_URGENCY_THRESHOLDS = {
  /** Critical: Must confirm within 2 blocks */
  critical: 2,
  /** High: Should confirm within 6 blocks (1 hour) */
  high: 6,
  /** Medium: Should confirm within 12 blocks (2 hours) */
  medium: 12,
  /** Low: Can wait up to 144 blocks (24 hours) */
  low: 144,
} as const;

/**
 * Blocks remaining before timelock that triggers fee bump
 *
 * If fewer than this many blocks remain before timelock expires,
 * aggressively bump fees to ensure confirmation.
 */
export const FEE_BUMP_TRIGGER_BLOCKS = 24;

/**
 * Minimum confirmations before considering a swap "safe"
 *
 * For high-value swaps, wait for more confirmations
 */
export const CONFIRMATION_THRESHOLDS = {
  /** Low value (<100k sats): 1 confirmation sufficient */
  low: 1,
  /** Medium value (100k-1M sats): 2 confirmations recommended */
  medium: 2,
  /** High value (>1M sats): 3+ confirmations recommended */
  high: 3,
} as const;

// =============================================================================
// PRIVACY CONSTANTS (C7 - Privacy Analysis)
// =============================================================================

/**
 * Privacy Configuration Defaults
 *
 * ADDRESSING AUDIT FINDING C7: "Lack of privacy analysis"
 */

/**
 * Default number of blinded hops for invoices
 */
export const DEFAULT_BLINDED_HOPS = 2;

/**
 * Maximum timing jitter for payment correlation prevention
 */
export const MAX_TIMING_JITTER_SECS = 30;

/**
 * Recommended Nostr relays with Tor support
 */
export const TOR_ENABLED_RELAYS = [
  'wss://relay.nostr.bg',
  'wss://nostr.wine',
  'wss://relay.primal.net',
] as const;

// =============================================================================
// SUBMARINE SWAP CONSTANTS (C6 - LN Accessibility)
// =============================================================================

/**
 * Submarine Swap Provider Configuration
 *
 * ADDRESSING AUDIT FINDING C6: "Lightning network requirements and UX"
 */

/**
 * Default submarine swap providers (Boltz-compatible)
 */
export const SUBMARINE_SWAP_PROVIDERS = {
  mainnet: 'https://api.boltz.exchange',
  testnet: 'https://testnet.boltz.exchange',
} as const;

/**
 * Maximum acceptable submarine swap fee (basis points)
 *
 * Warn user if swap provider fee exceeds this
 */
export const MAX_SUBMARINE_SWAP_FEE_BPS = 100; // 1%

/**
 * Submarine swap timeout (blocks)
 *
 * How long before a submarine swap can be refunded
 */
export const SUBMARINE_SWAP_TIMEOUT_BLOCKS = 288; // 48 hours
