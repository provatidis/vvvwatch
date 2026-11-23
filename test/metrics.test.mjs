import test from 'node:test';
import assert from 'node:assert/strict';
import { contiguous, dayOffset, grade, makeSnapshot, supplyWindow } from '../lib/metrics.js';
import { planAlerts } from '../lib/alerts.js';
import { summarizedUsage } from '../scripts/context.mjs';

const end = '2026-11-22';
const now = new Date('2026-11-23T03:41:00Z');
const rows = Array.from({length: 91}, (_, i) => ({
  date: dayOffset(end, i - 90), fromBlock: i * 10 + 1, toBlock: i * 10 + 10,
  dailyMinted: 100, dailyBurned: i > 60 ? 33 : 18, effective: 2_000_000,
  staked: 100_000, locked: 25_000, diemSupply: 10_000, diemStaked: 8_000,
  mintRate: 400, veniceVvv: 800, veniceSvvv: i < 90 ? 500 : 0, veniceCooldown: i === 90 ? 500 : 0,
  mintVenice: 0, exitsStarted: 0
}));
const protocol = {days: rows, lastDay: end, rules: {values: {}, changes: []}, policy: []};
const burns = {lastDay: end, buybacks: {asOf: end, cycles: []}, sales: {days: []}};
const context = {utilization: null, prices: null};
const snapshot = () => makeSnapshot(protocol, burns, context, {now});

test('90-day and 30-day grades use their own windows and opening block', () => {
  const data = snapshot();
  assert.equal(data.supply.windows[90].ratio, 0.23);
  assert.equal(data.supply.windows[30].ratio, 0.33);
  assert.equal(data.checks.find(c => c.id === 'cover').state, 'alert');
  assert.equal(data.evidence.startBlock90, rows[1].fromBlock - 1);
});

test('pending principal preserves tracked treasury holdings across unstaking', () => {
  const check = snapshot().checks.find(c => c.id === 'venice');
  assert.equal(check.value, 0);
  assert.equal(check.state, 'healthy');
});

test('incomplete and missing daily data cannot produce a grade', () => {
  assert.equal(contiguous([rows[0], rows[2]]), false);
  const missing = rows.map((r, i) => i === 5 ? {...r, dailyBurned: null} : r);
  assert.equal(supplyWindow(missing, 90, 90), null);
  assert.throws(() => makeSnapshot({...protocol, days: rows.filter((_, i) => i !== 5)}, burns, context, {now}));
  assert.equal(grade(null, {good: 1, watch: 0.25}), 'pending');
});

test('a failed or old source leaves useful readings and suppresses its alerts', () => {
  const failed = makeSnapshot(protocol, burns, context, {now, failures: ['protocol']});
  assert.equal(failed.supply.windows[90].ratio, 0.23);
  assert.equal(failed.checks.find(c => c.id === 'cover').state, 'stale');
  const old = makeSnapshot(protocol, burns, context, {now: new Date('2026-11-24T04:00:00Z')});
  assert.equal(old.sources.burns.ok, false);
});

test('alerts are seeded silently, survive stale days, deduplicate and close on recovery', () => {
  const data = snapshot();
  const check = data.checks[0];
  check.state = 'healthy';
  const initial = planAlerts(null, data);
  assert.equal(Object.keys(initial.issues).length, 0);
  check.state = 'watch';
  const incident = planAlerts(initial, data);
  const [id] = Object.keys(incident.issues);
  assert.equal(incident.issues[id].open, true);
  check.state = 'stale';
  assert.deepEqual(planAlerts(incident, data).issues, incident.issues);
  check.state = 'alert';
  const worse = planAlerts(incident, data);
  assert.deepEqual(Object.keys(worse.issues), [id]);
  check.state = 'healthy';
  const recovered = planAlerts(worse, data);
  assert.equal(recovered.issues[id].open, false);
  assert.deepEqual(planAlerts(recovered, data), recovered);
});

test('rule changes after a source outage are delivered once, including same-day reversals', () => {
  const data = snapshot();
  let journal = planAlerts(null, data);
  data.sources.protocol = {ok: false, asOf: end};
  journal = planAlerts(journal, data);
  data.sources.protocol = {ok: true, asOf: dayOffset(end, 2)};
  data.rules.changes = [
    {date: dayOffset(end, 1), id: 'cooldown', from: 7, to: 5, tx: '0x1'},
    {date: dayOffset(end, 1), id: 'cooldown', from: 5, to: 7, tx: '0x2'}
  ];
  const next = planAlerts(journal, data);
  assert.match(next.issues['rules-2026-11-23'].body, /0x1[\s\S]+0x2/);
  assert.deepEqual(planAlerts(next, data), next);
});

