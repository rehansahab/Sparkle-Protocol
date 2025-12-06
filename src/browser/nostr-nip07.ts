/**
 * Sparkle Protocol - NIP-07 Wallet Integration
 *
 * Provides secure Nostr wallet connection using browser extensions
 * (Alby, nos2x, Flamingo, etc.) instead of raw private key input.
 *
 * SECURITY: This module NEVER handles private keys directly.
 * All signing is delegated to the browser extension.
 *
 * NIP-07 Specification: https://github.com/nostr-protocol/nips/blob/master/07.md
 *
 * @module sparkle-protocol/browser/nostr-nip07
 * @version 0.3.0
 */

/**
 * NIP-07 window.nostr interface
 */
export interface Nip07Provider {
  /** Get the user's public key (hex, 32 bytes) */
  getPublicKey(): Promise<string>;

  /** Sign a Nostr event */
  signEvent(event: UnsignedEvent): Promise<SignedEvent>;

  /** Get configured relays (optional) */
  getRelays?(): Promise<Record<string, { read: boolean; write: boolean }>>;

  /** NIP-04 encryption/decryption */
  nip04?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };

  /** NIP-44 encryption/decryption (newer, more secure) */
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
}

/**
 * Unsigned Nostr event (before signing)
 */
export interface UnsignedEvent {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

/**
 * Signed Nostr event
 */
export interface SignedEvent extends UnsignedEvent {
  id: string;
  pubkey: string;
  sig: string;
}

/**
 * Wallet connection state
 */
export type WalletState =
  | 'not_detected'    // No NIP-07 provider found
  | 'detected'        // Provider found, not connected
  | 'connecting'      // Connection in progress
  | 'connected'       // Successfully connected
  | 'error';          // Connection failed

/**
 * Wallet connection result
 */
export interface WalletConnection {
  state: WalletState;
  pubkey?: string;
  error?: string;
  provider?: Nip07Provider;
}

/**
 * Check if NIP-07 provider is available
 */
export function isNip07Available(): boolean {
  return typeof window !== 'undefined' && 'nostr' in window;
}

/**
 * Get the NIP-07 provider
 */
export function getNip07Provider(): Nip07Provider | null {
  if (!isNip07Available()) return null;
  return (window as any).nostr as Nip07Provider;
}

/**
 * Detect available wallet extensions
 */
export function detectWalletExtension(): {
  available: boolean;
  name: string;
  hasNip04: boolean;
  hasNip44: boolean;
} {
  const provider = getNip07Provider();

  if (!provider) {
    return {
      available: false,
      name: 'None',
      hasNip04: false,
      hasNip44: false,
    };
  }

  // Try to detect which extension it is
  // Most extensions don't identify themselves, but some do
  let name = 'Unknown NIP-07 Extension';

  // Check for common extensions
  if ((window as any).alby) {
    name = 'Alby';
  } else if ((window as any).nos2x) {
    name = 'nos2x';
  }

  return {
    available: true,
    name,
    hasNip04: !!provider.nip04,
    hasNip44: !!provider.nip44,
  };
}

/**
 * Connect to the NIP-07 wallet
 *
 * This prompts the user to approve the connection in their wallet extension.
 *
 * @returns Wallet connection result
 */
export async function connectWallet(): Promise<WalletConnection> {
  const provider = getNip07Provider();

  if (!provider) {
    return {
      state: 'not_detected',
      error: 'No NIP-07 wallet extension detected. Please install Alby, nos2x, or another Nostr wallet.',
    };
  }

  try {
    // Request public key - this triggers the wallet approval prompt
    const pubkey = await provider.getPublicKey();

    if (!pubkey || pubkey.length !== 64) {
      return {
        state: 'error',
        error: 'Invalid public key returned from wallet',
      };
    }

    return {
      state: 'connected',
      pubkey,
      provider,
    };
  } catch (e: any) {
    // User rejected or other error
    return {
      state: 'error',
      error: e.message || 'Wallet connection failed',
    };
  }
}

/**
 * Sign a Nostr event using NIP-07
 *
 * @param event - Unsigned event to sign
 * @returns Signed event
 */
export async function signEvent(event: UnsignedEvent): Promise<SignedEvent> {
  const provider = getNip07Provider();

  if (!provider) {
    throw new Error('No NIP-07 wallet connected');
  }

  return provider.signEvent(event);
}

/**
 * Encrypt a message using NIP-04 (for private DMs)
 *
 * @param recipientPubkey - Recipient's public key (hex)
 * @param plaintext - Message to encrypt
 * @returns Encrypted message
 */
export async function encryptNip04(
  recipientPubkey: string,
  plaintext: string
): Promise<string> {
  const provider = getNip07Provider();

  if (!provider) {
    throw new Error('No NIP-07 wallet connected');
  }

  if (!provider.nip04) {
    throw new Error('Wallet does not support NIP-04 encryption');
  }

  return provider.nip04.encrypt(recipientPubkey, plaintext);
}

/**
 * Decrypt a message using NIP-04
 *
 * @param senderPubkey - Sender's public key (hex)
 * @param ciphertext - Encrypted message
 * @returns Decrypted message
 */
export async function decryptNip04(
  senderPubkey: string,
  ciphertext: string
): Promise<string> {
  const provider = getNip07Provider();

  if (!provider) {
    throw new Error('No NIP-07 wallet connected');
  }

  if (!provider.nip04) {
    throw new Error('Wallet does not support NIP-04 decryption');
  }

  return provider.nip04.decrypt(senderPubkey, ciphertext);
}

/**
 * Get configured relays from the wallet
 */
export async function getWalletRelays(): Promise<string[]> {
  const provider = getNip07Provider();

  if (!provider || !provider.getRelays) {
    return [];
  }

  try {
    const relays = await provider.getRelays();
    return Object.keys(relays);
  } catch {
    return [];
  }
}

// ============================================================================
// SPARKLE-SPECIFIC NOSTR EVENTS
// ============================================================================

/**
 * Nostr event kinds used by Sparkle Protocol
 */
export const SPARKLE_EVENT_KINDS = {
  /** Marketplace listing (NIP-15 inspired) */
  LISTING: 30018,
  /** Encrypted DM for swap negotiation */
  ENCRYPTED_DM: 4,
  /** Swap offer broadcast */
  SWAP_OFFER: 30078,
  /** Swap acceptance */
  SWAP_ACCEPT: 30079,
} as const;

/**
 * Create a swap offer event for Nostr broadcast
 */
export function createSwapOfferEvent(params: {
  ordinalId: string;
  priceSats: bigint;
  swapAddress: string;
  paymentHashHex: string;
  refundLocktime: number;
  buyerPubkeyHex: string;
  expiresAt?: number;
}): UnsignedEvent {
  const content = JSON.stringify({
    ordinal: params.ordinalId,
    price: params.priceSats.toString(),
    swap_address: params.swapAddress,
    payment_hash: params.paymentHashHex,
    refund_locktime: params.refundLocktime,
    buyer_pubkey: params.buyerPubkeyHex,
    expires_at: params.expiresAt || Math.floor(Date.now() / 1000) + 86400,
  });

  return {
    kind: SPARKLE_EVENT_KINDS.SWAP_OFFER,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', params.ordinalId], // Unique identifier
      ['p', params.buyerPubkeyHex], // Tag the buyer
      ['price', params.priceSats.toString()],
      ['t', 'sparkle-swap'],
    ],
    content,
  };
}

