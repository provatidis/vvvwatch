import assert from 'node:assert/strict';
import test from 'node:test';
import { collectVesting, summarizeVesting } from '../scripts/vesting.mjs';

const close = '2026-11-23';
const now = Date.parse('2026-11-24T19:00:00Z');
const source = {lastUpdated:'2026-11-24T18:00:00Z',dailyDripRate:13495,totalWithdrawn:7074579,totalStreams:206,
  dripCliff:{date:'2027-01-01',dropPct:94,streamCount:12}};

test('the vesting summary preserves source units and can omit a bad projection independently', () => {
  const result = summarizeVesting(source,close,now);
  assert.equal(result.asOf, '2026-11-24T18:00:00.000Z');
  assert.deepEqual(result.dripCliff,source.dripCliff);
  assert.equal(summarizeVesting({...source,dripCliff:{...source.dripCliff,dropPct:130}},close,now).dripCliff,null);
  for (const change of [{dailyDripRate:null},{totalWithdrawn:-1},{lastUpdated:'2026-11-30T12:00:00Z'}]) {
    assert.throws(()=>summarizeVesting({...source,...change},close,now));
  }
});

test('outages preserve only a recent dated reading and never manufacture an empty flow', async () => {
  const prior = summarizeVesting(source,close,now);
  const offline = async () => ({ok:false,status:503});
  assert.deepEqual(await collectVesting(prior,close,now,offline),{...prior,cached:true});
  assert.equal(await collectVesting(prior,'2026-11-27',now+4*86_400_000,offline),null);
  assert.equal(await collectVesting(null,close,now,offline),null);
});
