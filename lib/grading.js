// Published grading rules, written from the same THRESHOLDS that lib/metrics.js grades against.
import { THRESHOLDS } from './config.js';
import { escape } from './format.js';

const p = value => `${+(Math.abs(value) * 100).toFixed(1)}%`;

// grade() in lib/metrics.js: higher is better unless lowerIsBetter; each bound belongs to the better grade.
function atLeast({good, watch}) {
  return [`${p(good)} or more`, `${p(watch)} to under ${p(good)}`, `Under ${p(watch)}`];
}
function fallNoMoreThan({good, watch}) {
  return [`Up, or down ${p(good)} or less`, `Down more than ${p(good)}, up to ${p(watch)}`, `Down more than ${p(watch)}`];
}
function atMost({good, watch}) {
  return [`${p(good)} or less`, `More than ${p(good)}, up to ${p(watch)}`, `More than ${p(watch)}`];
}

export function gradingRows(t = THRESHOLDS) {
  const m = t.monthlyBurn;
  const monthly = atLeast(m);
  return [
    ['Burn cover', 'VVV burned ÷ VVV minted over 90 days', ...atLeast(t.burnCover90d)],
    ['Signup and credit purchases', 'Estimated purchase value, last 30 days against the 30 before',
      ...fallNoMoreThan(t.paidUse30d).slice(0, 2), `${fallNoMoreThan(t.paidUse30d)[2]}, or no matched purchase burns on the latest day`],
    ['Monthly buyback', 'Latest burn’s dollar value against the previous burn’s, and days since the latest burn',
      `${monthly[0]} of the previous value, within ${m.goodDays} days`,
      `${monthly[1]}, or ${m.goodDays + 1}–${m.watchDays} days since the burn`,
      `${monthly[2]}, or more than ${m.watchDays} days since the burn`],
    ['Staking exits', 'VVV entering the unstake cooldown over 7 days ÷ staked VVV', ...atMost(t.exits7d)],
    ['DIEM collateral', 'Change in staked VVV locked for DIEM over 30 days', ...fallNoMoreThan(t.diemLock30d)],
    ['Tracked Safe holdings', 'Change in VVV across the tracked Safes over 30 days, after their direct emissions', ...fallNoMoreThan(t.veniceVvv30d)]
  ];
}

export function gradingTable(t = THRESHOLDS) {
  const rows = gradingRows(t).map(row => `<tr>${row.map((cell, i) => i ? `<td>${escape(cell)}</td>` : `<th scope="row">${escape(cell)}</th>`).join('')}</tr>`).join('');
  return `<details class="grading"><summary>How the checks are graded</summary>
<p class="fine">These lines are VVV watch’s own choices, not targets set by Venice. Burn cover is the main one: below ${p(t.burnCover90d.watch)}, burns cancel less than a quarter of new VVV, so supply keeps growing at more than three-quarters of the issuance rate. At ${p(t.burnCover90d.good)}, burns cancel all new VVV and supply stops growing.</p>
<div class="table-wrap grading-wrap"><table class="data-table grading-table"><thead><tr><th scope="col">Check</th><th scope="col">Measure</th><th scope="col">Healthy</th><th scope="col">Watch</th><th scope="col">Alert</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="fine">A check shows Stale when its source missed the latest day, and Pending when its inputs are incomplete. The thresholds live in <a href="https://github.com/provatidis/vvvwatch/blob/main/lib/config.js">lib/config.js</a>.</p></details>`;
}
