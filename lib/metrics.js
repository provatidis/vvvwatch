import { DIEM, THRESHOLDS, VENICE } from './config.js';
import { alertEvidence } from './alert-evidence.js';
import { burnValueUsd } from './burn-value.js';
import { burnCoverContext } from './burn-cover.js';

const DAY = 86_400_000;
export const dayOffset = (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
const finite = Number.isFinite;
const daysBetween = (start, end) => (Date.parse(end) - Date.parse(start)) / DAY;
const sum = (rows, key) => rows.every(row => finite(row[key])) ? rows.reduce((n, row) => n + row[key], 0) : null;
const difference = (a, b) => finite(a) && finite(b) && b > 0 ? a / b - 1 : null;
const pct = n => (100 * n).toFixed(1).replace('-', '−') + '%';
const whole = n => Math.round(n).toLocaleString('en-US');
const movement = n => n > 0 ? 'rose '+pct(n) : n < 0 ? 'fell '+pct(-n) : 'was unchanged';

export function contiguous(rows) {
  if (!rows.length) return false;
  return rows.every((row, i) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
    (!i || dayOffset(rows[i - 1].date, 1) === row.date));
}

export function grade(value, threshold) {
  if (!finite(value)) return 'pending';
  if (threshold.lowerIsBetter) return value <= threshold.good ? 'healthy' : value <= threshold.watch ? 'watch' : 'alert';
  return value >= threshold.good ? 'healthy' : value >= threshold.watch ? 'watch' : 'alert';
}

const mintFields = ['mintVenice', 'mintStakers', 'mintOther'];
const burnFields = ['burnSales', 'burnMonthly', 'burnOther'];

function attributionTotals(rows, keys) {
  return Object.fromEntries(keys.map(key => [key, sum(rows, key)]));
}

function hasIssuanceAttribution(day) {
  if (day.flowsVerified !== true || !mintFields.every(key => finite(day[key]) && day[key] >= 0)) return false;
  const emitted = day.mintVenice + day.mintStakers + day.mintOther;
  // The protocol collector reconciles in wei before exporting the three displayed token amounts.
  return Math.abs(emitted - day.dailyMinted) <= 4 * Number.EPSILON * Math.max(1, day.dailyMinted);
}

function hasBurnAttribution(day, matched) {
  if (!matched || !day.blockHash || day.blockHash !== matched.blockHash ||
      day.fromBlock !== matched.fromBlock || day.toBlock !== matched.toBlock ||
      !burnFields.every(key => finite(matched[key]) && matched[key] >= 0)) return false;
  const raw = matched.raw;
  if (!raw || !['salesVvv','monthlyVvv','otherVvv','balanceChangeVvv','openingUsdc','incomingUsdc',
      'closingUsdc','recognizedUsdc','unknownUsdc'].every(key => typeof raw[key] === 'string' && /^\d+$/.test(raw[key]))) return false;
  return raw.balanceChangeVvv === day.raw?.dailyBurned &&
    BigInt(raw.salesVvv) + BigInt(raw.monthlyVvv) + BigInt(raw.otherVvv) === BigInt(raw.balanceChangeVvv) &&
    BigInt(raw.openingUsdc) + BigInt(raw.incomingUsdc) - BigInt(raw.closingUsdc) === BigInt(raw.recognizedUsdc) + BigInt(raw.unknownUsdc) &&
    [raw.salesVvv,raw.monthlyVvv,raw.otherVvv].every((value, i) => Number(value)/1e18 === matched[burnFields[i]]);
}

export function supplyWindow(rows, i, width, purchasesByDate) {
  if (i < width - 1) return null;
  const slice = rows.slice(i - width + 1, i + 1);
  if (!contiguous(slice)) return null;
  const minted = sum(slice, 'dailyMinted');
  const burned = sum(slice, 'dailyBurned');
  if (minted === null || burned === null || minted < 0 || burned < 0) return null;
  const issuanceAttribution = slice.every(hasIssuanceAttribution) ? attributionTotals(slice, mintFields) : null;
  const purchases = purchasesByDate && slice.map(day => purchasesByDate.get(day.date));
  const burnAttribution = purchases && slice.every((day, index) => hasBurnAttribution(day, purchases[index]))
    ? attributionTotals(purchases, burnFields) : null;
  const net = minted - burned;
  const opening = rows[i].effective - net;
  return {start: slice[0].date, end: rows[i].date, minted, burned, net, issuanceAttribution, burnAttribution,
    ratio: minted > 0 ? burned / minted : null,
    annualized: opening > 0 ? net / opening * 365 / width : null,
    startBlock: slice[0].fromBlock - 1, endBlock: rows[i].toBlock};
}

function salesWindow(days, buybacks, protocolByDate) {
  const recent = days.slice(-30);
  if (recent.length !== 30 || !contiguous(recent)) return null;
  const estimatedUsd = sum(recent, 'estimatedUsd');
  const prior = days.slice(-60, -30);
  const complete = prior.length === 30 && contiguous([...prior, ...recent]);
  const priorEstimatedUsd = complete ? sum(prior, 'estimatedUsd') : null;
  const burnUsdc = sum(recent, 'burnUsdc');
  const monthly = buybacks.cycles.filter(cycle => cycle.date >= recent[0].date && cycle.date <= recent.at(-1).date);
  const byDay = new Map();
  for (const cycle of monthly) {
    if (!/^\d+$/.test(cycle.raw?.burnedVvv ?? '')) continue;
    byDay.set(cycle.date,(byDay.get(cycle.date) ?? 0n)+BigInt(cycle.raw.burnedVvv));
  }
  const marked = buybacks.asOf >= recent.at(-1).date && monthly.every(c=>{
    const day=protocolByDate.get(c.date);
    return finite(burnValueUsd(c)) && /^[1-9]\d*$/.test(c.raw?.burnedVvv ?? '') &&
      day && c.block>=day.fromBlock && c.block<=day.toBlock;
  }) &&
    recent.every(d=>hasBurnAttribution(protocolByDate.get(d.date) ?? {},d) &&
      (byDay.get(d.date) ?? 0n).toString() === d.raw.monthlyVvv);
  const monthlyBurnUsd = marked ? monthly.reduce((n,c)=>n+burnValueUsd(c),0) : null;
  const usable = estimatedUsd > 0 && finite(burnUsdc);
  return {days: 30, start: recent[0].date, end: recent.at(-1).date, estimatedUsd, priorEstimatedUsd,
    change: difference(estimatedUsd, priorEstimatedUsd), burnUsdc, monthlyBurnUsd,
    annualizedUsd:finite(estimatedUsd) ? estimatedUsd*365/30 : null,
    programmaticBurnShare:usable ? burnUsdc/estimatedUsd:null,
    totalBurnShare:usable && marked ? (burnUsdc+monthlyBurnUsd)/estimatedUsd:null};
}

export function makeSnapshot(protocol, burns, context, {now = new Date(), failures = []} = {}) {
  const rows = protocol.days;
  if (!contiguous(rows)) throw Error('Protocol series is empty, unsorted or has a missing date');
  const last = rows.at(-1);
  const prior = rows.at(-31);
  const lastDay = last.date;
  const yesterday = dayOffset(now.toISOString().slice(0, 10), -1);
  if (lastDay > yesterday || protocol.lastDay !== lastDay) throw Error('Invalid protocol end date');
  const purchasesByDate = new Map(burns.sales.days.map(day => [day.date, day]));
  const windows = Object.fromEntries([30, 90].map(width => [width, supplyWindow(rows, rows.length - 1, width, purchasesByDate)]));
  if (windows[30]) windows[30].priorRatio = supplyWindow(rows, rows.length - 31, 30)?.ratio ?? null;
  const history = rows.map((day, i) => ({date: day.date, minted: day.dailyMinted, burned: day.dailyBurned,
    effective: day.effective, cover30: supplyWindow(rows, i, 30)?.ratio ?? null,
    cover90: supplyWindow(rows, i, 90)?.ratio ?? null}));
  const buckets = [];
  for (const day of history) {
    if (!finite(day.minted) || !finite(day.burned)) continue;
    const month = day.date.slice(0, 7);
    if (buckets.at(-1)?.month !== month) buckets.push({month, minted: 0, burned: 0, days: 0});
    const bucket = buckets.at(-1);
    bucket.minted += day.minted;
    bucket.burned += day.burned;
    bucket.days++;
  }

  const salesDays = burns.sales.days.filter(day => day.date <= lastDay);
  if (salesDays.length && !contiguous(salesDays)) throw Error('Invalid sales dates');
  const sales = {days: salesDays, asOf: salesDays.at(-1)?.date ?? null,
    window30: salesWindow(salesDays,burns.buybacks,new Map(rows.map(row=>[row.date,row]))),
    claim:{date:'2026-10-14',label:'Erik Voorhees reported more than $150M in annual company revenue',url:'https://x.com/ErikVoorhees/status/2110436081581879460'},
    reference: burns.sales.reference ?? null};
  const cycles = burns.buybacks.cycles.filter(cycle => cycle.date <= lastDay).sort((a, b) => a.block - b.block);
  const buybacks = {...burns.buybacks, cycles, asOf: burns.buybacks.asOf};
  const sources = {
    protocol: {asOf: lastDay, ok: !failures.includes('protocol') && lastDay === yesterday},
    burns: {asOf: burns.lastDay, ok: !failures.includes('burns') && burns.lastDay === yesterday},
    sales: {asOf: sales.asOf, ok: !failures.includes('burns') && sales.asOf === yesterday},
    buybacks: {asOf: buybacks.asOf, ok: !failures.includes('burns') && buybacks.asOf === yesterday && lastDay === yesterday}
  };
  const checks = [];
  function check(id, title, value, state, text, source = 'protocol') {
    checks.push({id, title, value: finite(value) ? value : null,
      state: sources[source].ok ? state : 'stale', text});
  }
  const cover = windows[90]?.ratio;
  const coverText = burnCoverContext(windows);
  const initialRate=rows.at(-90)?.parameters?.emissionRatePerYear, endingRate=last.parameters?.emissionRatePerYear;
  const rateContext = finite(initialRate) && finite(endingRate) && Math.abs(initialRate-endingRate)>=1
    ? ' The scheduled annual issuance rate went from '+whole(initialRate)+' to '+whole(endingRate)+' VVV during the 90-day window.' : '';
  check('cover', 'Burn cover', cover, grade(cover, THRESHOLDS.burnCover90d),
    coverText.level + (finite(cover) ? ' Burns retired '+whole(windows[90].burned)+' VVV against '+whole(windows[90].minted)+' VVV minted.' : '') + rateContext);
  const trend = sales.window30?.change;
  const salesDay = salesDays.at(-1);
  const confirmedPause = salesDay && salesDay.confirmedBurnEvents === 0 && salesDay.unknown === 0 && salesDay.unpairedPoolBurns === 0;
  check('sales', 'Signup and credit purchases', trend, confirmedPause ? 'alert' : grade(trend, THRESHOLDS.paidUse30d),
    confirmedPause ? 'No matched purchase burns in the latest complete day.' : finite(trend)
      ? 'Estimated purchase value ' + movement(trend) + ' versus the preceding 30 days.'
      : 'Needs two comparable 30-day windows of matched purchase burns.', 'sales');
  const latestCycle = cycles.at(-1), priorCycle = cycles.at(-2);
  const retiredUsd = burnValueUsd(latestCycle);
  const burnChange = difference(retiredUsd, burnValueUsd(priorCycle));
  const age = latestCycle ? daysBetween(latestCycle.date, lastDay) : null;
  const limits = THRESHOLDS.monthlyBurn;
  let monthlyState = grade(finite(burnChange) ? 1 + burnChange : null, limits);
  if (finite(age) && age > limits.watchDays) monthlyState = 'alert';
  else if (finite(age) && age > limits.goodDays && monthlyState !== 'alert') monthlyState = 'watch';
  let monthlyText = 'Awaiting a verified buyback burn.';
  if (latestCycle) {
    const burnDate = new Date(latestCycle.date + 'T00:00:00Z').toLocaleDateString('en-GB',
      {day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
    monthlyText = 'The Safe retired ' + whole(latestCycle.burnedVvv) + ' VVV on ' + burnDate + '.';
    if (finite(retiredUsd)) monthlyText += ' Estimated burn value was $' + whole(retiredUsd) + '.';
    if (finite(burnChange)) monthlyText += burnChange === 0 ? ' Burn value was unchanged from the previous cycle.' :
      ' Burn value ' + (burnChange > 0 ? 'rose ' : 'fell ') + pct(Math.abs(burnChange)) + ' from the previous cycle.';
    else monthlyText += ' A value comparison needs prices at both burn blocks.';
    if (age > limits.goodDays) monthlyText += ' The last burn was ' + age + ' days ago.';
  }
  check('monthly', 'Monthly buyback', burnChange, monthlyState, monthlyText, 'buybacks');
  const exitRows = rows.slice(-7);
  const exits = exitRows.length === 7 ? sum(exitRows, 'exitsStarted') : null;
  const exitShare = finite(exits) && last.staked > 0 ? exits / last.staked : null;
  check('exits', 'Staking exits', exitShare, grade(exitShare, THRESHOLDS.exits7d), finite(exitShare)
    ? whole(exits) + ' VVV entered cooldown in seven days, equal to ' + pct(exitShare) + ' of ending staked supply.'
    : 'Awaiting seven days of verified unstake events.');
  const lockChange = difference(last.locked, prior?.locked);
  check('diem', 'DIEM collateral', lockChange, grade(lockChange, THRESHOLDS.diemLock30d), finite(lockChange)
    ? 'Staked VVV locked for DIEM ' + movement(lockChange) + ' over 30 days.'
    : 'Needs 30 days of collateral history.');
  const holdings = row => row && [row.veniceVvv, row.veniceSvvv, row.veniceCooldown].every(finite)
    ? row.veniceVvv + row.veniceSvvv + row.veniceCooldown : null;
  const mintedToSafe = rows.length >= 31 ? sum(rows.slice(-30), 'mintVenice') : null;
  const treasuryChange = finite(mintedToSafe) && finite(holdings(last)) ? difference(holdings(last) - mintedToSafe, holdings(prior)) : null;
  const walletSet = context.wallets;
  if (Object.hasOwn(context, 'wallets')) {
    sources.wallets = {asOf:walletSet?.asOf ?? null,ok:sources.protocol.ok && !failures.includes('wallets') && walletSet?.asOf===lastDay};
    const change = walletSet?.trackedSafeChange30;
    check('trackedSafes','Tracked Safe holdings',change,grade(change,THRESHOLDS.veniceVvv30d),finite(change)
      ? 'Holdings across the control, incentive and liquidity Safes ' + movement(change) + ' in 30 days after direct emissions.'
      : 'A grade needs both closing balances, confirmed shared signers and 30 days of verified mint events.', 'wallets');
  } else {
    check('venice','Control Safe holdings',treasuryChange,grade(treasuryChange,THRESHOLDS.veniceVvv30d),finite(treasuryChange)
      ? 'Holdings ' + movement(treasuryChange) + ' in 30 days after direct emissions.'
      : 'A grade needs 30 days of verified flows.');
  }
  const rules = {...protocol.rules, policy: protocol.policy ?? []};
  return {schemaVersion: 1, generatedAt: now.toISOString(), lastDay, sources, checks,
    alertEvidence: alertEvidence(rows, purchasesByDate),
    supply: {effective: last.effective, staked: last.staked, locked: last.locked, windows, history, buckets},
    evidence: {startBlock30: windows[30]?.startBlock ?? null, startBlock90: windows[90]?.startBlock ?? null, endBlock: last.toBlock},
    diem: {supply: last.diemSupply, deposited: last.diemStaked, locked: last.locked, mintRate: last.mintRate,
      target: DIEM.target, change30: lockChange, utilization: context.utilization, annualCreditRatio: context.prices?.diem?.usd > 0 ? 365 / context.prices.diem.usd : null},
    treasury: {address: VENICE.controlSafe, vvv: last.veniceVvv, svvv: last.veniceSvvv, cooldown: last.veniceCooldown,
      wallets:walletSet?.wallets ?? [],walletsAsOf:walletSet?.asOf ?? null,walletsBlock:walletSet?.block ?? null,
      walletsStartBlock:walletSet?.startBlock ?? null,trackedSafeTotal:walletSet?.trackedSafeTotal ?? null,
      trackedSafeChange30:walletSet?.trackedSafeChange30 ?? null},
    rules, sales, buybacks, prices: context.prices};
}
