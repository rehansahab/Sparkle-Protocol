#!/usr/bin/env node
/**
 * Sparkle Protocol - Production Coordinator Server
 *
 * Complete coordinator server combining WebSocket and REST API.
 * Ready to deploy for production use.
 *
 * Usage:
 *   npx tsx src/coordinator/server.ts
 *   # or after build:
 *   node dist/coordinator/server.js
 *
 * Environment variables:
 *   PORT          - HTTP port (default: 3000)
 *   WS_PORT       - WebSocket port (default: 3001)
 *   DB_PATH       - Database file path (default: ./data/coordinator.json)
 *   NODE_ENV      - Environment (development/production)
 *
 * @module sparkle-protocol/coordinator/server
 */

import { CoordinatorServer, createCoordinator } from './coordinator-server.js';
import { CoordinatorHttpServer, createCoordinatorHttpServer, SwapListItem, CreateSwapRequest } from './http-server.js';
import { CoordinatorDatabase, createDatabase, generateSwapId, SwapRecord } from './database.js';

// Configuration from environment
const config = {
  httpPort: parseInt(process.env.PORT || '3000'),
  wsPort: parseInt(process.env.WS_PORT || '3001'),
  dbPath: process.env.DB_PATH || './data/coordinator.json',
  nodeEnv: process.env.NODE_ENV || 'development',
};

// Initialize database
const db = createDatabase(config.dbPath);
console.log(`Database initialized at: ${config.dbPath}`);

// Initialize WebSocket coordinator
const wsCoordinator = createCoordinator({
  port: config.wsPort,
});

// Bridge functions to connect HTTP API with database
function getSwaps(): SwapListItem[] {
  return db.getActiveSwaps().map(swapToListItem);
}

function getSwapById(id: string): SwapListItem | undefined {
  const swap = db.getSwap(id);
  return swap ? swapToListItem(swap) : undefined;
}

function createSwap(req: CreateSwapRequest): SwapListItem {
  const now = Date.now();
  const durationMs = req.durationMs || 2 * 60 * 60 * 1000; // 2 hours default

  const swap: SwapRecord = {
    id: generateSwapId(),
    inscriptionId: req.inscriptionId,
    priceSats: req.priceSats,
    status: 'created',
    sellerPubkey: req.sellerPubkey,
    sellerBitcoinAddress: req.sellerBitcoinAddress,
    buyerPubkey: null,
    buyerBitcoinAddress: null,
    swapAddress: null,
    paymentHash: null,
    preimage: null,
    lightningInvoice: null,
    fundingTxid: null,
    fundingVout: null,
    claimTxid: null,
    refundTxid: null,
    createdAt: now,
    expiresAt: now + durationMs,
    completedAt: null,
    updatedAt: now,
  };

  db.createSwap(swap);
  console.log(`Swap created: ${swap.id} for inscription ${swap.inscriptionId}`);

  return swapToListItem(swap);
}

function getStats() {
  return db.getStats();
}

function swapToListItem(swap: SwapRecord): SwapListItem {
  return {
    id: swap.id,
    inscriptionId: swap.inscriptionId,
    priceSats: swap.priceSats,
    status: swap.status,
    sellerPubkey: swap.sellerPubkey,
    createdAt: swap.createdAt,
    expiresAt: swap.expiresAt,
  };
}

// Initialize HTTP server
const httpServer = createCoordinatorHttpServer({
  port: config.httpPort,
  getSwaps,
  getSwapById,
  createSwap,
  getStats,
});

// Cleanup expired swaps periodically
const CLEANUP_INTERVAL = 60 * 1000; // 1 minute
setInterval(() => {
  const cleaned = db.cleanupExpired();
  if (cleaned > 0) {
    console.log(`Cleaned up ${cleaned} expired swaps`);
  }
}, CLEANUP_INTERVAL);

// Graceful shutdown
function shutdown() {
  console.log('\nShutting down coordinator...');

  httpServer.stop();
  wsCoordinator.stop();

  console.log('Coordinator stopped');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start servers
console.log(`
╔═══════════════════════════════════════════════════════════╗
║           SPARKLE PROTOCOL COORDINATOR v1.0.0             ║
╠═══════════════════════════════════════════════════════════╣
║  Trustless Atomic Swaps for Bitcoin Ordinals              ║
╚═══════════════════════════════════════════════════════════╝

Environment: ${config.nodeEnv}
`);

httpServer.start();
wsCoordinator.start();

console.log(`
HTTP API:     http://localhost:${config.httpPort}
WebSocket:    ws://localhost:${config.wsPort}
Health:       http://localhost:${config.httpPort}/health

Endpoints:
  GET  /health          - Health check
  GET  /api/swaps       - List active swaps
  GET  /api/swaps/:id   - Get swap details
  POST /api/swaps       - Create new swap
  GET  /api/stats       - Statistics

Ready for connections!
`);
