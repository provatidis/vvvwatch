import { RULES, SALES } from './lib/config.js';

const DAY = 86_400_000;
const BLANK = '—';
const $ = id => document.getElementById(id);
const round = (value, digits = 0) => Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: digits }) : BLANK;
const compact = (value, digits = 2) => Number.isFinite(value) ? value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: digits }) : BLANK;
const pct = (value, digits = 1) => Number.isFinite(value) ? `${round(value * 100, digits)}%` : BLANK;
const multiple = (value, digits = 2) => Number.isFinite(value) ? `${value.toFixed(digits)}×` : BLANK;
const money = (value, digits = 0) => Number.isFinite(value) ? `$${round(value, digits)}` : BLANK;
const moneyShort = value => Number.isFinite(value) ? `$${compact(value)}` : BLANK;
const signed = (value, format = round) => Number.isFinite(value) ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${format(Math.abs(value))}` : BLANK;
const divide = (value, denominator) => Number.isFinite(value) && denominator > 0 ? value / denominator : null;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[char]);
const date = (iso, withYear = true) => {
  if (!iso) return BLANK;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', ...(withYear ? {year:'numeric'} : {}) }) : BLANK;
};
const stamp = iso => iso ? `Through ${date(iso)} UTC` : 'Source date unavailable';
const stale = source => source?.ok === false ? ' · last good reading' : '';
const address = value => /^0x[0-9a-f]{40}$/i.test(value) ? `<a class="address" href="https://basescan.org/address/${value}" title="${value}">${value.slice(0,6)}…${value.slice(-4)}</a>` : BLANK;
const txLink = (tx, label = 'Transaction ↗') => /^0x[0-9a-f]{64}$/i.test(tx) ? `<a class="evidence-link" href="https://basescan.org/tx/${tx}">${escape(label)}</a>` : BLANK;
const blockLink = block => Number.isSafeInteger(block) && block > 0 ? `<a href="https://basescan.org/block/${block}">${round(block)}</a>` : BLANK;
const gradeNames = {healthy:'Healthy', watch:'Watch', alert:'Alert', stale:'Stale', pending:'Pending'};
const grade = state => `<span class="badge ${Object.hasOwn(gradeNames,state) ? state : 'pending'}">${gradeNames[state] ?? 'Pending'}</span>`;
const metric = (label, amount, note) => `<div class="metric"><span class="metric-label">${escape(label)}</span><strong class="metric-amount">${escape(amount)}</strong><span class="metric-note">${escape(note)}</span></div>`;
const datum = (label, amount, note = '') => `<div class="datum"><span class="datum-label">${escape(label)}</span><strong>${escape(amount)}</strong>${note ? `<span class="datum-note">${escape(note)}</span>` : ''}</div>`;
const table = (headers, rows) => `<div class="table-wrap large-table"><table class="data-table"><thead><tr>${headers.map(h => `<th scope="col">${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const details = (label, content) => `<details><summary>${escape(label)}</summary>${content}</details>`;
const empty = text => `<p class="empty">${escape(text)}</p>`;
const list = rows => `<dl class="summary-list">${rows.map(([k,v,cls]) => `<div${cls ? ` class="${cls}"` : ''}><dt>${escape(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
const utcMidnight = day => Date.parse(`${day}T00:00:00Z`);
function sourceLink(url, label) {
  try {
    const address = new URL(url);
    if (address.protocol === 'https:') return `<a href="${escape(address.href)}">${escape(label)}</a>`;
  } catch { /* Older snapshots may lack a source URL. */ }
  return escape(label);
}

const why = {
  cover: 'Burns offset dilution. At 100% cover, they retire one VVV for every new VVV issued.',
  sales: 'Qualifying purchases fund automatic burns, linking customer activity to demand for VVV.',
  monthly: 'A monthly burn permanently removes VVV from supply. Its dollar value depends on both the token count and the price at the burn.',
  exits: 'Tokens entering cooldown can return to circulation after the withdrawal period.',
  diem: 'Minting DIEM locks staked VVV. A shrinking collateral balance puts more of that stake within reach of withdrawal.',
  trackedSafes: 'A drop in the combined balance means VVV has moved outside the three tracked Safes after direct emissions are accounted for.',
  venice: 'Changes in the control Safe show how much VVV Venice holds there after accounting for new emissions.'
};

let snapshot;
let selectedDays = 30;

function theme() {
  const toggle = $('theme');
  function update() {
    const dark = document.documentElement.dataset.theme === 'dark';
    toggle.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} theme`);
    toggle.title = toggle.getAttribute('aria-label');
    document.querySelector('meta[name="theme-color"]').content = dark ? '#0b1517' : '#f1efe8';
  }
  toggle.hidden = false;
  update();
  toggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('ap-theme', next); } catch { /* Local storage is optional. */ }
    update();
  });
}

