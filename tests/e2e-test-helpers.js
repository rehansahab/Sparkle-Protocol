/**
 * Sparkle Protocol - E2E Test Helpers
 *
 * Helper functions for running end-to-end swap tests.
 * Use with Bitcoin Core, LND, and ord indexer.
 *
 * @version 1.2.1
 */

const crypto = require('crypto');

// =============================================================================
// PREIMAGE GENERATION (Buyer Side)
// =============================================================================

/**
 * Generate a cryptographically secure preimage and payment hash
 * @returns {Object} { preimage, paymentHash, preimageBytes }
 */
function generatePreimage() {
  // Generate 32 random bytes
  const preimageBytes = crypto.randomBytes(32);
  const preimage = preimageBytes.toString('hex');

  // SHA256 hash
  const hashBytes = crypto.createHash('sha256').update(preimageBytes).digest();
  const paymentHash = hashBytes.toString('hex');

  return {
    preimage,
    paymentHash,
    preimageBytes,
    hashBytes,
  };
}

/**
 * Verify a preimage matches a payment hash
 * @param {string} preimage - 64 hex chars
 * @param {string} paymentHash - 64 hex chars
 * @returns {boolean}
 */
function verifyPreimage(preimage, paymentHash) {
  const preimageBytes = Buffer.from(preimage, 'hex');
  const computed = crypto.createHash('sha256').update(preimageBytes).digest('hex');
  return computed.toLowerCase() === paymentHash.toLowerCase();
}

// =============================================================================
// TIMELOCK CALCULATION
// =============================================================================

/**
 * Calculate a safe timelock height
 * @param {number} currentHeight - Current block height
 * @param {number} hoursFromNow - Hours until refund enabled
 * @returns {number} Timelock block height
 */
function calculateTimelock(currentHeight, hoursFromNow = 24) {
  // ~6 blocks per hour
  const blocksPerHour = 6;
  const safetyBuffer = 12; // Extra blocks for safety
  return currentHeight + (hoursFromNow * blocksPerHour) + safetyBuffer;
}

// =============================================================================
// WITNESS EXTRACTION
// =============================================================================

/**
 * Extract preimage from a sweep transaction witness
 *
 * Taproot script-path witness stack:
 * [0] signature (64 bytes)
 * [1] preimage (32 bytes) <-- THIS
 * [2] script (variable)
 * [3] control block (33+ bytes)
 *
 * @param {Object} tx - Decoded transaction object
 * @param {number} inputIndex - Input index (usually 0 for contract input)
 * @returns {string|null} Preimage hex or null
 */
function extractPreimageFromTx(tx, inputIndex = 0) {
  try {
    const input = tx.vin[inputIndex];
    if (!input || !input.txinwitness) {
      console.error('No witness data found');
      return null;
    }

    const witness = input.txinwitness;

    // For hashlock spend, preimage is at index 1
    // It should be exactly 32 bytes (64 hex chars)
    if (witness.length >= 2) {
      const potentialPreimage = witness[1];
      if (potentialPreimage && potentialPreimage.length === 64) {
        return potentialPreimage;
      }
    }

    console.error('Preimage not found in expected witness position');
    return null;
  } catch (error) {
    console.error('Error extracting preimage:', error.message);
    return null;
  }
}

// =============================================================================
// BITCOIN-CLI COMMAND GENERATORS
// =============================================================================

/**
 * Generate bitcoin-cli command to check UTXO status
 * @param {string} txid
 * @param {number} vout
 * @param {string} network - 'mainnet' | 'testnet' | 'signet'
 * @returns {string} CLI command
 */
function cmdCheckUtxo(txid, vout, network = 'testnet') {
  const flag = network === 'mainnet' ? '' : `-${network}`;
  return `bitcoin-cli ${flag} gettxout ${txid} ${vout}`;
}

/**
 * Generate bitcoin-cli command to get transaction
 * @param {string} txid
 * @param {string} network
 * @returns {string} CLI command
 */
function cmdGetTx(txid, network = 'testnet') {
  const flag = network === 'mainnet' ? '' : `-${network}`;
  return `bitcoin-cli ${flag} getrawtransaction ${txid} true`;
}

/**
 * Generate bitcoin-cli command to broadcast
 * @param {string} txHex
 * @param {string} network
 * @returns {string} CLI command
 */
function cmdBroadcast(txHex, network = 'testnet') {
  const flag = network === 'mainnet' ? '' : `-${network}`;
  return `bitcoin-cli ${flag} sendrawtransaction ${txHex}`;
}

// =============================================================================
// LND COMMAND GENERATORS
// =============================================================================

/**
 * Generate lncli command to create hold invoice
 * @param {string} paymentHash - 64 hex chars
 * @param {number} amountSats
 * @param {string} memo
 * @param {string} network
 * @returns {string} CLI command
 */
function cmdCreateHoldInvoice(paymentHash, amountSats, memo = 'Sparkle Swap', network = 'testnet') {
  const flag = network === 'mainnet' ? '' : `--network=${network}`;
  return `lncli ${flag} addholdinvoice --hash=${paymentHash} --amt=${amountSats} --memo="${memo}"`;
}

/**
 * Generate lncli command to settle hold invoice
 * @param {string} preimage - 64 hex chars
 * @param {string} network
 * @returns {string} CLI command
 */
