/**
 * Sparkle Protocol - Indexer
 *
 * Discovers and tracks Sparkle-compatible Bitcoin Ordinal inscriptions.
 * Parses {"p": "sparkle"} metadata and maintains inscription state.
 *
 * @module sparkle-protocol/indexer
 * @version 0.3.0
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export interface SparkleMetadata {
  /** Protocol identifier - must be "sparkle" */
  p: 'sparkle';
  /** Protocol version */
  v?: number;
  /** Operation type */
  op?: 'genesis' | 'child' | 'checkout' | 'upgrade' | 'offer';
  /** Inscription name */
  name?: string;
  /** Description */
  description?: string;
  /** Collection name (for child inscriptions) */
  collection?: string;
  /** Parent inscription ID (for recursive inscriptions) */
  parent?: string;
  /** Traits (for NFTs) */
  traits?: Record<string, string | number>;
  /** Lightning configuration */
  lightning?: {
    enabled: boolean;
    minChannelCapacity?: number;
  };
  /** Trade configuration */
  trade?: {
    priceSats?: number;
    currency?: string;
    expiresAt?: number;
  };
  /** Original inscription ID (for upgrades) */
  original?: string;
}

export interface Inscription {
  /** Inscription ID (txid:vout or inscription number) */
  id: string;
  /** Transaction ID */
  txid: string;
  /** Output index */
  vout: number;
  /** Inscription number (if known) */
  number?: number;
  /** Content type (MIME) */
  contentType: string;
  /** Content length in bytes */
  contentLength: number;
  /** Raw content (if small enough to store) */
  content?: Uint8Array;
  /** Parsed Sparkle metadata (if applicable) */
  sparkleMetadata?: SparkleMetadata;
  /** Is this a Sparkle-compatible inscription? */
  isSparkle: boolean;
  /** Parent inscription ID (if recursive) */
  parentId?: string;
  /** Child inscription IDs */
  childIds: string[];
  /** Current owner address */
  owner?: string;
  /** Genesis block height */
  genesisHeight: number;
  /** Genesis timestamp */
  genesisTimestamp: number;
  /** Last transfer block height */
  lastTransferHeight?: number;
  /** Indexed timestamp */
  indexedAt: number;
}

export interface Collection {
  /** Collection ID (genesis inscription ID) */
  id: string;
  /** Collection name */
  name: string;
  /** Description */
  description?: string;
  /** Genesis inscription */
  genesisInscription: Inscription;
  /** Child inscriptions in this collection */
  children: Inscription[];
  /** Total supply (if known) */
  totalSupply?: number;
  /** Sparkle-enabled */
  sparkleEnabled: boolean;
  /** Created timestamp */
  createdAt: number;
}

export interface SwapOffer {
  /** Offer ID */
  id: string;
  /** Inscription being offered */
  inscriptionId: string;
  /** Seller pubkey */
  sellerPubkey: string;
  /** Price in satoshis */
  priceSats: bigint;
  /** Offer status */
  status: 'active' | 'accepted' | 'cancelled' | 'expired';
  /** Swap address (Taproot) */
  swapAddress?: string;
  /** Payment hash */
  paymentHash?: string;
  /** Created timestamp */
  createdAt: number;
  /** Expires timestamp */
  expiresAt?: number;
}

export interface IndexerConfig {
  /** Ord API endpoint */
  ordApiUrl: string;
  /** Bitcoin RPC endpoint (optional) */
  bitcoinRpcUrl?: string;
  /** Polling interval in milliseconds */
  pollIntervalMs: number;
  /** Start from block height (0 for genesis) */
  startBlockHeight: number;
  /** Enable recursive inscription resolution */
  resolveRecursive: boolean;
  /** Maximum content size to store (bytes) */
  maxContentSize: number;
}

export interface IndexerStats {
  totalInscriptions: number;
  sparkleInscriptions: number;
  collections: number;
  activeOffers: number;
  lastBlockHeight: number;
  lastIndexedAt: number;
}

// ============================================================================
// Sparkle Indexer Class
// ============================================================================

export class SparkleIndexer extends EventEmitter {
  private config: IndexerConfig;
  private inscriptions: Map<string, Inscription> = new Map();
  private collections: Map<string, Collection> = new Map();
  private offers: Map<string, SwapOffer> = new Map();
  private lastBlockHeight: number = 0;
  private isRunning: boolean = false;
  private pollTimer?: NodeJS.Timeout;

  constructor(config: Partial<IndexerConfig> = {}) {
    super();
    this.config = {
      ordApiUrl: config.ordApiUrl || 'https://ordinals.com',
      bitcoinRpcUrl: config.bitcoinRpcUrl,
      pollIntervalMs: config.pollIntervalMs || 60000, // 1 minute
      startBlockHeight: config.startBlockHeight || 0,
      resolveRecursive: config.resolveRecursive ?? true,
      maxContentSize: config.maxContentSize || 100000, // 100KB
    };
    this.lastBlockHeight = this.config.startBlockHeight;
  }

