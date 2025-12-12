/**
 * Sparkle Protocol - SDK Types
 *
 * FROZEN: These data models are part of the Production v1.0 spec.
 * The shape and semantics are binding and must not change.
 *
 * @module sparkle-protocol/types
 * @version 1.0.0-rc.1
 */

// =============================================================================
// CORE DATA MODEL (FROZEN)
// =============================================================================

/**
 * Sparkle Offer Content - v1.2 (Inverted Preimage Flow)
 *
 * CRITICAL SECURITY UPDATE: The preimage is now BUYER-GENERATED.
 *
 * OLD (BROKEN) FLOW:
 *   Seller generates invoice -> Buyer pays -> Seller knows preimage first
 *   PROBLEM: Seller can steal (cash + ordinal) if buyer's sweep fails
 *
 * NEW (SECURE) FLOW - Standard Submarine Swap Pattern:
 *   1. Buyer generates preimage P and hash H = SHA256(P)
 *   2. Buyer sends H to Seller
 *   3. Seller locks Ordinal to H
 *   4. Seller creates HOLD INVOICE tied to H
 *   5. Buyer pays hold invoice (funds locked, not settled)
 *   6. Buyer sweeps Ordinal on-chain (reveals P)
 *   7. Seller detects P on blockchain and settles invoice
 *
 * This is the canonical data structure for a Sparkle atomic swap offer.
 * Published to Nostr as Kind 8888 event content.
 */
export interface SparkleOfferContent {
  /** Protocol version - "1.1" (legacy) or "1.2" (inverted flow) */
  v: '1.1' | '1.2';

  /** Network - mainnet or testnet */
  network: 'mainnet' | 'testnet';

  /** Asset being sold */
  asset: {
    /** Transaction ID containing the Ordinal */
    txid: string;
    /** Output index */
    vout: number;
    /** Value in satoshis contained in the UTXO */
    value: number;
    /** Ordinal inscription ID (e.g., "txid:0" or inscription number) */
    inscriptionId: string;
  };

  /** Price in satoshis */
  priceSats: number;

  /**
   * Payment hash - 32-byte hex
   * CRITICAL: This is now BUYER-GENERATED (H = SHA256(buyer_preimage))
   * The buyer knows the preimage, the seller does not.
   */
  paymentHash: string;

  /** Absolute block height for refund timelock */
  timelock: number;

  /** Seller's x-only public key (32-byte hex) */
  sellerPubkey: string;

  /** Buyer's x-only public key (32-byte hex) - REQUIRED for Sealed Contracts */
  buyerPubkey: string;

  /** Optional affiliate outputs */
  affiliates?: Affiliate[];
}

/**
 * Affiliate payout configuration
 */
export interface Affiliate {
  /** Bitcoin address for payout */
  address: string;
  /** Basis points (100 = 1%) */
  bps: number;
}

// =============================================================================
// UTXO TYPES
// =============================================================================

/**
 * UTXO (Unspent Transaction Output)
 */
export interface UTXO {
  /** Transaction ID */
  txid: string;
  /** Output index */
  vout: number;
  /** Value in satoshis */
  value: number;
  /** ScriptPubKey (hex) - required for signing */
  scriptPubKey?: string;
}

/**
 * Funding UTXO with required fields
 */
export interface FundingUTXO extends UTXO {
  /** ScriptPubKey is REQUIRED for funding */
  scriptPubKey: string;
}

// =============================================================================
// INDEXER DATA
// =============================================================================

/**
 * Indexer response for inscription validation
 */
export interface IndexerData {
  /** Inscription ID */
  inscriptionId: string;
  /** Output value in satoshis */
  outputValue: number;
  /** Current owner address */
  address?: string;
  /** Transaction ID - REQUIRED for Gate 5 */
  txid: string;
  /** Output index - REQUIRED for Gate 5 */
  vout: number;
}

// =============================================================================
// VALIDATION TYPES
// =============================================================================

/**
 * Validation result
 */
