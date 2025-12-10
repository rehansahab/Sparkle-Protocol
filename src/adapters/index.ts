/**
 * Sparkle Protocol - Production Adapters
 *
 * Pre-built adapters for common providers.
 * Users can use these or implement their own using the provider interfaces.
 *
 * @module sparkle-protocol/adapters
 * @version 1.0.0-rc.1
 */

// =============================================================================
// INDEXER ADAPTERS
// =============================================================================

export {
  HiroIndexerAdapter,
  createHiroIndexer,
} from './hiro-indexer.js';

// =============================================================================
// SIGNER ADAPTERS
// =============================================================================

export {
  Nip07SignerAdapter,
  createNip07Signer,
  isNip07Available,
  detectNostrExtension,
} from './nip07-signer.js';

// =============================================================================
// WALLET ADAPTERS
// =============================================================================

export {
  UnisatWalletAdapter,
  createUnisatWallet,
  detectBitcoinWallets,
  isBitcoinWalletAvailable,
} from './unisat-wallet.js';

// =============================================================================
// LIGHTNING ADAPTERS
// =============================================================================

export {
  WebLNLightningAdapter,
  createWebLNLightning,
  isWebLNAvailable,
} from './webln-lightning.js';

// =============================================================================
// ADAPTER BUNDLE
// =============================================================================

import { createHiroIndexer } from './hiro-indexer.js';
import { createNip07Signer, isNip07Available } from './nip07-signer.js';
import { createUnisatWallet, isBitcoinWalletAvailable } from './unisat-wallet.js';
import { createWebLNLightning, isWebLNAvailable } from './webln-lightning.js';

import type { IndexerProvider, SignerProvider, WalletProvider, LightningProvider } from '../sdk-providers.js';

/**
 * Adapter availability check
 */
export interface AdapterAvailability {
  indexer: boolean;
  signer: boolean;
  wallet: boolean;
  lightning: boolean;
}

/**
 * Check which adapters are available in the current environment
 */
export function checkAdapterAvailability(): AdapterAvailability {
  return {
    indexer: true, // Always available (uses HTTP)
    signer: isNip07Available(),
    wallet: isBitcoinWalletAvailable(),
    lightning: isWebLNAvailable(),
  };
}

/**
 * Production provider bundle
 */
export interface ProviderBundle {
  indexer: IndexerProvider;
  signer: SignerProvider;
  wallet: WalletProvider;
  lightning: LightningProvider;
}

/**
 * Create a complete provider bundle with default adapters
 *
 * @param network - 'mainnet' or 'testnet'
 * @returns Provider bundle with all adapters
 * @throws If required browser extensions are not available
 */
export function createProviderBundle(
  network: 'mainnet' | 'testnet' = 'testnet'
): ProviderBundle {
  const availability = checkAdapterAvailability();

  if (!availability.signer) {
    throw new Error(
      'Nostr signer not available. Install Alby or another NIP-07 extension.'
    );
  }

  if (!availability.wallet) {
    throw new Error(
      'Bitcoin wallet not available. Install UniSat or another compatible wallet.'
    );
  }

  if (!availability.lightning) {
    throw new Error(
      'Lightning wallet not available. Install Alby or another WebLN extension.'
    );
  }

  return {
    indexer: createHiroIndexer(network),
    signer: createNip07Signer(),
    wallet: createUnisatWallet(),
    lightning: createWebLNLightning(),
  };
}