/**
 * Create encrypted DM for swap negotiation
 */
export async function createSwapDM(params: {
  recipientPubkey: string;
  swapData: {
    type: 'offer' | 'accept' | 'reject' | 'claim_ready' | 'refund_ready';
    swapId: string;
    data?: any;
  };
}): Promise<UnsignedEvent> {
  const plaintext = JSON.stringify(params.swapData);
  const ciphertext = await encryptNip04(params.recipientPubkey, plaintext);

  return {
    kind: SPARKLE_EVENT_KINDS.ENCRYPTED_DM,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['p', params.recipientPubkey],
    ],
    content: ciphertext,
  };
}

/**
 * Decode a swap DM
 */
export async function decodeSwapDM(
  event: SignedEvent
): Promise<{
  type: 'offer' | 'accept' | 'reject' | 'claim_ready' | 'refund_ready';
  swapId: string;
  data?: any;
}> {
  const plaintext = await decryptNip04(event.pubkey, event.content);
  return JSON.parse(plaintext);
}

// ============================================================================
// NOSTR RELAY CONNECTION
// ============================================================================

/**
 * Default Nostr relays for Sparkle Protocol
 */
export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr.wine',
];

/**
 * Simple Nostr relay connection
 */
export class NostrRelay {
  private ws: WebSocket | null = null;
  private url: string;
  private subscriptions: Map<string, (event: SignedEvent) => void> = new Map();

  constructor(url: string) {
    this.url = url;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error('WebSocket error'));
      this.ws.onclose = () => {
        this.ws = null;
      };

      this.ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data[0] === 'EVENT' && data[2]) {
            const subId = data[1];
            const event = data[2] as SignedEvent;
            const handler = this.subscriptions.get(subId);
            if (handler) handler(event);
          }
        } catch {}
      };
    });
  }

  async publish(event: SignedEvent): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Relay not connected');
    }

    this.ws.send(JSON.stringify(['EVENT', event]));
  }

  subscribe(
    filters: any,
    onEvent: (event: SignedEvent) => void
  ): string {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Relay not connected');
    }

    const subId = Math.random().toString(36).slice(2);
    this.subscriptions.set(subId, onEvent);
    this.ws.send(JSON.stringify(['REQ', subId, filters]));

    return subId;
  }

  unsubscribe(subId: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(['CLOSE', subId]));
    }
    this.subscriptions.delete(subId);
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscriptions.clear();
  }
}

/**
 * Connect to multiple relays
 */
export async function connectToRelays(
  urls: string[] = DEFAULT_RELAYS
): Promise<NostrRelay[]> {
  const relays: NostrRelay[] = [];

  await Promise.allSettled(
    urls.map(async (url) => {
      const relay = new NostrRelay(url);
      try {
        await relay.connect();
        relays.push(relay);
      } catch {}
    })
  );

  return relays;
}

/**
 * Publish event to multiple relays
 */
export async function publishToRelays(
  event: SignedEvent,
  relays: NostrRelay[]
): Promise<number> {
  let successCount = 0;

  await Promise.allSettled(
    relays.map(async (relay) => {
      try {
        await relay.publish(event);
        successCount++;
      } catch {}
    })
  );

  return successCount;
}
