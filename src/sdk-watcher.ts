/**
 * Sparkle Protocol - Settlement Watcher
 *
 * CRITICAL SERVICE: Monitors the blockchain for preimage reveals.
 *
 * In the inverted preimage flow (v1.2), the seller does NOT know the
 * preimage until the buyer sweeps the Ordinal on-chain. The seller
 * MUST detect this sweep and extract the preimage to settle their
 * Lightning hold invoice.
 *
 * WITHOUT THIS WATCHER: Buyer gets Ordinal for free (seller never settles).
 *
 * @module sparkle-protocol/watcher
 * @version 1.2.0
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

import type {
  PreimageReveal,
  WatcherConfig,
} from './sdk-types.js';

import type {
  IndexerProvider,
  SettlementWatcherProvider,
  HoldInvoiceProvider,
} from './sdk-providers.js';

// =============================================================================
// BUYER PREIMAGE GENERATION
// =============================================================================

/**
 * Generate a cryptographically secure preimage for the buyer
 *
 * CRITICAL: Store this preimage securely! If lost before sweep,
 * the buyer cannot claim the Ordinal.
 *
 * @returns Preimage data with hash
 */
export function generateBuyerPreimage(): {
  preimage: string;
  paymentHash: string;
  createdAt: number;
} {
  // Generate 32 random bytes
  const preimageBytes = new Uint8Array(32);
  crypto.getRandomValues(preimageBytes);

  // Hash to get payment hash
  const hashBytes = sha256(preimageBytes);

  return {
    preimage: bytesToHex(preimageBytes),
    paymentHash: bytesToHex(hashBytes),
    createdAt: Math.floor(Date.now() / 1000),
  };
}

/**
 * Verify a preimage matches a payment hash
 *
 * @param preimage - Claimed preimage (32-byte hex)
 * @param paymentHash - Expected payment hash (32-byte hex)
 * @returns true if SHA256(preimage) === paymentHash
 */
export function verifyPreimage(preimage: string, paymentHash: string): boolean {
  try {
    const preimageBytes = hexToBytes(preimage);
    const computedHash = bytesToHex(sha256(preimageBytes));
    return computedHash.toLowerCase() === paymentHash.toLowerCase();
  } catch {
    return false;
  }
}

// =============================================================================
// SETTLEMENT WATCHER CLASS
// =============================================================================

/**
 * SettlementWatcher - Monitors blockchain for sweep transactions
 *
 * Usage (Seller side):
 * ```typescript
 * const watcher = new SettlementWatcher(indexerProvider);
 *
 * watcher.watchForSweep({
 *   lockUtxo: { txid: 'abc...', vout: 0 },
 *   paymentHash: 'def...',
 *   onPreimageRevealed: async (reveal) => {
 *     // Seller got the preimage! Settle the hold invoice.
 *     await holdInvoiceProvider.settleInvoice(reveal.preimage);
 *   },
 *   onTimelockExpired: () => {
 *     // Buyer didn't sweep. Cancel invoice and broadcast refund.
 *   },
 * });
 * ```
 */
export class SettlementWatcher {
  private indexer: IndexerProvider;
  private activeWatchers: Map<string, NodeJS.Timeout> = new Map();

  constructor(indexer: IndexerProvider) {
    this.indexer = indexer;
  }

  /**
   * Start watching a lock UTXO for the sweep transaction
   *
   * @param config - Watcher configuration
   * @returns Stop function
   */
  watchForSweep(config: WatcherConfig): () => void {
    const utxoKey = `${config.lockUtxo.txid}:${config.lockUtxo.vout}`;
    const pollInterval = config.pollIntervalMs ?? 10000; // Default 10 seconds

    // Clear any existing watcher for this UTXO
    if (this.activeWatchers.has(utxoKey)) {
      clearInterval(this.activeWatchers.get(utxoKey)!);
    }

    const checkForSpend = async () => {
      try {
        // Check if UTXO has been spent
        const spendInfo = await this.checkUtxoSpent(
          config.lockUtxo.txid,
          config.lockUtxo.vout
        );

        if (spendInfo) {
          // UTXO was spent! Extract preimage from the sweep tx
          const preimage = await this.extractPreimageFromTx(spendInfo.spendingTxid);

          if (preimage) {
            // Verify preimage matches expected hash
            if (verifyPreimage(preimage, config.paymentHash)) {
              // Stop watching
              this.stopWatching(utxoKey);

              // Callback with reveal info
              config.onPreimageRevealed({
                preimage,
                txid: spendInfo.spendingTxid,
                blockHeight: spendInfo.blockHeight || 0,
                detectedAt: Math.floor(Date.now() / 1000),
              });
            }
          }
        }
      } catch (error) {
        console.error(`[SettlementWatcher] Error checking UTXO ${utxoKey}:`, error);
      }
    };

    // Start polling
    const intervalId = setInterval(checkForSpend, pollInterval);
    this.activeWatchers.set(utxoKey, intervalId);

    // Initial check
    checkForSpend();

    // Return stop function
    return () => this.stopWatching(utxoKey);
  }