function drawGauge(ratio) {
  const point = (fraction, radius) => {
    const angle = Math.PI * (1 - fraction);
    return [104 + radius * Math.cos(angle), 92 - radius * Math.sin(angle)].map(v => v.toFixed(1)).join(' ');
  };
  const ticks = Array.from({length:21}, (_,i) => `<path d="M${point(i/20, i%5 ? 74 : 70)} L${point(i/20,79)}" stroke="#8aa6a2" stroke-width="${i%5 ? 1 : 1.6}"/>`).join('');
  const pointer = Number.isFinite(ratio) ? `<path d="M104 92 L${point(Math.min(1,Math.max(0,ratio)),67)}" stroke="#89e2d3" stroke-width="3.2" stroke-linecap="round"/><circle cx="104" cy="92" r="4.5" fill="#89e2d3"/>` : '';
  const progress = Number.isFinite(ratio) ? `<path d="M20 92 A84 84 0 0 1 188 92" fill="none" pathLength="100" stroke="#79dcce" stroke-width="5" stroke-dasharray="${Math.min(100,Math.max(0,ratio * 100))} 101"/>` : '';
  return `<svg viewBox="0 0 208 113"><path d="M20 92 A84 84 0 0 1 188 92" fill="none" stroke="#3d5c5d" stroke-width="5"/>${progress}${ticks}${pointer}<text class="gauge-label" x="19" y="108" text-anchor="middle">0×</text><text class="gauge-label" x="188" y="108" text-anchor="middle">1×</text></svg>`;
}

function renderOverview(s) {
  const w = s.supply?.windows?.['90'];
  const cover = s.checks?.find(check => check.id === 'cover');
  $('cover-grade').innerHTML = grade(cover?.state);
  $('cover-value').textContent = multiple(w?.ratio,3);
  $('cover-note').textContent = Number.isFinite(w?.ratio) ? `Burns offset ${pct(w.ratio)} of issuance` : 'Awaiting a complete 90-day window';
  const recent = s.supply?.windows?.['30'];
  const recentNote = $('cover-recent');
  recentNote.hidden = !Number.isFinite(recent?.ratio);
  if (!recentNote.hidden) {
    const previous = recent.priorRatio;
    const change = recent.ratio > previous ? 'up from' : recent.ratio < previous ? 'down from' : 'level with';
    const comparison = Number.isFinite(previous) ? `, ${change} ${pct(previous)} in the prior 30 days` : '';
    recentNote.innerHTML = `30-day cover <strong>${pct(recent.ratio)}</strong>${comparison}`;
  }
  $('gauge').innerHTML = drawGauge(w?.ratio);
  const old = Date.now() - utcMidnight(s.lastDay) >= 3 * DAY;
  $('asof').innerHTML = `Data through <strong>${date(s.lastDay)} UTC</strong>${old ? ' · older snapshot' : ''}${s.evidence?.endBlock ? ` · Base block ${blockLink(s.evidence.endBlock)}` : ''}`;
  const p = s.prices, paid = s.sales?.window30;
  const vvvPrice = p?.vvv, diemPrice = p?.diem;
  $('overview').innerHTML = [
    metric('VVV price', money(vvvPrice?.usd,2), vvvPrice ? `Quote · ${date(vvvPrice.asOf,false)} UTC` : 'Quote unavailable'),
    metric('Effective supply', compact(s.supply?.effective), 'VVV outside burn addresses'),
    metric('Net issuance', signed(w?.net,compact), 'VVV over 90 days'),
    metric('Staked supply', pct(divide(s.supply?.staked,s.supply?.effective)), 'Share of effective VVV'),
    metric('Purchases · 30 days', moneyShort(paid?.estimatedUsd), Number.isFinite(paid?.annualizedUsd) ? `${moneyShort(paid.annualizedUsd)} annualized at list prices` : 'Estimated at list prices'),
    metric('DIEM price', money(diemPrice?.usd,2), diemPrice ? `Quote · ${date(diemPrice.asOf,false)} UTC` : 'Quote unavailable')
  ].join('');
  const order = {alert:0, watch:1, stale:2, pending:3, healthy:4};
  const checks = [...(s.checks || [])].sort((a,b) => (order[a.state] ?? 9) - (order[b.state] ?? 9));
  $('check-list').innerHTML = checks.length ? checks.map(check => `<article class="check"><div class="check-head"><h3>${escape(check.title)}</h3>${grade(check.state)}</div><p>${escape(check.text)}</p>${why[check.id] ? `<p class="check-why">${escape(why[check.id])}</p>` : ''}</article>`).join('') : empty('Check results are unavailable for this snapshot.');
}

