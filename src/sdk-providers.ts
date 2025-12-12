/**
 * Sparkle Protocol - Provider Interfaces
 *
 * These interfaces define the contract between the SDK and external services.
 * All real-world I/O MUST go through these providers.
 *
 * @module sparkle-protocol/providers
 * @version 1.0.0-rc.1
 */

import type {
  UTXO,
  FundingUTXO,
  IndexerData,
  DecodedInvoice,
  PaymentResult,
  NostrEventTemplate,
  NostrEvent,
  HoldInvoice,
  PreimageReveal,
  WatcherConfig,
} from './sdk-types.js';

// =============================================================================
// INDEXER PROVIDER
// =============================================================================

/**
 * IndexerProvider - Blockchain Data Interface
 *
 * Provides authoritative data about inscriptions and blockchain state.
 * Implementations: Hiro API, OrdinalsBot, Custom indexer
 */
export interface IndexerProvider {
  /**
   * Validate inscription ownership at a specific UTXO
   *
   * CRITICAL: This is the source of truth for Gate 5 (Ownership Verification).
   * The PSBT builder will refuse to construct a transaction if the lock UTXO
   * doesn't match the indexer's data.
   *
   * @param inscriptionId - The inscription ID to verify
   * @param utxo - The UTXO claimed to contain the inscription
   * @returns true if inscription exists at that UTXO
   * @throws Error if inscription not found or UTXO mismatch
   */
  validateOwnership(
    inscriptionId: string,
    utxo: { txid: string; vout: number; value: number }
  ): Promise<boolean>;

  /**
   * Get inscription data
   *
   * Used for initial offer validation and display.
   *
   * @param inscriptionId - The inscription to look up
   * @returns Inscription metadata including current location
   */
  getInscriptionData(inscriptionId: string): Promise<IndexerData>;

  /**
   * Get current blockchain height
   *
   * Used for Safety Delta calculation (Gate 4).
   *
   * @returns Current block height
   */
  getBlockHeight(): Promise<number>;

  /**
   * Broadcast a signed transaction
   *
   * @param txHex - Raw transaction hex
   * @returns Transaction ID
   * @throws Error if broadcast fails
   */
  broadcastTx(txHex: string): Promise<string>;

  /**
   * Get transaction details
   *
   * @param txid - Transaction ID to look up
   * @returns Transaction details or null if not found
   */
  getTransaction(txid: string): Promise<{
    txid: string;
    confirmations: number;
    blockHeight?: number;
    outputs: Array<{ value: number; address: string }>;
  } | null>;

  /**
   * Check if a transaction is confirmed
   *
   * @param txid - Transaction ID
   * @param minConfirmations - Minimum confirmations required (default: 1)
   * @returns true if confirmed with at least minConfirmations
   */
  isConfirmed(txid: string, minConfirmations?: number): Promise<boolean>;
}

// =============================================================================
// SIGNER PROVIDER
// =============================================================================

/**
 * SignerProvider - Identity & Privacy Interface
 *
 * Handles Nostr identity and NIP-44 encryption.
 * Implementations: NIP-07 browser extension (Alby, nos2x, etc.)
 */
export interface SignerProvider {
  /**
   * Get public key from wallet
   *
   * NIP-07: window.nostr.getPublicKey()
   *
   * @returns x-only public key (32-byte hex)
   */
  getPublicKey(): Promise<string>;

  /**
   * Sign a Nostr event
   *
   * NIP-07: window.nostr.signEvent(event)
   *
   * @param event - Unsigned event template
   * @returns Signed event with id, pubkey, sig
   */
  signEvent(event: NostrEventTemplate): Promise<NostrEvent>;

  /**
   * Encrypt content for a recipient
   *
   * NIP-44: XChaCha20-Poly1305 encryption
   * Used for Ghost Desk private offers.
   *
   * @param recipientPubkey - Recipient's public key
   * @param content - Plaintext to encrypt
   * @returns Ciphertext
   */
  encrypt(recipientPubkey: string, content: string): Promise<string>;

  /**
   * Decrypt content from a sender
   *
   * NIP-44: XChaCha20-Poly1305 decryption
   *
   * @param senderPubkey - Sender's public key
   * @param ciphertext - Encrypted content
   * @returns Plaintext
   */
  decrypt(senderPubkey: string, ciphertext: string): Promise<string>;
}

// =============================================================================
// WALLET PROVIDER
// =============================================================================

/**
 * WalletProvider - Bitcoin Wallet Interface
 *
 * Manages Bitcoin wallet operations for funding and signing.
 * Implementations: UniSat, Xverse, Leather, OKX
 */
export interface WalletProvider {
  /**
   * Connect to wallet
   *
   * @returns Connected address
   */
  connect(): Promise<string>;

  /**
   * Disconnect from wallet
   */
  disconnect(): Promise<void>;

  /**
   * Check if connected
   */
  isConnected(): Promise<boolean>;

  /**
   * Get connected address
   */
  getAddress(): Promise<string>;

  /**
   * Get public key
   *
   * @returns x-only public key (32-byte hex)
   */
  getPublicKey(): Promise<string>;

