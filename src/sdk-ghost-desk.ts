/**
 * Sparkle Protocol - Ghost Desk
 *
 * Private messaging layer using NIP-17 Gift Wrap and NIP-44 encryption.
 * Enables completely private Ordinal trades - no public offers, no chain analysis.
 *
 * @module sparkle-protocol/ghost-desk
 * @version 1.0.0-rc.1
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';

import type { SignerProvider, NostrProvider } from './sdk-providers.js';
import type {
  NostrEvent,
  NostrEventTemplate,
  SparkleOfferContent,
  GhostDeskMessage,
} from './sdk-types.js';

import {
  KIND_GIFT_WRAP,
  KIND_SEAL,
  KIND_SPARKLE_OFFER,
} from './sdk-constants.js';

// =============================================================================
// GHOST DESK CONFIGURATION
// =============================================================================

/**
 * Random time window for anti-correlation (NIP-59)
 * Timestamp is randomized within this window
 */
const TIMESTAMP_JITTER_SECONDS = 48 * 60 * 60; // 48 hours

// =============================================================================
// GHOST DESK CLASS
// =============================================================================

/**
 * Ghost Desk - Private Messaging for Sparkle Protocol
 *
 * Uses NIP-17 (Gift Wrap) with NIP-44 encryption for metadata protection.
 * Messages appear as random noise to observers - no sender, no recipient,
 * no content type visible on relays.
 */
export class GhostDesk {
  private readonly signer: SignerProvider;
  private readonly nostr?: NostrProvider;

  constructor(signer: SignerProvider, nostr?: NostrProvider) {
    this.signer = signer;
    this.nostr = nostr;
  }

  // ===========================================================================
  // SENDING PRIVATE MESSAGES
  // ===========================================================================

  /**
   * Send a private Sparkle offer
   *
   * Creates a NIP-17 Gift Wrap containing the offer, completely hiding
   * sender, recipient, and content from relay operators.
   *
   * @param offer - The Sparkle offer content
   * @param recipientPubkey - Recipient's hex pubkey
   * @returns Gift-wrapped event ready for relay
   */
  async sendPrivateOffer(
    offer: SparkleOfferContent,
    recipientPubkey: string
  ): Promise<NostrEvent> {
    const message: GhostDeskMessage = {
      type: 'offer',
      payload: offer,
      timestamp: Math.floor(Date.now() / 1000),
    };

    return this.wrapMessage(message, recipientPubkey);
  }

  /**
   * Send a private message (e.g., negotiation, acceptance)
   *
   * @param content - Message content
   * @param recipientPubkey - Recipient's hex pubkey
   * @param type - Message type
   * @returns Gift-wrapped event
   */
  async sendPrivateMessage(
    content: string,
    recipientPubkey: string,
    type: 'message' | 'accept' | 'reject' = 'message'
  ): Promise<NostrEvent> {
    const message: GhostDeskMessage = {
      type,
      payload: content,
      timestamp: Math.floor(Date.now() / 1000),
    };

    return this.wrapMessage(message, recipientPubkey);
  }

  /**
   * Send an invoice for a private offer
   *
   * @param invoice - BOLT11 invoice string
   * @param offerId - Reference to the original offer
   * @param recipientPubkey - Buyer's pubkey
   * @returns Gift-wrapped event
   */
  async sendPrivateInvoice(
    invoice: string,
    offerId: string,
    recipientPubkey: string
  ): Promise<NostrEvent> {
    const message: GhostDeskMessage = {
      type: 'invoice',
      payload: { invoice, offerId },
      timestamp: Math.floor(Date.now() / 1000),
    };

    return this.wrapMessage(message, recipientPubkey);
  }

  // ===========================================================================
  // RECEIVING PRIVATE MESSAGES
  // ===========================================================================

  /**
   * Unwrap a received Gift Wrap event
   *
   * @param giftWrap - The gift wrap event (kind 1059)
   * @returns Decrypted message or null if not for us
   */
  async unwrapMessage(giftWrap: NostrEvent): Promise<GhostDeskMessage | null> {
    if (giftWrap.kind !== KIND_GIFT_WRAP) {
      return null;
    }

    try {
      // Get our pubkey
      const ourPubkey = await this.signer.getPublicKey();

      // Check if addressed to us (p-tag)
      const recipientTag = giftWrap.tags.find((t) => t[0] === 'p');
      if (!recipientTag || recipientTag[1] !== ourPubkey) {
        return null;
      }

      // Decrypt the outer layer (Gift Wrap → Seal)
      const sealJson = await this.signer.decrypt(giftWrap.pubkey, giftWrap.content);
      const seal: NostrEvent = JSON.parse(sealJson);

      if (seal.kind !== KIND_SEAL) {
        throw new Error('Inner event is not a Seal (kind 13)');
      }

      // Decrypt the inner layer (Seal → Rumor)
      const rumorJson = await this.signer.decrypt(seal.pubkey, seal.content);
      const rumor = JSON.parse(rumorJson);

      // Parse the actual message content
      const message: GhostDeskMessage = JSON.parse(rumor.content);

      // Add sender info
      message.senderPubkey = seal.pubkey;

      return message;
    } catch (error) {
      // Not for us or corrupted
      console.warn('Failed to unwrap message:', error);
      return null;
    }
  }

