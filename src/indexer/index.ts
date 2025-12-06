/**
 * Sparkle Protocol - Indexer Module
 *
 * Discovers and tracks Sparkle-compatible Bitcoin Ordinal inscriptions.
 *
 * @module sparkle-protocol/indexer
 * @version 0.3.0
 */

export {
  SparkleIndexer,
  createIndexer,
  DEFAULT_INDEXER_CONFIG,
  type Inscription,
  type Collection,
  type SwapOffer,
  type SparkleMetadata,
  type IndexerConfig,
  type IndexerStats,
} from './sparkle-indexer.js';