export interface ValidationResult {
  /** Is the offer valid? */
  isValid: boolean;
  /** Error codes if invalid */
  errors: string[];
  /** Non-fatal warnings */
  warnings?: string[];
}

/**
 * Full validation context
 */
export interface ValidationContext {
  /** Current Bitcoin block height */
  currentBlockHeight: number;
  /** Lightning invoice expiry (Unix timestamp) */
  invoiceExpiryUnix: number;
  /** Indexer data for verification */
  indexerData: IndexerData;
}

// =============================================================================
// CONTRACT TYPES
// =============================================================================

/**
 * Generated contract result
 */
export interface ContractResult {
  /** Taproot address */
  address: string;
  /** Tap leaf script (hex) for PSBT construction */
  tapLeafScript: string;
  /** Script ASM representations */
  leaves: {
    swap: string;
    refund: string;
  };
  /** Internal pubkey used */
  internalPubkey: string;
  /** Control block for script path spend */
  controlBlock: string;
}

// =============================================================================
// PSBT TYPES
// =============================================================================

/**
 * Parameters for constructing sweep PSBT
 */
export interface SweepPsbtParams {
  /** Lock UTXO containing the Ordinal */
  lockUtxo: UTXO;
  /** Funding UTXO for fees */
  fundingUtxo: FundingUTXO;
  /** Preimage (32-byte hex) */
  preimage: string;
  /** Buyer's x-only pubkey (32-byte hex) */
  buyerPubkey: string;
  /** Buyer's destination address */
  buyerAddress: string;
  /** Change address for remaining funds */
  changeAddress: string;
  /** Fee rate in sats/vByte */
  feeRate: number;
  /** Network */
  network?: 'mainnet' | 'testnet';

  // Contract params for reconstruction
  /** Seller's x-only pubkey */
  sellerPubkey: string;
  /** Payment hash */
  paymentHash: string;
  /** Timelock block height */
  timelock: number;
  /** Price for affiliate calculation */
  priceSats: number;

  // Safety gate data
  /** Current block height */
  currentBlockHeight: number;
  /** Invoice expiry timestamp */
  invoiceExpiryUnix: number;
  /** Indexer data for verification */
  indexerData: IndexerData;

  /** Optional affiliates */
  affiliates?: Affiliate[];
}

/**
 * PSBT construction result
 */
export interface PsbtResult {
  /** PSBT hex */
  psbtHex: string;
  /** Transaction virtual size */
  estimatedVsize: number;
  /** Total fee in satoshis */
  totalFee: number;
  /** Fee rate achieved */
  effectiveFeeRate: number;
}

// =============================================================================
// LIGHTNING TYPES
// =============================================================================

/**
 * Decoded Lightning invoice
 */
export interface DecodedInvoice {
  /** Payment hash (32-byte hex) */
  paymentHash: string;
  /** Amount in satoshis */
  amountSats: number;
  /** Expiry timestamp (Unix) */
  expiryUnix: number;
  /** Invoice description */
  description?: string;
  /** Network */
  network: 'mainnet' | 'testnet';
}

/**
 * Payment result
 */
export interface PaymentResult {
  /** Revealed preimage (32-byte hex) */
  preimage: string;
  /** Payment timestamp */
  paidAt: number;
}

// =============================================================================
// INVERTED PREIMAGE FLOW TYPES (v1.2)
// =============================================================================

/**
 * Buyer-generated preimage data
 *
 * In the secure submarine swap flow, the BUYER generates the preimage.
 * This prevents the seller from knowing the preimage before the swap completes.
 */
export interface BuyerPreimage {
  /** The preimage (32-byte hex) - KEEP SECRET until sweep */
  preimage: string;
  /** SHA256 hash of preimage (32-byte hex) - safe to share */
  paymentHash: string;
  /** Timestamp when generated */
  createdAt: number;
}

/**
 * Hold Invoice - Lightning invoice that locks funds without settling
 *
 * The seller creates a hold invoice tied to the buyer's payment hash.
 * Funds are locked but NOT released to seller until they provide the preimage.
 */