function chartScale(maximum) {
  const rough = Math.max(maximum,1) / 4;
  const unit = 10 ** Math.floor(Math.log10(rough));
  const step = [1,2,2.5,5,10].find(value => value * unit >= rough) * unit;
  const count = Math.ceil(maximum / step) || 1;
  return {upper:count*step, ticks:Array.from({length:count+1},(_,i)=>i*step)};
}

function chartFrame(scale, xLabels, drawing, description, markers='') {
  const ticks = scale.ticks.map(t => `<span class="plot-tick" style="bottom:${t / scale.upper * 100}%"><span>${escape(compact(t))}</span></span>`).join('');
  const labels = xLabels.map(label=>`<span>${escape(label)}</span>`).join('');
  return `<div class="chart-frame" role="img" aria-label="${escape(description)}"><div class="plot-area" aria-hidden="true">${ticks}<svg viewBox="0 0 1000 160" preserveAspectRatio="none">${drawing}</svg>${markers}</div><div class="plot-x" aria-hidden="true">${labels}</div></div>`;
}

function lineChart(rows, series, labelStart, labelEnd, description) {
  const largest = Math.max(...rows.flatMap(row => series.map(s => row[s.key])));
  if (!Number.isFinite(largest) || !rows.length) return empty('The chart does not yet have complete observations.');
  const scale = chartScale(largest);
  const x = index => index * 1000 / Math.max(1,rows.length-1);
  const y = value => 160 - value * 160 / scale.upper;
  const lines = series.map(s => `<polyline class="chart-${s.style}" points="${rows.map((row,i) => `${x(i).toFixed(2)},${y(row[s.key]).toFixed(2)}`).join(' ')}"/>`).join('');
  return chartFrame(scale,[labelStart,labelEnd],lines,description);
}

function completeDays(rows, lastDay, days) {
  const end = utcMidnight(lastDay);
  const first = end-(days-1)*DAY;
  const period = (rows || []).filter(r => utcMidnight(r.date) >= first && utcMidnight(r.date) <= end).sort((a,b) => a.date.localeCompare(b.date));
  return period.length === days && period.every((r,i) => utcMidnight(r.date) === first+i*DAY) ? period : [];
}

function attribution(window) {
  if (!window) return '';
  const mint = window.issuanceAttribution;
  const burn = window.burnAttribution;
  if (!mint && !burn) {
    return '<p class="fine attribution-note">A full-period breakdown by recipient and burn program is unavailable. The totals above use onchain balances.</p>';
  }
  const entries = (heading, rows) => `<h4>${heading}</h4>${table(['Destination','VVV','Share'],rows)}`;
  const row = (label, amount, total) => [label,round(amount,2),pct(divide(amount,total))];
  const minted = mint ? entries('Issuance by recipient',[
    row('Stakers',mint.mintStakers,window.minted),
    row('Venice treasury',mint.mintVenice,window.minted),
    row('Other recipients',mint.mintOther,window.minted)
  ]) : empty('The issuance split is unavailable for this period.');
  const retired = burn ? entries('Burns by program',[
    row('Signup and credit purchases',burn.burnSales,window.burned),
    row('Monthly buybacks',burn.burnMonthly,window.burned),
    row('Other burns',burn.burnOther,window.burned)
  ]) : empty('The burn split is unavailable for this period.');
  return details('Show issuance and burn breakdown',minted + retired);
}

