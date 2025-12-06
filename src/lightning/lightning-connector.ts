/**
 * Sparkle Protocol - Lightning Node Connector
 *
 * Unified interface for LND and Core Lightning (CLN) nodes.
 * Enables invoice generation with specific payment hashes for atomic swaps.
 *
 * @module sparkle-protocol/lightning
 * @version 0.3.0
 */

import { EventEmitter } from 'events';
import { bytesToHex, hexToBytes } from '@noble/curves/abstract/utils';

// ============================================================================
// Types
// ============================================================================

export type LightningBackend = 'lnd' | 'cln' | 'ldk';

export interface LightningConfig {
  backend: LightningBackend;
  /** LND: REST endpoint, CLN: socket path or REST */
  endpoint: string;
  /** LND: macaroon hex, CLN: rune */
  credentials: string;
  /** TLS certificate (optional for some setups) */
  tlsCert?: string;
  /** Network */
  network: 'mainnet' | 'testnet' | 'regtest';
}

export interface Invoice {
  /** BOLT11 invoice string */
  bolt11: string;
  /** Payment hash (hex) */
  paymentHash: string;
  /** Payment preimage (hex) - only if we generated it */
  preimage?: string;
  /** Amount in satoshis */
  amountSats: bigint;
  /** Description */
  description: string;
  /** Expiry timestamp */
  expiresAt: number;
  /** Creation timestamp */
  createdAt: number;
  /** Invoice state */
  state: 'pending' | 'paid' | 'expired' | 'cancelled';
}

export interface Payment {
  /** Payment hash */
  paymentHash: string;
  /** Preimage (revealed after payment) */
  preimage?: string;
  /** Amount paid in satoshis */
  amountSats: bigint;
  /** Fee paid in satoshis */
  feeSats: bigint;
  /** Payment state */
  state: 'pending' | 'succeeded' | 'failed';
  /** Failure reason (if failed) */
  failureReason?: string;
  /** Creation timestamp */
  createdAt: number;
  /** Settlement timestamp */
  settledAt?: number;
}

export interface NodeInfo {
  /** Node public key */
  pubkey: string;
  /** Node alias */
  alias: string;
  /** Number of channels */
  numChannels: number;
  /** Total local balance (sats) */
  localBalanceSats: bigint;
  /** Total remote balance (sats) */
  remoteBalanceSats: bigint;
  /** Pending channels */
  pendingChannels: number;
  /** Block height */
  blockHeight: number;
  /** Synced to chain */
  syncedToChain: boolean;
}

export interface Channel {
  /** Channel ID */
  channelId: string;
  /** Remote node pubkey */
  remotePubkey: string;
  /** Local balance (sats) */
  localBalanceSats: bigint;
  /** Remote balance (sats) */
  remoteBalanceSats: bigint;
  /** Channel capacity (sats) */
  capacitySats: bigint;
  /** Is active */
  active: boolean;
  /** Is private */
  private: boolean;
}

export interface CreateInvoiceParams {
  /** Amount in satoshis */
  amountSats: bigint;
  /** Description */
  description: string;
  /** Expiry in seconds (default: 3600) */
  expirySecs?: number;
  /** Specific payment hash (for atomic swaps) */
  paymentHash?: string;
  /** Specific preimage (for atomic swaps) */
  preimage?: string;
  /** Private route hints */
  privateHints?: boolean;
}

export interface PayInvoiceParams {
  /** BOLT11 invoice to pay */
  bolt11: string;
  /** Maximum fee in satoshis */
  maxFeeSats?: bigint;
  /** Timeout in seconds */
  timeoutSecs?: number;
}

// ============================================================================
// Abstract Lightning Connector
// ============================================================================

export abstract class LightningConnector extends EventEmitter {
  protected config: LightningConfig;
  protected connected: boolean = false;

