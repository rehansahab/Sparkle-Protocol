/**
 * Sparkle Protocol
 *
 * Trustless atomic swaps for Bitcoin Ordinals via Lightning Network.
 *
 * @module sparkle-protocol
 * @version 1.0.0-rc.1
 */

// =============================================================================
// CONSTANTS (FROZEN)
// =============================================================================

export {
  // Protocol constants
  PROTOCOL_VERSION,
  NUMS_INTERNAL_KEY,
  TAPROOT_LEAF_VERSION,
  RBF_SEQUENCE,

  // Safety parameters
  SAFETY_BUFFER_BLOCKS,
  BLOCK_TIME_SECONDS,
  MIN_CLAIM_WINDOW_BLOCKS,
  DEFAULT_LOCKTIME_BLOCKS,

  // Affiliate limits
  MAX_AFFILIATES,
  MAX_AFFILIATE_BPS,
  MAX_TOTAL_AFFILIATE_BPS,
  BPS_DIVISOR,

  // Transaction constants
  DUST_THRESHOLD,
  MIN_RELAY_FEE,
  DEFAULT_FEE_RATE,
  ESTIMATED_SWEEP_VBYTES,
  ORDINAL_SAT_VALUE,

  // Nostr kinds
  KIND_SPARKLE_OFFER,
  KIND_GIFT_WRAP,
  KIND_SEAL,
  KIND_RELAY_LIST,
  DEFAULT_RELAYS,

  // Error codes
  SAFETY_ERRORS,
  SUPPORTED_NETWORKS,
} from './sdk-constants.js';

export type { SafetyError } from './sdk-constants.js';

// =============================================================================
// TYPES (FROZEN)
// =============================================================================

export type {
  // Core types
  SparkleOfferContent,
  Affiliate,

  // UTXO types
  UTXO,
  FundingUTXO,

  // Indexer types
  IndexerData,

  // Validation types
  ValidationResult,
  ValidationContext,

  // Contract types
  ContractResult,

  // PSBT types
  SweepPsbtParams,
  PsbtResult,

  // Lightning types
  DecodedInvoice,
  PaymentResult,

  // Nostr types
  NostrEventTemplate,
  NostrEvent,
  GiftWrappedOffer,

  // Swap types
  SwapState,
  SparkleSwapRecord,

  // Ghost Desk types
  GhostDeskMessageType,
  GhostDeskMessage,
} from './sdk-types.js';

// =============================================================================
// PROVIDERS (INTERFACES)
// =============================================================================

export type {
  IndexerProvider,
  SignerProvider,
  WalletProvider,
  LightningProvider,
  NostrProvider,
  NostrFilter,
} from './sdk-providers.js';

// =============================================================================
// SAFETY VALIDATION
// =============================================================================

export {
  validateOffer,
  validateAffiliates,
  calculateMinimumSafeTimelock,
  verifyPaymentHashMatch,
} from './sdk-safety.js';

// =============================================================================
// PSBT CONSTRUCTION
// =============================================================================

export {
  constructSweepPsbt,
  SafetyGateError,
  finalizeSweepWithPreimage,
} from './sdk-psbt.js';

// =============================================================================
// GHOST DESK (Private Messaging)
// =============================================================================

export {
  GhostDesk,
  createGhostDesk,
  generateConversationId,
  computeEventId,
} from './sdk-ghost-desk.js';

// =============================================================================
// ADAPTERS
// =============================================================================

export {
  // Indexer
  HiroIndexerAdapter,
  createHiroIndexer,

  // Signer
  Nip07SignerAdapter,
  createNip07Signer,
  isNip07Available,
  detectNostrExtension,

  // Wallet
  UnisatWalletAdapter,
  createUnisatWallet,
  detectBitcoinWallets,
  isBitcoinWalletAvailable,

  // Lightning
  WebLNLightningAdapter,
  createWebLNLightning,
  isWebLNAvailable,

  // Bundle utilities
  checkAdapterAvailability,
  createProviderBundle,
} from './adapters/index.js';

export type { AdapterAvailability, ProviderBundle } from './adapters/index.js';

// =============================================================================
// HIGH-LEVEL SDK
// =============================================================================

