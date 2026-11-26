import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { currentMintRate, diemTradeoff, freshPrice, holderSummary, shareChange, stakingYields, svvvForDiem } from '../lib/holders.js';

// Figures from the snapshot generated 2026-11-23T17:39:23Z.
const now = Date.parse('2026-11-23T18:00:00Z');
const curve = [
  {supply: 36500, rate: 411.3347363044837},
  {supply: 37000, rate: 438.21774446587403},
  {supply: 37500, rate: 467.6681153346494},
  {supply: 38000.00000000001, rate: 499.97578654034714},
  {supply: 38500, rate: 535.4683055992914}
];
const diemSupply = 37415.25170306601;
const snapshot = {
  rules: {values: {emissionRatePerYear: 2_000_000, venicePct: 0, venicePctLocked: 0.2, cooldown: 604800, diemCooldown: 86400, curve}},
  supply: {staked: 33055156.92123372, locked: 8603669.402561754, effective: 81281991.79892865,
    windows: {30: {minted: 164385.46423135465, burned: 53491.07202068587, annualized: 0.016621866013088276, end: '2026-11-22'}}},
  lastDay: '2026-11-22', evidence: {endBlock: 61008121},
  sales: {window30: {end: '2026-11-22', annualizedUsd: 141287558, totalBurnShare: 0.09820317816183885}},
  treasury: {walletsAsOf: '2026-11-22', walletsBlock: 61008121, trackedSafeTotal: 32350634.522800673},
  prices: {vvv: {usd: 25.41, asOf: '2026-11-23T17:39:10.000Z'}, diem: {usd: 1968.99, asOf: '2026-11-23T17:39:10.000Z'}},
  diem: {supply: diemSupply, target: 40000}
};
const near = (actual, expected, tolerance) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

test('staking rates split emissions the way StakingV2 does', () => {
  const y = stakingYields(snapshot.rules.values, snapshot.supply);
  near(y.aprU, 0.0605, 0.0001);
  near(y.aprL, 0.0484, 0.0001);
  near(y.aprL / y.aprU, 0.8, 1e-12);
  const h = holderSummary(snapshot, now);
  near(h.share.unstaked, -0.0164, 0.0001);
  near(h.share.staked, 0.0432, 0.0001);
  near(h.share.locked, 0.0313, 0.0001);
  assert.equal(h.cooldownDays, 7);
});

test('holder value uses the 30-day pace and both market-value bases', () => {
  const v = holderSummary(snapshot, now).value;
  near(v.burnRate, 0.0080, 0.0001);
  near(v.emitRate, 0.0246, 0.0001);
  near(v.psAll, 14.62, 0.01);
  near(v.psExVenice, 8.80, 0.01);
  near(v.salesShare, 0.0982, 0.0001);
});

test('wallet totals must cover the entire cohort at the supply close', () => {
  const wallets = [{inGrade: true, vvv: 100, svvv: 50, cooldown: 0}];
  for (const treasury of [
    {...snapshot.treasury, trackedSafeTotal: null, wallets},
    {...snapshot.treasury, walletsAsOf: '2026-11-21'},
    {...snapshot.treasury, walletsBlock: 61008120},
    {wallets}
  ]) {
    const value = holderSummary({...snapshot, treasury}, now).value;
    assert.equal(value.psExVenice, null);
    near(value.psAll, 14.62, 0.01);
  }
  const zero = holderSummary({...snapshot, treasury: {...snapshot.treasury, trackedSafeTotal: 0}}, now).value;
  assert.equal(zero.psExVenice, zero.psAll);
});

test('sales ratios keep the sales window date even when the protocol close is newer', () => {
  const period = {...snapshot.sales.window30, end: '2026-11-15'};
  const value = end => holderSummary({...snapshot, sales: {window30: {...period, end}}}, now).value;
  assert.equal(value(period.end).salesEnd, period.end);
  near(value(period.end).psAll, 14.62, 0.01);
  assert.equal(value(null).psAll, null);
  assert.equal(value(null).salesShare, null);
});

test('supply contraction, unchanged supply and unusable annualizations keep distinct results', () => {
  near(shareChange(0, -0.02), 0.020408, 0.000001);
  assert.equal(shareChange(0, 0), 0);
  assert.ok(shareChange(0.06, 0.12) < 0);
  assert.equal(shareChange(0, -1), null);
  assert.equal(shareChange(0, -3.91), null);
});

test('DIEM mints charge each curve step its own rate', () => {
  near(currentMintRate(diemSupply, curve), 467.668, 0.001);
  near(svvvForDiem(1, diemSupply, curve), 467.668, 0.001);
  near(svvvForDiem(50, diemSupply, curve), 23383.41, 0.01);
  near(svvvForDiem(100, diemSupply, curve), 47259.56, 0.01);
  near(svvvForDiem(500, diemSupply, curve), 247249.87, 0.01);
  assert.equal(svvvForDiem(2000, diemSupply, curve), null);
  assert.equal(svvvForDiem(0, diemSupply, curve), null);
});

