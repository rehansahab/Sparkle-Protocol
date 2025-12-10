/**
 * Sparkle Protocol - Hiro Indexer Adapter
 *
 * Production implementation of IndexerProvider using Hiro API.
 * https://docs.hiro.so/ordinals
 *
 * @module sparkle-protocol/adapters/hiro-indexer
 * @version 1.0.0-rc.1
 */

import type { IndexerProvider } from '../sdk-providers.js';
import type { IndexerData } from '../sdk-types.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const HIRO_API_MAINNET = 'https://api.hiro.so';
const HIRO_API_TESTNET = 'https://api.testnet.hiro.so';
const MEMPOOL_API_MAINNET = 'https://mempool.space/api';
const MEMPOOL_API_TESTNET = 'https://mempool.space/testnet/api';

// =============================================================================
// HIRO INDEXER ADAPTER
// =============================================================================

/**
 * Hiro API Indexer Adapter
 *
 * Uses Hiro for Ordinals data and Mempool.space for Bitcoin data.
 */
export class HiroIndexerAdapter implements IndexerProvider {
  private readonly hiroUrl: string;
  private readonly mempoolUrl: string;
  private readonly network: 'mainnet' | 'testnet';

  constructor(network: 'mainnet' | 'testnet' = 'mainnet') {
    this.network = network;
    this.hiroUrl = network === 'mainnet' ? HIRO_API_MAINNET : HIRO_API_TESTNET;
    this.mempoolUrl = network === 'mainnet' ? MEMPOOL_API_MAINNET : MEMPOOL_API_TESTNET;
  }

  /**
   * Validate inscription ownership at specific UTXO
   */
  async validateOwnership(
    inscriptionId: string,
    utxo: { txid: string; vout: number; value: number }
  ): Promise<boolean> {
    const data = await this.getInscriptionData(inscriptionId);

    // Check if inscription is at the claimed UTXO
    if (data.txid !== utxo.txid || data.vout !== utxo.vout) {
      throw new Error(
        `Ownership verification failed: inscription ${inscriptionId} ` +
        `is at ${data.txid}:${data.vout}, not ${utxo.txid}:${utxo.vout}`
      );
    }

    // Check value matches
    if (data.outputValue !== utxo.value) {
      throw new Error(
        `Value mismatch: inscription UTXO has ${data.outputValue} sats, ` +
        `claimed ${utxo.value} sats`
      );
    }

    return true;
  }

  /**
   * Get inscription data from Hiro API
   */
  async getInscriptionData(inscriptionId: string): Promise<IndexerData> {
    const url = `${this.hiroUrl}/ordinals/v1/inscriptions/${inscriptionId}`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Inscription ${inscriptionId} not found`);
      }
      throw new Error(`Hiro API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Parse Hiro response format
    // The location field contains "txid:vout:offset"
    const [txid, voutStr] = (data.location || '').split(':');

    return {
      inscriptionId: data.id || inscriptionId,
      outputValue: data.value || 0,
      address: data.address,
      txid: txid || data.genesis_tx_id,
      vout: parseInt(voutStr || '0', 10),
    };
  }

  /**
   * Get current blockchain height
   */
  async getBlockHeight(): Promise<number> {
    const url = `${this.mempoolUrl}/blocks/tip/height`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Mempool API error: ${response.status}`);
    }

    const height = await response.text();
    return parseInt(height, 10);
  }

  /**
   * Broadcast transaction
   */
  async broadcastTx(txHex: string): Promise<string> {
    const url = `${this.mempoolUrl}/tx`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: txHex,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Broadcast failed: ${error}`);
    }

    const txid = await response.text();
    return txid;
  }

  /**
   * Get transaction details
   */
  async getTransaction(txid: string): Promise<{
    txid: string;
    confirmations: number;
    blockHeight?: number;
    outputs: Array<{ value: number; address: string }>;
  } | null> {
    const url = `${this.mempoolUrl}/tx/${txid}`;

    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Mempool API error: ${response.status}`);
    }

    const tx = await response.json();

    // Get current height for confirmations
    const currentHeight = await this.getBlockHeight();
    const confirmations = tx.status?.block_height
      ? currentHeight - tx.status.block_height + 1
      : 0;

    return {
      txid: tx.txid,
      confirmations,
      blockHeight: tx.status?.block_height,
      outputs: tx.vout.map((out: any) => ({
        value: out.value,
        address: out.scriptpubkey_address || '',
      })),
    };
  }

  /**
   * Check if transaction is confirmed
   */
  async isConfirmed(txid: string, minConfirmations: number = 1): Promise<boolean> {
    const tx = await this.getTransaction(txid);
    if (!tx) return false;
    return tx.confirmations >= minConfirmations;
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create Hiro indexer adapter
 */
export function createHiroIndexer(
  network: 'mainnet' | 'testnet' = 'mainnet'
): IndexerProvider {
  return new HiroIndexerAdapter(network);
}
