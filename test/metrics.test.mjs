import test from 'node:test';
import assert from 'node:assert/strict';
import { contiguous, dayOffset, grade, makeSnapshot, rateStepText, rateSteps, supplyWindow } from '../lib/metrics.js';
import { planAlerts } from '../lib/alerts.js';
import { burnChangeDetail, burnCoverContext } from '../lib/burn-cover.js';
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
  const check = data.checks.find(c => c.id === 'cover');
  assert.match(check.text, /90-day cover was 23.0%, below the 25% threshold/);
  assert.match(check.text, /2,070 VVV against 9,000 VVV minted/);
  const hero = burnCoverContext(data.supply.windows);
  assert.ok(!check.text.includes(hero.trend));
  assert.ok(!check.text.includes(hero.breakdown));
});

test('22 November 2026 cover reports both complete periods and program contributions to issuance', () => {
  const minted = 164385.46423135465;
  const windows = {
    90: {ratio: 130735.77514623756 / 555187.8488077118},
    30: {ratio: 53491.07202068586 / minted, priorRatio: 39278.8655 / 174782.7562, minted,
      burnAttribution: {burnSales: 31791.49419095926, burnMonthly: 21657, burnOther: 42.5778297266}}
  };
  assert.deepEqual(burnCoverContext(windows), {
    level: '90-day cover was 23.5%, below the 25% threshold.',
    thresholdNote: 'Over 90 days, burns retired 23.5 VVV for every 100 minted. Cover is 1.5 percentage points below our own 25% alert line.',
    trend: 'Burns covered 32.5% of issuance in the last 30 days, up from 22.5% in the preceding 30 days.',
    detail: '',
    breakdown: 'Purchase-linked burns covered 19.3% of issuance. Monthly buybacks added 13.2 percentage points.'
  });
});

test('burn-cover comparisons distinguish equal, falling, missing and rounded readings', () => {
  const describe = (ratio, priorRatio, longRatio) => burnCoverContext({30:{ratio,priorRatio},90:{ratio:longRatio}});
  assert.match(describe(0, 0.26, 0.25).trend, /0.0% of issuance in the last 30 days, down from 26.0% in the preceding 30 days/);
  assert.equal(describe(0, 0.26, 0.25).thresholdNote, 'Over 90 days, burns retired 25 VVV for every 100 minted. Cover is at our own 25% alert line.');
  assert.match(describe(0.325, 0.325).trend, /32.5% of issuance in the last 30 days, unchanged from the preceding 30 days/);
  assert.match(describe(0.3253, 0.3252).trend, /slightly up from the preceding 30 days/);
  assert.equal(describe(0, null, 0.24998).thresholdNote, 'Over 90 days, burns retired 25 VVV for every 100 minted. Cover is less than 0.1 percentage point below our own 25% alert line.');
  assert.equal(describe(0, null, 0.2495).level, '90-day cover was 25.0%, just below the 25% threshold.');
  assert.equal(describe(0, null).trend, 'Burns covered 0.0% of issuance in the last 30 days.');
  assert.match(describe(0, null).detail, /comparison is unavailable/);
  assert.match(burnCoverContext().level, /needs 90 complete days/);
  assert.match(burnCoverContext().trend, /needs 30 complete days/);
  assert.equal(burnCoverContext().breakdown, '');
});

test('30-day trend uses adjacent windows and can read daily totals from an older snapshot', () => {
  const {windows, history} = snapshot().supply;
  const recent = windows[30];
  assert.equal(recent.previous.end, dayOffset(recent.start,-1));
  assert.match(burnCoverContext(windows).detail, /amount burned rose 83.3% and issuance was unchanged. Effective supply grew by 2,010 VVV/);
  const older = {30:{...recent,previous:undefined}};
  assert.equal(burnCoverContext(older, history).detail, burnCoverContext(windows).detail);
  const missing = history.filter(row => row.date !== recent.previous.start);
  assert.equal(burnCoverContext(older, missing).detail, '');
  const previous = {...recent.previous, burned:0, minted:4000};
  assert.match(burnCoverContext({30:{...recent,previous,priorRatio:0}}).detail, /rose from zero to 990 VVV and issuance fell 25.0%/);
});

