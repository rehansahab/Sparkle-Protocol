/**
 * Sparkle Protocol - Unified Wallet Manager
 *
 * Combines Nostr (NIP-07) and Bitcoin wallet connections into a single
 * interface for the Sparkle swap frontend.
 *
 * Architecture:
 * - Nostr wallet (Alby, nos2x): For identity and P2P communication
 * - Bitcoin wallet (Unisat, Xverse): For PSBT signing
 *
 * SECURITY: No private keys are ever handled by this code.
 * All signing is delegated to browser extensions.
 *
 * @module sparkle-protocol/browser/wallet-manager
 * @version 0.3.0
 */

import {
  isNip07Available,
  connectWallet as connectNostrWallet,
  signEvent,
  encryptNip04,
  decryptNip04,
  createSwapOfferEvent,
  createSwapDM,
  decodeSwapDM,
  connectToRelays,
  publishToRelays,
  type WalletConnection as NostrWalletConnection,
  type SignedEvent,
  type UnsignedEvent,
  type NostrRelay,
} from './nostr-nip07.js';

import {
  detectBitcoinWallets,
  connectBitcoinWallet,
  signPsbt,
  xOnlyToCompressed,
  compressedToXOnly,
  type WalletType as BitcoinWalletType,
  type BitcoinWalletConnection,
  type WalletAccount,
} from './bitcoin-wallet.js';

/**
 * Complete wallet state
 */
export interface SparkleWalletState {
  // Nostr
  nostrConnected: boolean;
  nostrPubkey?: string; // 32-byte x-only hex

  // Bitcoin
  bitcoinConnected: boolean;
  bitcoinWallet?: BitcoinWalletType;
  bitcoinAccounts: WalletAccount[];
  bitcoinNetwork?: 'mainnet' | 'testnet' | 'signet';

  // Derived
  /** Compressed pubkey for swap offers (33-byte hex) */
  swapPubkey?: string;

  // Status
  ready: boolean;
  errors: string[];
}

/**
 * Wallet manager class
 */
export class SparkleWalletManager {
  private state: SparkleWalletState = {
    nostrConnected: false,
    bitcoinConnected: false,
    bitcoinAccounts: [],
    ready: false,
    errors: [],
  };

  private relays: NostrRelay[] = [];
  private onStateChange?: (state: SparkleWalletState) => void;

  /**
   * Create wallet manager
   * @param onStateChange - Callback for state updates
   */
  constructor(onStateChange?: (state: SparkleWalletState) => void) {
    this.onStateChange = onStateChange;
  }

  /**
   * Get current state
   */
  getState(): SparkleWalletState {
    return { ...this.state };
  }

  /**
   * Check what wallets are available
   */
  detectWallets(): {
    nostr: boolean;
    bitcoin: BitcoinWalletType[];
  } {
    return {
      nostr: isNip07Available(),
      bitcoin: detectBitcoinWallets(),
    };
  }

  /**
   * Connect Nostr wallet (NIP-07)
   */
  async connectNostr(): Promise<boolean> {
    const result = await connectNostrWallet();

    if (result.state === 'connected' && result.pubkey) {
      this.state.nostrConnected = true;
      this.state.nostrPubkey = result.pubkey;

      // Derive swap pubkey (compressed format for Bitcoin)
      this.state.swapPubkey = xOnlyToCompressed(result.pubkey);

      this.updateReady();
      this.notifyChange();
      return true;
    } else {
      this.state.errors.push(result.error || 'Nostr connection failed');
      this.notifyChange();
      return false;
    }
  }

  /**
   * Connect Bitcoin wallet
   */
  async connectBitcoin(preferredWallet?: BitcoinWalletType): Promise<boolean> {
    const result = await connectBitcoinWallet(preferredWallet);

    if (result.connected) {
      this.state.bitcoinConnected = true;
      this.state.bitcoinWallet = result.wallet;
      this.state.bitcoinAccounts = result.accounts;
      this.state.bitcoinNetwork = result.network;

      // If no swap pubkey from Nostr, use Bitcoin pubkey
      if (!this.state.swapPubkey && result.accounts.length > 0) {
        this.state.swapPubkey = result.accounts[0].publicKey;
      }

      this.updateReady();
      this.notifyChange();
      return true;
    } else {
      this.state.errors.push(result.error || 'Bitcoin connection failed');
      this.notifyChange();
      return false;
    }
  }