export interface HoldInvoice {
  /** BOLT11 invoice string */
  bolt11: string;
  /** Payment hash (must match buyer's hash) */
  paymentHash: string;
  /** Amount in satoshis */
  amountSats: number;
  /** Expiry timestamp (Unix) */
  expiryUnix: number;
  /** Hold invoice state */
  state: 'pending' | 'accepted' | 'settled' | 'cancelled';
}

/**
 * Preimage reveal event - detected when buyer sweeps on-chain
 *
 * The settlement watcher monitors the blockchain for the sweep transaction.
 * When detected, it extracts the preimage from the witness stack.
 */
export interface PreimageReveal {
  /** The revealed preimage (32-byte hex) */
  preimage: string;
  /** Transaction ID where preimage was revealed */
  txid: string;
  /** Block height of the sweep transaction */
  blockHeight: number;
  /** Timestamp when detected */
  detectedAt: number;
}

/**
 * Settlement watcher configuration
 */
export interface WatcherConfig {
  /** Lock UTXO to monitor (txid:vout) */
  lockUtxo: { txid: string; vout: number };
  /** Expected payment hash */
  paymentHash: string;
  /** Callback when preimage is revealed */
  onPreimageRevealed: (reveal: PreimageReveal) => void;
  /** Callback when timelock expires without sweep */
  onTimelockExpired?: () => void;
  /** Poll interval in milliseconds (default: 10000) */
  pollIntervalMs?: number;
}

// =============================================================================
// NOSTR TYPES
// =============================================================================

/**
 * Nostr event template (unsigned)
 */
export interface NostrEventTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

/**
 * Signed Nostr event
 */
export interface NostrEvent extends NostrEventTemplate {
  id: string;
  pubkey: string;
  sig: string;
}

/**
 * NIP-17 Gift Wrapped offer
 */
export interface GiftWrappedOffer {
  /** Outer wrapper event (Kind 1059) */
  giftWrap: NostrEvent;
  /** Recipient pubkey */
  recipientPubkey: string;
}

// =============================================================================
// SWAP STATE
// =============================================================================

/**
 * Swap lifecycle states
 */
export type SwapState =
  | 'created'     // Offer created, not funded
  | 'funded'      // Ordinal locked in swap address
  | 'invoiced'    // Lightning invoice published
  | 'paid'        // Payment received, preimage revealed
  | 'claimed'     // Buyer claimed the Ordinal
  | 'refunded'    // Seller reclaimed after timeout
  | 'expired';    // Swap expired without action

/**
 * Complete swap record
 */
export interface SparkleSwapRecord {
  /** Unique swap ID */
  id: string;
  /** Current state */
  state: SwapState;
  /** Creation timestamp */
  createdAt: number;
  /** Offer content */
  offer: SparkleOfferContent;
  /** Nostr event ID (if published) */
  eventId?: string;
  /** Funding transaction ID */
  fundingTxid?: string;
  /** Funding output index */
  fundingVout?: number;
  /** BOLT11 invoice */
  invoice?: string;
  /** Revealed preimage */
  preimage?: string;
  /** Claim transaction ID */
  claimTxid?: string;
  /** Refund transaction ID */
  refundTxid?: string;
}

// =============================================================================
// GHOST DESK TYPES
// =============================================================================

/**
 * Ghost Desk message types
 */
export type GhostDeskMessageType =
  | 'offer'     // SparkleOfferContent
  | 'invoice'   // BOLT11 invoice response
  | 'accept'    // Acceptance confirmation
  | 'reject'    // Rejection with reason
  | 'message';  // General negotiation message

/**
 * Ghost Desk private message
 */
export interface GhostDeskMessage {
  /** Message type */
  type: GhostDeskMessageType;
  /** Payload (type depends on message type) */
  payload: SparkleOfferContent | string | { invoice: string; offerId: string };
  /** Timestamp */
  timestamp: number;
  /** Sender pubkey (added during unwrap) */
  senderPubkey?: string;
  /** Optional conversation ID for threading */
  conversationId?: string;
}