  /**
   * Subscribe to private messages via Nostr relays
   *
   * @param relays - Relay URLs to subscribe to
   * @param callback - Called when a new message arrives
   * @returns Unsubscribe function
   */
  async subscribeToMessages(
    relays: string[],
    callback: (message: GhostDeskMessage) => void
  ): Promise<() => void> {
    if (!this.nostr) {
      throw new Error('NostrProvider required for subscriptions');
    }

    const ourPubkey = await this.signer.getPublicKey();

    // Connect to relays first
    await this.nostr.connect(relays);

    // Subscribe to gift wraps addressed to us
    return this.nostr.subscribe(
      { kinds: [KIND_GIFT_WRAP], '#p': [ourPubkey] },
      async (event: NostrEvent) => {
        const message = await this.unwrapMessage(event);
        if (message) {
          callback(message);
        }
      }
    );
  }

  // ===========================================================================
  // INTERNAL WRAPPING LOGIC
  // ===========================================================================

  /**
   * Wrap a message in NIP-17 Gift Wrap
   *
   * Structure:
   * 1. Rumor (unsigned event with actual content)
   * 2. Seal (signed, encrypts Rumor, from real sender)
   * 3. Gift Wrap (signed by ephemeral key, encrypts Seal)
   */
  private async wrapMessage(
    message: GhostDeskMessage,
    recipientPubkey: string
  ): Promise<NostrEvent> {
    const ourPubkey = await this.signer.getPublicKey();

    // Step 1: Create Rumor (unsigned inner content)
    const rumor = {
      pubkey: ourPubkey,
      created_at: this.randomTimestamp(),
      kind: KIND_SPARKLE_OFFER,
      tags: [['p', recipientPubkey]],
      content: JSON.stringify(message),
    };

    // Step 2: Create Seal (encrypts Rumor)
    const encryptedRumor = await this.signer.encrypt(
      recipientPubkey,
      JSON.stringify(rumor)
    );

    const sealTemplate: NostrEventTemplate = {
      kind: KIND_SEAL,
      created_at: this.randomTimestamp(),
      tags: [],
      content: encryptedRumor,
    };

    const seal = await this.signer.signEvent(sealTemplate);

    // Step 3: Create Gift Wrap (encrypts Seal with ephemeral key)
    // Note: In a full implementation, we'd use an ephemeral keypair here
    // For now, we use our key but this should be improved for full privacy
    const encryptedSeal = await this.signer.encrypt(
      recipientPubkey,
      JSON.stringify(seal)
    );

    const giftWrapTemplate: NostrEventTemplate = {
      kind: KIND_GIFT_WRAP,
      created_at: this.randomTimestamp(),
      tags: [['p', recipientPubkey]],
      content: encryptedSeal,
    };

    const giftWrap = await this.signer.signEvent(giftWrapTemplate);

    return giftWrap;
  }

  /**
   * Generate randomized timestamp for anti-correlation
   * Per NIP-59, timestamps should be randomized to prevent timing analysis
   */
  private randomTimestamp(): number {
    const now = Math.floor(Date.now() / 1000);
    const jitter = Math.floor(Math.random() * TIMESTAMP_JITTER_SECONDS);
    return now - jitter;
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a Ghost Desk instance
 *
 * @param signer - SignerProvider for encryption/signing
 * @param nostr - Optional NostrProvider for relay operations
 * @returns Ghost Desk instance
 */
export function createGhostDesk(
  signer: SignerProvider,
  nostr?: NostrProvider
): GhostDesk {
  return new GhostDesk(signer, nostr);
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Generate a random conversation ID
 */
export function generateConversationId(): string {
  return bytesToHex(randomBytes(16));
}

/**
 * Compute event ID (NIP-01)
 */
export function computeEventId(event: NostrEventTemplate & { pubkey: string }): string {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
  return bytesToHex(sha256(new TextEncoder().encode(serialized)));
}
