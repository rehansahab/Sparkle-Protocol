/**
 * SPARKLE Protocol - Signet Configuration
 *
 * Pre-configured for Signet testing before mainnet deployment.
 * Copy this to mainnet/sparkle-e2e-test.js and modify CONFIG for production.
 */

const CONFIG = {
  // ==========================================================================
  // NETWORK SELECTION
  // ==========================================================================
  network: 'signet',  // 'signet' | 'testnet' | 'mainnet'

  // ==========================================================================
  // BITCOIN CORE - SIGNET
  // ==========================================================================
  bitcoin: {
    cli: process.platform === 'win32'
      ? 'C:\\Program Files\\Bitcoin\\daemon\\bitcoin-cli.exe'
      : 'bitcoin-cli',
    rpcUser: 'sparkle',
    rpcPassword: 'sparkletest2024',
    rpcPort: 38332,  // Signet default
    // rpcPort: 8332,  // Mainnet
    // rpcPort: 18332, // Testnet
  },

  // ==========================================================================
  // LND - SIGNET
  // ==========================================================================
  lnd: {
    cli: process.platform === 'win32'
      ? 'C:\\Users\\%USERNAME%\\lnd\\lncli.exe'
      : 'lncli',
    macaroonPath: process.platform === 'win32'
      ? 'C:\\Users\\%USERNAME%\\.lnd\\data\\chain\\bitcoin\\signet\\admin.macaroon'
      : '~/.lnd/data/chain/bitcoin/signet/admin.macaroon',
    rpcServer: 'localhost:10009',
    networkFlag: '--network=signet',
    // networkFlag: '',  // Mainnet (no flag needed)
  },

  // ==========================================================================
  // ORD - SIGNET
  // ==========================================================================
  ord: {
    cli: process.platform === 'win32'
      ? 'C:\\Users\\%USERNAME%\\.cargo\\bin\\ord.exe'
      : 'ord',
    networkFlag: '--signet',
    // networkFlag: '',  // Mainnet
    wallet: 'sparkle-test',
  },

  // ==========================================================================
  // TEST PARAMETERS
  // ==========================================================================
  test: {
    swapAmount: 10000,      // sats for Lightning payment
    feeRate: 1,             // sat/vB (low for signet)
    timelockDelta: 144,     // blocks (~24 hours)
    channelSize: 100000,    // sats for channel
  },

  // ==========================================================================
  // SIGNET PEERS (Known Lightning Nodes)
  // ==========================================================================
  signetPeers: [
    {
      name: 'ACINQ Signet',
      pubkey: '03a78d60ff8f3a5eb6096e08c5c3a03f7e26c2ae973f040ac30f33ddbeb5a88ca2',
      host: '54.89.83.135:39735'
    },
    {
      name: 'Blockstream Signet',
      pubkey: '0327aefb8e845c5f21e8369f11a8b64d5c7d3a78c4bef8e4c2f6b3c5d8e9f0a1b2',
      host: 'signet-ln.blockstream.info:39735'
    }
  ],

  // ==========================================================================
  // FAUCETS
  // ==========================================================================
  faucets: {
    signet: [
      'https://signetfaucet.com',
      'https://alt.signetfaucet.com',
      'https://faucet.mutinynet.com'  // Mutinynet signet
    ],
    testnet: [
      'https://testnet-faucet.com',
      'https://bitcoinfaucet.uo1.net'
    ]
  },

  // ==========================================================================
  // EXPLORERS
  // ==========================================================================
  explorers: {
    signet: 'https://mempool.space/signet',
    testnet: 'https://mempool.space/testnet',
    mainnet: 'https://mempool.space'
  }
};

// ==========================================================================
// HELPER FUNCTIONS
// ==========================================================================

function getExplorerUrl(txid) {
  return `${CONFIG.explorers[CONFIG.network]}/tx/${txid}`;
}

function getBitcoinCliCommand(command) {
  const networkFlag = CONFIG.network === 'mainnet' ? '' : `-${CONFIG.network}`;
  return `"${CONFIG.bitcoin.cli}" -rpcuser=${CONFIG.bitcoin.rpcUser} -rpcpassword=${CONFIG.bitcoin.rpcPassword} -rpcport=${CONFIG.bitcoin.rpcPort} ${networkFlag} ${command}`;
}

function getLncliCommand(command) {
  return `"${CONFIG.lnd.cli}" --macaroonpath="${CONFIG.lnd.macaroonPath}" --rpcserver=${CONFIG.lnd.rpcServer} ${CONFIG.lnd.networkFlag} ${command}`;
}

function getOrdCommand(command) {
  return `"${CONFIG.ord.cli}" ${CONFIG.ord.networkFlag} ${command}`;
}

// ==========================================================================
// MAINNET OVERRIDE
// ==========================================================================

function switchToMainnet() {
  CONFIG.network = 'mainnet';
  CONFIG.bitcoin.rpcPort = 8332;
  CONFIG.lnd.networkFlag = '';
  CONFIG.lnd.macaroonPath = CONFIG.lnd.macaroonPath.replace('/signet/', '/mainnet/');
  CONFIG.ord.networkFlag = '';
  CONFIG.test.feeRate = 4;  // Higher for mainnet
  console.log('Switched to MAINNET configuration');
  console.log('WARNING: Real money will be used!');
}

// ==========================================================================
// EXPORTS
// ==========================================================================

module.exports = {
  CONFIG,
  getExplorerUrl,
  getBitcoinCliCommand,
  getLncliCommand,
  getOrdCommand,
  switchToMainnet
};

// If run directly, print config
if (require.main === module) {
  console.log('SPARKLE Protocol - Current Configuration');
  console.log('========================================');
  console.log(`Network: ${CONFIG.network.toUpperCase()}`);
  console.log(`Bitcoin RPC Port: ${CONFIG.bitcoin.rpcPort}`);
  console.log(`LND Network Flag: ${CONFIG.lnd.networkFlag || '(none - mainnet)'}`);
  console.log(`Explorer: ${CONFIG.explorers[CONFIG.network]}`);
  console.log('');
  console.log('Faucets:');
  CONFIG.faucets[CONFIG.network]?.forEach(f => console.log(`  - ${f}`));
  console.log('');
  console.log('To switch to mainnet: require("./signet-config").switchToMainnet()');
}
