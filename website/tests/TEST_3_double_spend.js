/**
 * SPARKLE Protocol TEST 3: Double-Spend Prevention
 *
 * Purpose: Verify that once lock TX is confirmed, seller cannot double-spend
 * Network: Regtest
 */

const { execSync } = require('child_process');
const crypto = require('crypto');

// Regtest configuration
const CLI = 'bitcoin-cli -regtest -rpcuser=YOUR_USERNAME -rpcpassword=YOUR_PASSWORD -rpcport=18443';
const WALLET = '-rpcwallet=sparkle_test';

function btcCli(cmd) {
    try {
        const result = execSync(`${CLI} ${WALLET} ${cmd}`, { encoding: 'utf8' });
        return result.trim();
    } catch (e) {
        return { error: e.stderr || e.message };
    }
}

function btcCliNoWallet(cmd) {
    try {
        const result = execSync(`${CLI} ${cmd}`, { encoding: 'utf8' });
        return result.trim();
    } catch (e) {
        return { error: e.stderr || e.message };
    }
}

async function runDoubleSpendTest() {
    console.log('========================================');
    console.log('SPARKLE TEST 3: Double-Spend Prevention');
    console.log('========================================\n');

    const testResult = {
        test: 'double_spend_prevention',
        timestamp: new Date().toISOString(),
        steps: []
    };

    // Step 1: Get current block height
    const startHeight = parseInt(btcCliNoWallet('getblockcount'));
    console.log(`[1] Starting block height: ${startHeight}`);
    testResult.start_height = startHeight;

    // Step 2: Get a fresh address for lock destination (simulating SPARKLE lock address)
    const lockAddress = btcCli('getnewaddress "sparkle_lock" bech32m');
    console.log(`[2] Lock address (Taproot): ${lockAddress}`);
    testResult.lock_address = lockAddress;

    // Step 3: Get seller address for refund
    const sellerAddress = btcCli('getnewaddress "seller" bech32');
    console.log(`[3] Seller address: ${sellerAddress}`);
    testResult.seller_address = sellerAddress;

    // Step 4: Create and broadcast lock TX
    console.log('\n[4] Creating lock transaction...');
    const sendResult = btcCli(`send "{\\"${lockAddress}\\": 0.0001}" null "unset" 1`);
    let lockTxid;
    try {
        const sendJson = JSON.parse(sendResult);
        lockTxid = sendJson.txid;
    } catch (e) {
        console.log('Send result:', sendResult);
        lockTxid = sendResult; // Sometimes returns just txid
    }
    console.log(`   Lock TXID: ${lockTxid}`);
    testResult.lock_txid = lockTxid;
    testResult.steps.push({ action: 'create_lock_tx', txid: lockTxid, status: 'SUCCESS' });

    // Step 5: Get the raw transaction to find the input used
    console.log('\n[5] Getting lock TX details...');
    const lockTxRaw = JSON.parse(btcCliNoWallet(`getrawtransaction ${lockTxid} true`));
    const inputTxid = lockTxRaw.vin[0].txid;
    const inputVout = lockTxRaw.vin[0].vout;
    console.log(`   Input UTXO: ${inputTxid}:${inputVout}`);
    testResult.lock_input = { txid: inputTxid, vout: inputVout };

    // Step 6: Mine 1 block to confirm lock TX
    console.log('\n[6] Mining 1 block to confirm lock TX...');
    btcCliNoWallet(`generatetoaddress 1 ${sellerAddress}`);
    const confirmHeight = parseInt(btcCliNoWallet('getblockcount'));
    console.log(`   Lock TX confirmed at block ${confirmHeight}`);
    testResult.lock_confirmed_height = confirmHeight;
    testResult.steps.push({ action: 'mine_confirmation', block: confirmHeight, status: 'SUCCESS' });

    // Step 7: Verify lock TX is confirmed
    const lockTxConfirmed = JSON.parse(btcCliNoWallet(`getrawtransaction ${lockTxid} true`));
    console.log(`   Confirmations: ${lockTxConfirmed.confirmations}`);
    testResult.lock_confirmations = lockTxConfirmed.confirmations;

    // Step 8: ATTEMPT DOUBLE-SPEND - Try to spend the same input UTXO again
    console.log('\n[7] ATTEMPTING DOUBLE-SPEND...');
    console.log('   Creating conflicting TX spending the same input UTXO...');

    // Get info about the original input
    const originalInput = JSON.parse(btcCliNoWallet(`getrawtransaction ${inputTxid} true`));
    const inputValue = originalInput.vout[inputVout].value;
    const inputScript = originalInput.vout[inputVout].scriptPubKey.hex;
    console.log(`   Original input value: ${inputValue} BTC`);

    // Create a raw transaction trying to spend the same input
    const doubleSpendAddress = btcCli('getnewaddress "double_spend_attempt" bech32');
    const outputValue = (inputValue - 0.0001).toFixed(8); // Subtract fee

    const createRawCmd = `createrawtransaction "[{\\"txid\\":\\"${inputTxid}\\",\\"vout\\":${inputVout}}]" "[{\\"${doubleSpendAddress}\\":${outputValue}}]"`;
    const rawTx = btcCli(createRawCmd);
    console.log(`   Created raw double-spend TX`);
    testResult.double_spend_raw_tx = rawTx.substring(0, 64) + '...';

    // Sign the raw transaction
    console.log('   Signing double-spend TX...');
    const signedResult = btcCli(`signrawtransactionwithwallet "${rawTx}"`);
    const signedTx = JSON.parse(signedResult);
    console.log(`   Signed: ${signedTx.complete}`);

    if (signedTx.hex) {
        // Step 9: Attempt to broadcast the double-spend
        console.log('\n[8] BROADCASTING DOUBLE-SPEND TX...');
        const broadcastResult = btcCliNoWallet(`sendrawtransaction "${signedTx.hex}"`);

        if (broadcastResult.error || broadcastResult.includes('error')) {
            console.log('   ✅ DOUBLE-SPEND REJECTED!');
            console.log(`   Rejection: ${JSON.stringify(broadcastResult)}`);
            testResult.double_spend_result = 'REJECTED';
            testResult.rejection_reason = broadcastResult;
            testResult.steps.push({
                action: 'broadcast_double_spend',
                status: 'REJECTED',
                reason: broadcastResult
            });
        } else {
            console.log('   ❌ UNEXPECTED: Double-spend was accepted!');
            testResult.double_spend_result = 'UNEXPECTED_SUCCESS';
            testResult.double_spend_txid = broadcastResult;
        }
    } else {
        console.log('   Signing failed (expected - input already spent)');
        console.log(`   Error: ${JSON.stringify(signedTx.errors)}`);
        testResult.double_spend_result = 'REJECTED_AT_SIGNING';
        testResult.rejection_reason = signedTx.errors;
        testResult.steps.push({
            action: 'sign_double_spend',
            status: 'REJECTED',
            reason: signedTx.errors
        });
    }

    // Step 10: Verify original lock output is still valid
    console.log('\n[9] Verifying lock output still valid...');
    const lockOutput = JSON.parse(btcCliNoWallet(`gettxout ${lockTxid} 0`));
    if (lockOutput) {
        console.log('   ✅ Lock output still exists and is spendable');
        testResult.lock_output_valid = true;
    } else {
        console.log('   Lock output not found (may be non-zero vout)');
        // Check other outputs
        for (let i = 0; i < 3; i++) {
            const out = btcCliNoWallet(`gettxout ${lockTxid} ${i}`);
            if (out && out !== 'null') {
                console.log(`   Found output at vout ${i}`);
                testResult.lock_output_valid = true;
                break;
            }
        }
    }

    // Final result
    console.log('\n========================================');
    console.log('TEST 3 RESULT: ' + (testResult.double_spend_result === 'REJECTED' || testResult.double_spend_result === 'REJECTED_AT_SIGNING' ? 'PASS ✅' : 'FAIL ❌'));
    console.log('========================================');

    testResult.conclusion = testResult.double_spend_result.includes('REJECTED')
        ? 'Once lock TX is confirmed, inscription is secured against double-spend'
        : 'UNEXPECTED: Further investigation needed';
    testResult.result = testResult.double_spend_result.includes('REJECTED') ? 'PASS' : 'FAIL';

    console.log('\nFull Test Result:');
    console.log(JSON.stringify(testResult, null, 2));

    return testResult;
}

// Run the test
runDoubleSpendTest()
    .then(result => {
        // Save result to file
        const fs = require('fs');
        fs.writeFileSync(
            './TEST_3_double_spend_result.json',
            JSON.stringify(result, null, 2)
        );
        console.log('\nResult saved to TEST_3_double_spend_result.json');
    })
    .catch(err => {
        console.error('Test failed:', err);
    });