import {
  validateOffer,
  calculateMinimumSafeTimelock,
} from './sdk-safety.js';

import { constructSweepPsbt } from './sdk-psbt.js';
import { GhostDesk } from './sdk-ghost-desk.js';
import { createProviderBundle, checkAdapterAvailability } from './adapters/index.js';

import type {
  SparkleOfferContent,
  ValidationContext,
  SweepPsbtParams,
  PsbtResult,
} from './sdk-types.js';

import type {
  IndexerProvider,
  SignerProvider,
  WalletProvider,
  LightningProvider,
} from './sdk-providers.js';

/**
 * Sparkle Protocol SDK
 *
 * High-level interface for creating and executing Ordinal<->Lightning swaps.
 */
export class SparkleSDK {
  public readonly indexer: IndexerProvider;
  public readonly signer: SignerProvider;
  public readonly wallet: WalletProvider;
  public readonly lightning: LightningProvider;
  public readonly ghostDesk: GhostDesk;

  private readonly network: 'mainnet' | 'testnet';

  constructor(config: {
    indexer: IndexerProvider;
    signer: SignerProvider;
    wallet: WalletProvider;
    lightning: LightningProvider;
    network?: 'mainnet' | 'testnet';
  }) {
    this.indexer = config.indexer;
    this.signer = config.signer;
    this.wallet = config.wallet;
    this.lightning = config.lightning;
    this.network = config.network || 'testnet';

    // Initialize Ghost Desk with signer
    this.ghostDesk = new GhostDesk(this.signer);
  }

  /**
   * Validate an offer with full safety checks
   */
  async validateOffer(
    offer: SparkleOfferContent,
    invoiceExpiryUnix: number
  ): Promise<{
    isValid: boolean;
    errors: string[];
    warnings?: string[];
  }> {
    // Get current block height
    const currentBlockHeight = await this.indexer.getBlockHeight();

    // Get indexer data for the asset
    const indexerData = await this.indexer.getInscriptionData(offer.asset.inscriptionId);

    // Create validation context
    const context: ValidationContext = {
      currentBlockHeight,
      invoiceExpiryUnix,
      indexerData,
    };

    // Run validation
    return validateOffer(offer, context);
  }

  /**
   * Get minimum safe timelock for an offer
   */
  async getMinimumSafeTimelock(invoiceExpiryUnix: number): Promise<number> {
    const currentBlockHeight = await this.indexer.getBlockHeight();
    return calculateMinimumSafeTimelock(currentBlockHeight, invoiceExpiryUnix);
  }

  /**
   * Construct a sweep PSBT (buyer claims Ordinal)
   */
  async constructSweepPsbt(params: SweepPsbtParams): Promise<PsbtResult> {
    return constructSweepPsbt(params);
  }

  /**
   * Get SDK version
   */
  static get version(): string {
    return '1.0.0-rc.1';
  }

  /**
   * Check what adapters are available
   */
  static checkAvailability() {
    return checkAdapterAvailability();
  }
}

/**
 * Create SDK with default adapters
 *
 * @param network - 'mainnet' or 'testnet'
 * @returns SparkleSDK instance
 * @throws If required browser extensions are not available
 */
export function createSparkleSDK(
  network: 'mainnet' | 'testnet' = 'testnet'
): SparkleSDK {
  const bundle = createProviderBundle(network);

  return new SparkleSDK({
    ...bundle,
    network,
  });
}

// =============================================================================
// LEGACY MODULES (Compatibility)
// =============================================================================
// These modules are maintained for backwards compatibility.
// New code should use the production SDK above.

// Core - Taproot atomic swap primitives (exported with legacy namespace)
export * as legacyCore from './core/index.js';

// Auction - Pay-to-bid Lightning auctions
export * from './auction/index.js';

// Indexer - Inscription discovery and tracking
export * from './indexer/index.js';

// Lightning - LND/CLN node connectors
export * from './lightning/index.js';

// Coordinator - WebSocket trade coordination
export * from './coordinator/index.js';

// Browser - Wallet integrations (exported with legacy namespace to avoid conflicts)
export * as legacyBrowser from './browser/index.js';

// =============================================================================
// VERSION
// =============================================================================

export const VERSION = '1.0.0-rc.1';