function renderLedger(s) {
  const d = selectedDays, win = s.supply?.windows?.[d];
  document.querySelectorAll('[data-ledger-days]').forEach(btn => btn.setAttribute('aria-pressed', String(Number(btn.dataset.ledgerDays) === d)));
  const info = win ? `${date(win.start,false)} – ${date(win.end)} UTC` : 'Awaiting a complete window';
  $('ledger-summary').innerHTML = `<h3>${d}-day reconciliation</h3><p class="fine">${escape(info)}</p>${list([
    ['Minted', `${round(win?.minted)} VVV`], ['Retired', `${round(win?.burned)} VVV`], ['Net supply change', `${signed(win?.net)} VVV`,'total'], ['Burn cover', multiple(win?.ratio,3)], ['Annualized net change', signed(win?.annualized,pct)]
  ])}${attribution(win)}`;
  let mint = 0, burn = 0;
  const daily = completeDays(s.supply?.history,s.lastDay,d);
  const valid = daily.length && daily.every(r => Number.isFinite(r.minted) && Number.isFinite(r.burned));
  const running = valid ? [{date:null,minted:0,burned:0}, ...daily.map(r => { mint+=r.minted; burn+=r.burned; return {date:r.date,minted:mint,burned:burn}; })] : [];
  const plot = valid ? lineChart(running,[{key:'minted',style:'mint'},{key:'burned',style:'burn'}], date(daily[0].date,false),date(s.lastDay,false),'Cumulative VVV minted and retired over the selected window') : empty('A complete daily series is required to plot this window.');
  $('ledger-trend').innerHTML = `<h3>Issuance against burns</h3><p class="fine">Cumulative VVV over ${d} completed days</p><div class="legend"><span><i class="sw-mint"></i>Minted</span><span><i class="sw-burn"></i>Retired</span></div>${plot}${valid ? details('Show daily amounts', table(['UTC day','Minted VVV','Retired VVV','Net VVV'],[...daily].reverse().map(r => [date(r.date),round(r.minted,2),round(r.burned,2),signed(r.minted-r.burned,v => round(v,2))]))) : ''}`;
  const ev = s.evidence || {}, start = d === 30 ? ev.startBlock30 : ev.startBlock90;
  $('ledger-source').innerHTML = `Measured from changes in total VVV issued and the balances of the zero and dead addresses.${start && ev.endBlock ? ` Base blocks ${blockLink(start)} to ${blockLink(ev.endBlock)}.` : ''}`;
}

function renderBuybacks(s) {
  const b = s.buybacks, cycles = [...(b?.cycles || [])].sort((a,c) => c.date.localeCompare(a.date));
  if (!cycles.length) { $('buyback-panel').innerHTML = empty('Monthly Safe inventory is unavailable in this snapshot.'); return; }
  const c = cycles[0], prev = cycles[1];
  const value = c.burnVerified ? c.valuation : null;
  const priorValue = prev?.burnVerified ? prev.valuation : null;
  const delta = (n, base) => Number.isFinite(n) && base > 0 ? n/base - 1 : null;
  const changes = [
    ['burn value',delta(value?.usd,priorValue?.usd)],
    ['VVV retired',delta(c.burnedVvv,prev?.burnedVvv)],
    ['USDC spent',c.verified && prev?.verified ? delta(c.spentUsdc,prev.spentUsdc) : null]
  ].filter(([,ratio]) => Number.isFinite(ratio)).map(([name,ratio])=>`${name} ${signed(ratio,pct)}`);
  const comparison = prev && changes.length ? `<p class="buyback-comparison">Since the ${date(prev.date,false)} cycle · ${changes.join(' · ')}</p>` : '';
  const valuationSource = value ? `<p class="fine">The estimate prices retired VVV at ${money(value.priceUsd,2)} per token at Base block ${blockLink(value.block)}. It combines the <a href="https://basescan.org/address/${escape(value.pool)}">Aerodrome VVV/WETH price</a> and <a href="https://basescan.org/address/${escape(value.oracle)}">Chainlink ETH/USD price</a>.</p>` : '<p class="fine">A burn-time market price is unavailable for this cycle.</p>';
  const rows = cycles.map(cycle => [date(cycle.date),round(cycle.openingVvv,1),round(cycle.boughtVvv,1),signed(cycle.otherVvv,v=>round(v,1)),round(cycle.burnedVvv,1),money(cycle.burnVerified ? cycle.valuation?.usd : null),round(cycle.closingVvv,1),money(cycle.spentUsdc),cycle.verified ? 'Verified' : 'Partial',txLink(cycle.tx,'View ↗')]);
  $('buyback-panel').innerHTML = `<div class="subhead"><h3>Latest burn · ${date(c.date)}</h3><span class="fine">${escape(stamp(s.sources?.buybacks?.asOf || b.asOf)+stale(s.sources?.buybacks))}</span></div><div class="subgrid">${[
    datum('Estimated burn value',moneyShort(value?.usd),'USD at the burn block'), datum('VVV retired',round(c.burnedVvv),'Permanently removed'), datum('Spent during cycle',moneyShort(c.spentUsdc),c.verified ? 'USDC paid for VVV' : 'Attributed USDC purchases'), datum('Closing inventory',round(c.closingVvv),'VVV left in the Safe')
  ].join('')}</div>${comparison}${valuationSource}<p class="fine">${Number.isFinite(c.openingVvv) && Number.isFinite(c.boughtVvv) ? `The Safe carried ${round(c.openingVvv)} VVV into this cycle and bought ${round(c.boughtVvv)} VVV.` : 'Earlier Safe balances are unavailable for this cycle.'} ${txLink(c.tx,'Burn transaction ↗')}</p>${details('Show cycle ledger',table(['Burn date','Opening VVV','Bought VVV','Other net VVV','Burned VVV','Est. burn value','Closing VVV','USDC spent','Spending evidence','Evidence'],rows))}`;
}

