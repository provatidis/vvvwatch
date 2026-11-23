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

let snapshot;
let selectedDays = 90;

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
    metric('Purchase estimate', moneyShort(paid?.estimatedUsd), 'Estimated purchases · 30d'),
    metric('DIEM price', money(diemPrice?.usd,2), diemPrice ? `Quote · ${date(diemPrice.asOf,false)} UTC` : 'Quote unavailable')
  ].join('');
  const order = {alert:0, watch:1, stale:2, pending:3, healthy:4};
  const checks = [...(s.checks || [])].sort((a,b) => (order[a.state] ?? 9) - (order[b.state] ?? 9));
  $('check-list').innerHTML = checks.length ? checks.map(check => `<article class="check"><div class="check-head"><h3>${escape(check.title)}</h3>${grade(check.state)}</div><p>${escape(check.text)}</p></article>`).join('') : empty('Check results are unavailable for this snapshot.');
}

function lineChart(rows, series, labelStart, labelEnd, description, format = compact) {
  const w = 540, h = 164, left = 48, right = 14, top = 10, bottom = 25;
  const x = index => left + index * (w-left-right) / Math.max(1,rows.length-1);
  const highest = Math.max(...rows.flatMap(row => series.map(s => row[s.key])));
  if (!Number.isFinite(highest) || !rows.length) return empty('The chart does not yet have complete observations.');
  const maximum = Math.max(highest, 1);
  const y = value => h-bottom-value*(h-top-bottom)/maximum;
  const grid = [0,.5,1].map(v => `<path class="chart-grid" d="M${left} ${y(v*maximum)}H${w-right}"/><text class="axis" text-anchor="end" x="${left-6}" y="${y(v*maximum)+4}">${escape(format(v*maximum))}</text>`).join('');
  const lines = series.map(s => `<polyline class="chart-${s.style}" points="${rows.map((row,i) => `${x(i).toFixed(1)},${y(row[s.key]).toFixed(1)}`).join(' ')}"/>`).join('');
  return `<svg class="plot mini-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escape(description)}">${grid}${lines}<text class="axis" x="${left}" y="${h-3}">${escape(labelStart)}</text><text class="axis" text-anchor="end" x="${w-right}" y="${h-3}">${escape(labelEnd)}</text></svg>`;
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
  $('ledger-trend').innerHTML = `<h3>Issuance against burns</h3><p class="fine">Cumulative VVV over ${d} completed days</p><div class="legend"><span><i class="sw-mint"></i>Minted</span><span><i class="sw-burn"></i>Retired</span></div>${plot}${valid ? details('Show daily amounts', table(['UTC day','Minted VVV','Retired VVV','Net VVV'],[...daily].reverse().map(r => [escape(r.date),round(r.minted,2),round(r.burned,2),signed(r.minted-r.burned,v => round(v,2))]))) : ''}`;
  const ev = s.evidence || {}, start = d === 30 ? ev.startBlock30 : ev.startBlock90;
  $('ledger-source').innerHTML = `Measured from changes in total VVV issued and the balances of the zero and dead addresses.${start && ev.endBlock ? ` Base blocks ${blockLink(start)} to ${blockLink(ev.endBlock)}.` : ''}`;
}

