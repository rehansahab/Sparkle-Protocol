/**
 * Sparkle Protocol - Bitcoin Wallet Integration
 *
 * Provides secure Bitcoin wallet connection using browser extensions
 * (Unisat, Xverse, Leather, OKX) for signing PSBTs without exposing private keys.
 *
 * SECURITY: This module NEVER handles private keys directly.
 * All signing is delegated to the browser extension.
 *
 * @module sparkle-protocol/browser/bitcoin-wallet
 * @version 0.3.0
 */

/**
 * Supported wallet types
 */
export type WalletType = 'unisat' | 'xverse' | 'leather' | 'okx' | 'unknown';

/**
 * Bitcoin network
 */
export type BitcoinNetwork = 'mainnet' | 'testnet' | 'signet';

/**
 * Wallet account info
 */
export interface WalletAccount {
  address: string;
  publicKey: string; // Hex
  addressType: 'p2tr' | 'p2wpkh' | 'p2sh-p2wpkh' | 'p2pkh';
}

/**
 * Wallet connection result
 */
export interface BitcoinWalletConnection {
  connected: boolean;
  wallet: WalletType;
  accounts: WalletAccount[];
  network: BitcoinNetwork;
  error?: string;
}

/**
 * PSBT signing result
 */
export interface SignPsbtResult {
  signedPsbtHex: string;
  signedPsbtBase64?: string;
  txId?: string;
}

// ============================================================================
// WALLET DETECTION
// ============================================================================

/**
 * Check if Unisat wallet is available
 */
export function isUnisatAvailable(): boolean {
  return typeof window !== 'undefined' && 'unisat' in window;
}

/**
 * Check if Xverse wallet is available
 */
export function isXverseAvailable(): boolean {
  return typeof window !== 'undefined' && 'XverseProviders' in window;
}

/**
 * Check if Leather (Hiro) wallet is available
 */
export function isLeatherAvailable(): boolean {
  return typeof window !== 'undefined' && 'LeatherProvider' in window;
}

/**
 * Check if OKX wallet is available
 */
export function isOkxAvailable(): boolean {
  return typeof window !== 'undefined' && 'okxwallet' in window && 'bitcoin' in (window as any).okxwallet;
}

/**
 * Detect all available Bitcoin wallets
 */
export function detectBitcoinWallets(): WalletType[] {
  const wallets: WalletType[] = [];

  if (isUnisatAvailable()) wallets.push('unisat');
  if (isXverseAvailable()) wallets.push('xverse');
  if (isLeatherAvailable()) wallets.push('leather');
  if (isOkxAvailable()) wallets.push('okx');

  return wallets;
}

// ============================================================================
// UNISAT WALLET
// ============================================================================

interface UnisatProvider {
  requestAccounts(): Promise<string[]>;
  getAccounts(): Promise<string[]>;
  getPublicKey(): Promise<string>;
  getNetwork(): Promise<string>;
  switchNetwork(network: string): Promise<void>;
  signPsbt(psbtHex: string, options?: { autoFinalized?: boolean }): Promise<string>;
  signMessage(message: string, type?: string): Promise<string>;
  getBalance(): Promise<{ confirmed: number; unconfirmed: number; total: number }>;
}

function getUnisatProvider(): UnisatProvider | null {
  if (!isUnisatAvailable()) return null;
  return (window as any).unisat as UnisatProvider;
}

/**
 * Connect to Unisat wallet
 */
export async function connectUnisat(): Promise<BitcoinWalletConnection> {
  const provider = getUnisatProvider();

  if (!provider) {
    return {
      connected: false,
      wallet: 'unisat',
      accounts: [],
      network: 'mainnet',
      error: 'Unisat wallet not detected',
    };
  }

  try {
    // Request account access
    const addresses = await provider.requestAccounts();
    const publicKey = await provider.getPublicKey();
    const networkStr = await provider.getNetwork();

    const network: BitcoinNetwork =
      networkStr === 'testnet' ? 'testnet' :
      networkStr === 'signet' ? 'signet' : 'mainnet';

    // Determine address type from address format
    const address = addresses[0];
    let addressType: WalletAccount['addressType'] = 'p2wpkh';
    if (address.startsWith('bc1p') || address.startsWith('tb1p')) {
      addressType = 'p2tr';
    } else if (address.startsWith('bc1q') || address.startsWith('tb1q')) {
      addressType = 'p2wpkh';
    } else if (address.startsWith('3') || address.startsWith('2')) {
      addressType = 'p2sh-p2wpkh';
    } else if (address.startsWith('1') || address.startsWith('m') || address.startsWith('n')) {
      addressType = 'p2pkh';
    }

    return {
      connected: true,
      wallet: 'unisat',
      accounts: [{
        address,
        publicKey,
        addressType,
      }],
      network,
    };
  } catch (e: any) {
    return {
      connected: false,
      wallet: 'unisat',
      accounts: [],
      network: 'mainnet',
      error: e.message || 'Failed to connect to Unisat',
    };
  }
}

/**
 * Sign PSBT with Unisat
 */
export async function signPsbtUnisat(
  psbtHex: string,
  options?: { autoFinalized?: boolean }
): Promise<SignPsbtResult> {
  const provider = getUnisatProvider();

  if (!provider) {
    throw new Error('Unisat wallet not connected');
  }

  const signedPsbtHex = await provider.signPsbt(psbtHex, options);

  return {
    signedPsbtHex,
  };
}

