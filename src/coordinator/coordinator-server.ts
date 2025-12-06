/**
 * Sparkle Protocol - Coordinator Server
 *
 * Non-custodial trade coordination service with WebSocket real-time updates.
 * Facilitates atomic swaps between buyers and sellers without holding custody.
 *
 * @module sparkle-protocol/coordinator
 * @version 0.3.0
 */

import { EventEmitter } from 'events';
import { randomBytes } from '@noble/hashes/utils';
import { bytesToHex } from '@noble/curves/abstract/utils';

// ============================================================================
// Types
// ============================================================================

export type SwapStatus =
  | 'created'          // Swap offer created
  | 'negotiating'      // Buyer/seller negotiating terms
  | 'funded'           // Seller has funded the swap address
  | 'invoice_created'  // Lightning invoice generated
  | 'payment_pending'  // Waiting for Lightning payment
  | 'payment_received' // Payment received, preimage revealed
  | 'claiming'         // Buyer is claiming the ordinal
  | 'completed'        // Swap completed successfully
  | 'refunding'        // Seller is refunding (timeout)
  | 'refunded'         // Seller has refunded
  | 'cancelled'        // Swap cancelled
  | 'expired';         // Swap expired

export interface SwapParticipant {
  /** Nostr pubkey */
  nostrPubkey: string;
  /** Bitcoin address (Taproot) */
  bitcoinAddress?: string;
  /** Connected WebSocket session ID */
  sessionId?: string;
  /** Last seen timestamp */
  lastSeen: number;
}

export interface Swap {
  id: string;
  /** Ordinal inscription ID */
  inscriptionId: string;
  /** Price in satoshis */
  priceSats: bigint;
  /** Seller information */
  seller: SwapParticipant;
  /** Buyer information (if matched) */
  buyer?: SwapParticipant;
  /** Current status */
  status: SwapStatus;
  /** Swap address (Taproot with hashlock/timelock) */
  swapAddress?: string;
  /** Payment hash for the swap */
  paymentHash?: string;
  /** Preimage (revealed after payment) */
  preimage?: string;
  /** Lightning invoice */
  lightningInvoice?: string;
  /** Funding transaction ID */
  fundingTxid?: string;
  /** Funding output index */
  fundingVout?: number;
  /** Claim transaction ID */
  claimTxid?: string;
  /** Refund transaction ID */
  refundTxid?: string;
  /** Refund locktime (block height) */
  refundLocktime?: number;
  /** Created timestamp */
  createdAt: number;
  /** Updated timestamp */
  updatedAt: number;
  /** Expiry timestamp */
  expiresAt: number;
  /** Messages between parties */
  messages: SwapMessage[];
}

export interface SwapMessage {
  id: string;
  swapId: string;
  senderPubkey: string;
  content: string;
  timestamp: number;
}

export interface WebSocketClient {
  id: string;
  nostrPubkey?: string;
  subscriptions: Set<string>; // Swap IDs
  lastPing: number;
  send: (message: string) => void;
  close: () => void;
}

export interface CoordinatorConfig {
  /** Server port */
  port: number;
  /** Maximum swap duration (seconds) */
  maxSwapDurationSecs: number;
  /** Coordinator fee (basis points, 100 = 1%) */
  feeBasisPoints: number;
  /** Minimum swap amount (sats) */
  minSwapSats: bigint;
  /** Maximum swap amount (sats) */
  maxSwapSats: bigint;
  /** Heartbeat interval (ms) */
  heartbeatIntervalMs: number;
  /** Client timeout (ms) */
  clientTimeoutMs: number;
}

export interface CreateSwapParams {
  inscriptionId: string;
  priceSats: bigint;
  sellerNostrPubkey: string;
  sellerBitcoinAddress: string;
  durationSecs?: number;
}

export interface AcceptSwapParams {
  swapId: string;
  buyerNostrPubkey: string;
  buyerBitcoinAddress: string;
}

// ============================================================================
// WebSocket Message Types
// ============================================================================

