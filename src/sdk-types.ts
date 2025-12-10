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
 * Sparkle Offer Content - FROZEN
 *
 * This is the canonical data structure for a Sparkle atomic swap offer.
 * Published to Nostr as Kind 8888 event content.
 */
export interface SparkleOfferContent {
  /** Protocol version - MUST be "1.1" */
  v: '1.1';

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

  /** Payment hash - 32-byte hex (from Seller's Hold Invoice) */
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
