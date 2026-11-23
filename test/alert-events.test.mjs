import test from 'node:test';
import assert from 'node:assert/strict';
import { alertEvidence } from '../lib/alert-evidence.js';
import { planAlerts } from '../lib/alerts.js';

const date = n => '2026-11-' + String(n).padStart(2, '0');
const row = (n, extra = {}) => ({date: date(n), block: 100 + n, ...extra});
const snap = (n, days, protocol = true, sales = true) => ({
  lastDay: date(n), checks: [], rules: {}, buybacks: {cycles: []}, alertEvidence: days,
  sources: {protocol: {ok: protocol, asOf: date(n)}, sales: {ok: sales, asOf: date(n)}}
});
const runway = low => ({low, balanceUsdc: low ? 50 : 100, dailySpendUsdc: 100,
  days: low ? 0.5 : 1, start: date(1)});
const mint = (tx, to) => ({tx, to, amount: 100});
const move = (tx, to) => ({tx, from: 'control-safe', to, amount: 150000});

test('launch cutoff suppresses initial mint and outflow observations, then accepts late verified days once', () => {
  const records = {unexpectedMints: [mint('0xa', 'one'), mint('0xa', 'two')],
    largeOutflows: [move('0xb', 'three'), move('0xc', 'four')], externalOutflow: 300000};
  let journal = planAlerts(null, snap(10, [row(10, records)]));
  assert.deepEqual(journal.issues, {});
  journal = planAlerts(journal, snap(12, [row(11), row(12, {unexpectedMints: [], largeOutflows: []})]));
  assert.deepEqual(journal.issues, {});
  const repaired = [row(10, records), row(11, records), row(12)];
  journal = planAlerts(journal, snap(12, repaired, false));
  assert.deepEqual(journal.issues, {});
  journal = planAlerts(journal, snap(12, repaired));
  assert.deepEqual(Object.keys(journal.issues).sort(), ['mint-0xa','safe-outflow-' + date(11)]);
  assert.match(journal.issues['mint-0xa'].body, /one[\s\S]+two/);
  assert.match(journal.issues['safe-outflow-' + date(11)].body, /300,000[\s\S]+three[\s\S]+four/);
  assert.deepEqual(planAlerts(journal, snap(12, repaired)), journal);
});

test('runway alerts are informational per verified low period and handle delayed samples and stale sources', () => {
  let journal = planAlerts(null, snap(10, [row(10, {runway: runway(true)})]));
  const r = (n, low) => row(n, {runway: runway(low)});
  journal = planAlerts(journal, snap(11,[r(11,true)]));
  assert.deepEqual(journal.issues, {});
  journal = planAlerts(journal, snap(12,[r(12,false)]));
  journal = planAlerts(journal, snap(14,[r(14,true)],true,false));
  assert.deepEqual(journal.issues, {});
  journal = planAlerts(journal, snap(14,[r(14,true)]));
  const first = 'runway-' + date(14);
  assert.equal(journal.issues[first].once, true);
  assert.match(journal.issues[first].body, /0.5 days[\s\S]+basescan.org\/block\/114/);
  journal = planAlerts(journal, snap(15,[r(13,true),r(14,true),r(15,true)]));
  assert.deepEqual(Object.keys(journal.issues), [first]);
  journal = planAlerts(journal, snap(16,[r(16,false)], false));
  journal = planAlerts(journal, snap(17,[row(16),r(17,true)]));
  assert.deepEqual(Object.keys(journal.issues), [first]);
  journal = planAlerts(journal, snap(18,[r(16,false),r(17,true),r(18,false)]));
  assert.deepEqual(Object.keys(journal.issues), [first, 'runway-' + date(17)]);
  assert.deepEqual(planAlerts(journal, snap(18,[r(16,false),r(17,true),r(18,false)])), journal);
});

test('runway checks exact chain balances and seven reconciled closing days including unknown spending', () => {
  const rows = Array.from({length: 8}, (_, i) => ({date: date(i+1), fromBlock: i*10+1,
    toBlock: i*10+10, blockHash: 'hash'+i, raw: {burnWalletUsdc: '100000000'},
    flowsVerified: false, unexpectedMints: [mint('fake','ignored')], auditVerified: false, largeOutflows: [move('fake','ignored')]}));
  const sales = new Map(rows.map(x => [x.date, {...x, fundingEvidenceSha256: 'a'.repeat(64),
    raw: {openingUsdc:'100000000',incomingUsdc:'100000000',closingUsdc:'100000000',recognizedUsdc:'75000000',unknownUsdc:'25000000'}}]));
  const build = () => alertEvidence(rows,sales);
  const equal = build().at(-1);
  assert.deepEqual(equal.runway, {low:false, days:1, balanceUsdc:100, dailySpendUsdc:100, start:date(2)});
  assert.equal(equal.largeOutflows, null);
  assert.equal(equal.unexpectedMints, null);
  assert.equal(build().at(-2).runway, null);
  rows.at(-1).raw.burnWalletUsdc = '99999999';
  Object.assign(sales.get(date(8)).raw, {closingUsdc:'99999999',incomingUsdc:'99999999'});
  assert.equal(build().at(-1).runway.low,true);
  sales.get(date(3)).raw.unknownUsdc = '0';
  assert.equal(build().at(-1).runway,null);
  sales.get(date(3)).raw.unknownUsdc = '25000000';
  sales.get(date(3)).blockHash = 'wrong fork';
  assert.equal(build().at(-1).runway,null);
});