function cmdSettleInvoice(preimage, network = 'testnet') {
  const flag = network === 'mainnet' ? '' : `--network=${network}`;
  // Convert hex to base64 for lncli
  const base64Preimage = Buffer.from(preimage, 'hex').toString('base64');
  return `lncli ${flag} settleinvoice ${base64Preimage}`;
}

/**
 * Generate lncli command to pay invoice
 * @param {string} bolt11
 * @param {string} network
 * @returns {string} CLI command
 */
function cmdPayInvoice(bolt11, network = 'testnet') {
  const flag = network === 'mainnet' ? '' : `--network=${network}`;
  return `lncli ${flag} payinvoice ${bolt11}`;
}

// =============================================================================
// ORD COMMAND GENERATORS
// =============================================================================

/**
 * Generate ord command to send inscription
 * @param {string} address - Destination address
 * @param {string} inscriptionId
 * @param {number} feeRate
 * @param {string} network
 * @param {string} wallet
 * @returns {string} CLI command
 */
function cmdSendInscription(address, inscriptionId, feeRate = 2, network = 'signet', wallet = 'default') {
  return `ord --${network} wallet --name ${wallet} send --fee-rate ${feeRate} ${address} ${inscriptionId}`;
}

/**
 * Generate ord command to list inscriptions
 * @param {string} network
 * @param {string} wallet
 * @returns {string} CLI command
 */
function cmdListInscriptions(network = 'signet', wallet = 'default') {
  return `ord --${network} wallet --name ${wallet} inscriptions`;
}

// =============================================================================
// TEST RESULT TRACKING
// =============================================================================

/**
 * Test result tracker
 */
class TestTracker {
  constructor(testName) {
    this.testName = testName;
    this.startTime = Date.now();
    this.steps = [];
    this.values = {};
  }

  recordStep(step, success, details = '') {
    this.steps.push({
      step,
      success,
      details,
      timestamp: Date.now(),
    });
    console.log(`[${success ? 'PASS' : 'FAIL'}] ${step}${details ? ': ' + details : ''}`);
  }

  recordValue(key, value) {
    this.values[key] = value;
    console.log(`[RECORDED] ${key}: ${value}`);
  }

  getReport() {
    const passed = this.steps.filter((s) => s.success).length;
    const failed = this.steps.filter((s) => !s.success).length;

    return {
      testName: this.testName,
      duration: Date.now() - this.startTime,
      passed,
      failed,
      success: failed === 0,
      steps: this.steps,
      values: this.values,
    };
  }

  printReport() {
    const report = this.getReport();
    console.log('\n=== TEST REPORT ===');
    console.log(`Test: ${report.testName}`);
    console.log(`Duration: ${report.duration}ms`);
    console.log(`Passed: ${report.passed}/${report.passed + report.failed}`);
    console.log(`Status: ${report.success ? 'SUCCESS' : 'FAILED'}`);
    console.log('\nRecorded Values:');
    Object.entries(report.values).forEach(([k, v]) => {
      console.log(`  ${k}: ${v}`);
    });
  }
}

// =============================================================================
// QUICK TEST RUNNER
// =============================================================================

/**
 * Run preimage generation test
 */
function testPreimageGeneration() {
  console.log('=== Testing Preimage Generation ===\n');

  const tracker = new TestTracker('Preimage Generation');

  // Generate
  const { preimage, paymentHash } = generatePreimage();
  tracker.recordValue('preimage', preimage);
  tracker.recordValue('paymentHash', paymentHash);
  tracker.recordStep('Generate preimage', preimage.length === 64);
  tracker.recordStep('Generate payment hash', paymentHash.length === 64);

  // Verify
  const verified = verifyPreimage(preimage, paymentHash);
  tracker.recordStep('Verify preimage matches hash', verified);

  // Wrong preimage should fail
  const wrongPreimage = '0'.repeat(64);
  const wrongVerify = verifyPreimage(wrongPreimage, paymentHash);
  tracker.recordStep('Wrong preimage should fail verification', !wrongVerify);

  tracker.printReport();
  return tracker.getReport();
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Preimage
  generatePreimage,
  verifyPreimage,

  // Timelock
  calculateTimelock,

  // Witness extraction
  extractPreimageFromTx,

  // Command generators
  cmdCheckUtxo,
  cmdGetTx,
  cmdBroadcast,
  cmdCreateHoldInvoice,
  cmdSettleInvoice,
  cmdPayInvoice,
  cmdSendInscription,
  cmdListInscriptions,

  // Test tracking
  TestTracker,
  testPreimageGeneration,
};

// Run tests if executed directly
if (require.main === module) {
  console.log('Sparkle Protocol E2E Test Helpers\n');

  // Quick self-test
  const result = testPreimageGeneration();

  if (result.success) {
    console.log('\n All helper tests passed!\n');
    console.log('Copy these commands for your AI with node access:');
    console.log('');
    console.log('# Generate preimage:');
    console.log(`node -e "const h = require('./e2e-test-helpers'); const p = h.generatePreimage(); console.log('Preimage:', p.preimage); console.log('Hash:', p.paymentHash);"`);
  } else {
    console.log('\nSome tests failed!');
    process.exit(1);
  }
}