test('burn program contributions to a change need reconciled, adjacent periods', () => {
  const previous = {start:'2026-09-26',end:'2026-10-25',burned:100,burnAttribution:{burnSales:49,burnMonthly:50,burnOther:1}};
  const recent = {start:'2026-10-26',end:'2026-11-24',burned:150,burnAttribution:{burnSales:79,burnMonthly:70,burnOther:1},previous};
  assert.match(burnChangeDetail(recent), /about 60% of the increase.*about 40%/);
  assert.match(burnChangeDetail({...recent,burned:50,burnAttribution:{burnSales:19,burnMonthly:30,burnOther:1}}), /60% of the decrease.*40%/);
  assert.match(burnChangeDetail({...recent,burned:100,burnAttribution:previous.burnAttribution}), /unchanged across all three/);
  assert.match(burnChangeDetail({...recent,burned:150,burnAttribution:{burnSales:100,burnMonthly:49,burnOther:1}}), /monthly buyback burns by −1 VVV/);
  for (const previousInvalid of [null,{...previous,start:'2026-09-25'},{...previous,burned:99},{...previous,burnAttribution:null}]) {
    assert.equal(burnChangeDetail({...recent,previous:previousInvalid}), '');
  }
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

test('an existing staking-exits watch gains the automatic closure explanation on its next fresh reading', () => {
  const data = snapshot();
  const check = data.checks.find(c => c.id === 'exits');
  const prior = planAlerts(null, data);
  const id = 'check-exits-2026-11-20';
  prior.states.exits = {state:'watch', incident:id};
  prior.issues[id] = {title:'Staking exits · Watch', body:'Earlier reading.', open:true};
  check.state = 'stale';
  assert.deepEqual(planAlerts(prior, data).issues, prior.issues);

  check.state = 'watch';
  check.text = '2,600 VVV entered cooldown in seven days, equal to 2.6% of ending staked supply.';
  const next = planAlerts(prior, data);
  assert.deepEqual(Object.keys(next.issues), [id]);
  assert.equal(next.issues[id].open, true);
  assert.ok(next.issues[id].body.startsWith(check.text));
  assert.match(next.issues[id].body, /bot closes this issue when a fresh reading shows VVV entering cooldown over seven days at 1\.5% or less of ending staked supply\./);
  assert.deepEqual(planAlerts(next, data), next);
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

test('monthly check grades burn value, including inventory-funded burns, and monitors timing without quotes', () => {
  const cycle = (date,block,usd,spentUsdc) => ({date,block,blockHash:'hash-'+block,spentUsdc,
    burnedVvv:100,burnVerified:true,verified:false,valuation:{block,blockHash:'hash-'+block,usd,priceUsd:usd/100}});
  const prior = cycle('2026-09-08',30,100_000,200_000), latest = cycle('2026-11-09',60,105_000,0);
  const buybacks = {asOf:end, cycles:[prior, latest]};
  const check = () => makeSnapshot(protocol,{...burns,buybacks},context,{now}).checks.find(c=>c.id==='monthly');
  assert.equal(check().state,'healthy');
  assert.match(check().text,/9 Nov 2026/);
  latest.spentUsdc = 500_000;
  latest.valuation.usd = 59_000;
  latest.valuation.priceUsd = 590;
  assert.equal(check().state,'alert');
  prior.valuation = null;
  assert.equal(check().state,'pending');
  assert.equal(check().value,null);
  latest.date=dayOffset(end,-36);
  assert.equal(check().state,'watch');
  latest.date=dayOffset(end,-46);
  assert.equal(check().state,'alert');
  assert.match(check().text,/46 days ago/);
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

test('purchase pace and burn shares use the same complete window and require attributable monthly value',()=>{
  const wei=n=>String(BigInt(n)*10n**18n);
  const days=rows.slice(-30).map((d,i)=>({...d,blockHash:'hash-'+i,raw:{dailyBurned:wei(33)}}));
  const sales={days:days.map((d,i)=>({
    date:d.date,blockHash:d.blockHash,fromBlock:d.fromBlock,toBlock:d.toBlock,estimatedUsd:200,burnUsdc:10,
    burnSales:i===0?23:33,burnMonthly:i===0?10:0,burnOther:0,
    raw:{salesVvv:wei(i===0?23:33),monthlyVvv:wei(i===0?10:0),otherVvv:'0',balanceChangeVvv:wei(33),
      openingUsdc:'100',incomingUsdc:'10',closingUsdc:'100',recognizedUsdc:'10',unknownUsdc:'0'}
  }))};
  const block=days[0].fromBlock;
  const cycle={date:days[0].date,block,blockHash:'burn',burnVerified:true,burnedVvv:10,raw:{burnedVvv:wei(10)},
    valuation:{block,blockHash:'burn',usd:120,priceUsd:12}};
  const buybacks={asOf:end,cycles:[cycle]};
  const window=()=>makeSnapshot({...protocol,days},{...burns,sales,buybacks},context,{now}).sales.window30;
  assert.equal(window().annualizedUsd,73000);
  assert.equal(window().programmaticBurnShare,0.05);
  assert.equal(window().totalBurnShare,0.07);
  buybacks.cycles=[];
  assert.equal(window().totalBurnShare,null);
  buybacks.cycles=[{...cycle,valuation:null}];
  assert.equal(window().totalBurnShare,null);
  assert.equal(window().programmaticBurnShare,0.05);
});

test('the burn cover check lists every issuance rate change inside the 90-day window', () => {
  const day = (date, rate) => ({date, parameters: {emissionRatePerYear: rate}});
  const series = [day('2026-08-31', 3_000_000), day('2026-09-01', 2_500_000), day('2026-09-02', 2_500_000),
    day('2026-10-01', 2_000_000), day('2026-10-02', 2_000_000.0000004)];
  assert.deepEqual(rateSteps(series), [{date:'2026-09-01', from:3_000_000, to:2_500_000}, {date:'2026-10-01', from:2_500_000, to:2_000_000}]);
  assert.equal(rateStepText(rateSteps(series)),
    ' During the 90-day window, the scheduled annual issuance rate was cut from 3,000,000 to 2,500,000 VVV on 1 Sept 2026 and to 2,000,000 VVV on 1 Oct 2026.');
  assert.equal(rateStepText([{date:'2026-10-01', from:2_000_000, to:2_500_000}]),
    ' During the 90-day window, the scheduled annual issuance rate was raised from 2,000,000 to 2,500,000 VVV on 1 Oct 2026.');
  assert.match(rateStepText([{date:'2026-09-01', from:3e6, to:2e6}, {date:'2026-10-01', from:2e6, to:2.5e6}, {date:'2026-11-01', from:2.5e6, to:1e6}]),
    /rate changed from 3,000,000 to 2,000,000 VVV on 1 Sept 2026, to 2,500,000 VVV on 1 Oct 2026 and to 1,000,000 VVV on 1 Nov 2026\.$/);
  assert.equal(rateStepText([]), '');
  assert.deepEqual(rateSteps([day('2026-09-01', 3e6), {date:'2026-09-02'}, day('2026-09-03', 2e6)]), []);
});

test('the snapshot names a rate change on the first day of the 90-day window', () => {
  const series = rows.map((row, i) => ({...row, parameters: {...row.parameters, emissionRatePerYear: i < 1 ? 3_000_000 : i < 50 ? 2_500_000 : 2_000_000}}));
  const s = makeSnapshot({days: series, lastDay: end, rules: {}}, {sales: {days: []}, buybacks: {cycles: [], asOf: end}, lastDay: end}, {}, {now});
  const text = s.checks.find(check => check.id === 'cover').text;
  assert.match(text, new RegExp(`cut from 3,000,000 to 2,500,000 VVV on .+ and to 2,000,000 VVV on .+\\.$`));
  assert.doesNotMatch(text, /went from/);
});
