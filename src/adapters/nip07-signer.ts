/**
 * Sparkle Protocol - NIP-07 Signer Adapter
 *
 * Production implementation of SignerProvider using NIP-07.
 * Works with Alby, nos2x, Flamingo, and other Nostr extensions.
 *
 * @module sparkle-protocol/adapters/nip07-signer
 * @version 1.0.0-rc.1
 */

import type { SignerProvider } from '../sdk-providers.js';
import type { NostrEventTemplate, NostrEvent } from '../sdk-types.js';

// =============================================================================
// NIP-07 TYPE DEFINITIONS
// =============================================================================

interface Nip07Provider {
  getPublicKey(): Promise<string>;
  signEvent(event: NostrEventTemplate): Promise<NostrEvent>;
  nip04?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
}

declare global {
  interface Window {
    nostr?: Nip07Provider;
  }
}

// =============================================================================
// NIP-07 SIGNER ADAPTER
// =============================================================================

/**
 * NIP-07 Signer Adapter
 *
 * Implements SignerProvider using browser Nostr extension.
 */
export class Nip07SignerAdapter implements SignerProvider {
  private cachedPubkey: string | null = null;

  /**
   * Check if NIP-07 is available
   */
  private checkAvailable(): void {
    if (typeof window === 'undefined' || !window.nostr) {
      throw new Error(
        'NIP-07 extension not found. Please install a Nostr signer ' +
        'like Alby (getalby.com) or nos2x.'
      );
    }
  }

  /**
   * Get public key from extension
   */
  async getPublicKey(): Promise<string> {
    this.checkAvailable();

    if (this.cachedPubkey) {
      return this.cachedPubkey;
    }

    const pubkey = await window.nostr!.getPublicKey();
    this.cachedPubkey = pubkey;
    return pubkey;
  }

  /**
   * Sign a Nostr event
   */
  async signEvent(event: NostrEventTemplate): Promise<NostrEvent> {
    this.checkAvailable();

    const signedEvent = await window.nostr!.signEvent(event);
    return signedEvent;
  }

  /**
   * Encrypt content using NIP-44 (preferred) or NIP-04 (fallback)
   *
   * NIP-44 uses XChaCha20-Poly1305 - required for Ghost Desk.
   */
  async encrypt(recipientPubkey: string, content: string): Promise<string> {
    this.checkAvailable();

    // Prefer NIP-44 for modern encryption
    if (window.nostr!.nip44) {
      return await window.nostr!.nip44.encrypt(recipientPubkey, content);
    }

    // Fallback to NIP-04 (deprecated but widely supported)
    if (window.nostr!.nip04) {
      console.warn(
        'Using NIP-04 encryption (deprecated). ' +
        'Consider upgrading to a wallet that supports NIP-44.'
      );
      return await window.nostr!.nip04.encrypt(recipientPubkey, content);
    }

    throw new Error(
      'Encryption not supported. Your Nostr extension does not support ' +
      'NIP-44 or NIP-04 encryption.'
    );
  }

  /**
   * Decrypt content using NIP-44 (preferred) or NIP-04 (fallback)
   */
  async decrypt(senderPubkey: string, ciphertext: string): Promise<string> {
    this.checkAvailable();

    // Try NIP-44 first
    if (window.nostr!.nip44) {
      try {
        return await window.nostr!.nip44.decrypt(senderPubkey, ciphertext);
      } catch {
        // May fail if encrypted with NIP-04, try fallback
      }
    }

    // Try NIP-04
    if (window.nostr!.nip04) {
      return await window.nostr!.nip04.decrypt(senderPubkey, ciphertext);
    }

    throw new Error('Decryption not supported by this Nostr extension');
  }

  /**
   * Check if NIP-44 is supported
   */
  async supportsNip44(): Promise<boolean> {
    if (typeof window === 'undefined' || !window.nostr) {
      return false;
    }
    return !!window.nostr.nip44;
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create NIP-07 signer adapter
 */
export function createNip07Signer(): SignerProvider {
  return new Nip07SignerAdapter();
}

/**
 * Check if NIP-07 is available
 */
export function isNip07Available(): boolean {
  return typeof window !== 'undefined' && !!window.nostr;
}

/**
 * Detect which Nostr extension is installed
 */
export function detectNostrExtension(): string | null {
  if (typeof window === 'undefined' || !window.nostr) {
    return null;
  }

  // Check for known extensions by their signatures
  const nostr = window.nostr as any;

  if (nostr._alby) return 'Alby';
  if (nostr._nos2x) return 'nos2x';
  if (nostr._flamingo) return 'Flamingo';

  return 'Unknown Nostr Extension';
}