function referencePurchases(reference, completeVerifiedWindow) {
  if (!reference?.asOf || !reference.days?.length) return '';
  const period = completeDays(reference.days,reference.asOf,30);
  const day = reference.days.find(row => row.date === reference.asOf);
  if (!day) return '';
  const total = period.length && period.every(row => Number.isFinite(row.estimatedUsd))
    ? period.reduce((sum, row) => sum + row.estimatedUsd, 0) : null;
  const source = 'https://venicestats.com/burns';
  const header = `<h4>VeniceStats purchase estimates</h4><p class="fine">External reference through ${date(day.date)} UTC. The purchase check uses independently matched onchain burns.</p>`;
  const values = list([
    ['Estimated purchases over 30 days',money(total)],
    ['Estimated purchases on ' + date(day.date,false),money(day.estimatedUsd)],
    ...Object.values(SALES.products).map(p=>[p.label + ' events on ' + date(day.date,false),round(day[p.id])])
  ]);
  const body = `${header}${values}<p class="fine"><a href="${source}">VeniceStats burn data ↗</a></p>`;
  return completeVerifiedWindow ? details('Compare with VeniceStats',body) : body;
}

function renderSales(s) {
  const sales = s.sales, recent = [...(sales?.days || [])].sort((a,b) => a.date.localeCompare(b.date));
  const reference = referencePurchases(sales?.reference,Number.isFinite(sales?.window30?.estimatedUsd));
  if (!sales || !recent.length) { $('sales-panel').innerHTML = empty('No verified purchase observations are available in this snapshot.') + reference; return; }
  const w = sales.window30, latest = recent.at(-1), used = completeDays(recent,latest.date,30);
  const rows = recent.slice().reverse().map(day => [date(day.date),round(day.pro),round(day.proplus),round(day.max),round(day.credits),round(typeof day.unknown === 'object' ? day.unknown?.count : day.unknown),money(day.estimatedUsd),money(day.burnUsdc)]);
  const productRows = used.length ? Object.values(SALES.products).map(p => {
    const count = used.every(r=>Number.isFinite(r[p.id])) ? used.reduce((v,r)=>v+r[p.id],0) : null;
    return [escape(p.label),round(count),money(p.price),money(Number.isFinite(count)?count*p.price:null)];
  }) : [];
  const claim = sales.claim;
  const reported = claim?.date && claim?.url && claim?.label ? `<p class="fine company-claim"><strong>Reported company figure · ${date(claim.date)}</strong> ${escape(claim.label)} ${sourceLink(claim.url,'Source')}</p>` : '';
  const share = Number.isFinite(w?.programmaticBurnShare) ? `<h4>Burns relative to estimated purchase value</h4><div class="subgrid burn-shares">${datum('Purchase-linked burn budget',pct(w.programmaticBurnShare),moneyShort(w.burnUsdc) + ' allocated over 30 days')}${Number.isFinite(w.totalBurnShare) ? datum('Including monthly burns',pct(w.totalBurnShare),'Adds the market value of monthly burns in the same 30 days') : datum('Including monthly burns',BLANK,'Awaiting burn valuations for the full period')}</div>` : '';
  $('sales-panel').innerHTML = `<div class="subhead"><h3>Estimated purchases · 30 days</h3><span class="fine">${escape(stamp(s.sources?.sales?.asOf || sales.asOf)+stale(s.sources?.sales))}</span></div><div class="subgrid">${[
    datum('Estimated purchases',moneyShort(w?.estimatedUsd),'Matched purchases at list prices'), datum('Annualized pace',moneyShort(w?.annualizedUsd),'30-day estimate × 365 / 30'), datum('Versus prior 30 days',signed(w?.change,pct),'Comparable completed windows')
  ].join('')}</div>${reported}<p class="fine">The estimate applies list prices to matched purchases. Renewals, discounts, annual billing and transactions outside the burn program limit how closely it tracks company revenue.</p>${share}${productRows.length ? details('Show product mix',table(['Product','Events over 30d','List price','Estimated purchases'],productRows)) : ''}${details('Show daily purchase counts',table(['UTC day','Pro','Pro+','Max','Credit packs','Unknown','Estimated purchases','Burn USDC'],rows))}${reference}`;
}

