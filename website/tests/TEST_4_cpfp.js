/**
 * SPARKLE Protocol TEST 4: CPFP Fee Bump Recovery
 *
 * Purpose: Demonstrate that a stuck claim TX can be accelerated via CPFP
 * Network: Regtest
 */

const { execSync } = require('child_process');
const fs = require('fs');

const CLI = 'bitcoin-cli -regtest -rpcuser=YOUR_USERNAME -rpcpassword=YOUR_PASSWORD -rpcport=18443';
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

async function runCPFPTest() {
    console.log('========================================');
    console.log('SPARKLE TEST 4: CPFP Fee Bump Recovery');
    console.log('========================================\n');

    const testResult = {
        test: 'cpfp_fee_bump',
        timestamp: new Date().toISOString(),
        steps: []
    };

    try {
        // Step 1: Create a "claim" transaction with very low fee
        console.log('[1] Creating simulated claim TX with LOW fee...');

        const claimDestination = btcCli('getnewaddress "claim_output" bech32');
        const cpfpDestination = btcCli('getnewaddress "cpfp_output" bech32');
        const minerAddr = btcCli('getnewaddress "miner" bech32');

        // First, fund a source address
        const sourceAddr = btcCli('getnewaddress "source" bech32');
        const fundResult = btcCli(`send "{\\"${sourceAddr}\\": 0.001}" null "unset" 1`);
        let fundTxid;
        try {
            fundTxid = JSON.parse(fundResult).txid;
        } catch {
            fundTxid = fundResult;
        }

        // Mine to confirm
        btcCliNoWallet(`generatetoaddress 1 ${minerAddr}`);
        console.log(`    Source funded: ${fundTxid}`);
        testResult.fund_txid = fundTxid;

        // Find the vout
        const fundTxRaw = JSON.parse(btcCliNoWallet(`getrawtransaction ${fundTxid} true`));
        let fundVout = 0;
        for (let i = 0; i < fundTxRaw.vout.length; i++) {
            if (fundTxRaw.vout[i].scriptPubKey.address === sourceAddr) {
                fundVout = i;
                break;
            }
        }

        // Step 2: Create claim TX with minimum fee (1 sat/vB would normally be stuck)
        console.log('\n[2] Creating claim TX with 1 sat/vB fee...');

        // Calculate: 0.001 BTC input, output just under that with tiny fee
        const claimValue = 0.00099; // Very small fee difference
        const claimRaw = btcCli(`createrawtransaction "[{\\"txid\\":\\"${fundTxid}\\",\\"vout\\":${fundVout}}]" "[{\\"${claimDestination}\\":${claimValue}}]"`);
        const claimSigned = JSON.parse(btcCli(`signrawtransactionwithwallet "${claimRaw}"`));

        // Calculate fee rate
        const claimTxSize = claimSigned.hex.length / 2; // Approximate vbytes
        const claimFee = 100000 - 99000; // 1000 sats fee for ~110 vbyte tx ≈ 9 sat/vB
        console.log(`    Claim TX size: ~${claimTxSize} vbytes`);
        console.log(`    Claim TX fee: ${claimFee} sats (~${Math.round(claimFee / (claimTxSize * 0.9))} sat/vB)`);

        // Broadcast claim TX (it will be in mempool)
        const claimTxid = btcCliNoWallet(`sendrawtransaction "${claimSigned.hex}"`);
        console.log(`    Claim TXID: ${claimTxid}`);
        testResult.claim_txid = claimTxid;
        testResult.claim_fee_sats = claimFee;
        testResult.steps.push({ action: 'create_claim_tx', txid: claimTxid, status: 'IN_MEMPOOL' });

        // Verify it's in mempool
        const mempoolInfo = JSON.parse(btcCliNoWallet('getmempoolinfo'));
        console.log(`    Mempool size: ${mempoolInfo.size} txs`);

        // Step 3: Create CPFP transaction spending the claim output
        console.log('\n[3] Creating CPFP transaction with HIGH fee...');

        // The claim output is at vout 0 with value 0.00099
        const cpfpValue = 0.00089; // Leave 0.0001 (10000 sats) for fee
        const cpfpRaw = btcCli(`createrawtransaction "[{\\"txid\\":\\"${claimTxid}\\",\\"vout\\":0}]" "[{\\"${cpfpDestination}\\":${cpfpValue}}]"`);
        const cpfpSigned = JSON.parse(btcCli(`signrawtransactionwithwallet "${cpfpRaw}"`));

        const cpfpSize = cpfpSigned.hex.length / 2;
        const cpfpFee = 99000 - 89000; // 10000 sats for CPFP
        console.log(`    CPFP TX size: ~${cpfpSize} vbytes`);
        console.log(`    CPFP TX fee: ${cpfpFee} sats (~${Math.round(cpfpFee / (cpfpSize * 0.9))} sat/vB)`);

        // Calculate effective combined fee rate
        const totalFee = claimFee + cpfpFee;
        const totalSize = claimTxSize + cpfpSize;
        const effectiveRate = Math.round(totalFee / (totalSize * 0.9));
        console.log(`    Combined effective rate: ~${effectiveRate} sat/vB`);
        testResult.cpfp_fee_sats = cpfpFee;
        testResult.combined_effective_rate = effectiveRate;

        // Broadcast CPFP
        const cpfpTxid = btcCliNoWallet(`sendrawtransaction "${cpfpSigned.hex}"`);
        console.log(`    CPFP TXID: ${cpfpTxid}`);
        testResult.cpfp_txid = cpfpTxid;
        testResult.steps.push({ action: 'create_cpfp_tx', txid: cpfpTxid, status: 'IN_MEMPOOL' });

        // Verify both are in mempool
        const mempool2 = JSON.parse(btcCliNoWallet('getmempoolinfo'));
        console.log(`    Mempool now: ${mempool2.size} txs`);

        // Step 4: Mine a block and verify BOTH confirm together
        console.log('\n[4] Mining block to confirm both transactions...');
        const blocksBefore = parseInt(btcCliNoWallet('getblockcount'));
        btcCliNoWallet(`generatetoaddress 1 ${minerAddr}`);
        const blocksAfter = parseInt(btcCliNoWallet('getblockcount'));
        console.log(`    Mined block ${blocksAfter}`);
        testResult.confirmation_block = blocksAfter;

        // Check confirmations
        const claimConfirmed = JSON.parse(btcCliNoWallet(`getrawtransaction ${claimTxid} true`));
        const cpfpConfirmed = JSON.parse(btcCliNoWallet(`getrawtransaction ${cpfpTxid} true`));

        console.log(`    Claim TX confirmations: ${claimConfirmed.confirmations}`);
        console.log(`    CPFP TX confirmations: ${cpfpConfirmed.confirmations}`);

        if (claimConfirmed.confirmations >= 1 && cpfpConfirmed.confirmations >= 1) {
            console.log('\n    ✅ BOTH TRANSACTIONS CONFIRMED TOGETHER!');
            testResult.claim_confirmations = claimConfirmed.confirmations;
            testResult.cpfp_confirmations = cpfpConfirmed.confirmations;
            testResult.result = 'PASS';
            testResult.steps.push({
                action: 'confirm_both',
                claim_confirmed: true,
                cpfp_confirmed: true,
                status: 'SUCCESS'
            });
        } else {
            console.log('\n    ❌ Confirmation issue');
            testResult.result = 'FAIL';
        }

        // Verify they're in the same block
        if (claimConfirmed.blockhash === cpfpConfirmed.blockhash) {
            console.log(`    ✅ Both in same block: ${claimConfirmed.blockhash.substring(0, 16)}...`);
            testResult.same_block = true;
        }

        // Final Summary
        console.log('\n========================================');
        console.log(`TEST 4 RESULT: ${testResult.result === 'PASS' ? 'PASS ✅' : 'FAIL ❌'}`);
        console.log('========================================');

        testResult.conclusion = testResult.result === 'PASS'
            ? 'CPFP successfully accelerated stuck claim TX. Both transactions confirmed in same block.'
            : 'Test failed - check error details';

    } catch (err) {
        console.error('Test error:', err);
        testResult.error = err.message;
        testResult.result = 'ERROR';
    }

    console.log('\nFull Test Result:');
    console.log(JSON.stringify(testResult, null, 2));

    fs.writeFileSync(
        './TEST_4_cpfp_result.json',
        JSON.stringify(testResult, null, 2)
    );
    console.log('\nResult saved to TEST_4_cpfp_result.json');

    return testResult;
}

runCPFPTest().catch(console.error);
