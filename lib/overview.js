import { SALES } from './config.js';
import { DAY, compact, pct, money, moneyShort, signed, divide, escape, date, blockLink, utcMidnight, completeDays } from './format.js';
import { burnCoverContext } from './burn-cover.js';

const gradeNames = {healthy:'Healthy', watch:'Watch', alert:'Alert', stale:'Stale', pending:'Pending'};
function grade(state) {
  const name = Object.hasOwn(gradeNames, state) ? state : 'pending';
  return `<span class="badge ${name}">${gradeNames[name]}</span>`;
}
const metric = (label, amount, note) => `<div class="metric"><span class="metric-label">${escape(label)}</span><strong class="metric-amount">${escape(amount)}</strong><span class="metric-note">${escape(note)}</span></div>`;

const why = {
  cover: 'Burns offset dilution. At 100% cover, they retire one VVV for every new VVV issued.',
  sales: 'Qualifying purchases fund automatic burns, linking customer activity to demand for VVV.',
  monthly: 'A monthly burn permanently removes VVV from supply. Its dollar value depends on both the token count and the price at the burn.',
  exits: 'Tokens entering cooldown can return to circulation after the withdrawal period.',
  diem: 'Minting DIEM locks staked VVV. A shrinking collateral balance puts more of that stake within reach of withdrawal.',
  trackedSafes: 'A drop in the combined balance means VVV has moved outside the three tracked Safes after direct emissions are accounted for.',
  venice: 'Changes in the control Safe show how much VVV Venice holds there after accounting for new emissions.'
};

export function drawGauge(ratio) {
  const point = (fraction, radius) => {
    const angle = Math.PI * (1 - fraction);
    return [104 + radius * Math.cos(angle), 92 - radius * Math.sin(angle)].map(v => v.toFixed(1)).join(' ');
  };
  const ticks = Array.from({length:21}, (_,i) => `<path d="M${point(i/20, i%5 ? 74 : 70)} L${point(i/20,79)}" stroke="#8aa6a2" stroke-width="${i%5 ? 1 : 1.6}"/>`).join('');
  const pointer = Number.isFinite(ratio) ? `<path d="M104 92 L${point(Math.min(1,Math.max(0,ratio)),67)}" stroke="#89e2d3" stroke-width="3.2" stroke-linecap="round"/><circle cx="104" cy="92" r="4.5" fill="#89e2d3"/>` : '';
  const progress = Number.isFinite(ratio) ? `<path d="M20 92 A84 84 0 0 1 188 92" fill="none" pathLength="100" stroke="#79dcce" stroke-width="5" stroke-dasharray="${Math.min(100,Math.max(0,ratio * 100))} 101"/>` : '';
  return `<svg viewBox="0 0 208 113"><path d="M20 92 A84 84 0 0 1 188 92" fill="none" stroke="#3d5c5d" stroke-width="5"/>${progress}${ticks}${pointer}<text class="gauge-label" x="19" y="108" text-anchor="middle">0%</text><text class="gauge-label" x="188" y="108" text-anchor="middle">100%</text></svg>`;
}

// The denominator must match the same 30 complete days valued at the configured list prices.
function creditPurchaseShare(sales) {
  const window = sales?.window30;
  if (!window || !(window.estimatedUsd > 0) || !Array.isArray(sales.days)) return null;
  const rows = completeDays(sales.days, window.end, 30);
  if (!rows.length || rows[0].date !== window.start) return null;

  const products = Object.values(SALES.products);
  let total = 0, credits = 0;
  for (const row of rows) {
    let dayTotal = 0;
    for (const product of products) {
      const count = row[product.id];
      if (!Number.isSafeInteger(count) || count < 0) return null;
      const value = count * product.price;
      dayTotal += value;
      if (product.id === 'credits') credits += value;
    }
    if (dayTotal !== row.estimatedUsd) return null;
    total += dayTotal;
  }
  return total === window.estimatedUsd ? credits / total : null;
}

export function overviewFragments(s, now = Date.now()) {
  const w = s.supply?.windows?.[90];
  const cover = s.checks?.find(check => check.id === 'cover');
  const context = burnCoverContext(s.supply?.windows, s.supply?.history);
  const older = now - utcMidnight(s.lastDay) >= 3 * DAY;
  const endBlock = s.evidence?.endBlock;
  const vvv = s.prices?.vvv, diem = s.prices?.diem, paid = s.sales?.window30;
  const order = {alert:0, watch:1, stale:2, pending:3, healthy:4};
  const checks = [...(s.checks || [])].sort((a,b) => (order[a.state] ?? 9) - (order[b.state] ?? 9));
  const cards = checks.map(check => {
    const reason = Object.hasOwn(why, check.id) ? `<p class="check-why">${escape(why[check.id])}</p>` : '';
    return `<article class="check"><div class="check-head"><h3>${escape(check.title)}</h3>${grade(check.state)}</div><p>${escape(check.text)}</p>${reason}</article>`;
  });
  const creditShare = creditPurchaseShare(s.sales);
  const mixNote = creditShare === null ? 'Estimated at list prices' : `${pct(creditShare,0)} of this value came from API credit purchases`;
  const purchasesAsOf = paid?.end && paid.end !== s.lastDay ? ` · through ${date(paid.end)} UTC` : '';
  const metrics = [
    metric('VVV price', money(vvv?.usd,2), vvv ? `Quote · ${date(vvv.asOf,false)} UTC` : 'Quote unavailable'),
    metric('Effective supply', compact(s.supply?.effective), 'VVV outside burn addresses'),
    metric('Net issuance', signed(w?.net,compact), 'VVV over 90 days'),
    metric('Staked supply', pct(divide(s.supply?.staked,s.supply?.effective)), 'Share of effective VVV'),
    metric('Estimated qualifying purchases · 30 days', moneyShort(paid?.estimatedUsd), mixNote + purchasesAsOf),
    metric('DIEM price', money(diem?.usd,2), diem ? `Quote · ${date(diem.asOf,false)} UTC` : 'Quote unavailable')
  ];
  return {
    asof: `Data through <strong>${date(s.lastDay)} UTC</strong>${older ? ' · older snapshot' : ''}${endBlock ? ` · Base block ${blockLink(endBlock)}` : ''}`,
    'cover-grade': grade(cover?.state),
    'cover-value': pct(w?.ratio),
    'cover-note': escape(context.thresholdNote),
    'cover-recent': escape(context.trend),
    'cover-drivers': escape(context.detail),
    'cover-breakdown': escape(context.breakdown),
    gauge: drawGauge(w?.ratio),
    overview: metrics.join(''),
    'check-list': cards.join('') || '<p class="empty">Check results are unavailable for this snapshot.</p>'
  };
}