function curveMarkup(curve, supply, target, currentRate) {
  const points = (curve || []).filter(p => Number.isFinite(p.supply) && p.supply > 0 && Number.isFinite(p.rate) && p.rate > 0)
    .sort((a,b) => a.supply-b.supply);
  if (points.length < 2) return '';
  const precision = n => n >= 1e9 ? n.toExponential(3).replace('+','') : round(n,2);
  const tableOfRates = details('Show full mint schedule',table(['Supply upper bound (DIEM)','sVVV per DIEM'],points.map(p=>[round(p.supply,2),precision(p.rate)])));
  const end = points.at(-1).supply;
  if (!(Number.isFinite(supply) && supply >= 0 && supply <= end && Number.isFinite(target) && target > 0 && target <= end)) return tableOfRates;

  // The upper bound of a bracket applies to the last unit minted into that bracket.
  // At an exact boundary, the next unit takes the following bracket's rate.
  const close = (a,b) => Math.abs(a-b) <= Math.max(1,Math.abs(a),Math.abs(b))*1e-12;
  const toTarget = points.find(p => p.supply > target || close(p.supply,target));
  const afterTarget = points.find(p => p.supply > target && !close(p.supply,target));
  const current = Number.isFinite(currentRate) ? currentRate : points.find(p => p.supply > supply && !close(p.supply,supply))?.rate;
  if (!toTarget || !Number.isFinite(current)) return tableOfRates;

  const spacing = 5000;
  const low = Math.max(0,Math.floor((Math.min(supply,target)-spacing)/spacing)*spacing);
  const high = Math.min(end,Math.ceil((Math.max(supply,target)+spacing)/spacing)*spacing);
  const steps = [];
  for (let i=0;i<points.length;i++) {
    const start = Math.max(low,i ? points[i-1].supply : 0);
    const stop = Math.min(high,points[i].supply);
    if (stop > start && !close(start,stop)) steps.push({start,stop,rate:points[i].rate});
  }
  if (!steps.length) return tableOfRates;
  const scale = chartScale(Math.max(current,toTarget.rate,...steps.map(p=>p.rate)));
  const x = value => (value-low)/(high-low)*1000;
  const y = rate => (1-rate/scale.upper)*160;
  const path = steps.map((p,i) => `${i ? 'V' : 'M' + x(p.start).toFixed(2) +' '}${y(p.rate).toFixed(2)}H${x(p.stop).toFixed(2)}`).join(' ');
  function marker(value,rate,kind) {
    return `<span class="curve-guide" style="left:${x(value)/10}%"></span><i class="curve-point ${kind}" style="left:${x(value)/10}%;bottom:${rate/scale.upper*100}%"></i>`;
  }
  const markers = marker(target,toTarget.rate,'target')+marker(supply,current,'current');
  const xLabels = [compact(low),compact((low+high)/2),compact(high)];
  const plot = chartFrame(scale,xLabels,`<path class="chart-teal" d="${path}"/>`,'Linear mint curve from '+round(low)+' to '+round(high)+' DIEM outstanding, with current and policy target rates.',markers);
  const next = afterTarget && afterTarget.rate !== toTarget.rate ? ` The next DIEM above the target costs ${round(afterTarget.rate)} sVVV.` : '';
  return `<div class="curve-section"><h4>DIEM mint curve</h4><p class="fine">sVVV per DIEM minted</p><div class="curve-grid"><div>${plot}<p class="plot-caption">DIEM outstanding</p></div><div class="curve-readings"><div><span class="curve-key current"></span><span>Current supply · ${round(supply)} DIEM</span><strong>${round(current)} <small>sVVV / DIEM</small></strong></div><div><span class="curve-key target"></span><span>Policy target · ${round(target)} DIEM</span><strong>${round(toTarget.rate)} <small>sVVV / DIEM</small></strong></div></div></div><p class="fine">The target rate applies to the last DIEM minted to reach ${round(target)}.${next}</p>${tableOfRates}</div>`;
}

