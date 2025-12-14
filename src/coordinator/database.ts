/**
 * Sparkle Protocol - Coordinator Database Layer
 *
 * SQLite-based persistence for swap data.
 * Uses a simple file-based database for easy deployment.
 *
 * @module sparkle-protocol/coordinator/database
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';

// Types
export interface SwapRecord {
  id: string;
  inscriptionId: string;
  priceSats: string;
  status: string;
  sellerPubkey: string;
  sellerBitcoinAddress: string;
  buyerPubkey: string | null;
  buyerBitcoinAddress: string | null;
  swapAddress: string | null;
  paymentHash: string | null;
  preimage: string | null;
  lightningInvoice: string | null;
  fundingTxid: string | null;
  fundingVout: number | null;
  claimTxid: string | null;
  refundTxid: string | null;
  createdAt: number;
  expiresAt: number;
  completedAt: number | null;
  updatedAt: number;
}

export interface SwapMessage {
  id: string;
  swapId: string;
  senderPubkey: string;
  content: string;
  createdAt: number;
}

export interface DatabaseStats {
  totalSwaps: number;
  activeSwaps: number;
  completedSwaps: number;
  cancelledSwaps: number;
}

// Simple JSON-based database (can be replaced with better-sqlite3 in production)
export class CoordinatorDatabase {
  private dbPath: string;
  private data: {
    swaps: Map<string, SwapRecord>;
    messages: Map<string, SwapMessage[]>;
    metadata: {
      version: string;
      createdAt: number;
      lastUpdated: number;
    };
  };

  constructor(dbPath: string = './data/coordinator.json') {
    this.dbPath = dbPath;
    this.data = {
      swaps: new Map(),
      messages: new Map(),
      metadata: {
        version: '1.0.0',
        createdAt: Date.now(),
        lastUpdated: Date.now(),
      },
    };
    this.load();
  }

  // Persistence
  private load(): void {
    try {
      if (existsSync(this.dbPath)) {
        const raw = readFileSync(this.dbPath, 'utf8');
        const parsed = JSON.parse(raw);

        // Restore swaps
        if (parsed.swaps) {
          this.data.swaps = new Map(Object.entries(parsed.swaps));
        }

        // Restore messages
        if (parsed.messages) {
          this.data.messages = new Map(Object.entries(parsed.messages));
        }

        // Restore metadata
        if (parsed.metadata) {
          this.data.metadata = parsed.metadata;
        }

        console.log(`Database loaded: ${this.data.swaps.size} swaps`);
      }
    } catch (error) {
      console.error('Failed to load database:', error);
    }
  }

  private save(): void {
    try {
      // Ensure directory exists
      const dir = dirname(this.dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // Update metadata
      this.data.metadata.lastUpdated = Date.now();

      // Serialize
      const serialized = JSON.stringify({
        swaps: Object.fromEntries(this.data.swaps),
        messages: Object.fromEntries(this.data.messages),
        metadata: this.data.metadata,
      }, null, 2);

      writeFileSync(this.dbPath, serialized);
    } catch (error) {
      console.error('Failed to save database:', error);
    }
  }

  // Swap operations
  createSwap(swap: SwapRecord): SwapRecord {
    if (this.data.swaps.has(swap.id)) {
      throw new Error(`Swap ${swap.id} already exists`);
    }

    this.data.swaps.set(swap.id, swap);
    this.save();
    return swap;
  }

  getSwap(id: string): SwapRecord | undefined {
    return this.data.swaps.get(id);
  }

  updateSwap(id: string, updates: Partial<SwapRecord>): SwapRecord | undefined {
    const swap = this.data.swaps.get(id);
    if (!swap) return undefined;

    const updated: SwapRecord = {
      ...swap,
      ...updates,
      updatedAt: Date.now(),
    };

    this.data.swaps.set(id, updated);
    this.save();
    return updated;
  }

  deleteSwap(id: string): boolean {
    const deleted = this.data.swaps.delete(id);
    if (deleted) {
      this.data.messages.delete(id);
      this.save();
    }
    return deleted;
  }

  listSwaps(filter?: {
    status?: string;
    sellerPubkey?: string;
    buyerPubkey?: string;
    inscriptionId?: string;
  }): SwapRecord[] {
    let swaps = Array.from(this.data.swaps.values());

    if (filter) {
      if (filter.status) {
        swaps = swaps.filter(s => s.status === filter.status);
      }
      if (filter.sellerPubkey) {
        swaps = swaps.filter(s => s.sellerPubkey === filter.sellerPubkey);
      }
      if (filter.buyerPubkey) {
        swaps = swaps.filter(s => s.buyerPubkey === filter.buyerPubkey);
      }
      if (filter.inscriptionId) {
        swaps = swaps.filter(s => s.inscriptionId === filter.inscriptionId);
      }
    }

    // Sort by created date, newest first
    return swaps.sort((a, b) => b.createdAt - a.createdAt);
  }

  getActiveSwaps(): SwapRecord[] {
    const activeStatuses = ['created', 'negotiating', 'funded', 'invoice_created', 'paid', 'claiming'];
    return Array.from(this.data.swaps.values())
      .filter(s => activeStatuses.includes(s.status))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  getExpiredSwaps(): SwapRecord[] {
    const now = Date.now();
    const activeStatuses = ['created', 'negotiating', 'funded', 'invoice_created'];
    return Array.from(this.data.swaps.values())
      .filter(s => activeStatuses.includes(s.status) && s.expiresAt < now);
  }

  // Message operations
  addMessage(message: SwapMessage): void {
    const messages = this.data.messages.get(message.swapId) || [];
    messages.push(message);
    this.data.messages.set(message.swapId, messages);
    this.save();
  }

  getMessages(swapId: string): SwapMessage[] {
    return this.data.messages.get(swapId) || [];
  }

  // Statistics
  getStats(): DatabaseStats {
    const swaps = Array.from(this.data.swaps.values());
    const activeStatuses = ['created', 'negotiating', 'funded', 'invoice_created', 'paid', 'claiming'];

    return {
      totalSwaps: swaps.length,
      activeSwaps: swaps.filter(s => activeStatuses.includes(s.status)).length,
      completedSwaps: swaps.filter(s => s.status === 'completed').length,
      cancelledSwaps: swaps.filter(s => ['cancelled', 'expired', 'refunded'].includes(s.status)).length,
    };
  }

  // Maintenance
  cleanupExpired(): number {
    const expired = this.getExpiredSwaps();
    let count = 0;

    for (const swap of expired) {
      this.updateSwap(swap.id, { status: 'expired' });
      count++;
    }

    return count;
  }

  // Export/Import
  export(): string {
    return JSON.stringify({
      swaps: Object.fromEntries(this.data.swaps),
      messages: Object.fromEntries(this.data.messages),
      metadata: this.data.metadata,
    }, null, 2);
  }

  import(data: string): void {
    const parsed = JSON.parse(data);

    if (parsed.swaps) {
      this.data.swaps = new Map(Object.entries(parsed.swaps));
    }
    if (parsed.messages) {
      this.data.messages = new Map(Object.entries(parsed.messages));
    }
    if (parsed.metadata) {
      this.data.metadata = parsed.metadata;
    }

    this.save();
  }

  // Reset (for testing)
  reset(): void {
    this.data.swaps.clear();
    this.data.messages.clear();
    this.data.metadata = {
      version: '1.0.0',
      createdAt: Date.now(),
      lastUpdated: Date.now(),
    };

    if (existsSync(this.dbPath)) {
      unlinkSync(this.dbPath);
    }
  }
}

// Factory
export function createDatabase(dbPath?: string): CoordinatorDatabase {
  return new CoordinatorDatabase(dbPath);
}

// Generate unique ID
export function generateSwapId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `swap_${timestamp}_${random}`;
}

export function generateMessageId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `msg_${timestamp}_${random}`;
}