export type WSMessageType =
  | 'auth'
  | 'subscribe'
  | 'unsubscribe'
  | 'create_swap'
  | 'accept_swap'
  | 'fund_swap'
  | 'pay_swap'
  | 'claim_swap'
  | 'refund_swap'
  | 'cancel_swap'
  | 'send_message'
  | 'get_swaps'
  | 'get_swap'
  | 'ping'
  | 'pong';

export interface WSMessage {
  type: WSMessageType;
  id?: string;
  payload?: any;
}

export interface WSResponse {
  type: 'response' | 'error' | 'event';
  id?: string;
  payload: any;
}

// ============================================================================
// Coordinator Server Class
// ============================================================================

export class CoordinatorServer extends EventEmitter {
  private config: CoordinatorConfig;
  private swaps: Map<string, Swap> = new Map();
  private clients: Map<string, WebSocketClient> = new Map();
  private swapsByInscription: Map<string, Set<string>> = new Map();
  private swapsByParticipant: Map<string, Set<string>> = new Map();
  private heartbeatTimer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config: Partial<CoordinatorConfig> = {}) {
    super();
    this.config = {
      port: config.port || 3000,
      maxSwapDurationSecs: config.maxSwapDurationSecs || 86400, // 24 hours
      feeBasisPoints: config.feeBasisPoints || 50, // 0.5%
      minSwapSats: config.minSwapSats || 10000n,
      maxSwapSats: config.maxSwapSats || 100000000n, // 1 BTC
      heartbeatIntervalMs: config.heartbeatIntervalMs || 30000,
      clientTimeoutMs: config.clientTimeoutMs || 90000,
    };
  }

  /**
   * Start the coordinator server
   */
  start(): void {
    // Start heartbeat timer
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeats();
    }, this.config.heartbeatIntervalMs);

    // Start cleanup timer
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredSwaps();
      this.cleanupInactiveClients();
    }, 60000); // Every minute

    this.emit('started', { port: this.config.port });
    console.log(`[Coordinator] Started on port ${this.config.port}`);
  }

  /**
   * Stop the coordinator server
   */
  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    // Close all client connections
    for (const client of this.clients.values()) {
      client.close();
    }
    this.clients.clear();

    this.emit('stopped');
    console.log('[Coordinator] Stopped');
  }

  /**
   * Handle new WebSocket connection
   */
  handleConnection(
    clientId: string,
    send: (message: string) => void,
    close: () => void
  ): WebSocketClient {
    const client: WebSocketClient = {
      id: clientId,
      subscriptions: new Set(),
      lastPing: Date.now(),
      send,
      close,
    };

    this.clients.set(clientId, client);
    this.emit('client_connected', clientId);
    console.log(`[Coordinator] Client connected: ${clientId}`);

    return client;
  }

  /**
   * Handle client disconnection
   */
  handleDisconnection(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      // Update participant last seen for their swaps
      if (client.nostrPubkey) {
        const swapIds = this.swapsByParticipant.get(client.nostrPubkey);
        if (swapIds) {
          for (const swapId of swapIds) {
            const swap = this.swaps.get(swapId);
            if (swap) {
              if (swap.seller.nostrPubkey === client.nostrPubkey) {
                swap.seller.sessionId = undefined;
              }
              if (swap.buyer?.nostrPubkey === client.nostrPubkey) {
                swap.buyer.sessionId = undefined;
              }
            }
          }
        }
      }

      this.clients.delete(clientId);
      this.emit('client_disconnected', clientId);
      console.log(`[Coordinator] Client disconnected: ${clientId}`);
    }
  }

  /**
   * Handle incoming WebSocket message
   */
  async handleMessage(clientId: string, rawMessage: string): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) {
      return;
    }

    let message: WSMessage;
    try {
      message = JSON.parse(rawMessage);
    } catch {
      this.sendError(client, 'invalid_json', 'Invalid JSON message');
      return;
    }

    try {
      switch (message.type) {
        case 'ping':
          client.lastPing = Date.now();
          this.sendResponse(client, message.id, 'pong', {});
          break;

        case 'auth':
          await this.handleAuth(client, message);
          break;

        case 'subscribe':
          await this.handleSubscribe(client, message);
          break;

        case 'unsubscribe':
          await this.handleUnsubscribe(client, message);
          break;

        case 'create_swap':
          await this.handleCreateSwap(client, message);
          break;

        case 'accept_swap':
          await this.handleAcceptSwap(client, message);
          break;

        case 'fund_swap':
          await this.handleFundSwap(client, message);
          break;

        case 'pay_swap':
          await this.handlePaySwap(client, message);
          break;

        case 'claim_swap':
          await this.handleClaimSwap(client, message);
          break;

        case 'cancel_swap':
          await this.handleCancelSwap(client, message);
          break;

        case 'send_message':
          await this.handleSendMessage(client, message);
          break;

        case 'get_swaps':
          await this.handleGetSwaps(client, message);
          break;

        case 'get_swap':
          await this.handleGetSwap(client, message);
          break;

        default:
          this.sendError(client, message.id, `Unknown message type: ${message.type}`);
      }
    } catch (error: any) {
      this.sendError(client, message.id, error.message);
    }
  }

  // ============================================================================
  // Message Handlers
  // ============================================================================

  private async handleAuth(client: WebSocketClient, message: WSMessage): Promise<void> {
    const { nostrPubkey, signature } = message.payload || {};

    if (!nostrPubkey) {
      throw new Error('nostrPubkey required');
    }

    // In real implementation, verify NIP-98 signature
    // For now, trust the pubkey
    client.nostrPubkey = nostrPubkey;

    // Track client's swaps
    if (!this.swapsByParticipant.has(nostrPubkey)) {
      this.swapsByParticipant.set(nostrPubkey, new Set());
    }

    this.sendResponse(client, message.id, 'auth', { success: true });
  }

  private async handleSubscribe(client: WebSocketClient, message: WSMessage): Promise<void> {
    const { swapId } = message.payload || {};

    if (!swapId) {
      throw new Error('swapId required');
    }

    const swap = this.swaps.get(swapId);
    if (!swap) {
      throw new Error('Swap not found');
    }

    // Verify client is a participant
    if (
      client.nostrPubkey !== swap.seller.nostrPubkey &&
      client.nostrPubkey !== swap.buyer?.nostrPubkey
    ) {
      throw new Error('Not authorized to subscribe to this swap');
    }

    client.subscriptions.add(swapId);
    this.sendResponse(client, message.id, 'subscribe', { swapId, swap: this.sanitizeSwap(swap) });
  }

  private async handleUnsubscribe(client: WebSocketClient, message: WSMessage): Promise<void> {
    const { swapId } = message.payload || {};
    client.subscriptions.delete(swapId);
    this.sendResponse(client, message.id, 'unsubscribe', { swapId });
  }

  private async handleCreateSwap(client: WebSocketClient, message: WSMessage): Promise<void> {
    if (!client.nostrPubkey) {
      throw new Error('Authentication required');
    }

    const params: CreateSwapParams = {
      inscriptionId: message.payload.inscriptionId,
      priceSats: BigInt(message.payload.priceSats),
      sellerNostrPubkey: client.nostrPubkey,
      sellerBitcoinAddress: message.payload.bitcoinAddress,
      durationSecs: message.payload.durationSecs,
    };

    const swap = this.createSwap(params);
    client.subscriptions.add(swap.id);

    this.sendResponse(client, message.id, 'create_swap', { swap: this.sanitizeSwap(swap) });
    this.emit('swap_created', swap);
  }

  private async handleAcceptSwap(client: WebSocketClient, message: WSMessage): Promise<void> {
    if (!client.nostrPubkey) {
      throw new Error('Authentication required');
    }

    const params: AcceptSwapParams = {
      swapId: message.payload.swapId,
      buyerNostrPubkey: client.nostrPubkey,
      buyerBitcoinAddress: message.payload.bitcoinAddress,
    };

    const swap = this.acceptSwap(params);
    client.subscriptions.add(swap.id);

    this.sendResponse(client, message.id, 'accept_swap', { swap: this.sanitizeSwap(swap) });
    this.broadcastSwapUpdate(swap);
    this.emit('swap_accepted', swap);
  }

  private async handleFundSwap(client: WebSocketClient, message: WSMessage): Promise<void> {
    const { swapId, fundingTxid, fundingVout } = message.payload || {};

    const swap = this.swaps.get(swapId);
    if (!swap) {
      throw new Error('Swap not found');
    }

    if (client.nostrPubkey !== swap.seller.nostrPubkey) {
      throw new Error('Only seller can fund');
    }

    swap.fundingTxid = fundingTxid;
    swap.fundingVout = fundingVout;
    swap.status = 'funded';
    swap.updatedAt = Math.floor(Date.now() / 1000);

    this.sendResponse(client, message.id, 'fund_swap', { swap: this.sanitizeSwap(swap) });
    this.broadcastSwapUpdate(swap);
    this.emit('swap_funded', swap);
  }

  private async handlePaySwap(client: WebSocketClient, message: WSMessage): Promise<void> {
    const { swapId, preimage } = message.payload || {};

    const swap = this.swaps.get(swapId);
    if (!swap) {
      throw new Error('Swap not found');
    }

    // Verify preimage matches payment hash
    // In real implementation, verify SHA256(preimage) === paymentHash

    swap.preimage = preimage;
    swap.status = 'payment_received';
    swap.updatedAt = Math.floor(Date.now() / 1000);

    this.sendResponse(client, message.id, 'pay_swap', { swap: this.sanitizeSwap(swap) });
    this.broadcastSwapUpdate(swap);
    this.emit('swap_paid', swap);
  }

  private async handleClaimSwap(client: WebSocketClient, message: WSMessage): Promise<void> {
    const { swapId, claimTxid } = message.payload || {};

    const swap = this.swaps.get(swapId);
    if (!swap) {
      throw new Error('Swap not found');
    }

    if (client.nostrPubkey !== swap.buyer?.nostrPubkey) {
      throw new Error('Only buyer can claim');
    }

    swap.claimTxid = claimTxid;
    swap.status = 'completed';
    swap.updatedAt = Math.floor(Date.now() / 1000);

    this.sendResponse(client, message.id, 'claim_swap', { swap: this.sanitizeSwap(swap) });
    this.broadcastSwapUpdate(swap);
    this.emit('swap_completed', swap);
  }

  private async handleCancelSwap(client: WebSocketClient, message: WSMessage): Promise<void> {
    const { swapId } = message.payload || {};

    const swap = this.swaps.get(swapId);
    if (!swap) {
      throw new Error('Swap not found');
    }

    if (
      client.nostrPubkey !== swap.seller.nostrPubkey &&
      client.nostrPubkey !== swap.buyer?.nostrPubkey
    ) {
      throw new Error('Not authorized');
    }

    // Can only cancel if not yet funded
    if (swap.status !== 'created' && swap.status !== 'negotiating') {
      throw new Error('Cannot cancel swap in current state');
    }

    swap.status = 'cancelled';
    swap.updatedAt = Math.floor(Date.now() / 1000);

    this.sendResponse(client, message.id, 'cancel_swap', { swap: this.sanitizeSwap(swap) });
    this.broadcastSwapUpdate(swap);
    this.emit('swap_cancelled', swap);
  }

  private async handleSendMessage(client: WebSocketClient, message: WSMessage): Promise<void> {
    const { swapId, content } = message.payload || {};

    const swap = this.swaps.get(swapId);
    if (!swap) {
      throw new Error('Swap not found');
    }

    if (
      client.nostrPubkey !== swap.seller.nostrPubkey &&
      client.nostrPubkey !== swap.buyer?.nostrPubkey
    ) {
      throw new Error('Not a participant');
    }

    const swapMessage: SwapMessage = {
      id: bytesToHex(randomBytes(16)),
      swapId,
      senderPubkey: client.nostrPubkey!,
      content,
      timestamp: Math.floor(Date.now() / 1000),
    };

    swap.messages.push(swapMessage);
    swap.updatedAt = Math.floor(Date.now() / 1000);

    this.sendResponse(client, message.id, 'send_message', { message: swapMessage });
    this.broadcastToSwap(swap.id, { type: 'event', payload: { event: 'message', message: swapMessage } });
  }

  private async handleGetSwaps(client: WebSocketClient, message: WSMessage): Promise<void> {
    if (!client.nostrPubkey) {
      throw new Error('Authentication required');
    }

    const swapIds = this.swapsByParticipant.get(client.nostrPubkey) || new Set();
    const swaps = Array.from(swapIds)
      .map((id) => this.swaps.get(id))
      .filter((s): s is Swap => s !== undefined)
      .map((s) => this.sanitizeSwap(s));

    this.sendResponse(client, message.id, 'get_swaps', { swaps });
  }

  private async handleGetSwap(client: WebSocketClient, message: WSMessage): Promise<void> {
    const { swapId } = message.payload || {};

    const swap = this.swaps.get(swapId);
    if (!swap) {
      throw new Error('Swap not found');
    }

    this.sendResponse(client, message.id, 'get_swap', { swap: this.sanitizeSwap(swap) });
  }

  // ============================================================================
  // Core Swap Operations
  // ============================================================================

  /**
   * Create a new swap
   */
  createSwap(params: CreateSwapParams): Swap {
    // Validate
    if (params.priceSats < this.config.minSwapSats) {
      throw new Error(`Minimum swap amount is ${this.config.minSwapSats} sats`);
    }
    if (params.priceSats > this.config.maxSwapSats) {
      throw new Error(`Maximum swap amount is ${this.config.maxSwapSats} sats`);
    }

    const now = Math.floor(Date.now() / 1000);
    const duration = params.durationSecs || this.config.maxSwapDurationSecs;

    const swap: Swap = {
      id: bytesToHex(randomBytes(16)),
      inscriptionId: params.inscriptionId,
      priceSats: params.priceSats,
      seller: {
        nostrPubkey: params.sellerNostrPubkey,
        bitcoinAddress: params.sellerBitcoinAddress,
        lastSeen: now,
      },
      status: 'created',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + duration,
      messages: [],
    };

    // Store swap
    this.swaps.set(swap.id, swap);

    // Index by inscription
    if (!this.swapsByInscription.has(params.inscriptionId)) {
      this.swapsByInscription.set(params.inscriptionId, new Set());
    }
    this.swapsByInscription.get(params.inscriptionId)!.add(swap.id);

    // Index by participant
    if (!this.swapsByParticipant.has(params.sellerNostrPubkey)) {
      this.swapsByParticipant.set(params.sellerNostrPubkey, new Set());
    }
    this.swapsByParticipant.get(params.sellerNostrPubkey)!.add(swap.id);

    return swap;
  }

  /**
   * Accept a swap (buyer)
   */
  acceptSwap(params: AcceptSwapParams): Swap {
    const swap = this.swaps.get(params.swapId);
    if (!swap) {
      throw new Error('Swap not found');
    }

    if (swap.status !== 'created') {
      throw new Error('Swap is not available');
    }

    if (swap.seller.nostrPubkey === params.buyerNostrPubkey) {
      throw new Error('Cannot accept your own swap');
    }

    const now = Math.floor(Date.now() / 1000);

    swap.buyer = {
      nostrPubkey: params.buyerNostrPubkey,
      bitcoinAddress: params.buyerBitcoinAddress,
      lastSeen: now,
    };
    swap.status = 'negotiating';
    swap.updatedAt = now;

    // Index by participant
    if (!this.swapsByParticipant.has(params.buyerNostrPubkey)) {
      this.swapsByParticipant.set(params.buyerNostrPubkey, new Set());
    }
    this.swapsByParticipant.get(params.buyerNostrPubkey)!.add(swap.id);

    return swap;
  }

  /**
   * Get active swaps (public listing)
   */
  getActiveSwaps(): Partial<Swap>[] {
    const now = Math.floor(Date.now() / 1000);
    return Array.from(this.swaps.values())
      .filter((s) => s.status === 'created' && s.expiresAt > now)
      .map((s) => this.sanitizeSwap(s));
  }

  /**
   * Get swap by ID
   */
  getSwap(id: string): Swap | undefined {
    return this.swaps.get(id);
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private sendResponse(
    client: WebSocketClient,
    id: string | undefined,
    type: string,
    payload: any
  ): void {
    client.send(JSON.stringify({ type: 'response', id, payload: { type, ...payload } }));
  }

  private sendError(client: WebSocketClient, id: string | undefined, error: string): void {
    client.send(JSON.stringify({ type: 'error', id, payload: { error } }));
  }

  private broadcastSwapUpdate(swap: Swap): void {
    this.broadcastToSwap(swap.id, {
      type: 'event',
      payload: { event: 'swap_update', swap: this.sanitizeSwap(swap) },
    });
  }

  private broadcastToSwap(swapId: string, message: object): void {
    const messageStr = JSON.stringify(message);
    for (const client of this.clients.values()) {
      if (client.subscriptions.has(swapId)) {
        client.send(messageStr);
      }
    }
  }

  private sanitizeSwap(swap: Swap): Partial<Swap> {
    // Remove sensitive data for public view
    return {
      id: swap.id,
      inscriptionId: swap.inscriptionId,
      priceSats: swap.priceSats,
      seller: {
        nostrPubkey: swap.seller.nostrPubkey,
        lastSeen: swap.seller.lastSeen,
      },
      buyer: swap.buyer
        ? {
            nostrPubkey: swap.buyer.nostrPubkey,
            lastSeen: swap.buyer.lastSeen,
          }
        : undefined,
      status: swap.status,
      swapAddress: swap.swapAddress,
      paymentHash: swap.paymentHash,
      lightningInvoice: swap.lightningInvoice,
      fundingTxid: swap.fundingTxid,
      claimTxid: swap.claimTxid,
      createdAt: swap.createdAt,
      updatedAt: swap.updatedAt,
      expiresAt: swap.expiresAt,
    };
  }

  private sendHeartbeats(): void {
    const message = JSON.stringify({ type: 'ping' });
    for (const client of this.clients.values()) {
      client.send(message);
    }
  }

  private cleanupExpiredSwaps(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const swap of this.swaps.values()) {
      if (swap.expiresAt < now && swap.status === 'created') {
        swap.status = 'expired';
        this.broadcastSwapUpdate(swap);
        this.emit('swap_expired', swap);
      }
    }
  }

  private cleanupInactiveClients(): void {
    const now = Date.now();
    for (const [id, client] of this.clients.entries()) {
      if (now - client.lastPing > this.config.clientTimeoutMs) {
        console.log(`[Coordinator] Removing inactive client: ${id}`);
        client.close();
        this.clients.delete(id);
      }
    }
  }

  // ============================================================================
  // Persistence
  // ============================================================================

  exportState(): { swaps: Swap[] } {
    return {
      swaps: Array.from(this.swaps.values()),
    };
  }

  importState(state: { swaps: Swap[] }): void {
    this.swaps.clear();
    this.swapsByInscription.clear();
    this.swapsByParticipant.clear();

    for (const swap of state.swaps) {
      this.swaps.set(swap.id, swap);

      // Rebuild indexes
      if (!this.swapsByInscription.has(swap.inscriptionId)) {
        this.swapsByInscription.set(swap.inscriptionId, new Set());
      }
      this.swapsByInscription.get(swap.inscriptionId)!.add(swap.id);

      if (!this.swapsByParticipant.has(swap.seller.nostrPubkey)) {
        this.swapsByParticipant.set(swap.seller.nostrPubkey, new Set());
      }
      this.swapsByParticipant.get(swap.seller.nostrPubkey)!.add(swap.id);

      if (swap.buyer) {
        if (!this.swapsByParticipant.has(swap.buyer.nostrPubkey)) {
          this.swapsByParticipant.set(swap.buyer.nostrPubkey, new Set());
        }
        this.swapsByParticipant.get(swap.buyer.nostrPubkey)!.add(swap.id);
      }
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createCoordinator(config?: Partial<CoordinatorConfig>): CoordinatorServer {
  return new CoordinatorServer(config);
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_COORDINATOR_CONFIG: CoordinatorConfig = {
  port: 3000,
  maxSwapDurationSecs: 86400,
  feeBasisPoints: 50,
  minSwapSats: 10000n,
  maxSwapSats: 100000000n,
  heartbeatIntervalMs: 30000,
  clientTimeoutMs: 90000,
};