function renderDiem(s) {
  const d = s.diem, u = d?.utilization;
  if (!d) { $('diem-panel').innerHTML=empty('DIEM contract data is unavailable.'); return; }
  const ux = u ? `<h4>Inference credit use</h4><p class="fine">Across ${round(u.days)} completed days through ${date(u.date)}, users consumed ${money(u.consumedPerDay)} of ${money(u.depositedPerDay)} in eligible daily credit on average (${pct(u.ratio)}). <a href="https://venicestats.com/diem">VeniceStats usage data ↗</a></p>` : '<p class="fine">Inference usage is unavailable in this snapshot.</p>';
  const creditNote = Number.isFinite(d.annualCreditRatio) ? `<p class="fine">Using the full $1 daily allocation would deliver a year of API credit worth ${pct(d.annualCreditRatio)} of the recorded DIEM price. Unused daily credit expires.</p>` : '';
  $('diem-panel').innerHTML=`<div class="subhead"><h3>Compute credit capacity</h3><span class="fine">${escape(stamp(s.lastDay)+stale(s.sources?.protocol))}</span></div><div class="subgrid">${[
    datum('DIEM issued',compact(d.supply),`Policy target ${round(d.target)} DIEM`), datum('Deposited for credits',compact(d.deposited),`${pct(divide(d.deposited,d.supply))} of issued DIEM`), datum('Locked sVVV',compact(d.locked),`${signed(d.change30,pct)} over 30 days`),datum('Mint quote',round(d.mintRate,1),'sVVV per DIEM')].join('')}</div>${creditNote}${ux}${curveMarkup(s.rules?.values?.curve,d.supply,d.target,d.mintRate)}`;
}

function renderTreasury(s) {
  const t = s.treasury || {}, supply=s.supply || {};
  const holding = [t.vvv,t.svvv,t.cooldown].every(Number.isFinite) ? t.vvv+t.svvv+t.cooldown : null;
  const wallets = t.wallets || [];
  const grouped = wallets.length ? `<div class="subhead"><h3>Tracked Safe holdings</h3><span class="fine">${escape(stamp(t.walletsAsOf)+stale(s.sources?.wallets))}${t.walletsBlock ? ' · '+blockLink(t.walletsBlock) : ''}</span></div><div class="subgrid">${datum('VVV in tracked Safes',compact(t.trackedSafeTotal),'Liquid, staked and in cooldown')}${datum('30-day change',signed(t.trackedSafeChange30,pct),'After direct emissions')}</div><p class="fine">The holdings check combines the wallets marked as included below. Transfers between them leave the combined balance unchanged.</p>${details('Show wallets and ownership evidence',table(['Wallet','Attribution','Holdings check','VVV','sVVV','In cooldown','30-day change (VVV)','DIEM'],wallets.map(w=>[`${escape(w.label)}<br>${address(w.address)}`,`${escape(w.attribution ?? w.role ?? '')} ${w.sourceUrl ? sourceLink(w.sourceUrl,'Evidence') : ''}`,w.inGrade ? 'Included' : 'Context only',round(w.vvv),round(w.svvv),round(w.cooldown),signed(w.change30),round(w.diem,1)])))}<hr class="divider">` : '';
  $('treasury-panel').innerHTML=`${grouped}<div class="subhead"><h3>Control Safe holdings</h3><span class="fine">${address(t.address)}</span></div><div class="subgrid">${[
    datum('Wallet VVV',compact(t.vvv),'Unstaked balance'),datum('Staked VVV',compact(t.svvv),'sVVV in the Safe'),datum('In cooldown',compact(t.cooldown),'Principal still owed to the Safe'),datum('Total tracked',compact(holding),'VVV equivalent')].join('')}</div><p class="fine">The tracked balance includes pending withdrawals. Transfers and unstaking can move VVV without a sale.</p>${details('Show protocol-wide staking',list([['Total effective VVV',round(supply.effective)],['Total staked VVV',round(supply.staked)],['Locked behind DIEM',round(supply.locked)],['Share of stake locked',pct(divide(supply.locked,supply.staked))]]))}`;
}

function shortChange(value) {
  if (value == null) return BLANK;
  if (Array.isArray(value)) return value.map(v=>/^0x[0-9a-f]{40}$/i.test(v)?address(v):escape(v)).join(', ');
  if (typeof value === 'object') return escape(JSON.stringify(value));
  if (/^0x[0-9a-f]{40}$/i.test(value)) return address(value);
  if (/^(0x)?[0-9a-f]{64}$/i.test(value)) return `<span title="${escape(value)}">${escape(value.slice(0,10))}…</span>`;
  if (Number.isFinite(value)) return round(value,5);
  return escape(value);
}

