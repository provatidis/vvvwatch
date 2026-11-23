import test from 'node:test';
import assert from 'node:assert/strict';
import { verifiedInventory } from '../scripts/buybacks.mjs';
import { readBurnValuation } from '../scripts/burn-valuation.mjs';
import { burnValueUsd } from '../lib/burn-value.js';
import { planAlerts } from '../lib/alerts.js';
import { SALES, VENICE, VVV, ZERO } from '../lib/config.js';

const safe = VENICE.buybackSafe;
const settlement = '0x9008d19f58aabd9ed0d60971565aa8510560ab41';
const buyTx = '0x' + 'ab'.repeat(32), burnTx = '0x' + 'cd'.repeat(32);
const wei = n => BigInt(n) * 10n ** 18n;
const prior = {block: 100, tx: '0x' + '11'.repeat(32), raw: {closingVvv: String(wei(2)), closingUsdc: '1000000000'}};
const burn = {date: '2026-11-09', block: 110, tx: burnTx, blockHash: '0x' + 'ee'.repeat(32),
  raw: {closingVvv: String(wei(4)), burnedVvv: String(wei(10)), closingUsdc: '900000000'}};
const log = (tx, index, tokenAddress, from, to, value) => ({
  blockNumber: tx === burnTx ? 110 : 105, transactionHash: tx, transferId: 'e'+tx.slice(2)+index,
  tokenAddress, from, to, value: String(value)
});
const transfers = [
  log(buyTx, 3, SALES.usdc, safe, settlement, 100000000),
  log(buyTx, 8, VVV.token, settlement, safe, wei(12)),
  log(burnTx, 21, VVV.token, safe, ZERO, wei(10))
];
test('Safe spending requires VVV and USDC inventory, a matched fill and the closing receipt', () => {
  const result = verifiedInventory(prior, burn, transfers);
  assert.equal(result.verified, true);
  assert.equal(result.spentUsdc, 100);
  assert.equal(result.closingVvv, 4);
  assert.equal(result.fillCount, 1);
  assert.throws(() => verifiedInventory(prior, burn, transfers.slice(1)), /USDC transfers/);
  assert.throws(() => verifiedInventory(prior, burn, [...transfers, transfers[0]]), /Invalid indexed/);
  assert.throws(() => verifiedInventory(prior, {...burn,raw:{...burn.raw,burnedVvv:'1'}}, transfers), /differs from receipt/);
});


const encode = (...words) => '0x' + words.map(v => BigInt(v).toString(16).padStart(64,'0')).join('');
const timestamp = 1780000000;
const evidence = {...burn, timestamp, burnVerified:true, burnedVvv:10};
const inputs = [
  {hash:burn.blockHash,number:'0x6e',timestamp:'0x'+timestamp.toString(16)},
  encode('0x4200000000000000000000000000000000000006'), encode(VVV.token),
  encode(wei(1),wei(100),timestamp-9), encode(0),
  encode(3,2000_00000000n,timestamp-50,timestamp-40,3),encode(8)
];
test('burn-block market value is reproducible from both historic contracts', async () => {
  const quote = await readBurnValuation({batch:async calls=>{
    assert.equal(calls.length,7);
    assert(calls.slice(1).every(c=>c.method==='eth_call' && c.params[1]==='0x6e'));
    return inputs;
  }},evidence);
  assert.equal(quote.priceUsd,20);
  assert.equal(quote.usd,200);
  assert.equal(quote.roundId,'3');
  assert.equal(burnValueUsd({...evidence,valuation:quote}),200);
  assert.equal(burnValueUsd({...evidence,valuation:{...quote,block:111}}),null);
  assert.equal(burnValueUsd({...evidence,valuation:{...quote,usd:900}}),null);
});
test('invalid addresses, block hashes, pool types and stale, future or negative prices fail valuation', async () => {
  for (const [index,change] of [
    [0,{...inputs[0],hash:'different'}], [1,encode(ZERO)], [4,encode(1)], [6,encode(18)],
    [3,encode(wei(1),wei(100),timestamp-1201)],
    [5,encode(3,2000_00000000n,timestamp-1300,timestamp-1201,3)],
    [5,encode(3,1n<<255n,timestamp-50,timestamp-40,3)],
    [5,encode(3,2000_00000000n,timestamp-50,timestamp+1,3)]
  ]) {
    await assert.rejects(readBurnValuation({batch:async()=>inputs.with(index,change)},evidence));
  }
});
test('monthly event threshold and notice use burn value independently of spend', () => {
  const baseline = {lastDay:'2026-11-08',checks:[],sources:{buybacks:{ok:true,asOf:'2026-11-08'}},rules:{changes:[]},
    buybacks:{cycles:[]}};
  const journal = planAlerts(null,baseline);
  const cycle = (date,tx,usd,spentUsdc)=>({...evidence,date,tx,verified:true,spentUsdc,valuation:{usd,priceUsd:usd/10,block:burn.block,blockHash:burn.blockHash}});
  const prior = cycle('2026-10-07',buyTx,200,100), latest = cycle('2026-11-09',burnTx,242,0);
  const s = {...baseline,lastDay:latest.date,sources:{buybacks:{ok:true,asOf:latest.date}},buybacks:{cycles:[prior,latest]}};
  const notice = planAlerts(journal,s).issues['burn-'+burnTx];
  assert.match(notice.title,/value rose 21%/);
  assert.match(notice.body,/\$242/);
  assert.match(notice.body,/spent 0 USDC/);
  prior.valuation=null;
  assert.doesNotMatch(planAlerts(journal,s).issues['burn-'+burnTx].title,/rose/);
});