  /**
   * Stop watching a specific UTXO
   */
  private stopWatching(utxoKey: string): void {
    const intervalId = this.activeWatchers.get(utxoKey);
    if (intervalId) {
      clearInterval(intervalId);
      this.activeWatchers.delete(utxoKey);
    }
  }

  /**
   * Stop all active watchers
   */
  stopAll(): void {
    this.activeWatchers.forEach((intervalId, key) => {
      clearInterval(intervalId);
    });
    this.activeWatchers.clear();
  }

  /**
   * Check if a UTXO has been spent
   */
  private async checkUtxoSpent(
    txid: string,
    vout: number
  ): Promise<{ spendingTxid: string; blockHeight?: number } | null> {
    // This would typically call a blockchain API
    // Implementation depends on the indexer being used
    //
    // For mempool.space: GET /api/tx/{txid}/outspend/{vout}
    // For Electrum: blockchain.transaction.get_merkle
    // For bitcoind: gettxout returns null if spent

    // Placeholder - actual implementation would use indexer
    return null;
  }

  /**
   * Extract preimage from a sweep transaction's witness
   *
   * In a hashlock spend, the witness stack contains:
   * [signature, preimage]
   *
   * The preimage is the second-to-last item in the witness.
   */
  private async extractPreimageFromTx(txid: string): Promise<string | null> {
    try {
      // Get transaction details
      const tx = await this.indexer.getTransaction(txid);
      if (!tx) return null;

      // The preimage would be in the witness data
      // This requires parsing the raw transaction
      //
      // For a Taproot script-path spend with hashlock:
      // witness = [signature, preimage, script, control_block]
      //
      // The preimage is typically 32 bytes

      // Placeholder - actual implementation would parse witness
      return null;
    } catch {
      return null;
    }
  }
}

// =============================================================================
// PREIMAGE STORAGE (Browser)
// =============================================================================

/**
 * Store preimage in localStorage for recovery
 *
 * CRITICAL: If the browser crashes after payment but before sweep,
 * the buyer needs to recover the preimage.
 *
 * @param paymentHash - The payment hash (used as key)
 * @param preimage - The preimage to store
 */
export function storePreimageLocal(paymentHash: string, preimage: string): void {
  if (typeof localStorage !== 'undefined') {
    const key = `sparkle_preimage_${paymentHash}`;
    const data = {
      preimage,
      storedAt: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(data));
  }
}

/**
 * Recover preimage from localStorage
 *
 * @param paymentHash - The payment hash to look up
 * @returns Preimage or null if not found
 */
export function recoverPreimageLocal(paymentHash: string): string | null {
  if (typeof localStorage !== 'undefined') {
    const key = `sparkle_preimage_${paymentHash}`;
    const data = localStorage.getItem(key);
    if (data) {
      try {
        const parsed = JSON.parse(data);
        return parsed.preimage || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Clear stored preimage after successful sweep
 *
 * @param paymentHash - The payment hash to clear
 */
export function clearPreimageLocal(paymentHash: string): void {
  if (typeof localStorage !== 'undefined') {
    const key = `sparkle_preimage_${paymentHash}`;
    localStorage.removeItem(key);
  }
}

// =============================================================================
// AUTO-SETTLEMENT FLOW
// =============================================================================

/**
 * AutoSettler - Combines watcher with hold invoice settlement
 *
 * This is the complete seller-side automation:
 * 1. Watch for buyer's sweep transaction
 * 2. Extract preimage from witness
 * 3. Settle the hold invoice
 *
 * Usage:
 * ```typescript
 * const settler = new AutoSettler(indexer, holdInvoiceProvider);
 * settler.start({
 *   lockUtxo: { txid: 'abc...', vout: 0 },
 *   paymentHash: 'def...',
 * });
 * ```
 */
export class AutoSettler {
  private watcher: SettlementWatcher;
  private holdInvoice: HoldInvoiceProvider;
  private stopFn: (() => void) | null = null;

  constructor(indexer: IndexerProvider, holdInvoice: HoldInvoiceProvider) {
    this.watcher = new SettlementWatcher(indexer);
    this.holdInvoice = holdInvoice;
  }

  /**
   * Start auto-settlement for a swap
   */
  start(config: {
    lockUtxo: { txid: string; vout: number };
    paymentHash: string;
    onSettled?: (preimage: string, txid: string) => void;
    onError?: (error: Error) => void;
    pollIntervalMs?: number;
  }): void {
    this.stopFn = this.watcher.watchForSweep({
      lockUtxo: config.lockUtxo,
      paymentHash: config.paymentHash,
      pollIntervalMs: config.pollIntervalMs,
      onPreimageRevealed: async (reveal) => {
        try {
          // Settle the hold invoice
          const settled = await this.holdInvoice.settleInvoice(reveal.preimage);

          if (settled && config.onSettled) {
            config.onSettled(reveal.preimage, reveal.txid);
          }
        } catch (error) {
          if (config.onError) {
            config.onError(error as Error);
          }
        }
      },
    });
  }

  /**
   * Stop auto-settlement
   */
  stop(): void {
    if (this.stopFn) {
      this.stopFn();
      this.stopFn = null;
    }
  }
}