  /**
   * Get a funding UTXO suitable for fees
   *
   * CRITICAL SAFETY: Must filter OUT inscriptions to prevent
   * accidental spend of valuable Ordinals as fees.
   *
   * @param amountSats - Minimum amount needed
   * @returns Clean BTC UTXO (not an inscription)
   * @throws Error if no suitable UTXO found
   */
  getFundingUtxo(amountSats: number): Promise<FundingUTXO>;

  /**
   * Get all available UTXOs
   *
   * @returns List of UTXOs (some may be inscriptions)
   */
  getUtxos(): Promise<UTXO[]>;

  /**
   * Sign a specific input of a PSBT
   *
   * IMPORTANT: For Sparkle sweeps, only sign Input 1 (funding).
   * Input 0 (contract) requires the preimage witness, not wallet signing.
   *
   * @param psbtHex - PSBT in hex format
   * @param inputIndex - Which input to sign (usually 1 for funding)
   * @returns Signed PSBT hex
   */
  signPsbtInput(psbtHex: string, inputIndex: number): Promise<string>;

  /**
   * Sign multiple inputs of a PSBT
   *
   * @param psbtHex - PSBT in hex format
   * @param inputIndexes - Which inputs to sign
   * @returns Signed PSBT hex
   */
  signPsbtInputs(psbtHex: string, inputIndexes: number[]): Promise<string>;

  /**
   * Get current network
   *
   * @returns 'mainnet' or 'testnet'
   */
  getNetwork(): Promise<'mainnet' | 'testnet'>;
}

// =============================================================================
// LIGHTNING PROVIDER
// =============================================================================

/**
 * LightningProvider - Payment Interface
 *
 * Handles Lightning Network invoice operations.
 * Implementations: WebLN (Alby, etc.), LND REST, CLN
 */
export interface LightningProvider {
  /**
   * Decode a BOLT11 invoice
   *
   * Extracts payment hash, amount, and expiry for validation.
   *
   * @param invoice - BOLT11 invoice string
   * @returns Decoded invoice data
   */
  decodeInvoice(invoice: string): Promise<DecodedInvoice>;

  /**
   * Pay a Lightning invoice
   *
   * CRITICAL: Must return the preimage on success.
   * The preimage is required to sweep the Ordinal.
   *
   * @param invoice - BOLT11 invoice string
   * @returns Payment result with preimage
   * @throws Error if payment fails
   */
  payInvoice(invoice: string): Promise<PaymentResult>;

  /**
   * Check if Lightning provider is available
   */
  isAvailable(): Promise<boolean>;

  /**
   * Enable WebLN provider
   *
   * Some providers require explicit enable call.
   */
  enable(): Promise<void>;

  /**
   * Get node info (if available)
   *
   * @returns Node pubkey and alias
   */
  getInfo?(): Promise<{ pubkey: string; alias?: string }>;
}

// =============================================================================
// NOSTR PROVIDER
// =============================================================================

/**
 * Nostr filter for subscriptions
 */
export interface NostrFilter {
  ids?: string[];
  kinds?: number[];
  authors?: string[];
  since?: number;
  until?: number;
  limit?: number;
  '#p'?: string[];
  '#e'?: string[];
  '#i'?: string[];
  '#x'?: string[];
}

/**
 * NostrProvider - Relay Communication Interface
 *
 * Handles Nostr relay connections and event publishing.
 */
export interface NostrProvider {
  /**
   * Connect to relays
   *
   * @param relayUrls - List of relay WebSocket URLs
   */
  connect(relayUrls: string[]): Promise<void>;

  /**
   * Disconnect from all relays
   */
  disconnect(): Promise<void>;

  /**
   * Publish an event to connected relays
   *
   * @param event - Signed Nostr event
   * @returns Event ID
   */
  publish(event: NostrEvent): Promise<string>;

  /**
   * Subscribe to events matching filter
   *
   * @param filter - Nostr filter (kinds, authors, #p, etc.)
   * @param onEvent - Callback for matching events
   * @returns Unsubscribe function
   */
  subscribe(
    filter: NostrFilter,
    onEvent: (event: NostrEvent) => void
  ): () => void;

  /**
   * Fetch a single event by ID
   *
   * @param eventId - Event ID to fetch
   * @returns Event or null
   */
  fetchEvent(eventId: string): Promise<NostrEvent | null>;

  /**
   * Fetch events matching filter
   *
   * @param filter - Nostr filter
   * @returns Matching events
   */
  fetchEvents(filter: NostrFilter): Promise<NostrEvent[]>;

  /**
   * Get user's preferred relays (NIP-65)
   *
   * @param pubkey - User's public key
   * @returns List of relay URLs
   */
  getUserRelays(pubkey: string): Promise<string[]>;
}

// =============================================================================
// FEE ESTIMATOR PROVIDER
// =============================================================================

/**
 * Fee rate priority levels
 */
export type FeePriority = 'low' | 'medium' | 'high' | 'urgent';