test('reported consumption excludes the in-progress epoch and requires seven distinct dates', () => {
  const t = Date.parse(end);
  const days = Array.from({length: 8}, (_, i) => ({t: t + (i - 6) * 86400000, consumed: 15, staked: 30}));
  days.at(-1).consumed = 999;
  const data = {days, summary: {latestClosedDay: {t}}};
  assert.equal(summarizedUsage(data, end).ratio, 0.5);
  assert.throws(() => summarizedUsage({...data, days: days.slice(1)}, end));
});

test('monthly check grades verified cycle USDC spend and distinguishes a late burn', () => {
  const cycle = (date, block, spentUsdc) => ({date, block, spentUsdc, burnedVvv: 100, verified: true});
  const buybacks = {asOf: end, cycles: [cycle('2026-10-07', 30, 269061), cycle('2026-11-09', 60, 555096)]};
  const current = makeSnapshot(protocol, {...burns, buybacks}, context, {now});
  assert.equal(current.checks.find(c => c.id === 'monthly').state, 'healthy');
  buybacks.cycles[1].spentUsdc = 100_000;
  const smaller = makeSnapshot(protocol, {...burns, buybacks}, context, {now});
  assert.equal(smaller.checks.find(c => c.id === 'monthly').state, 'alert');
  buybacks.cycles[1].verified = false;
  const unresolved = makeSnapshot(protocol, {...burns, buybacks}, context, {now});
  assert.equal(unresolved.checks.find(c => c.id === 'monthly').state, 'pending');
});

test('window attribution requires independent evidence for every day on each side', () => {
  const wei = n => String(BigInt(n) * 10n ** 18n);
  const days = rows.map((day,i) => ({...day, blockHash:'0x'+String(i).padStart(64,'0'), flowsVerified:true,
    mintStakers:95, mintVenice:5, mintOther:0, raw:{dailyBurned:wei(day.dailyBurned)}}));
  const labels = days.slice(-30).map(day => ({date:day.date,blockHash:day.blockHash,fromBlock:day.fromBlock,toBlock:day.toBlock,
    burnSales:20,burnMonthly:12,burnOther:1,raw:{salesVvv:wei(20),monthlyVvv:wei(12),otherVvv:wei(1),balanceChangeVvv:wei(33),
      openingUsdc:'1000000',incomingUsdc:'150',closingUsdc:'1000000',recognizedUsdc:'150',unknownUsdc:'0'}}));
  const build = () => makeSnapshot({...protocol,days},{...burns,sales:{days:labels}},context,{now}).supply.windows;
  let windows = build();
  assert.deepEqual(windows[30].issuanceAttribution,{mintVenice:150,mintStakers:2850,mintOther:0});
  assert.deepEqual(windows[30].burnAttribution,{burnSales:600,burnMonthly:360,burnOther:30});
  assert.deepEqual(windows[90].issuanceAttribution,{mintVenice:450,mintStakers:8550,mintOther:0});
  assert.equal(windows[90].burnAttribution,null);
  days.at(-1).flowsVerified = false;
  windows = build();
  assert.equal(windows[30].issuanceAttribution,null);
  assert.equal(windows[30].burnAttribution.burnMonthly,360);
  assert.equal(windows[30].minted,3000);
  labels.at(-1).blockHash='mismatched boundary';
  assert.equal(build()[30].burnAttribution,null);
  labels.at(-1).blockHash=days.at(-1).blockHash;
  labels.at(-1).raw.recognizedUsdc='149';
  assert.equal(build()[30].burnAttribution,null);
});

test('an apparent purchase pause requires known zero unmatched and unpaired counts', () => {
  const day={date:end,estimatedUsd:0,burnUsdc:0,confirmedBurnEvents:0,unknown:0,unpairedPoolBurns:0};
  const state = row => makeSnapshot(protocol,{...burns,sales:{days:[row]}},context,{now}).checks.find(c=>c.id==='sales').state;
  assert.equal(state(day),'alert');
  assert.equal(state({...day,unpairedPoolBurns:1}),'pending');
  assert.equal(state({...day,unpairedPoolBurns:undefined}),'pending');
  assert.equal(state({...day,unknown:1}),'pending');
});