function renderBuybacks(s) {
  const b = s.buybacks, cycles = [...(b?.cycles || [])].sort((a,c) => c.date.localeCompare(a.date));
  if (!cycles.length) { $('buyback-panel').innerHTML = empty('Monthly Safe inventory is unavailable in this snapshot.'); return; }
  const c = cycles[0];
  const rows = cycles.map(cycle => [escape(cycle.date),round(cycle.openingVvv,1),round(cycle.boughtVvv,1),signed(cycle.otherVvv,v=>round(v,1)),round(cycle.burnedVvv,1),round(cycle.closingVvv,1),money(cycle.spentUsdc),cycle.verified ? 'Verified' : 'Unverified',txLink(cycle.tx,'View ↗')]);
  $('buyback-panel').innerHTML = `<div class="subhead"><h3>Latest burn · ${date(c.date)}</h3><span class="fine">${escape(stamp(s.sources?.buybacks?.asOf || b.asOf)+stale(s.sources?.buybacks))}</span></div><div class="subgrid">${[
    datum('Spent during cycle',moneyShort(c.spentUsdc),'USDC paid for VVV'), datum('VVV bought',compact(c.boughtVvv),'Tokens acquired'), datum('VVV burned',compact(c.burnedVvv),'Retired at the burn'), datum('Closing inventory',compact(c.closingVvv),'VVV left in the Safe')
  ].join('')}</div><p class="fine">${c.verified ? 'The Safe’s opening inventory, purchases and other transfers reconcile with the burned and remaining VVV.' : 'This cycle has incomplete inventory attribution.'} ${txLink(c.tx,'Burn transaction ↗')}</p>${details('Show cycle ledger',table(['Burn date','Opening VVV','Bought VVV','Other net VVV','Burned VVV','Closing VVV','USDC spent','Inventory','Evidence'],rows))}`;
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
  const rows = recent.slice().reverse().map(day => [escape(day.date),round(day.pro),round(day.proplus),round(day.max),round(day.credits),round(typeof day.unknown === 'object' ? day.unknown?.count : day.unknown),money(day.estimatedUsd),money(day.burnUsdc)]);
  const productRows = used.length ? Object.values(SALES.products).map(p => {
    const count = used.every(r=>Number.isFinite(r[p.id])) ? used.reduce((v,r)=>v+r[p.id],0) : null;
    return [escape(p.label),round(count),money(p.price),money(Number.isFinite(count)?count*p.price:null)];
  }) : [];
  $('sales-panel').innerHTML = `<div class="subhead"><h3>Purchase proxy · 30 days</h3><span class="fine">${escape(stamp(s.sources?.sales?.asOf || sales.asOf)+stale(s.sources?.sales))}</span></div><div class="subgrid">${[
    datum('Estimated purchases',moneyShort(w?.estimatedUsd),'Recognized events at list prices'), datum('Versus prior 30 days',signed(w?.change,pct),'Comparable completed windows'), datum('Programmatic burns',moneyShort(w?.burnUsdc),'USD allocated to these burns')
  ].join('')}</div><p class="fine">This proxy values recognized burn-linked purchases at list prices. Renewals, discounts, annual billing and transactions outside the burn program affect its relationship to company revenue.</p>${productRows.length ? details('Show product mix',table(['Product','Events over 30d','List price','Estimated purchases'],productRows)) : ''}${details('Show daily purchase counts',table(['UTC day','Pro','Pro+','Max','Credit packs','Unknown','Estimated purchases','Burn USDC'],rows))}${reference}`;
}

function curveMarkup(curve, supply, target) {
  const points = (curve || []).filter(p => p.supply>0 && p.rate>0).sort((a,b)=>a.supply-b.supply);
  if (points.length<2) return '';
  const lo = 47, right=528, top=9, bottom=125;
  const minY=Math.log10(Math.min(...points.map(p=>p.rate))), maxY=Math.log10(Math.max(...points.map(p=>p.rate)));
  if (!(maxY>minY)) return '';
  const maxX=points.at(-1).supply, x=v=>lo+(right-lo)*v/maxX, y=v=>bottom-(bottom-top)*(Math.log10(v)-minY)/(maxY-minY);
  const markers=[[supply,'Current',top+10],[target,'Target',top+24]].filter(([val])=>val>=0 && val<=maxX && Number.isFinite(val)).map(([val,label,height])=>`<path d="M${x(val)} ${top}V${bottom}" stroke="var(--muted)" stroke-dasharray="3 4"/><text class="axis" x="${Math.min(x(val)+4,right-42)}" y="${height}">${label}</text>`).join('');
  const axisRate = value => value >= 1e7 ? value.toExponential(0).replace('+','') : compact(value,1);
  const ticks=[minY,(minY+maxY)/2,maxY].map(t=>`<path class="chart-grid" d="M${lo} ${y(10**t)}H${right}"/><text class="axis" x="${lo-5}" text-anchor="end" y="${y(10**t)+3}">${axisRate(10**t)}</text>`).join('');
  const steps=points.map((p,i)=>`${i?'V':'M'+lo+' '}${y(p.rate).toFixed(1)}H${x(p.supply).toFixed(1)}`).join(' ');
  const plot=`<svg class="plot" viewBox="0 0 540 147" role="img" aria-label="DIEM mint rate in sVVV at each supply boundary, with logarithmic vertical scale">${ticks}<path class="chart-teal" d="${steps}"/>${markers}<text class="axis" x="${lo}" y="143">0 DIEM</text><text class="axis" text-anchor="end" x="${right}" y="143">${compact(maxX)} DIEM</text></svg>`;
  return `${details('Show mint curve',`<p class="fine">Supply on the horizontal axis. The vertical axis shows sVVV per additional DIEM on a logarithmic scale.</p>${plot}${details('Show curve as table',table(['Supply upper bound (DIEM)','sVVV per DIEM'],points.map(p=>[round(p.supply,1),round(p.rate,2)])))}`)}`;
}

