import test from 'node:test';
import assert from 'node:assert/strict';
import { THRESHOLDS } from '../lib/config.js';
import { gradingRows, gradingTable } from '../lib/grading.js';
import { grade } from '../lib/metrics.js';

const row = title => gradingRows().find(r => r[0] === title);

test('the published thresholds match the configured values', () => {
  assert.deepEqual(row('Burn cover').slice(2), ['100% or more', '25% to under 100%', 'Under 25%']);
  assert.deepEqual(row('Signup and credit purchases').slice(2),
    ['Up, or down 10% or less', 'Down more than 10%, up to 25%', 'Down more than 25%, or no matched purchase burns on the latest day']);
  assert.deepEqual(row('Monthly buyback').slice(2),
    ['90% or more of the previous value, within 35 days', '60% to under 90%, or 36–45 days since the burn', 'Under 60%, or more than 45 days since the burn']);
  assert.deepEqual(row('Staking exits').slice(2), ['1.5% or less', 'More than 1.5%, up to 3%', 'More than 3%']);
  assert.deepEqual(row('DIEM collateral').slice(2), ['Up, or down 2% or less', 'Down more than 2%, up to 5%', 'Down more than 5%']);
  assert.deepEqual(row('Tracked Safe holdings').slice(2), ['Up, or down 1% or less', 'Down more than 1%, up to 3%', 'Down more than 3%']);
});

test('each published boundary belongs to the grade that grade() assigns', () => {
  const tiny = 1e-9;
  for (const key of ['burnCover90d', 'paidUse30d', 'exits7d', 'diemLock30d', 'veniceVvv30d', 'monthlyBurn']) {
    const t = THRESHOLDS[key];
    const worse = t.lowerIsBetter ? tiny : -tiny;
    assert.equal(grade(t.good, t), 'healthy', key);
    assert.equal(grade(t.good + worse, t), 'watch', key);
    assert.equal(grade(t.watch, t), 'watch', key);
    assert.equal(grade(t.watch + worse, t), 'alert', key);
  }
  // The "down" wording assumes these limits are falls; a positive limit would need different text.
  for (const key of ['paidUse30d', 'diemLock30d', 'veniceVvv30d']) {
    assert.ok(THRESHOLDS[key].good <= 0 && THRESHOLDS[key].watch < THRESHOLDS[key].good, key);
  }
  assert.ok(THRESHOLDS.exits7d.lowerIsBetter && THRESHOLDS.burnCover90d.good > THRESHOLDS.burnCover90d.watch);
});

test('the grading table is escaped HTML with a row per check and the reason for the 25% line', () => {
  const html = gradingTable();
  assert.equal((html.match(/<tr><th scope="row">/g) || []).length, 6);
  assert.match(html, /<summary>How the checks are graded<\/summary>/);
  assert.match(html, /below 25%, burns cancel less than a quarter of new VVV/);
  assert.match(html, /Venice’s|VVV watch’s own choices/);
  assert.doesNotMatch(html.replace(/<[^>]+>/g, ''), /[<>]/);
  assert.match(gradingTable({...THRESHOLDS, exits7d: {...THRESHOLDS.exits7d, good: 0.02}}), /2% or less/);
});