function renderRules(s) {
  const r=s.rules,v=r?.values || {};
  if (!r) { $('rules-panel').innerHTML=empty('Rules and administrative controls are unavailable for this snapshot.'); return; }
  const safe = obj => obj && Number.isInteger(obj.threshold) && Array.isArray(obj.owners) ? `${obj.threshold} of ${obj.owners.length}` : BLANK;
  const changes = [...(r.changes || [])].sort((a,b) => (b.block||0)-(a.block||0));
  const names = Object.fromEntries(RULES.map(k=>[k.id,k.label]));
  names.curveHash = 'DIEM mint curve';
  names.emissionRatePerYear = 'Annual issuance (VVV)';
  const changesTable = changes.length ? `<div class="history-table">${table(['UTC day','Change','Evidence'],changes.map(c => {
    const documented = c.policyTarget;
    let description;
    if (c.id === 'curveHash') {
      const targetChange = Number.isFinite(documented?.to) && Number.isFinite(documented?.from)
        ? `Published DIEM target · ${round(documented.from)} → ${round(documented.to)}` : 'The contract’s DIEM mint schedule changed.';
      const hashes = `<details class="hash-proof"><summary>Curve hashes</summary><code>${escape(c.from)}</code><code>${escape(c.to)}</code></details>`;
      description = `${targetChange} ${documented?.sourceUrl ? sourceLink(documented.sourceUrl,documented.sourceLabel || 'Published schedule') : ''}${hashes}`;
    } else {
      description = `${escape(names[c.id] || c.label || c.id)}<br>${shortChange(c.from)} → ${shortChange(c.to)}`;
    }
    return [date(c.date),description,txLink(c.tx,'Transaction')];
  }))}</div>` : empty('No rule changes appear in the observed history.');
  const policies=[...(r.policy||[])].sort((a,b)=>b.date.localeCompare(a.date));
  const policy=policies.length?`<ul class="event-list">${policies.map(p=>`<li><time>${date(p.date)}</time><span>${escape(p.label)} ${p.sourceUrl ? sourceLink(p.sourceUrl,p.sourceLabel || 'Source') : ''} ${p.tx ? txLink(p.tx,'Transaction') : ''}</span></li>`).join('')}</ul>`:'';
  const secondsToDays = n => Number.isFinite(n) ? `${round(n/86400,2)} ${n===86400 ? 'day' : 'days'}` : BLANK;
  const parameters=[['VVV emissions per year',round(v.emissionRatePerYear)],['Venice share of emissions',pct(v.venicePct)],['Venice share on locked stake',pct(v.venicePctLocked)],['VVV unstake cooldown',secondsToDays(v.cooldown)],['DIEM unstake cooldown',secondsToDays(v.diemCooldown)],['Staking owner',address(v.stakingOwner)],['VVV owner',address(v.vvvOwner)],['Rewards treasury',address(v.treasury)],['Staking implementation',address(v.implementation)]];
  $('rules-panel').innerHTML=`<div class="subhead"><h3>Current settings</h3><span class="fine">${escape(stamp(r.asOf)+stale(s.sources?.protocol))}${r.block?` · ${blockLink(r.block)}`:''}</span></div><div class="subgrid">${[
    datum('Control Safe',safe(v.controlSafe),'Signatures required'),datum('Buyback Safe',safe(v.buybackSafe),'Signatures required'),datum('Annual issuance rate',compact(v.emissionRatePerYear),'VVV per year'),datum('Locked-stake share',pct(v.venicePctLocked),'Paid to Venice')].join('')}</div>${details('Show contract parameters',list(parameters))}${details(`Onchain changes (${changes.length})`,changesTable)}${policy?details('Dated policy events',policy):''}`;
}

function render(s) {
  renderOverview(s); renderLedger(s); renderBuybacks(s); renderSales(s); renderDiem(s); renderTreasury(s); renderRules(s);
}

async function load() {
  $('error').hidden=true;
  try {
    const response=await fetch('./data/latest.json',{cache:'no-cache'});
    if (!response.ok) throw new Error(`Snapshot HTTP ${response.status}`);
    const s=await response.json();
    if (s.schemaVersion!==1 || !Number.isFinite(utcMidnight(s.lastDay))) throw new Error('Unsupported snapshot');
    snapshot=s;
    render(snapshot);
  } catch {
    $('asof').textContent='Snapshot unavailable';
    $('cover-note').textContent='Awaiting a verified snapshot';
    $('gauge').innerHTML=drawGauge(null);
    $('error').hidden=false;
    $('error').innerHTML='The dashboard could not load its daily snapshot. <button type="button" id="retry">Retry</button> <a href="./data/latest.json">Open snapshot JSON ↗</a>';
    $('retry').addEventListener('click',load,{once:true});
    for (const id of ['check-list','ledger-summary','ledger-trend','buyback-panel','sales-panel','diem-panel','treasury-panel','rules-panel']) $(id).innerHTML=empty('Data is unavailable.');
  }
}

theme();
document.querySelectorAll('[data-ledger-days]').forEach(button=>button.addEventListener('click',()=>{
  selectedDays=Number(button.dataset.ledgerDays);
  if (snapshot) renderLedger(snapshot);
}));
load();