test('one DIEM: lost rewards, break-even credit use and the buy-back ceiling', () => {
  const h = holderSummary(snapshot, now);
  const t = diemTradeoff({n: 1, usePerDay: 1, years: 1, supply: diemSupply, curve, aprU: h.yields.aprU, aprL: h.yields.aprL, pVVV: h.pVVV, pDIEM: h.pDIEM});
  near(t.forgoneVVV, 5.659, 0.001);
  near(t.forgoneUsd, 143.8, 0.1);
  near(t.breakEvenUse, 0.394, 0.001);
  near(t.parity, 0.1657, 0.0001);
  near(t.creditsUsd, 365, 1e-9);
  near(t.buybackTotal, 1968.99 - t.forgoneUsd, 1e-9);
  assert.equal(t.crossesStep, false);
  const many = diemTradeoff({n: 100, usePerDay: 1, years: 1, supply: diemSupply, curve, aprU: h.yields.aprU, aprL: h.yields.aprL, pVVV: h.pVVV, pDIEM: h.pDIEM});
  assert.equal(many.crossesStep, true);
  near(many.rateAvg, 472.60, 0.01);
});

test('burning the new mint uses the wallet’s pooled collateral and outstanding DIEM', () => {
  const scenario = {n: 1, usePerDay: 1, years: 1, supply: diemSupply, curve, aprU: 0.06, aprL: 0.048, pVVV: 25, pDIEM: 1950};
  const first = diemTradeoff(scenario);
  assert.equal(first.unlocked, first.svvv);
  assert.equal(first.remainingLocked, 0);
  for (const priorLocked of [100, 800]) {
    const existing = diemTradeoff({...scenario, priorDiem: 1, priorLocked});
    near(existing.unlocked, (priorLocked + first.svvv) / 2, 1e-10);
    near(existing.remainingLocked + existing.unlocked, priorLocked + first.svvv, 1e-10);
    assert.equal(existing.forgoneVVV, first.forgoneVVV);
    assert.equal(existing.buybackTotal, first.buybackTotal);
  }
  const fractional = diemTradeoff({...scenario, priorDiem: 0.5, priorLocked: 50});
  near(fractional.unlocked, (50 + first.svvv) / 1.5, 1e-10);
  for (const prior of [{priorDiem: 1}, {priorLocked: 100}, {priorDiem: -1, priorLocked: 10}]) {
    assert.equal(diemTradeoff({...scenario, ...prior}), null);
  }
});

test('missing inputs give blanks, never zero or NaN', () => {
  assert.equal(stakingYields(snapshot.rules.values, {staked: 0}), null);
  assert.equal(shareChange(0.05, null), null);
  assert.equal(freshPrice({usd: 25, asOf: '2026-11-21T00:00:00Z'}, now), null);
  assert.equal(freshPrice(null, now), null);
  const bare = holderSummary({rules: {values: {}}, supply: {}}, now);
  assert.equal(bare.yields, null);
  assert.equal(bare.share.staked, null);
  assert.equal(bare.value.psAll, null);
  const noPrices = diemTradeoff({n: 1, usePerDay: 1, years: 1, supply: diemSupply, curve, aprU: 0.06, aprL: 0.048});
  near(noPrices.forgoneVVV, 467.668 * 0.012, 0.001);
  assert.equal(noPrices.forgoneUsd, null);
  assert.equal(noPrices.parity, null);
  assert.equal(noPrices.creditsNet, null);
});

test('the build copies every module the page imports, including modules those modules import', async () => {
  const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
  const build = await read('scripts/build.mjs');
  const seen = new Set(), queue = ['app.js'];
  while (queue.length) {
    const file = queue.shift();
    const base = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
    for (const [, path] of (await read(file)).matchAll(/from '\.\/([\w./-]+\.js)'/g)) {
      const resolved = base + path;
      if (!seen.has(resolved)) { seen.add(resolved); queue.push(resolved); }
    }
  }
  assert.ok(seen.has('lib/holders.js') && seen.has('lib/sections.js') && seen.has('lib/buyback-recap.js'));
  for (const file of seen) assert.ok(build.includes(`'${file}'`), `${file} is not copied by scripts/build.mjs`);
});

test('reported circulating value requires a recent official count and a fresh price', () => {
  const value = (vvv, age) => holderSummary({...snapshot,supply:{...snapshot.supply,
    circulating:{vvv,observedAt:new Date(now-age).toISOString()}}},now).value;
  const v = value(49_000_000,3600_000);
  near(v.circulatingMultiple, v.psAll * 49_000_000 / snapshot.supply.effective, 1e-9);
  assert.equal(value(49_000_000,25*3600_000).circulatingMultiple,null);
  assert.equal(value(-1,0).circulatingMultiple,null);
  assert.equal(holderSummary(snapshot,now).value.circulatingMultiple,null);
});