/**
 * FeeEstimatorProvider - Dynamic Fee Estimation
 *
 * CRITICAL: Hardcoding fees or relying on wallet defaults is risky.
 * If the sweep transaction gets stuck, the atomic swap fails.
 *
 * Implementations: mempool.space API, bitcoind estimatesmartfee
 */
export interface FeeEstimatorProvider {
  /**
   * Get recommended fee rate for priority level
   *
   * @param priority - Desired confirmation speed
   * @returns Fee rate in sats/vByte
   */
  getFeeRate(priority: FeePriority): Promise<number>;

  /**
   * Get fee rates for all priority levels
   *
   * @returns Object with fee rates for each priority
   */
  getAllFeeRates(): Promise<{
    low: number;      // ~1 hour (6 blocks)
    medium: number;   // ~30 min (3 blocks)
    high: number;     // ~10 min (1 block)
    urgent: number;   // Next block (priority)
  }>;

  /**
   * Estimate fee for a specific vsize
   *
   * @param vsize - Transaction virtual size in bytes
   * @param priority - Desired confirmation speed
   * @returns Total fee in satoshis
   */
  estimateFee(vsize: number, priority: FeePriority): Promise<number>;
}

// =============================================================================
// HOLD INVOICE PROVIDER (For Inverted Preimage Flow)
// =============================================================================

/**
 * HoldInvoiceProvider - Lightning Hold Invoice Management
 *
 * CRITICAL for secure submarine swaps: Hold invoices lock funds
 * WITHOUT settling until the preimage is provided.
 *
 * Flow:
 * 1. Seller creates hold invoice with buyer's payment hash
 * 2. Buyer pays invoice (funds locked, not settled)
 * 3. Buyer sweeps Ordinal (reveals preimage on-chain)
 * 4. Seller detects preimage and settles hold invoice
 *
 * Implementations: LND (routerrpc), CLN (hold invoice plugin)
 */
export interface HoldInvoiceProvider {
  /**
   * Create a hold invoice tied to a specific payment hash
   *
   * Unlike regular invoices, hold invoices do NOT settle automatically.
   * The seller must call settleInvoice() with the preimage.
   *
   * @param paymentHash - The buyer's payment hash (32-byte hex)
   * @param amountSats - Amount in satoshis
   * @param expirySecs - Invoice expiry in seconds (default: 3600)
   * @param memo - Optional invoice description
   * @returns Hold invoice object
   */
  createHoldInvoice(
    paymentHash: string,
    amountSats: number,
    expirySecs?: number,
    memo?: string
  ): Promise<HoldInvoice>;

  /**
   * Get hold invoice state
   *
   * @param paymentHash - The payment hash to look up
   * @returns Current invoice state
   */
  getInvoiceState(paymentHash: string): Promise<HoldInvoice['state']>;

  /**
   * Settle a hold invoice with the preimage
   *
   * MUST be called after detecting the preimage on-chain.
   * Releases the locked funds to the seller.
   *
   * @param preimage - The revealed preimage (32-byte hex)
   * @returns true if settled successfully
   */
  settleInvoice(preimage: string): Promise<boolean>;

  /**
   * Cancel a hold invoice
   *
   * Returns funds to the buyer. Use if swap fails or times out.
   *
   * @param paymentHash - The payment hash to cancel
   * @returns true if cancelled successfully
   */
  cancelInvoice(paymentHash: string): Promise<boolean>;

  /**
   * Subscribe to invoice state changes
   *
   * @param paymentHash - The payment hash to watch
   * @param onStateChange - Callback for state changes
   * @returns Unsubscribe function
   */
  subscribeToInvoice(
    paymentHash: string,
    onStateChange: (state: HoldInvoice['state']) => void
  ): () => void;
}

// =============================================================================
// SETTLEMENT WATCHER PROVIDER
// =============================================================================

/**
 * SettlementWatcherProvider - On-chain Preimage Detection
 *
 * CRITICAL: In the inverted flow, the seller MUST watch the blockchain
 * to detect when the buyer reveals the preimage in the sweep transaction.
 *
 * If the seller closes their browser/app without a watcher running,
 * they will LOSE THE PAYMENT (buyer gets Ordinal for free).
 *
 * Implementations: bitcoind RPC, Electrum, mempool.space websocket
 */
export interface SettlementWatcherProvider {
  /**
   * Start watching a lock UTXO for spend
   *
   * When the UTXO is spent (buyer sweeps), extracts the preimage
   * from the witness stack and calls the callback.
   *
   * @param config - Watcher configuration
   * @returns Stop function
   */
  watch(config: WatcherConfig): () => void;

  /**
   * Check if a UTXO has been spent
   *
   * @param txid - Transaction ID
   * @param vout - Output index
   * @returns Spending transaction info or null if unspent
   */
  checkUtxoSpent(
    txid: string,
    vout: number
  ): Promise<{ spendingTxid: string; blockHeight?: number } | null>;

  /**
   * Extract preimage from a sweep transaction
   *
   * Parses the witness stack to find the preimage in the hashlock spend.
   *
   * @param txid - Sweep transaction ID
   * @returns Preimage (32-byte hex) or null if not a hashlock spend
   */
  extractPreimage(txid: string): Promise<string | null>;
}
