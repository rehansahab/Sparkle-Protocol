/**
 * Sparkle Protocol - WebLN Lightning Adapter
 *
 * Production implementation of LightningProvider using WebLN.
 * Works with Alby, Zeus, and other WebLN-compatible wallets.
 *
 * @module sparkle-protocol/adapters/webln-lightning
 * @version 1.0.0-rc.1
 */

import type { LightningProvider } from '../sdk-providers.js';
import type { DecodedInvoice, PaymentResult } from '../sdk-types.js';

// =============================================================================
// WEBLN TYPE DEFINITIONS
// =============================================================================

interface WebLNProvider {
  enable(): Promise<void>;
  getInfo(): Promise<{ node: { pubkey: string; alias?: string } }>;
  sendPayment(paymentRequest: string): Promise<{ preimage: string }>;
  makeInvoice?(args: { amount: number; defaultMemo?: string }): Promise<{ paymentRequest: string }>;
}

declare global {
  interface Window {
    webln?: WebLNProvider;
  }
}

// =============================================================================
// BOLT11 DECODER (Minimal implementation)
// =============================================================================

/**
 * Decode BOLT11 invoice (minimal parser)
 *
 * For production, consider using bolt11 or light-bolt11-decoder package.
 */
function decodeBolt11Minimal(invoice: string): DecodedInvoice {
  const lowerInvoice = invoice.toLowerCase();

  // Determine network from prefix
  let network: 'mainnet' | 'testnet' = 'mainnet';
  if (lowerInvoice.startsWith('lntb') || lowerInvoice.startsWith('lnbcrt')) {
    network = 'testnet';
  }

  // Extract amount from human-readable part
  // Format: ln[network][amount][multiplier]1[data]
  const match = lowerInvoice.match(/^ln(bc|tb|bcrt)(\d+)([munp])?1/);
  let amountSats = 0;

  if (match) {
    const amount = parseInt(match[2], 10);
    const multiplier = match[3];

    switch (multiplier) {
      case 'm': amountSats = amount * 100000; break;      // milli-BTC
      case 'u': amountSats = amount * 100; break;         // micro-BTC
      case 'n': amountSats = Math.floor(amount / 10); break;  // nano-BTC
      case 'p': amountSats = Math.floor(amount / 10000); break; // pico-BTC
      default: amountSats = amount * 100000000; break;    // BTC
    }
  }

  // For payment hash extraction, we need proper bech32 decoding
  // This is a simplified version - production should use a library
  // The payment hash is in the tagged data fields

  // Default expiry is 1 hour from now
  const defaultExpiry = Math.floor(Date.now() / 1000) + 3600;

  return {
    paymentHash: '', // Would need proper decoding
    amountSats,
    expiryUnix: defaultExpiry,
    network,
  };
}

// =============================================================================
// WEBLN LIGHTNING ADAPTER
// =============================================================================

/**
 * WebLN Lightning Adapter
 *
 * Implements LightningProvider using browser WebLN API.
 */
export class WebLNLightningAdapter implements LightningProvider {
  private enabled: boolean = false;

  /**
   * Check if WebLN is available
   */
  async isAvailable(): Promise<boolean> {
    return typeof window !== 'undefined' && !!window.webln;
  }

  /**
   * Enable WebLN provider
   */
  async enable(): Promise<void> {
    if (!window.webln) {
      throw new Error(
        'WebLN not available. Please install a Lightning wallet extension like Alby.'
      );
    }

    await window.webln.enable();
    this.enabled = true;
  }

  /**
   * Decode BOLT11 invoice
   */
  async decodeInvoice(invoice: string): Promise<DecodedInvoice> {
    // Use the built-in decoder from our core module if available
    // For now, use minimal decoder
    const decoded = decodeBolt11Minimal(invoice);

    // For proper payment hash extraction, we'd use the full decoder
    // from sparkle-protocol/core/lightning-invoice

    return decoded;
  }

  /**
   * Pay a Lightning invoice
   *
   * CRITICAL: Returns preimage on success - required for Ordinal sweep.
   */
  async payInvoice(invoice: string): Promise<PaymentResult> {
    if (!this.enabled) {
      await this.enable();
    }

    if (!window.webln) {
      throw new Error('WebLN not available');
    }

    try {
      const result = await window.webln.sendPayment(invoice);

      if (!result.preimage) {
        throw new Error('Payment succeeded but no preimage returned');
      }

      return {
        preimage: result.preimage,
        paidAt: Math.floor(Date.now() / 1000),
      };
    } catch (error: any) {
      // Handle user rejection
      if (error.message?.includes('User rejected')) {
        throw new Error('Payment cancelled by user');
      }

      // Handle insufficient balance
      if (error.message?.includes('insufficient')) {
        throw new Error('Insufficient Lightning balance');
      }

      throw new Error(`Lightning payment failed: ${error.message}`);
    }
  }

  /**
   * Get node info
   */
  async getInfo(): Promise<{ pubkey: string; alias?: string }> {
    if (!this.enabled) {
      await this.enable();
    }

    if (!window.webln) {
      throw new Error('WebLN not available');
    }

    const info = await window.webln.getInfo();
    return {
      pubkey: info.node.pubkey,
      alias: info.node.alias,
    };
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create WebLN lightning adapter
 */
export function createWebLNLightning(): LightningProvider {
  return new WebLNLightningAdapter();
}

/**
 * Check if WebLN is available in current environment
 */
export function isWebLNAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.webln;
}
