import assert from 'node:assert/strict';
import test from 'node:test';
import { VVV } from '../lib/config.js';
import { dayOffset } from '../lib/metrics.js';
import { decodeAggregate3Calls, encodeAggregate3Results } from '../lib/multicall.js';
import { word } from '../scripts/rpc.mjs';
import { readVestingHistory, streamChanges } from '../scripts/vesting-history.mjs';

const unit = 10n ** 18n;
const balance = (unlocked, withdrawn) => ({unlocked: BigInt(unlocked) * unit, withdrawn: BigInt(withdrawn) * unit});

test('withdrawals can draw on earlier vesting and new streams enter at zero', () => {
  const before = new Map([['existing', balance(100,25)]]);
  const after = new Map([['existing', balance(110,105)], ['new', balance(15,7)]]);
  assert.deepEqual(streamChanges(before,after), {unlocked:25, withdrawn:87});
});

test('a missing or decreasing individual stream invalidates the window even if the total rises', () => {
  const before = new Map([['old',balance(10,5)]]);
  for (const closing of [new Map(), new Map([['old',balance(9,5)],['new',balance(20,10)]]),
    new Map([['old',balance(11,4)]])]) assert.throws(() => streamChanges(before,closing));
});

test('replay checks the token and uses the stream counter at each canonical boundary', async () => {
  const address = '0x4cb16d4153123a74bc724d161050959754f378d8';
  const streams = {[address]:[1,2]};
  const days = Array.from({length:91}, (_, i) => ({
    date:dayOffset('2026-01-01',i), toBlock:i+100, blockHash:'0x'+word(i+100)
  }));
  let asset = VVV.token;
  const rpc = {async call(method, [{data}, block]) {
    assert.equal(method, 'eth_call');
    assert.equal(block.requireCanonical, true);
    const offset = [0,60,90].find(i => days[i].blockHash === block.blockHash);
    assert.notEqual(offset, undefined);
    const results = decodeAggregate3Calls(data).map(call => {
      assert.equal(call.to, address);
      const selector = call.data.slice(0,10);
      if (selector === '0x1e99d569') return offset === 90 ? 3n : 2n;
      const stream = Number(BigInt('0x'+call.data.slice(10)));
      assert(stream === 1 || (offset === 90 && stream === 2));
      if (selector === '0xeac8f5b8') return BigInt(asset);
      if (selector === '0x4869e12d') return BigInt(offset+10) * unit;
      assert.equal(selector, '0xd511609f');
      return BigInt(offset) * unit;
    });
    return encodeAggregate3Results(results.map(n => ({success:true,data:'0x'+word(n)})));
  }};
  const history = await readVestingHistory(rpc,{days},streams);
  assert.equal(history.streamCount, 2);
  assert.deepEqual(history.windows[30], {start:days[61].date,end:days[90].date,startBlock:160,endBlock:190,unlocked:130,withdrawn:120});
  assert.equal(history.windows[90].unlocked, 190);
  asset = '0x0000000000000000000000000000000000000001';
  await assert.rejects(readVestingHistory(rpc,{days},streams), /Invalid VVV/);
});