  /**
   * Connect both wallets
   */
  async connectAll(): Promise<boolean> {
    const [nostrOk, bitcoinOk] = await Promise.all([
      this.connectNostr().catch(() => false),
      this.connectBitcoin().catch(() => false),
    ]);

    return nostrOk || bitcoinOk; // At least one connected
  }

  /**
   * Connect to Nostr relays
   */
  async connectRelays(urls?: string[]): Promise<number> {
    this.relays = await connectToRelays(urls);
    return this.relays.length;
  }

  /**
   * Sign and publish a Nostr event
   */
  async signAndPublish(event: UnsignedEvent): Promise<{
    success: boolean;
    signedEvent?: SignedEvent;
    relayCount?: number;
    error?: string;
  }> {
    if (!this.state.nostrConnected) {
      return { success: false, error: 'Nostr wallet not connected' };
    }

    try {
      const signedEvent = await signEvent(event);
      const relayCount = await publishToRelays(signedEvent, this.relays);

      return {
        success: relayCount > 0,
        signedEvent,
        relayCount,
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Send encrypted DM
   */
  async sendEncryptedDM(
    recipientPubkey: string,
    message: object
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.state.nostrConnected) {
      return { success: false, error: 'Nostr wallet not connected' };
    }

    try {
      const plaintext = JSON.stringify(message);
      const ciphertext = await encryptNip04(recipientPubkey, plaintext);

      const event: UnsignedEvent = {
        kind: 4,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', recipientPubkey]],
        content: ciphertext,
      };

      const signedEvent = await signEvent(event);
      await publishToRelays(signedEvent, this.relays);

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Decrypt received DM
   */
  async decryptDM(event: SignedEvent): Promise<object | null> {
    if (!this.state.nostrConnected) {
      return null;
    }

    try {
      const plaintext = await decryptNip04(event.pubkey, event.content);
      return JSON.parse(plaintext);
    } catch {
      return null;
    }
  }

  /**
   * Sign a PSBT with the Bitcoin wallet
   */
  async signPsbt(
    psbtHex: string,
    options?: { autoFinalized?: boolean }
  ): Promise<{ signedPsbtHex?: string; error?: string }> {
    if (!this.state.bitcoinConnected || !this.state.bitcoinWallet) {
      return { error: 'Bitcoin wallet not connected' };
    }

    try {
      const result = await signPsbt(
        this.state.bitcoinWallet,
        psbtHex,
        options
      );
      return { signedPsbtHex: result.signedPsbtHex };
    } catch (e: any) {
      return { error: e.message };
    }
  }

  /**
   * Get the pubkey to use for swap offers
   */
  getSwapPubkey(): string | null {
    return this.state.swapPubkey || null;
  }

  /**
   * Get the Bitcoin address for receiving
   */
  getBitcoinAddress(): string | null {
    if (this.state.bitcoinAccounts.length === 0) return null;

    // Prefer Taproot address for Ordinals
    const taprootAccount = this.state.bitcoinAccounts.find(
      a => a.addressType === 'p2tr'
    );
    if (taprootAccount) return taprootAccount.address;

    return this.state.bitcoinAccounts[0].address;
  }

  /**
   * Disconnect all wallets
   */
  disconnect(): void {
    this.state = {
      nostrConnected: false,
      bitcoinConnected: false,
      bitcoinAccounts: [],
      ready: false,
      errors: [],
    };

    // Close relay connections
    this.relays.forEach(r => r.close());
    this.relays = [];

    this.notifyChange();
  }

  private updateReady(): void {
    // Ready when at least Nostr is connected (for identity)
    // Bitcoin is optional but recommended for PSBT signing
    this.state.ready = this.state.nostrConnected;
  }

  private notifyChange(): void {
    if (this.onStateChange) {
      this.onStateChange(this.getState());
    }
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Create and initialize a wallet manager
 */
export async function initializeWallets(
  options?: {
    autoConnect?: boolean;
    relayUrls?: string[];
    onStateChange?: (state: SparkleWalletState) => void;
  }
): Promise<SparkleWalletManager> {
  const manager = new SparkleWalletManager(options?.onStateChange);

  if (options?.autoConnect) {
    await manager.connectAll();
  }

  if (options?.relayUrls) {
    await manager.connectRelays(options.relayUrls);
  }

  return manager;
}

/**
 * Quick check if any wallet is available
 */
export function hasWalletSupport(): boolean {
  return isNip07Available() || detectBitcoinWallets().length > 0;
}

// Re-export types
export type {
  NostrWalletConnection,
  BitcoinWalletConnection,
  SignedEvent,
  UnsignedEvent,
  WalletAccount,
  BitcoinWalletType,
};
