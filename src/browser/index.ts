/**
 * Sparkle Protocol - Browser Module
 *
 * Client-side wallet integration for Nostr and Bitcoin.
 * Use these modules in browser environments only.
 *
 * @module sparkle-protocol/browser
 * @version 0.3.0
 */

// NIP-07 Nostr Wallet
export {
  isNip07Available,
  getNip07Provider,
  detectWalletExtension,
  connectWallet,
  signEvent,
  encryptNip04,
  decryptNip04,
  getWalletRelays,
  createSwapOfferEvent,
  createSwapDM,
  decodeSwapDM,
  connectToRelays,
  publishToRelays,
  NostrRelay,
  DEFAULT_RELAYS,
  SPARKLE_EVENT_KINDS,
  type Nip07Provider,
  type UnsignedEvent,
  type SignedEvent,
  type WalletState,
  type WalletConnection,
} from './nostr-nip07.js';

// Bitcoin Wallet
export {
  isUnisatAvailable,
  isXverseAvailable,
  isLeatherAvailable,
  isOkxAvailable,
  detectBitcoinWallets,
  connectUnisat,
  connectXverse,
  connectBitcoinWallet,
  signPsbt,
  signPsbtUnisat,
  signPsbtXverse,
  xOnlyToCompressed,
  compressedToXOnly,
  type WalletType,
  type BitcoinNetwork,
  type WalletAccount,
  type BitcoinWalletConnection,
  type SignPsbtResult,
} from './bitcoin-wallet.js';

// Unified Wallet Manager
export {
  SparkleWalletManager,
  initializeWallets,
  hasWalletSupport,
  type SparkleWalletState,
} from './wallet-manager.js';