function renderDiem(s) {
  const d = s.diem, u = d?.utilization;
  if (!d) { $('diem-panel').innerHTML=empty('DIEM contract data is unavailable.'); return; }
  const ux = u ? `<h4>Inference credit use</h4><p class="fine">Across ${round(u.days)} completed days through ${date(u.date)}, users consumed ${money(u.consumedPerDay)} of ${money(u.depositedPerDay)} in eligible daily credit on average (${pct(u.ratio)}). <a href="https://venicestats.com/diem">VeniceStats usage data ↗</a></p>` : '<p class="fine">Inference usage is unavailable in this snapshot.</p>';
  const creditNote = Number.isFinite(d.annualCreditRatio) ? `<p class="fine">Using the full $1 daily allocation would deliver a year of API credit worth ${pct(d.annualCreditRatio)} of the recorded DIEM price. Unused daily credit expires.</p>` : '';
  $('diem-panel').innerHTML=`<div class="subhead"><h3>Compute credit capacity</h3><span class="fine">${escape(stamp(s.lastDay)+stale(s.sources?.protocol))}</span></div><div class="subgrid">${[
    datum('DIEM issued',compact(d.supply),`Policy target ${round(d.target)} DIEM`), datum('Deposited for credits',compact(d.deposited),`${pct(divide(d.deposited,d.supply))} of issued DIEM`), datum('Locked sVVV',compact(d.locked),`${signed(d.change30,pct)} over 30 days`),datum('Mint quote',round(d.mintRate,1),'sVVV per DIEM')].join('')}</div>${creditNote}${ux}${curveMarkup(s.rules?.values?.curve,d.supply,d.target)}`;
}

function renderTreasury(s) {
  const t = s.treasury || {}, supply=s.supply || {};
  const holding = [t.vvv,t.svvv,t.cooldown].every(Number.isFinite) ? t.vvv+t.svvv+t.cooldown : null;
  $('treasury-panel').innerHTML=`<div class="subhead"><h3>Control Safe holdings</h3><span class="fine">${address(t.address)}</span></div><div class="subgrid">${[
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
  const changesTable = changes.length ? table(['UTC day','Rule','Previous','New','Evidence'],changes.map(c => [escape(c.date),escape(names[c.id] || c.label || c.id),shortChange(c.from),shortChange(c.to),txLink(c.tx,'View ↗')])) : empty('No rule changes appear in the observed history.');
  const policies=[...(r.policy||[])].sort((a,b)=>b.date.localeCompare(a.date));
  const policy=policies.length?`<ul class="event-list">${policies.map(p=>`<li><time>${date(p.date)}</time><span>${escape(p.label)} ${p.tx ? txLink(p.tx,'View ↗') : ''}</span></li>`).join('')}</ul>`:'';
  const secondsToDays = n => Number.isFinite(n) ? `${round(n/86400,2)} days` : BLANK;
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