  /**
   * Start the indexer
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Indexer is already running');
    }

    this.isRunning = true;
    this.emit('started');

    // Initial sync
    await this.sync();

    // Start polling
    this.pollTimer = setInterval(() => {
      this.sync().catch((err) => {
        this.emit('error', err);
      });
    }, this.config.pollIntervalMs);
  }

  /**
   * Stop the indexer
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.isRunning = false;
    this.emit('stopped');
  }

  /**
   * Sync with the blockchain
   */
  async sync(): Promise<void> {
    try {
      const currentHeight = await this.getCurrentBlockHeight();

      if (currentHeight <= this.lastBlockHeight) {
        return; // No new blocks
      }

      this.emit('syncing', { from: this.lastBlockHeight, to: currentHeight });

      // Fetch new inscriptions
      const newInscriptions = await this.fetchInscriptionsSince(this.lastBlockHeight);

      for (const inscription of newInscriptions) {
        await this.processInscription(inscription);
      }

      this.lastBlockHeight = currentHeight;
      this.emit('synced', { height: currentHeight, count: newInscriptions.length });
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Process a single inscription
   */
  private async processInscription(raw: RawInscription): Promise<Inscription> {
    const inscription = await this.parseInscription(raw);

    // Check if Sparkle-compatible
    if (inscription.isSparkle && inscription.sparkleMetadata) {
      await this.processSparkleInscription(inscription);
    }

    // Store inscription
    this.inscriptions.set(inscription.id, inscription);

    // Resolve parent-child relationships
    if (this.config.resolveRecursive && inscription.parentId) {
      await this.resolveParent(inscription);
    }

    this.emit('inscription', inscription);
    return inscription;
  }

  /**
   * Process Sparkle-specific metadata
   */
  private async processSparkleInscription(inscription: Inscription): Promise<void> {
    const meta = inscription.sparkleMetadata!;

    switch (meta.op) {
      case 'genesis':
        // Create new collection
        const collection: Collection = {
          id: inscription.id,
          name: meta.name || 'Unnamed Collection',
          description: meta.description,
          genesisInscription: inscription,
          children: [],
          totalSupply: meta.traits?.totalSupply as number,
          sparkleEnabled: meta.lightning?.enabled ?? true,
          createdAt: inscription.genesisTimestamp,
        };
        this.collections.set(collection.id, collection);
        this.emit('collection', collection);
        break;

      case 'child':
        // Add to parent collection
        if (meta.parent) {
          const parentCollection = this.collections.get(meta.parent);
          if (parentCollection) {
            parentCollection.children.push(inscription);
          }
        }
        break;

      case 'offer':
        // Create swap offer
        if (meta.trade?.priceSats) {
          const offer: SwapOffer = {
            id: inscription.id,
            inscriptionId: meta.original || inscription.id,
            sellerPubkey: inscription.owner || '',
            priceSats: BigInt(meta.trade.priceSats),
            status: 'active',
            createdAt: inscription.genesisTimestamp,
            expiresAt: meta.trade.expiresAt,
          };
          this.offers.set(offer.id, offer);
          this.emit('offer', offer);
        }
        break;
    }
  }

  /**
   * Parse raw inscription data
   */
  private async parseInscription(raw: RawInscription): Promise<Inscription> {
    let sparkleMetadata: SparkleMetadata | undefined;
    let isSparkle = false;

    // Try to parse JSON content as Sparkle metadata
    if (raw.contentType.includes('application/json') || raw.contentType.includes('text/plain')) {
      try {
        const text = new TextDecoder().decode(raw.content);
        const json = JSON.parse(text);

        if (json.p === 'sparkle') {
          isSparkle = true;
          sparkleMetadata = json as SparkleMetadata;
        }
      } catch {
        // Not valid JSON, not a problem
      }
    }

    return {
      id: raw.id,
      txid: raw.txid,
      vout: raw.vout,
      number: raw.number,
      contentType: raw.contentType,
      contentLength: raw.contentLength,
      content: raw.contentLength <= this.config.maxContentSize ? raw.content : undefined,
      sparkleMetadata,
      isSparkle,
      parentId: sparkleMetadata?.parent,
      childIds: [],
      owner: raw.owner,
      genesisHeight: raw.genesisHeight,
      genesisTimestamp: raw.genesisTimestamp,
      indexedAt: Math.floor(Date.now() / 1000),
    };
  }

  /**
   * Resolve parent inscription
   */
  private async resolveParent(inscription: Inscription): Promise<void> {
    if (!inscription.parentId) return;

    let parent = this.inscriptions.get(inscription.parentId);

    if (!parent) {
      // Fetch parent from API
      try {
        const rawParent = await this.fetchInscription(inscription.parentId);
        parent = await this.parseInscription(rawParent);
        this.inscriptions.set(parent.id, parent);
      } catch {
        // Parent not found
        return;
      }
    }

    // Add this inscription as child of parent
    if (!parent.childIds.includes(inscription.id)) {
      parent.childIds.push(inscription.id);
    }
  }

  /**
   * Get current block height from Bitcoin node or API
   */
  private async getCurrentBlockHeight(): Promise<number> {
    // In real implementation, query Bitcoin RPC or mempool.space API
    // For now, simulate with incrementing height
    return this.lastBlockHeight + 1;
  }

  /**
   * Fetch inscriptions since a given block height
   */
  private async fetchInscriptionsSince(blockHeight: number): Promise<RawInscription[]> {
    // In real implementation, query ord API or run ord indexer
    // This is a placeholder that returns empty for simulation
    const url = `${this.config.ordApiUrl}/inscriptions?from_height=${blockHeight}`;
    console.log(`[Indexer] Would fetch from: ${url}`);
    return [];
  }

  /**
   * Fetch a single inscription by ID
   */
  private async fetchInscription(id: string): Promise<RawInscription> {
    const url = `${this.config.ordApiUrl}/inscription/${id}`;

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch inscription ${id}: ${response.status}`);
    }

    return await response.json();
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  /**
   * Get inscription by ID
   */
  getInscription(id: string): Inscription | undefined {
    return this.inscriptions.get(id);
  }

  /**
   * Get all Sparkle inscriptions
   */
  getSparkleInscriptions(): Inscription[] {
    return Array.from(this.inscriptions.values()).filter((i) => i.isSparkle);
  }

  /**
   * Get collection by ID
   */
  getCollection(id: string): Collection | undefined {
    return this.collections.get(id);
  }

  /**
   * Get all collections
   */
  getCollections(): Collection[] {
    return Array.from(this.collections.values());
  }

  /**
   * Get active swap offers
   */
  getActiveOffers(): SwapOffer[] {
    const now = Math.floor(Date.now() / 1000);
    return Array.from(this.offers.values()).filter(
      (o) => o.status === 'active' && (!o.expiresAt || o.expiresAt > now)
    );
  }

  /**
   * Get offer by ID
   */
  getOffer(id: string): SwapOffer | undefined {
    return this.offers.get(id);
  }

  /**
   * Get offers for a specific inscription
   */
  getOffersForInscription(inscriptionId: string): SwapOffer[] {
    return Array.from(this.offers.values()).filter(
      (o) => o.inscriptionId === inscriptionId
    );
  }

  /**
   * Search inscriptions by name or collection
   */
  searchInscriptions(query: string): Inscription[] {
    const lower = query.toLowerCase();
    return Array.from(this.inscriptions.values()).filter((i) => {
      if (!i.sparkleMetadata) return false;
      const name = i.sparkleMetadata.name?.toLowerCase() || '';
      const collection = i.sparkleMetadata.collection?.toLowerCase() || '';
      return name.includes(lower) || collection.includes(lower);
    });
  }

  /**
   * Get inscriptions by owner
   */
  getInscriptionsByOwner(owner: string): Inscription[] {
    return Array.from(this.inscriptions.values()).filter(
      (i) => i.owner === owner
    );
  }

  /**
   * Get indexer statistics
   */
  getStats(): IndexerStats {
    return {
      totalInscriptions: this.inscriptions.size,
      sparkleInscriptions: this.getSparkleInscriptions().length,
      collections: this.collections.size,
      activeOffers: this.getActiveOffers().length,
      lastBlockHeight: this.lastBlockHeight,
      lastIndexedAt: Math.floor(Date.now() / 1000),
    };
  }

  // ============================================================================
  // Persistence
  // ============================================================================

  /**
   * Export indexer state
   */
  exportState(): IndexerState {
    return {
      inscriptions: Array.from(this.inscriptions.values()),
      collections: Array.from(this.collections.values()),
      offers: Array.from(this.offers.values()),
      lastBlockHeight: this.lastBlockHeight,
    };
  }

  /**
   * Import indexer state
   */
  importState(state: IndexerState): void {
    this.inscriptions.clear();
    this.collections.clear();
    this.offers.clear();

    for (const inscription of state.inscriptions) {
      this.inscriptions.set(inscription.id, inscription);
    }

    for (const collection of state.collections) {
      this.collections.set(collection.id, collection);
    }

    for (const offer of state.offers) {
      this.offers.set(offer.id, offer);
    }

    this.lastBlockHeight = state.lastBlockHeight;
  }
}

// ============================================================================
// Supporting Types
// ============================================================================

interface RawInscription {
  id: string;
  txid: string;
  vout: number;
  number?: number;
  contentType: string;
  contentLength: number;
  content?: Uint8Array;
  owner?: string;
  genesisHeight: number;
  genesisTimestamp: number;
}

interface IndexerState {
  inscriptions: Inscription[];
  collections: Collection[];
  offers: SwapOffer[];
  lastBlockHeight: number;
}

// ============================================================================
// Factory Function
// ============================================================================

export function createIndexer(config?: Partial<IndexerConfig>): SparkleIndexer {
  return new SparkleIndexer(config);
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_INDEXER_CONFIG: IndexerConfig = {
  ordApiUrl: 'https://ordinals.com',
  pollIntervalMs: 60000,
  startBlockHeight: 767430, // Ordinals genesis
  resolveRecursive: true,
  maxContentSize: 100000,
};
