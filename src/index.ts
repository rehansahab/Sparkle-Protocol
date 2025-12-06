/**
 * Sparkle Protocol
 *
 * Trustless atomic swaps for Bitcoin Ordinals via Lightning Network.
 *
 * @module sparkle-protocol
 * @version 0.3.0
 */

// Core - Taproot atomic swap primitives
export * from './core/index.js';

// Auction - Pay-to-bid Lightning auctions
export * from './auction/index.js';

// Indexer - Inscription discovery and tracking
export * from './indexer/index.js';

// Lightning - LND/CLN node connectors
export * from './lightning/index.js';

// Coordinator - WebSocket trade coordination
export * from './coordinator/index.js';

// Browser - Wallet integrations (NIP-07, Unisat, Xverse)
export * from './browser/index.js';

// Version
export const VERSION = '0.3.0';
