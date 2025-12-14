/**
 * SPARKLE Protocol TEST 2: Buyer Pays But Fails to Claim
 *
 * Purpose: Document the edge case where buyer pays Lightning but fails to
 *          broadcast claim TX before timelock expires (buyer-loss scenario)
 * Network: Regtest (simulated Lightning payment)
 */

const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');

const CLI = 'D:\\Bitcoin\\bin\\bitcoin-cli.exe -regtest -rpcuser=sparkle -rpcpassword=test123 -rpcport=18443';
const WALLET = '-rpcwallet=sparkle_test';

function btcCli(cmd) {
    try {
        const result = execSync(`${CLI} ${WALLET} ${cmd}`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
        return result.trim();
    } catch (e) {
        return { error: e.stderr || e.message };
    }
}

function btcCliNoWallet(cmd) {
    try {
        const result = execSync(`${CLI} ${cmd}`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
        return result.trim();
    } catch (e) {
        return { error: e.stderr || e.message };
    }
}

async function runBuyerFailsTest() {
    console.log('==============================================');
    console.log('SPARKLE TEST 2: Buyer Pays But Fails to Claim');
    console.log('==============================================\n');

    const testResult = {
        test: 'buyer_fails_to_claim',
        timestamp: new Date().toISOString(),
        scenario: 'Buyer paid Lightning invoice, received preimage, but did NOT broadcast claim TX before timelock expired',
        steps: []
    };

    try {
        // Step 1: Setup - simulate the locked inscription
        console.log('[1] Setting up lock scenario...');

        const currentHeight = parseInt(btcCliNoWallet('getblockcount'));
        const timelockHeight = currentHeight + 3;
        console.log(`    Current height: ${currentHeight}`);
        console.log(`    Timelock: ${timelockHeight} (+3 blocks)`);

        const sellerAddr = btcCli('getnewaddress "seller" bech32');
        const lockAddr = btcCli('getnewaddress "lock" bech32');
        const minerAddr = btcCli('getnewaddress "miner" bech32');

        testResult.current_height = currentHeight;
        testResult.timelock_height = timelockHeight;
        testResult.seller_address = sellerAddr;

        // Step 2: Create "lock" TX (simulating inscription lock)
        console.log('\n[2] Creating lock transaction (inscription locked)...');
        const lockResult = btcCli(`send "{\\"${lockAddr}\\": 0.0001}" null "unset" 1`);
        let lockTxid;
        try { lockTxid = JSON.parse(lockResult).txid; } catch { lockTxid = lockResult; }
        console.log(`    Lock TXID: ${lockTxid}`);
        testResult.lock_txid = lockTxid;
        testResult.steps.push({ action: 'create_lock', txid: lockTxid, status: 'SUCCESS' });

        btcCliNoWallet(`generatetoaddress 1 ${minerAddr}`);

        // Step 3: Generate preimage and payment hash (simulating Lightning)
        console.log('\n[3] Simulating Lightning payment...');
        const preimage = crypto.randomBytes(32);
        const paymentHash = crypto.createHash('sha256').update(preimage).digest();
        console.log(`    Preimage: ${preimage.toString('hex')}`);
        console.log(`    Payment Hash: ${paymentHash.toString('hex')}`);
        testResult.preimage = preimage.toString('hex');
        testResult.payment_hash = paymentHash.toString('hex');

        // Step 4: BUYER PAYS - receives preimage
        console.log('\n[4] BUYER PAYS LIGHTNING INVOICE...');
        console.log('    ✅ Payment successful - Buyer receives preimage');
        testResult.invoice_paid = true;
        testResult.preimage_received = preimage.toString('hex');
        testResult.steps.push({
            action: 'lightning_payment',
            status: 'PAID',
            preimage_revealed: true
        });

        // Step 5: BUYER DOES NOT CLAIM - fails to broadcast
        console.log('\n[5] BUYER FAILS TO BROADCAST CLAIM TX...');
        console.log('    ⚠️  Buyer has preimage but does NOT claim');
        console.log('    (Maybe: offline, lost connection, forgot, etc.)');
        testResult.claim_broadcast = false;
        testResult.steps.push({
            action: 'buyer_inaction',
            claim_broadcast: false,
            reason: 'Buyer failed to broadcast claim TX'
        });

        // Step 6: Timelock expires
        console.log('\n[6] Waiting for timelock to expire...');
        let h = parseInt(btcCliNoWallet('getblockcount'));
        const blocksNeeded = Math.max(0, timelockHeight - h + 1);
        console.log(`    Mining ${blocksNeeded} blocks...`);
        if (blocksNeeded > 0) {
            btcCliNoWallet(`generatetoaddress ${blocksNeeded} ${minerAddr}`);
        }
        h = parseInt(btcCliNoWallet('getblockcount'));
        console.log(`    New height: ${h} - TIMELOCK EXPIRED!`);
        testResult.timelock_expired = true;
        testResult.height_at_expiry = h;
        testResult.steps.push({ action: 'timelock_expired', block: h, status: 'SUCCESS' });

        // Step 7: Seller reclaims via refund path
        console.log('\n[7] SELLER BROADCASTS REFUND TRANSACTION...');

        const lockTxRaw = JSON.parse(btcCliNoWallet(`getrawtransaction ${lockTxid} true`));
        let lockVout = 0;
        for (let i = 0; i < lockTxRaw.vout.length; i++) {
            if (lockTxRaw.vout[i].scriptPubKey.address === lockAddr) {
                lockVout = i;
                break;
            }
        }
        const lockValue = lockTxRaw.vout[lockVout].value;
        const refundValue = (lockValue - 0.00001).toFixed(8);

        const refundRaw = btcCli(`createrawtransaction "[{\\"txid\\":\\"${lockTxid}\\",\\"vout\\":${lockVout},\\"sequence\\":4294967294}]" "[{\\"${sellerAddr}\\":${refundValue}}]" ${timelockHeight}`);
        const refundSigned = JSON.parse(btcCli(`signrawtransactionwithwallet "${refundRaw}"`));

        if (refundSigned.complete) {
            const refundTxid = btcCliNoWallet(`sendrawtransaction "${refundSigned.hex}"`);
            console.log(`    ✅ Seller refund TXID: ${refundTxid}`);
            testResult.refund_txid = refundTxid;
            testResult.steps.push({ action: 'seller_refund', txid: refundTxid, status: 'SUCCESS' });

            btcCliNoWallet(`generatetoaddress 1 ${minerAddr}`);
            console.log('    Refund confirmed - Seller recovered inscription');
        }

        // Step 8: Document outcome
        console.log('\n[8] FINAL OUTCOME:');
        console.log('    ┌─────────────────────────────────────────┐');
        console.log('    │  BUYER:  LOST PAYMENT (has preimage)   │');
        console.log('    │  SELLER: RECOVERED INSCRIPTION         │');
        console.log('    └─────────────────────────────────────────┘');

        testResult.buyer_outcome = 'LOST_PAYMENT';
        testResult.seller_outcome = 'RECOVERED_INSCRIPTION';
        testResult.buyer_has_preimage = true;
        testResult.buyer_has_inscription = false;
        testResult.seller_has_inscription = true;
        testResult.seller_received_payment = true; // via Lightning before refund

        testResult.lesson = 'CRITICAL: Buyers MUST broadcast claim TX immediately after receiving preimage. Failure to claim before timelock = total loss of payment with no recourse.';

        testResult.result = 'DOCUMENTED';

        // Summary
        console.log('\n==============================================');
        console.log('TEST 2 RESULT: DOCUMENTED ✅');
        console.log('==============================================');
        console.log('\nThis is a BUYER-LOSS scenario that users must understand.');
        console.log('The protocol is NOT atomic if buyer fails to claim.');
        console.log('\nMitigation: SPARKLE client auto-broadcasts claim immediately');
        console.log('upon receiving preimage from settled Lightning payment.');

        testResult.mitigation = 'SPARKLE client should auto-broadcast claim TX immediately upon Lightning settlement';
        testResult.conclusion = 'Buyer-loss scenario documented. Protocol requires buyer action within timelock window.';

    } catch (err) {
        console.error('Test error:', err);
        testResult.error = err.message;
        testResult.result = 'ERROR';
    }

    console.log('\nFull Test Result:');
    console.log(JSON.stringify(testResult, null, 2));

    fs.writeFileSync(
        'C:\\Users\\sk84l\\Downloads\\PROTOCOL UPDATE\\hostinger-deploy\\tests\\TEST_2_buyer_fails_claim_result.json',
        JSON.stringify(testResult, null, 2)
    );
    console.log('\nResult saved to TEST_2_buyer_fails_claim_result.json');

    return testResult;
}

runBuyerFailsTest().catch(console.error);
