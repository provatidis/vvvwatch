// Section markup shared by the static build and the browser, so readers without JavaScript see the same data.
import { buybackRecap } from './buyback-recap.js';
import { burnValueUsd } from './burn-value.js';
import { burnChangeDetail } from './burn-cover.js';
import { RULES, SALES } from './config.js';
import { diemTradeoff, holderSummary } from './holders.js';
import { DAY, BLANK, round, compact, pct, money, moneyShort, signed, divide, escape, date, blockLink, utcMidnight, completeDays } from './format.js';
export const multiple = (value, digits = 2) => Number.isFinite(value) ? `${value.toFixed(digits)}×` : BLANK;
export const stamp = iso => iso ? `Through ${date(iso)} UTC` : 'Source date unavailable';
export const stale = source => source?.ok === false ? ' · last good reading' : '';
export const address = value => /^0x[0-9a-f]{40}$/i.test(value) ? `<a class="address" href="https://basescan.org/address/${value}" title="${value}">${value.slice(0,6)}…${value.slice(-4)}</a>` : BLANK;
export const txLink = (tx, label = 'Transaction ↗') => /^0x[0-9a-f]{64}$/i.test(tx) ? `<a class="evidence-link" href="https://basescan.org/tx/${tx}">${escape(label)}</a>` : BLANK;
export const datum = (label, amount, note = '') => `<div class="datum"><span class="datum-label">${escape(label)}</span><strong>${escape(amount)}</strong>${note ? `<span class="datum-note">${escape(note)}</span>` : ''}</div>`;
export const table = (headers, rows) => `<div class="table-wrap large-table"><table class="data-table"><thead><tr>${headers.map(h => `<th scope="col">${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
export const details = (label, content) => `<details><summary>${escape(label)}</summary>${content}</details>`;
export const empty = text => `<p class="empty">${escape(text)}</p>`;
export const list = rows => `<dl class="summary-list">${rows.map(([k,v,cls]) => `<div${cls ? ` class="${cls}"` : ''}><dt>${escape(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
export function sourceLink(url, label) {
  try {
    const address = new URL(url);
    if (address.protocol === 'https:') return `<a href="${escape(address.href)}">${escape(label)}</a>`;
  } catch { /* Older snapshots may lack a source URL. */ }
  return escape(label);
}

function vestingHistory(s) {
  const history = s.vesting.history;
  const rows = [];
  for (const days of [30, 90]) {
    const stream = history?.windows?.[days];
    const supply = s.supply?.windows?.[days];
    if (!stream || !supply || !['start','end','startBlock','endBlock'].every(k => stream[k] === supply[k]) ||
        ![stream.unlocked,stream.withdrawn,supply.minted,supply.burned].every(Number.isFinite)) continue;
    rows.push([`${days} days`, round(stream.unlocked), round(stream.withdrawn), pct(divide(supply.burned, supply.minted + stream.unlocked))]);
  }
  if (!rows.length) return empty('Historical stream balances are unavailable for these supply windows.');
  return `<h4>Verified stream activity</h4><p class="fine">${round(history.streamCount)} indexed VVV streams through ${date(history.asOf)} UTC · Base block ${blockLink(s.evidence?.endBlock)}</p>
${table(['Window','Newly vested VVV','Withdrawn VVV','Burns ÷ (minted + vested)'],rows)}
<p class="fine">A withdrawal can include VVV that vested earlier. The percentage compares burns with new minting and newly vested VVV over the same dates.</p>`;
}

function vestingPanel(s) {
  const v = s.vesting;
  const title = '<h3>Vesting and unlocks</h3>';
  const source = '<a href="https://venicestats.com/vesting">VeniceStats vesting schedule</a>';
  if (!v || !Number.isFinite(Date.parse(v.asOf))) {
    return `<article class="panel wide" id="vesting">${title}<p class="fine">Vesting data is unavailable for this snapshot. See the ${source}.</p></article>`;
  }
  const rate = v.dailyDripRate;
  const annualIssuance = s.rules?.values?.emissionRatePerYear;
  const observationDay = utcMidnight(v.asOf.slice(0,10));
  const rulesDay = utcMidnight(s.rules?.asOf);
  const samePeriod = Math.abs(observationDay - rulesDay) <= DAY && s.sources?.protocol?.ok !== false;
  const dailyIssuance = samePeriod && Number.isFinite(annualIssuance) && annualIssuance >= 0 ? annualIssuance / 365 : null;
  const share = Number.isFinite(rate) && dailyIssuance !== null ? divide(rate, rate + dailyIssuance) : null;
  const cliff = v.dripCliff;
  const month = cliff?.date && new Date(cliff.date);
  const asOfMonth = v.asOf.slice(0,7);
  const futureStep = Number.isFinite(month?.getTime()) && cliff.date.slice(0,7) >= asOfMonth;
  const grossChange = Number.isFinite(share) && Number.isFinite(cliff?.dropPct)
    ? ` If issuance holds steady, the combined flow from minting and unlocks would fall about ${pct(share * cliff.dropPct / 100,0)}.` : '';
  const schedule = futureStep && Number.isInteger(cliff.streamCount) && Number.isFinite(cliff.dropPct)
    ? `<p class="holders-lead">${round(cliff.streamCount)} streams are scheduled to end in ${month.toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'})}. VeniceStats estimates the daily unlock rate will fall by about ${round(cliff.dropPct)}%.${grossChange}</p>` : '';
  return `<article class="panel wide" id="vesting"><div class="subhead">${title}<span class="fine">VeniceStats · ${date(v.asOf)} UTC${v.cached ? ' · last good reading' : ''}</span></div>
<p class="fine">Vesting makes previously issued VVV available to recipients. They can withdraw, hold, stake or sell it. An unlock leaves your share of effective supply unchanged.</p>
<div class="subgrid">${[
    datum('Scheduled unlock rate', round(rate), 'VVV per day'),
    datum('30 days at this rate', Number.isFinite(rate) ? round(rate * 30) : BLANK, 'VVV if the daily rate holds'),
    ...(share !== null ? [datum('Unlocks as share of gross inflow', pct(share), `At ${round(dailyIssuance)} VVV of scheduled issuance per day`)] : []),
    datum('Withdrawn to date', round(v.totalWithdrawn), 'VVV claimed from tracked streams')
  ].join('')}</div>${schedule}
${vestingHistory(s)}
<p class="fine">${source} · <a href="https://venicestats.com/api/vesting">Source data</a></p></article>`;
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

export function ledgerFragments(s, d = 30) {
  const win = s.supply?.windows?.[d];
  const drivers = d === 30 ? burnChangeDetail(win) : '';
  const info = win ? `${date(win.start,false)} – ${date(win.end)} UTC` : 'Awaiting a complete window';
  const summary = `<h3>${d}-day reconciliation</h3><p class="fine">${escape(info)}</p>${list([
    ['Minted', `${round(win?.minted)} VVV`], ['Retired', `${round(win?.burned)} VVV`], ['Net supply change', `${signed(win?.net)} VVV`,'total'], ['Burn cover', pct(win?.ratio)], ['Annualized net change', signed(win?.annualized,pct)]
  ])}${drivers ? `<p class="fine attribution-note">${escape(drivers)}</p>` : ''}${attribution(win)}`;
  let mint = 0, burn = 0;
  const daily = completeDays(s.supply?.history,s.lastDay,d);
  const valid = daily.length && daily.every(r => Number.isFinite(r.minted) && Number.isFinite(r.burned));
  const running = valid ? [{date:null,minted:0,burned:0}, ...daily.map(r => { mint+=r.minted; burn+=r.burned; return {date:r.date,minted:mint,burned:burn}; })] : [];
  const plot = valid ? lineChart(running,[{key:'minted',style:'mint'},{key:'burned',style:'burn'}], date(daily[0].date,false),date(s.lastDay,false),'Cumulative VVV minted and retired over the selected window') : empty('A complete daily series is required to plot this window.');
  const trend = `<h3>Issuance against burns</h3><p class="fine">Cumulative VVV over ${d} completed days</p><div class="legend"><span><i class="sw-mint"></i>Minted</span><span><i class="sw-burn"></i>Retired</span></div>${plot}${valid ? details('Show daily amounts', table(['UTC day','Minted VVV','Retired VVV','Net VVV'],[...daily].reverse().map(r => [date(r.date),round(r.minted,2),round(r.burned,2),signed(r.minted-r.burned,v => round(v,2))]))) : ''}`;
  const ev = s.evidence || {}, start = d === 30 ? ev.startBlock30 : ev.startBlock90;
  const source = `Measured from changes in total VVV issued and the balances of the zero and dead addresses.${s.supply?.history?.[0]?.date ? ` The opening balance for this backfill is dated ${date(s.supply.history[0].date)} UTC.` : ''}${start && ev.endBlock ? ` Base blocks ${blockLink(start)} to ${blockLink(ev.endBlock)}.` : ''}`;
  return {'ledger-summary': summary, 'ledger-trend': trend, 'ledger-source': source};
}

export function buybackPanel(s) {
  const b = s.buybacks, cycles = [...(b?.cycles || [])].sort((a,c) => c.date.localeCompare(a.date) || c.block - a.block);
  if (!cycles.length) return empty('Monthly Safe inventory is unavailable in this snapshot.');
  const c = cycles[0], prev = cycles[1];
  const value = burnValueUsd(c) !== null ? c.valuation : null;
  const recap = buybackRecap(c, prev);
  const comparison = recap ? `<h4>What changed since the previous burn?</h4><p class="buyback-comparison">${escape(recap)}</p>` : '';
  const valuationSource = value ? `<p class="fine">The estimate prices retired VVV at ${money(value.priceUsd,2)} per token at Base block ${blockLink(value.block)}. It combines the <a href="https://basescan.org/address/${escape(value.pool)}">Aerodrome VVV/WETH price</a> and <a href="https://basescan.org/address/${escape(value.oracle)}">Chainlink ETH/USD price</a>.</p>` : '<p class="fine">A burn-time market price is unavailable for this cycle.</p>';
  const rows = cycles.map(cycle => [date(cycle.date),round(cycle.openingVvv,1),round(cycle.boughtVvv,1),signed(cycle.otherVvv,v=>round(v,1)),round(cycle.burnedVvv,1),money(burnValueUsd(cycle)),round(cycle.closingVvv,1),money(cycle.spentUsdc),cycle.verified ? 'Verified' : 'Partial',txLink(cycle.tx,'View ↗')]);
  return `<div class="subhead"><h3>Latest burn · ${date(c.date)}</h3><span class="fine">${escape(stamp(s.sources?.buybacks?.asOf || b.asOf)+stale(s.sources?.buybacks))}</span></div><div class="subgrid">${[
    datum('Estimated burn value',moneyShort(value?.usd),'USD at the burn block'), datum('VVV retired',round(c.burnedVvv),'Permanently removed'), datum('Spent during cycle',moneyShort(c.spentUsdc),c.verified ? 'USDC paid for VVV' : 'Attributed USDC purchases'), datum('Closing inventory',round(c.closingVvv),'VVV left in the Safe')
  ].join('')}</div>${comparison}${valuationSource}<p class="fine">${Number.isFinite(c.openingVvv) && Number.isFinite(c.boughtVvv) ? (recap ? `The Safe bought ${round(c.boughtVvv)} VVV during this cycle.` : `The Safe carried ${round(c.openingVvv)} VVV into this cycle and bought ${round(c.boughtVvv)} VVV.`) : 'Earlier Safe balances are unavailable for this cycle.'} ${txLink(c.tx,'Burn transaction ↗')}</p>${details('Show cycle ledger',table(['Burn date','Opening VVV','Bought VVV','Other net VVV','Burned VVV','Est. burn value','Closing VVV','USDC spent','Spending evidence','Evidence'],rows))}`;
}

function referencePurchases(reference, verified) {
  if (!reference?.asOf || !reference.days?.length) return '';
  const dates = verified.length ? [reference.asOf, verified.at(-1).date].sort() : [reference.asOf];
  const end = dates[0];
  const local = completeDays(verified,end,30);
  const external = completeDays(reference.days,end,30);
  const sum = rows => rows.length === 30 && rows.every(row => Number.isFinite(row.estimatedUsd))
    ? rows.reduce((total,row) => total + row.estimatedUsd,0) : null;
  const localTotal = sum(local), externalTotal = sum(external);
  const header = '<h4>Purchases over the same 30 days</h4>';
  const source = '<a href="https://venicestats.com/burns">VeniceStats burn data</a>';
  const datesNote = external.length ? `${date(external[0].date)} – ${date(end)} UTC.` : `Through ${date(end)} UTC.`;
  const body = `${header}<p class="fine">${datesNote} VVV watch matches burn payments to retirements on Base. The VeniceStats comparison applies the same list prices to its event counts. Both estimates use public burn activity.</p>`;
  const values = localTotal !== null && externalTotal !== null ? list([
    ['VVV watch',money(localTotal)],['VeniceStats',money(externalTotal)],['VVV watch minus VeniceStats', signed(localTotal-externalTotal,money)]
  ]) : empty('A comparison needs 30 complete days from both sources.') + (externalTotal !== null ? list([['VeniceStats estimate',money(externalTotal)]]) : '');
  const last = reference.days.find(row => row.date === reference.asOf);
  const daily = last ? details('VeniceStats events on ' + date(last.date), list([
    ['Estimated purchases',money(last.estimatedUsd)], ...Object.values(SALES.products).map(p => [p.label,round(last[p.id])])
  ])) : '';
  const content = body + values + daily + `<p class="fine">${source} · reference history from ${date(reference.days[0].date)} UTC</p>`;
  return verified.length ? details('Compare with VeniceStats',content) : content;
}

export function salesPanel(s) {
  const sales = s.sales, recent = [...(sales?.days || [])].sort((a,b) => a.date.localeCompare(b.date));
  const reference = referencePurchases(sales?.reference,recent);
  if (!sales || !recent.length) return empty('No verified purchase observations are available in this snapshot.') + reference;
  const w = sales.window30, latest = recent.at(-1), used = completeDays(recent,latest.date,30);
  const rows = recent.slice().reverse().map(day => [date(day.date),round(day.pro),round(day.proplus),round(day.max),round(day.credits),round(typeof day.unknown === 'object' ? day.unknown?.count : day.unknown),money(day.estimatedUsd),money(day.burnUsdc)]);
  const productRows = used.length ? Object.values(SALES.products).map(p => {
    const count = used.every(r=>Number.isFinite(r[p.id])) ? used.reduce((v,r)=>v+r[p.id],0) : null;
    return [escape(p.label),round(count),money(p.price),money(Number.isFinite(count)?count*p.price:null)];
  }) : [];
  const claim = sales.claim;
  const reported = claim?.date && claim?.url && claim?.label ? `<p class="fine company-claim"><strong>Reported company figure · ${date(claim.date)}</strong> ${escape(claim.label)} ${sourceLink(claim.url,'Source')}</p>` : '';
  const share = Number.isFinite(w?.programmaticBurnShare) ? `<h4>Burns relative to estimated purchase value</h4><div class="subgrid burn-shares">${datum('Purchase-linked burn budget',pct(w.programmaticBurnShare),moneyShort(w.burnUsdc) + ' allocated over 30 days')}${Number.isFinite(w.totalBurnShare) ? datum('Including monthly burns',pct(w.totalBurnShare),'Adds the market value of monthly burns in the same 30 days') : datum('Including monthly burns',BLANK,'Awaiting burn valuations for the full period')}</div>` : '';
  return `<div class="subhead"><h3>Estimated purchases · 30 days</h3><span class="fine">${escape(stamp(s.sources?.sales?.asOf || sales.asOf)+stale(s.sources?.sales))}</span></div><div class="subgrid">${[
    datum('Estimated purchases',moneyShort(w?.estimatedUsd),'Matched purchases at list prices'), datum('Annualized pace',moneyShort(w?.annualizedUsd),'30-day estimate × 365 / 30'), datum('Versus prior 30 days',signed(w?.change,pct),'Comparable completed windows')
  ].join('')}</div>${reported}<p class="fine">The onchain purchase backfill starts ${date(recent[0].date)} UTC. The estimate applies list prices to matched purchases. Renewals, discounts, annual billing and transactions outside the burn program limit how closely it tracks company revenue.</p>${share}${productRows.length ? details('Show product mix',table(['Product','Events over 30d','List price','Estimated purchases'],productRows)) : ''}${details('Show daily purchase counts',table(['UTC day','Pro','Pro+','Max','Credit packs','Unknown','Estimated purchases','Burn USDC'],rows))}${reference}`;
}

// Snapshot conversion can put a contract boundary a few decimal places off its integer target.
const sameSupply = (a,b) => Math.abs(a-b) <= Math.max(1,Math.abs(a),Math.abs(b))*1e-12;
export function curveAtTarget(curve, target) {
  const points = (Array.isArray(curve) ? curve : []).filter(p => Number.isFinite(p?.supply) && p.supply > 0 && Number.isFinite(p.rate) && p.rate > 0)
    .sort((a,b) => a.supply-b.supply);
  if (!(Number.isFinite(target) && target > 0)) return {points};
  // The bracket's upper bound includes the last DIEM minted to reach it.
  const toTarget = points.find(p => p.supply > target || sameSupply(p.supply,target));
  const afterTarget = points.find(p => p.supply > target && !sameSupply(p.supply,target));
  return {points, toTarget, afterTarget};
}

function curveMarkup(curve, supply, target, currentRate) {
  const {points, toTarget, afterTarget} = curveAtTarget(curve,target);
  if (points.length < 2) return '';
  const precision = n => n >= 1e9 ? n.toExponential(3).replace('+','') : round(n,2);
  const tableOfRates = details('Show full mint schedule',table(['Supply upper bound (DIEM)','sVVV per DIEM'],points.map(p=>[round(p.supply,2),precision(p.rate)])));
  const end = points.at(-1).supply;
  if (!(Number.isFinite(supply) && supply >= 0 && supply <= end && Number.isFinite(target) && target > 0 && target <= end)) return tableOfRates;

  const current = Number.isFinite(currentRate) ? currentRate : points.find(p => p.supply > supply && !sameSupply(p.supply,supply))?.rate;
  if (!toTarget || !Number.isFinite(current)) return tableOfRates;

  const spacing = 5000;
  const low = Math.max(0,Math.floor((Math.min(supply,target)-spacing)/spacing)*spacing);
  const high = Math.min(end,Math.ceil((Math.max(supply,target)+spacing)/spacing)*spacing);
  const steps = [];
  for (let i=0;i<points.length;i++) {
    const start = Math.max(low,i ? points[i-1].supply : 0);
    const stop = Math.min(high,points[i].supply);
    if (stop > start && !sameSupply(start,stop)) steps.push({start,stop,rate:points[i].rate});
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

export function diemPanel(s) {
  const d = s.diem, u = d?.utilization;
  if (!d) return empty('DIEM contract data is unavailable.');
  const ux = u ? `<h4>Inference credit use</h4><p class="fine">Across ${round(u.days)} completed days through ${date(u.date)}, users consumed ${money(u.consumedPerDay)} of ${money(u.depositedPerDay)} in eligible daily credit on average (${pct(u.ratio)}). <a href="https://venicestats.com/diem">VeniceStats usage data ↗</a></p>` : '<p class="fine">Inference usage is unavailable in this snapshot.</p>';
  const creditNote = Number.isFinite(d.annualCreditRatio) ? `<p class="fine">Using the full $1 daily allocation would deliver a year of API credit worth ${pct(d.annualCreditRatio)} of the recorded DIEM price. Unused daily credit expires.</p>` : '';
  return `<div class="subhead"><h3>Compute credit capacity</h3><span class="fine">${escape(stamp(s.lastDay)+stale(s.sources?.protocol))}</span></div><div class="subgrid">${[
    datum('DIEM issued',compact(d.supply),`Policy target ${round(d.target)} DIEM`), datum('Deposited for credits',compact(d.deposited),`${pct(divide(d.deposited,d.supply))} of issued DIEM`), datum('Locked sVVV',compact(d.locked),`${signed(d.change30,pct)} over 30 days`),datum('Mint quote',round(d.mintRate,1),'sVVV per DIEM')].join('')}</div>${creditNote}${ux}${curveMarkup(s.rules?.values?.curve,d.supply,d.target,d.mintRate)}`;
}

export function treasuryPanel(s) {
  const t = s.treasury || {}, supply=s.supply || {};
  const holding = [t.vvv,t.svvv,t.cooldown].every(Number.isFinite) ? t.vvv+t.svvv+t.cooldown : null;
  const wallets = t.wallets || [];
  const grouped = wallets.length ? `<div class="subhead"><h3>Tracked Safe holdings</h3><span class="fine">${escape(stamp(t.walletsAsOf)+stale(s.sources?.wallets))}${t.walletsBlock ? ' · '+blockLink(t.walletsBlock) : ''}</span></div><div class="subgrid">${datum('VVV in tracked Safes',compact(t.trackedSafeTotal),'Liquid, staked and in cooldown')}${datum('30-day change',signed(t.trackedSafeChange30,pct),'After direct emissions')}</div><p class="fine">The check combines Safes whose signer sets match the control Safe at both ends of the 30-day window. Wallet role names come from the <a href="https://venicestats.com/treasury">VeniceStats directory</a>. Transfers between the included Safes leave their combined balance unchanged.</p>${details('Show wallets and ownership evidence',table(['Wallet','Attribution','Holdings check','VVV','sVVV','In cooldown','30-day change (VVV)','DIEM'],wallets.map(w=>[`${escape(w.label)}<br>${address(w.address)}`,`${escape(w.attribution ?? w.role ?? '')} ${w.sourceUrl ? sourceLink(w.sourceUrl,'Evidence') : ''}`,w.inGrade ? 'Included' : 'Context only',round(w.vvv),round(w.svvv),round(w.cooldown),signed(w.change30),round(w.diem,1)])))}<hr class="divider">` : '';
  return `${grouped}<div class="subhead"><h3>Control Safe holdings</h3><span class="fine">${address(t.address)}</span></div><div class="subgrid">${[
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

export function rulesPanel(s) {
  const r=s.rules,v=r?.values || {};
  if (!r) return empty('Rules and administrative controls are unavailable for this snapshot.');
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
  return `<div class="subhead"><h3>Current settings</h3><span class="fine">${escape(stamp(r.asOf)+stale(s.sources?.protocol))}${r.block?` · ${blockLink(r.block)}`:''}</span></div><div class="subgrid">${[
    datum('Control Safe',safe(v.controlSafe),'Signatures required'),datum('Buyback Safe',safe(v.buybackSafe),'Signatures required'),datum('Annual issuance rate',compact(v.emissionRatePerYear),'VVV per year'),datum('Locked-stake share',pct(v.venicePctLocked),'Paid to Venice')].join('')}</div>${details('Show contract parameters',list(parameters))}${details(`Onchain changes (${changes.length})`,changesTable)}${policy?details('Dated policy events',policy):''}`;
}

export const priceTime = iso => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? `${d.toLocaleDateString('en-GB',{timeZone:'UTC',day:'numeric',month:'short'})} ${d.toLocaleTimeString('en-GB',{timeZone:'UTC',hour:'2-digit',minute:'2-digit'})} UTC` : BLANK;
};
export const years = n => `${round(n,1)} ${n === 1 ? 'year' : 'years'}`;
function dilutionNote(h) {
  const g = h.g;
  const supply = g === 0 ? 'Effective supply held steady over the last 30 days.' :
    `Effective supply ${g > 0 ? 'grew' : 'shrank'} at a ${pct(Math.abs(g),2)} annualized pace over the last 30 days.`;
  if (!Number.isFinite(h.share.staked) || !Number.isFinite(h.share.unstaked)) {
    return supply + ' A yearly share comparison is unavailable at this pace.';
  }
  const change = rate => rate === 0 ? 'would hold its share' :
    `would ${rate > 0 ? 'gain' : 'lose'} ${pct(Math.abs(rate),1)} in share`;
  return `${supply} At that pace, staked VVV ${change(h.share.staked)} over a year. Unstaked VVV ${change(h.share.unstaked)}.`;
}

export function holderPanels(s, calc = '') {
  const h = holderSummary(s);
  const y = h.yields, v = h.value, w30 = s.supply?.windows?.['30'];
  const priceNote = h.pVVV ? `at $${round(h.pVVV,2)} (CoinGecko, ${priceTime(s.prices.vvv.asOf)})` : 'VVV price unavailable';
  const windowNotes = w30?.end && w30.end === v.salesEnd ? [stamp(w30.end)] : [
    w30?.end ? `Supply through ${date(w30.end)} UTC` : 'Supply window unavailable',
    v.salesEnd ? `Sales through ${date(v.salesEnd)} UTC` : 'Sales window unavailable'
  ];
  if (w30?.end && s.sources?.protocol?.ok === false) windowNotes.push('last good supply reading');
  if (v.salesEnd && s.sources?.sales?.ok === false) windowNotes.push('last good sales reading');
  const staking = y && Number.isFinite(h.g) ? `<article class="panel"><div class="subhead"><h3>Staking against dilution</h3><span class="fine">${escape(stamp(w30?.end || s.lastDay))}</span></div>
<p class="fine">Staked VVV, held as sVVV, earns newly issued VVV. Your share here is measured against all VVV outside burn addresses, including tokens still vesting.</p>
<div class="subgrid">${[
    datum('Staked VVV', pct(y.aprU,2), `A year, paid in VVV · ${Number.isFinite(h.cooldownDays) ? `${round(h.cooldownDays,1)}-day unstake` : 'unstake cooldown'}`),
    datum('Staked and locked for DIEM', pct(y.aprL,2), Number.isFinite(h.lockedKeeps) ? `A year · ${pct(h.lockedKeeps,0)} of the staking rate` : 'A year'),
    datum('Not staked', signed(h.share.unstaked, x => pct(x,1)), 'Yearly change in your share of effective supply at the last 30 days’ pace')].join('')}</div>
<p class="holders-lead">${escape(dilutionNote(h))}</p>
<p class="fine">Simple yearly rates at today’s emission rate and staked supply. More staking spreads the same emissions thinner.</p></article>`
    : `<article class="panel"><h3>Staking against dilution</h3>${empty('Pending: staking settings or a complete 30-day window are missing.')}</article>`;
  const worth = `<article class="panel"><div class="subhead"><h3>What holders get</h3><span class="fine">${escape(windowNotes.join(' · '))}</span></div>
<p class="fine">VVV has no claim on Venice’s revenue. Holders get burns, paid from sales and a monthly buyback. <a href="https://venice.ai/faqs/all#faq-vvv-pro-features">Staking at least 100 VVV currently unlocks Venice Pro</a>. Venice may end staking rewards on those 100 VVV with at least 15 days’ notice.</p>
<div class="subgrid">${[
    datum('Burned a year', pct(v.burnRate,2), 'Share of effective supply at the 30-day pace'),
    datum('Minted a year', pct(v.emitRate,2), 'Share of effective supply at the 30-day pace'),
    datum('Burns as share of estimated purchases', pct(v.salesShare,1), 'Purchase-linked and monthly burns')].join('')}</div>
<h4>Token value ÷ annualized estimated purchases</h4><div class="subgrid">${[
    datum('Reported circulating supply', multiple(v.circulatingMultiple,1), v.circulating ? `${compact(v.circulating)} VVV · Venice, ${priceTime(s.supply.circulating.observedAt)}` : 'Current Venice reading unavailable'),
    datum('Effective supply', multiple(v.psAll,1), `${compact(s.supply?.effective)} VVV outside burn addresses`)
  ].join('')}</div>
<p class="fine">The denominator is <a href="#sales">estimated purchases at the last 30 days’ pace</a>. ${h.pVVV ? `VVV was ${money(h.pVVV,2)} at ${priceTime(s.prices.vvv.asOf)} (CoinGecko).` : 'The latest VVV price is unavailable.'} ${Number.isFinite(v.psExVenice) ? `Excluding Venice’s tracked Safes gives ${multiple(v.psExVenice,1)} on the effective-supply basis. ` : ''}<a href="https://api.venice.ai/api/v1/vvv/circulatingsupply">Venice circulating supply</a></p></article>`;
  const diem = `<article class="panel wide"><div class="subhead"><h3>Mint DIEM: use the credits or sell the DIEM</h3><span class="fine">${escape(priceNote)}</span></div>
<p class="fine">Locking sVVV mints DIEM and reduces the staking rewards on that collateral. Each staked DIEM provides up to $1 of Venice credit per day.</p>
<form class="calc" id="diem-calc" novalidate>
<label for="calc-n">DIEM to mint<input id="calc-n" type="number" inputmode="numeric" min="1" max="500" step="1" value="1" required data-error="Enter a whole number from 1 to 500 for DIEM to mint."></label>
<label for="calc-use">Credit used per day, per DIEM <output id="calc-use-out" for="calc-use">$1.00</output><input id="calc-use" type="range" min="0" max="1" step="0.05" value="1"></label>
<label for="calc-years">Years held<input id="calc-years" type="number" inputmode="decimal" min="0.5" max="5" step="0.5" value="1" required data-error="Enter 0.5 to 5 years in half-year steps."></label>
<label for="calc-mode">Wallet position<select id="calc-mode"><option value="first">First mint in this wallet</option><option value="existing">Existing mint position</option></select></label>
<fieldset class="calc-position" id="calc-position" disabled hidden><legend>Wallet position before this mint</legend>
<label for="calc-debt">Outstanding DIEM from previous mints<input id="calc-debt" type="number" inputmode="decimal" min="0" step="any" required data-error="Enter the positive amount of DIEM still outstanding from this wallet’s previous mints."></label>
<label for="calc-locked">sVVV still locked for those mints<input id="calc-locked" type="number" inputmode="decimal" min="0" step="any" required data-error="Enter the positive amount of sVVV still locked for those mints."></label>
</fieldset>
</form>
<p id="calc-errors" class="calc-errors" role="status"></p>
<div id="calc-out" aria-live="polite">${calc}</div></article>`;
  return {h, 'holders-panel': staking + worth + vestingPanel(s) + diem, 'holders-source': 'Venice’s control Safe sets the emission rate, the share on locked stake and the DIEM curve, and has changed them without a vote. Every change is listed under <a href="#rules">Rules and control</a>.'};
}

export function calcResult(s, h, {n, use, duration, existing = false, priorDiem = 0, priorLocked = 0}) {
  const d = s.diem, y = h.yields, curve = s.rules?.values?.curve;
  if (!Number.isFinite(d?.supply) || !curve?.length) {
    return empty('DIEM supply or the mint curve is unavailable.');
  }
  const t = diemTradeoff({n, usePerDay: use, years: duration, supply: d.supply, curve,
    aprU: y?.aprU, aprL: y?.aprL, pVVV: h.pVVV, pDIEM: h.pDIEM, priorDiem, priorLocked});
  if (!t) {
    return empty(`Minting ${round(n)} DIEM would exceed the published curve.`);
  }
  const lost = Number.isFinite(t.forgoneVVV)
    ? `This mint forgoes an estimated ${round(t.forgoneVVV,2)} VVV in staking rewards over ${years(duration)}${t.forgoneUsd !== null ? ` (${money(t.forgoneUsd)})` : ''}.`
    : 'The staking rates needed to estimate forgone rewards are unavailable.';
  let redemption = `With no other mints or burns, buying back and burning ${round(n)} DIEM would release the full ${round(t.svvv,1)} sVVV locked by this first mint.`;
  if (existing) {
    const difference = t.svvv - t.unlocked;
    redemption = `With no other mints or burns, buying back and burning ${round(n)} DIEM would release ${round(t.unlocked,1)} sVVV at your wallet’s pooled rate, leaving ${round(t.remainingLocked,1)} sVVV against your earlier DIEM.`;
    if (difference >= 0.05) redemption += ` Of the ${round(t.svvv,1)} sVVV this mint locks, ${round(difference,1)} would stay locked until you burn more of your earlier DIEM.`;
    if (difference <= -0.05) redemption += ` That includes ${round(-difference,1)} sVVV from your earlier collateral.`;
  }
  const {points, toTarget, afterTarget} = curveAtTarget(curve,d.target);
  const risesFurther = afterTarget && points.some(p => p.supply > afterTarget.supply && p.rate > afterTarget.rate);
  const mintRisk = toTarget && afterTarget && afterTarget.rate > toTarget.rate
    ? `The mint rate rises from ${round(toTarget.rate)} to ${round(afterTarget.rate)} sVVV per DIEM as supply passes Venice’s ${round(d.target)} DIEM target. ${risesFurther ? 'Higher rates follow. ' : ''}Current supply is ${round(d.supply)} DIEM. `
    : '';
  const step = t.crossesStep ? ` The mint crosses a curve step, so the average rate is above today’s ${round(t.rateNow,1)}.` : '';
  const util = s.diem?.utilization;
  const usage = Number.isFinite(util?.ratio) ? ` Across all staked DIEM, holders used ${pct(util.ratio)} of their daily credit over the last ${round(util.days)} days (<a href="https://venicestats.com/diem">VeniceStats</a>).` : '';
  const breakEven = t.gap > 0 && Number.isFinite(t.breakEvenUse) ? ` Using about ${money(t.breakEvenUse,2)} a day per DIEM covers the lost rewards.` : '';
  const ceiling = Number.isFinite(t.buybackTotal)
    ? (t.buybackTotal > 0
      ? `After ${years(duration)} of forgone rewards, the sale leaves ${money(t.buybackTotal)} to buy back ${round(n)} DIEM${n > 1 ? ` (${money(t.buybackEach)} each)` : ''}, before fees and price impact.`
      : `At this spot price, forgone rewards over ${years(duration)} consume the sale value, even before fees and price impact.`)
    : 'The buyback estimate needs both spot prices and verified staking rates.';
  return `<p class="holders-lead">Locks ${round(t.svvv,1)} sVVV${t.lockedUsd !== null ? ` (${money(t.lockedUsd)})` : ''}, ${round(t.rateAvg,1)} sVVV per DIEM. ${escape(lost)}${escape(step)}</p>
<div class="calc-columns">
<div class="calc-option"><h4>Use the credits</h4><strong class="calc-figure">${money(t.creditsUsd)}</strong><span class="datum-note">of credit used over ${years(duration)}</span>
<p>After lost rewards: <b>${t.creditsNet !== null ? signed(t.creditsNet, x => money(x)) : BLANK}</b></p>
<p class="fine">Credit runs out each day if unused.${usage}${breakEven}</p></div>
<div class="calc-option"><h4>Sell the DIEM</h4><strong class="calc-figure">${money(t.saleUsd)}</strong><span class="datum-note">Indicative spot value before fees and price impact${h.pDIEM ? ` · ${money(h.pDIEM,2)} per DIEM (${priceTime(s.prices.diem.asOf)})` : ''}</span>
<p>${escape(ceiling)}</p>
<p class="fine calc-redemption">${escape(redemption)}</p>
<p class="fine">${escape(mintRisk)}Buying DIEM back on the market could cost more than you received from selling it.</p></div>
</div>
<p class="fine">${Number.isFinite(t.parity) ? `DIEM trades at ${pct(t.parity)} of the sVVV locked to mint it. ` : ''}To burn staked DIEM, first complete its unstaking cooldown of ${Number.isFinite(s.rules?.values?.diemCooldown) ? `${round(s.rules.values.diemCooldown/86400,1)} ${s.rules.values.diemCooldown === 86400 ? 'day' : 'days'}` : 'a cooldown'}.</p>`;
}

export const CALC_DEFAULTS = Object.freeze({n: 1, use: 1, duration: 1, existing: false, priorDiem: 0, priorLocked: 0});

export function sectionFragments(s, ledgerDays = 30) {
  const {h} = holderPanels(s);
  const {h: _, ...panels} = holderPanels(s, calcResult(s, h, CALC_DEFAULTS));
  return {...panels, ...ledgerFragments(s, ledgerDays), 'buyback-panel': buybackPanel(s), 'sales-panel': salesPanel(s),
    'diem-panel': diemPanel(s), 'treasury-panel': treasuryPanel(s), 'rules-panel': rulesPanel(s)};
}