// ============================================================================
// XVERSE WALLET
// ============================================================================

/**
 * Connect to Xverse wallet
 */
export async function connectXverse(): Promise<BitcoinWalletConnection> {
  if (!isXverseAvailable()) {
    return {
      connected: false,
      wallet: 'xverse',
      accounts: [],
      network: 'mainnet',
      error: 'Xverse wallet not detected',
    };
  }

  try {
    const providers = (window as any).XverseProviders;

    // Xverse has a different API structure
    const response = await providers.BitcoinProvider.request('getAccounts', null);

    if (!response || !response.result || response.result.length === 0) {
      throw new Error('No accounts returned');
    }

    const accounts: WalletAccount[] = response.result.map((acc: any) => ({
      address: acc.address,
      publicKey: acc.publicKey,
      addressType: acc.addressType || 'p2wpkh',
    }));

    return {
      connected: true,
      wallet: 'xverse',
      accounts,
      network: 'mainnet', // Xverse returns network info differently
    };
  } catch (e: any) {
    return {
      connected: false,
      wallet: 'xverse',
      accounts: [],
      network: 'mainnet',
      error: e.message || 'Failed to connect to Xverse',
    };
  }
}

/**
 * Sign PSBT with Xverse
 */
export async function signPsbtXverse(
  psbtBase64: string,
  inputsToSign: { address: string; signingIndexes: number[] }[]
): Promise<SignPsbtResult> {
  if (!isXverseAvailable()) {
    throw new Error('Xverse wallet not connected');
  }

  const providers = (window as any).XverseProviders;

  const response = await providers.BitcoinProvider.request('signPsbt', {
    psbt: psbtBase64,
    signInputs: inputsToSign,
    broadcast: false,
  });

  return {
    signedPsbtHex: '', // Xverse returns base64
    signedPsbtBase64: response.result.psbt,
  };
}

// ============================================================================
// UNIFIED WALLET INTERFACE
// ============================================================================

/**
 * Connect to the best available Bitcoin wallet
 */
export async function connectBitcoinWallet(
  preferredWallet?: WalletType
): Promise<BitcoinWalletConnection> {
  const available = detectBitcoinWallets();

  if (available.length === 0) {
    return {
      connected: false,
      wallet: 'unknown',
      accounts: [],
      network: 'mainnet',
      error: 'No Bitcoin wallet detected. Please install Unisat, Xverse, or another Bitcoin wallet.',
    };
  }

  // Use preferred wallet if available
  if (preferredWallet && available.includes(preferredWallet)) {
    switch (preferredWallet) {
      case 'unisat':
        return connectUnisat();
      case 'xverse':
        return connectXverse();
      // Add other wallets as needed
    }
  }

  // Otherwise use first available
  const wallet = available[0];
  switch (wallet) {
    case 'unisat':
      return connectUnisat();
    case 'xverse':
      return connectXverse();
    default:
      return {
        connected: false,
        wallet,
        accounts: [],
        network: 'mainnet',
        error: `Wallet ${wallet} not yet supported`,
      };
  }
}

/**
 * Sign PSBT with connected wallet
 */
export async function signPsbt(
  wallet: WalletType,
  psbtHex: string,
  options?: {
    inputsToSign?: { address: string; signingIndexes: number[] }[];
    autoFinalized?: boolean;
  }
): Promise<SignPsbtResult> {
  switch (wallet) {
    case 'unisat':
      return signPsbtUnisat(psbtHex, { autoFinalized: options?.autoFinalized });
    case 'xverse':
      // Xverse needs base64 and input specification
      const psbtBase64 = Buffer.from(psbtHex, 'hex').toString('base64');
      if (!options?.inputsToSign) {
        throw new Error('Xverse requires inputsToSign specification');
      }
      return signPsbtXverse(psbtBase64, options.inputsToSign);
    default:
      throw new Error(`Wallet ${wallet} not supported for PSBT signing`);
  }
}

// ============================================================================
// HELPER: Convert Nostr pubkey to Bitcoin pubkey
// ============================================================================

/**
 * Convert x-only pubkey (Nostr) to compressed pubkey (Bitcoin)
 *
 * Nostr uses 32-byte x-only pubkeys (like Taproot internal keys)
 * Bitcoin uses 33-byte compressed pubkeys (02/03 prefix + x-coordinate)
 *
 * Note: This assumes even y-coordinate (02 prefix). For signing,
 * the wallet extension handles the correct parity.
 *
 * @param xOnlyPubkey - 32-byte x-only pubkey (hex, 64 chars)
 * @returns 33-byte compressed pubkey (hex, 66 chars)
 */
export function xOnlyToCompressed(xOnlyPubkey: string): string {
  if (xOnlyPubkey.length !== 64) {
    throw new Error('Invalid x-only pubkey length');
  }
  // Default to 02 prefix (even y). For actual transactions,
  // the wallet will use the correct parity based on the full key.
  return '02' + xOnlyPubkey;
}

/**
 * Convert compressed pubkey to x-only
 *
 * @param compressedPubkey - 33-byte compressed pubkey (hex, 66 chars)
 * @returns 32-byte x-only pubkey (hex, 64 chars)
 */
export function compressedToXOnly(compressedPubkey: string): string {
  if (compressedPubkey.length !== 66) {
    throw new Error('Invalid compressed pubkey length');
  }
  return compressedPubkey.slice(2);
}