  constructor(config: LightningConfig) {
    super();
    this.config = config;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract getInfo(): Promise<NodeInfo>;
  abstract getChannels(): Promise<Channel[]>;
  abstract createInvoice(params: CreateInvoiceParams): Promise<Invoice>;
  abstract lookupInvoice(paymentHash: string): Promise<Invoice>;
  abstract payInvoice(params: PayInvoiceParams): Promise<Payment>;
  abstract subscribeInvoices(callback: (invoice: Invoice) => void): () => void;

  isConnected(): boolean {
    return this.connected;
  }
}

// ============================================================================
// LND Connector
// ============================================================================

export class LNDConnector extends LightningConnector {
  private baseUrl: string;
  private macaroon: string;

  constructor(config: LightningConfig) {
    super(config);
    this.baseUrl = config.endpoint.replace(/\/$/, '');
    this.macaroon = config.credentials;
  }

  async connect(): Promise<void> {
    try {
      await this.getInfo();
      this.connected = true;
      this.emit('connected');
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnected');
  }

  private async request<T>(
    method: string,
    path: string,
    body?: object
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        'Grpc-Metadata-macaroon': this.macaroon,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LND API error: ${response.status} ${error}`);
    }

    return response.json();
  }

  async getInfo(): Promise<NodeInfo> {
    const info = await this.request<any>('GET', '/v1/getinfo');

    return {
      pubkey: info.identity_pubkey,
      alias: info.alias,
      numChannels: info.num_active_channels,
      localBalanceSats: BigInt(0), // Need to sum from channels
      remoteBalanceSats: BigInt(0),
      pendingChannels: info.num_pending_channels,
      blockHeight: info.block_height,
      syncedToChain: info.synced_to_chain,
    };
  }

  async getChannels(): Promise<Channel[]> {
    const response = await this.request<any>('GET', '/v1/channels');

    return (response.channels || []).map((ch: any) => ({
      channelId: ch.chan_id,
      remotePubkey: ch.remote_pubkey,
      localBalanceSats: BigInt(ch.local_balance || 0),
      remoteBalanceSats: BigInt(ch.remote_balance || 0),
      capacitySats: BigInt(ch.capacity || 0),
      active: ch.active,
      private: ch.private,
    }));
  }

  async createInvoice(params: CreateInvoiceParams): Promise<Invoice> {
    const body: any = {
      value: params.amountSats.toString(),
      memo: params.description,
      expiry: params.expirySecs?.toString() || '3600',
      private: params.privateHints ?? false,
    };

    // For atomic swaps, we can specify the payment hash
    if (params.paymentHash) {
      body.r_hash = Buffer.from(hexToBytes(params.paymentHash)).toString('base64');
    }

    // Or provide the preimage and LND will compute the hash
    if (params.preimage) {
      body.r_preimage = Buffer.from(hexToBytes(params.preimage)).toString('base64');
    }

    const response = await this.request<any>('POST', '/v1/invoices', body);

    const paymentHash = bytesToHex(
      new Uint8Array(Buffer.from(response.r_hash, 'base64'))
    );

    return {
      bolt11: response.payment_request,
      paymentHash,
      preimage: params.preimage,
      amountSats: params.amountSats,
      description: params.description,
      expiresAt: Math.floor(Date.now() / 1000) + (params.expirySecs || 3600),
      createdAt: Math.floor(Date.now() / 1000),
      state: 'pending',
    };
  }

  async lookupInvoice(paymentHash: string): Promise<Invoice> {
    const hashBase64 = Buffer.from(hexToBytes(paymentHash)).toString('base64url');
    const response = await this.request<any>(
      'GET',
      `/v1/invoice/${hashBase64}`
    );

    let state: Invoice['state'] = 'pending';
    if (response.settled) {
      state = 'paid';
    } else if (response.state === 'CANCELED') {
      state = 'cancelled';
    } else if (Date.now() / 1000 > response.creation_date + response.expiry) {
      state = 'expired';
    }

    return {
      bolt11: response.payment_request,
      paymentHash,
      preimage: response.r_preimage
        ? bytesToHex(new Uint8Array(Buffer.from(response.r_preimage, 'base64')))
        : undefined,
      amountSats: BigInt(response.value || 0),
      description: response.memo || '',
      expiresAt: response.creation_date + response.expiry,
      createdAt: response.creation_date,
      state,
    };
  }

  async payInvoice(params: PayInvoiceParams): Promise<Payment> {
    const body: any = {
      payment_request: params.bolt11,
      timeout_seconds: params.timeoutSecs || 60,
    };

    if (params.maxFeeSats) {
      body.fee_limit = { fixed: params.maxFeeSats.toString() };
    }

    const response = await this.request<any>('POST', '/v1/channels/transactions', body);

    const paymentHash = bytesToHex(
      new Uint8Array(Buffer.from(response.payment_hash, 'base64'))
    );

    let state: Payment['state'] = 'pending';
    if (response.payment_error) {
      state = 'failed';
    } else if (response.payment_preimage) {
      state = 'succeeded';
    }

    return {
      paymentHash,
      preimage: response.payment_preimage
        ? bytesToHex(new Uint8Array(Buffer.from(response.payment_preimage, 'base64')))
        : undefined,
      amountSats: BigInt(response.value || 0),
      feeSats: BigInt(response.payment_route?.total_fees || 0),
      state,
      failureReason: response.payment_error,
      createdAt: Math.floor(Date.now() / 1000),
      settledAt: state === 'succeeded' ? Math.floor(Date.now() / 1000) : undefined,
    };
  }

  subscribeInvoices(callback: (invoice: Invoice) => void): () => void {
    // In real implementation, use WebSocket or gRPC streaming
    // This is a polling fallback
    const knownHashes = new Set<string>();
    let running = true;

    const poll = async () => {
      while (running) {
        try {
          const response = await this.request<any>('GET', '/v1/invoices?pending_only=true');
          for (const inv of response.invoices || []) {
            const hash = bytesToHex(new Uint8Array(Buffer.from(inv.r_hash, 'base64')));
            if (!knownHashes.has(hash) && inv.settled) {
              knownHashes.add(hash);
              const invoice = await this.lookupInvoice(hash);
              callback(invoice);
            }
          }
        } catch (error) {
          this.emit('error', error);
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    };

    poll();

    return () => {
      running = false;
    };
  }
}

// ============================================================================
// Core Lightning (CLN) Connector
// ============================================================================

export class CLNConnector extends LightningConnector {
  private baseUrl: string;
  private rune: string;

  constructor(config: LightningConfig) {
    super(config);
    this.baseUrl = config.endpoint.replace(/\/$/, '');
    this.rune = config.credentials;
  }

  async connect(): Promise<void> {
    try {
      await this.getInfo();
      this.connected = true;
      this.emit('connected');
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnected');
  }

  private async request<T>(method: string, params: object = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}/v1/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Rune: this.rune,
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`CLN API error: ${response.status} ${error}`);
    }

    return response.json();
  }

  async getInfo(): Promise<NodeInfo> {
    const info = await this.request<any>('getinfo');

    return {
      pubkey: info.id,
      alias: info.alias,
      numChannels: info.num_active_channels || 0,
      localBalanceSats: BigInt(0),
      remoteBalanceSats: BigInt(0),
      pendingChannels: info.num_pending_channels || 0,
      blockHeight: info.blockheight,
      syncedToChain: true,
    };
  }

  async getChannels(): Promise<Channel[]> {
    const response = await this.request<any>('listpeerchannels');

    return (response.channels || []).map((ch: any) => ({
      channelId: ch.short_channel_id || ch.channel_id,
      remotePubkey: ch.peer_id,
      localBalanceSats: BigInt(ch.to_us_msat || 0) / 1000n,
      remoteBalanceSats: BigInt(ch.total_msat || 0) / 1000n - BigInt(ch.to_us_msat || 0) / 1000n,
      capacitySats: BigInt(ch.total_msat || 0) / 1000n,
      active: ch.peer_connected && ch.state === 'CHANNELD_NORMAL',
      private: ch.private || false,
    }));
  }

  async createInvoice(params: CreateInvoiceParams): Promise<Invoice> {
    const clnParams: any = {
      amount_msat: (params.amountSats * 1000n).toString(),
      description: params.description,
      expiry: params.expirySecs || 3600,
    };

    // CLN uses 'preimage' parameter for custom preimage
    if (params.preimage) {
      clnParams.preimage = params.preimage;
    }

    const response = await this.request<any>('invoice', clnParams);

    return {
      bolt11: response.bolt11,
      paymentHash: response.payment_hash,
      preimage: params.preimage,
      amountSats: params.amountSats,
      description: params.description,
      expiresAt: response.expires_at,
      createdAt: Math.floor(Date.now() / 1000),
      state: 'pending',
    };
  }

  async lookupInvoice(paymentHash: string): Promise<Invoice> {
    const response = await this.request<any>('listinvoices', {
      payment_hash: paymentHash,
    });

    const inv = response.invoices?.[0];
    if (!inv) {
      throw new Error(`Invoice not found: ${paymentHash}`);
    }

    let state: Invoice['state'] = 'pending';
    if (inv.status === 'paid') {
      state = 'paid';
    } else if (inv.status === 'expired') {
      state = 'expired';
    }

    return {
      bolt11: inv.bolt11,
      paymentHash: inv.payment_hash,
      preimage: inv.payment_preimage,
      amountSats: BigInt(inv.amount_msat || 0) / 1000n,
      description: inv.description || '',
      expiresAt: inv.expires_at,
      createdAt: inv.created_index,
      state,
    };
  }

  async payInvoice(params: PayInvoiceParams): Promise<Payment> {
    const clnParams: any = {
      bolt11: params.bolt11,
    };

    if (params.maxFeeSats) {
      clnParams.maxfee = (params.maxFeeSats * 1000n).toString();
    }

    const response = await this.request<any>('pay', clnParams);

    return {
      paymentHash: response.payment_hash,
      preimage: response.payment_preimage,
      amountSats: BigInt(response.amount_sent_msat || 0) / 1000n,
      feeSats: BigInt(response.amount_sent_msat - response.amount_msat || 0) / 1000n,
      state: response.status === 'complete' ? 'succeeded' : 'failed',
      createdAt: Math.floor(Date.now() / 1000),
      settledAt: Math.floor(Date.now() / 1000),
    };
  }

  subscribeInvoices(callback: (invoice: Invoice) => void): () => void {
    // CLN has waitinvoice and waitanyinvoice for blocking
    // This is a polling implementation
    let running = true;
    let lastIndex = 0;

    const poll = async () => {
      while (running) {
        try {
          const response = await this.request<any>('listinvoices', {
            index: 'created',
            start: lastIndex,
          });

          for (const inv of response.invoices || []) {
            if (inv.status === 'paid' && inv.created_index > lastIndex) {
              lastIndex = inv.created_index;
              const invoice = await this.lookupInvoice(inv.payment_hash);
              callback(invoice);
            }
          }
        } catch (error) {
          this.emit('error', error);
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    };

    poll();

    return () => {
      running = false;
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createLightningConnector(config: LightningConfig): LightningConnector {
  switch (config.backend) {
    case 'lnd':
      return new LNDConnector(config);
    case 'cln':
      return new CLNConnector(config);
    default:
      throw new Error(`Unsupported Lightning backend: ${config.backend}`);
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create an invoice specifically for an atomic swap
 * Uses a pre-determined payment hash linked to the swap
 */
export async function createSwapInvoice(
  connector: LightningConnector,
  paymentHash: string,
  amountSats: bigint,
  description: string,
  expirySecs: number = 3600
): Promise<Invoice> {
  return connector.createInvoice({
    amountSats,
    description,
    expirySecs,
    paymentHash,
  });
}

/**
 * Wait for an invoice to be paid
 */
export function waitForPayment(
  connector: LightningConnector,
  paymentHash: string,
  timeoutMs: number = 600000
): Promise<Invoice> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error('Payment timeout'));
    }, timeoutMs);

    const unsubscribe = connector.subscribeInvoices((invoice) => {
      if (invoice.paymentHash === paymentHash && invoice.state === 'paid') {
        clearTimeout(timeout);
        unsubscribe();
        resolve(invoice);
      }
    });
  });
}
