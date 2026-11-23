import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeLogs, digestEvents, filters, topic, transfer, classifyPurchases, reconcileCycle } from '../scripts/burn-events.mjs';
import { boundariesFromCache, collectDay } from '../scripts/collect-burns.mjs';
import { referenceFromChart } from '../scripts/burn-reference.mjs';
import { SALES, VVV, POOLS, VENICE, ZERO } from '../lib/config.js';

const address = '0x' + '11'.repeat(20);
const hash = i => '0x' + BigInt(i).toString(16).padStart(64,'0');
const day = {date:'2026-09-24',fromBlock:5,toBlock:8,blockHash:hash(80)};
const unit = 10n ** 18n;

function log({index=1,tx=1,amount=2015000n,asset=SALES.usdc,from=VENICE.burnWallet,to=address,block=6}={}) {
  return {address:asset, data:hash(amount), topics:[transfer,topic(from),topic(to)],blockNumber:'0x'+block.toString(16),
    logIndex:'0x'+index.toString(16),blockHash:hash(block*10),transactionHash:hash(tx)};
}
function sink(tx, index, from=POOLS.aerodromeVvvWeth) {
  return log({tx,index,amount:unit/10n,asset:VVV.token,from,to:ZERO});
}
const decode = (events, type) => decodeLogs(events,filters[type],day.fromBlock,day.toBlock);

test('only one recognized payment with matching same-transaction pool retirement is counted',()=>{
  const pay = [log(),log({tx:2,index:4,amount:5070000n}),log({tx:3,index:6,amount:250000000n}),
    log({tx:4,index:7}),log({tx:5,index:8}),log({tx:5,index:9}),log({tx:6,index:10})];
  const retire = [sink(1,2),sink(2,5),sink(4,11,address),sink(5,12),sink(7,13,VENICE.buybackSafe)];
  const result = classifyPurchases(day,decode(pay,'payments'),decode(retire,'burns'));
  assert.equal(result.pro,1);
  assert.equal(result.credits,1);
  assert.equal(result.confirmedBurnEvents,2);
  assert.equal(result.estimatedUsd,118);
  assert.equal(result.burnUsdc,7);
  assert.equal(result.raw.recognizedUsdc,'7085000');
  assert.equal(result.raw.salesVvv,String(unit/5n));
  assert.equal(result.raw.monthlyVvv,String(unit/10n));
  assert.equal(result.raw.otherVvv,String(unit/5n));
  assert.equal(result.unknown,5);
  assert.deepEqual(result.unknownReasons,{unrecognizedAmount:1,unrecognizedRoute:1,multiplePayments:2,noBurn:1});
  assert.equal(result.evidenceSha256.length,64);
  assert.throws(()=>classifyPurchases({...day,date:'2026-07-17'},[],[]),/Incomplete/);
});

test('duplicate, removed, out-of-range and wrong-contract logs fail the whole day',()=>{
  const payment = log();
  for (const bad of [[payment,payment],[{...payment,removed:true}],[{...payment,blockNumber:'0x9'}],[{...payment,address:VVV.token}]])
    assert.throws(()=>decode(bad,'payments'),/Invalid/);
  assert.equal(digestEvents(decode([payment],'payments')),digestEvents(decode([payment],'payments')));
});

test('daily aggregate reconciles to burn-address balance delta and failed chunks remain failures',async()=>{
  const rpc = {call:async (_method,[params]) => params.address===SALES.usdc.toLowerCase()?[log()]:[sink(1,2)]};
  const matching = await collectDay(rpc,{...day,dailyBurned:0.1});
  assert.equal(matching.confirmedBurnEvents,1);
  await assert.rejects(collectDay(rpc,{...day,dailyBurned:0.2}),/does not reconcile/);
  await assert.rejects(collectDay({call:async()=>{throw Error('provider unavailable');}},day),/unavailable/);
});

test('completed adjacent UTC days use prior last block plus one',()=>{
  const r = boundariesFromCache([{date:'2026-09-23',block:4,hash:hash(40)},{date:day.date,block:8,hash:hash(80)}]);
  assert.deepEqual(r,[day]);
  assert.throws(()=>boundariesFromCache([{date:'2026-09-22',block:4},{date:day.date,block:8}]));
});

test('external reference omits partial days, incomplete counts and unsupported withdrawal fields',()=>{
  const base = {t:Date.parse('2026-11-22T00:00Z'),programmaticCountPro:2,programmaticCountProPlus:3,
    programmaticCountMax:4,programmaticCountCredits:5,programmaticCount:9,programmaticUsd:89};
  const report=referenceFromChart({period:'tier-era',burns:[{...base,t:base.t-86400000,programmaticCountMax:null},base,
    {...base,t:base.t+86400000}]},'2026-11-22');
  assert.deepEqual(report.days,[{date:'2026-11-22',pro:2,proplus:3,max:4,credits:5,estimatedUsd:1540,providerBurnUsd:89}]);
});

test('cycle reconciles carried tokens, matched purchase cost net of change, other transfers and the burn',()=>{
  const details = {opening:5n*unit,closing:4n*unit,fromBlock:5,toBlock:8,date:day.date,
    tx:hash(5),priorTx:hash(0),blockHash:day.blockHash};
  const txs = {
    acquired:decode([log({index:1,tx:1,amount:8n*unit,asset:VVV.token,from:address,to:VENICE.buybackSafe}),
      log({index:2,tx:2,amount:unit,asset:VVV.token,from:address,to:VENICE.buybackSafe})],'acquired'),
    disposed:decode([sink(5,3,VENICE.buybackSafe)].map(e=>({...e,data:hash(10n*unit)})),'disposed'),
    spend:decode([log({from:VENICE.buybackSafe,amount:35000000n,tx:1,index:4})],'spend'),
    refund:decode([log({from:address,to:VENICE.buybackSafe,amount:5000000n,tx:1,index:5})],'refund')
  };
  const result = reconcileCycle(details,txs);
  assert.equal(result.spentUsdc,30);
  assert.equal(result.boughtVvv,8);
  assert.equal(result.otherVvv,1);
  assert.equal(result.verified,true);
  assert.throws(()=>reconcileCycle({...details,closing:0n},txs),/inventory mismatch/);
});

test('a silent empty payment response fails the independent USDC balance reconciliation',async()=>{
  const dayWithState={...day,raw:{dailyBurned:String(unit/10n),burnWalletUsdc:'7985000'},openingUsdc:'10000000'};
  const honest={call:async(_method,[filter])=>filter.address===VVV.token.toLowerCase()?[sink(1,2)]:
    filter.topics.length===2?[log()]:[]};
  const row=await collectDay(honest,dayWithState);
  assert.equal(row.raw.incomingUsdc,'0');
  assert.equal(row.raw.recognizedUsdc,'2015000');
  const missing={call:async(method,[filter])=>filter.topics.length===2?[]:honest.call(method,[filter])};
  await assert.rejects(collectDay(missing,dayWithState),/USDC logs do not reconcile/);
});
