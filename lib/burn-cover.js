import { THRESHOLDS } from './config.js';
import { completeDays, DAY, round, signed, utcMidnight } from './format.js';

const valid = value => Number.isFinite(value) && value >= 0;
const tenths = new Intl.NumberFormat('en-US', {minimumFractionDigits: 1, maximumFractionDigits: 1});
const pct = ratio => tenths.format(100 * ratio) + '%';

function coverComparison(recent) {
  const current = recent?.ratio, prior = recent?.priorRatio;
  if (!valid(current)) return '30-day cover needs 30 complete days with positive total issuance.';
  const latest = 'Burns covered ' + pct(current) + ' of issuance in the last 30 days';
  if (!valid(prior)) return latest + '.';
  if (current === prior) return latest + ', unchanged from the preceding 30 days.';
  const direction = current > prior ? 'up' : 'down';
  if (pct(current) === pct(prior)) return latest + ', slightly ' + direction + ' from the preceding 30 days at the same displayed percentage.';
  return latest + ', ' + direction + ' from ' + pct(prior) + ' in the preceding 30 days.';
}

function adjacent(previous, recent) {
  const start = utcMidnight(recent?.start);
  return utcMidnight(previous?.end) === start - DAY && utcMidnight(previous?.start) === start - 30 * DAY &&
    utcMidnight(recent?.end) === start + 29 * DAY;
}

function previousTotals(recent, history) {
  if (adjacent(recent?.previous, recent)) return recent.previous;
  // Older snapshots have daily totals and the prior ratio, but no prior attribution.
  const start = utcMidnight(recent?.start);
  if (!Number.isFinite(start) || utcMidnight(recent.end) !== start + 29 * DAY) return null;
  const end = new Date(start - DAY).toISOString().slice(0,10);
  const days = completeDays(history, end, 30);
  if (!days.length || !days.every(day => valid(day.minted) && valid(day.burned))) return null;
  return {minted: days.reduce((n,d) => n + d.minted, 0), burned: days.reduce((n,d) => n + d.burned, 0)};
}

function movement(current, prior) {
  if (current === prior) return 'was unchanged';
  if (!prior) return 'rose from zero to ' + round(current) + ' VVV';
  const change = pct(Math.abs(current - prior) / prior);
  return (current > prior ? 'rose ' : 'fell ') + (change === '0.0%' ? 'by less than 0.1%' : change);
}

function trendDetail(recent, history) {
  const previous = previousTotals(recent, history);
  if (![recent?.ratio, recent?.burned, recent?.minted, previous?.burned, previous?.minted].every(valid)) {
    return valid(recent?.ratio) && !valid(recent.priorRatio) ? 'The preceding 30-day comparison is unavailable.' : '';
  }
  const net = recent.minted - recent.burned;
  const supply = net === 0 ? 'Effective supply was unchanged over those 30 days.' : 'Effective supply ' +
    (net > 0 ? 'grew' : 'fell') + ' by ' + round(Math.abs(net)) + ' VVV over those 30 days.';
  return 'The amount burned ' + movement(recent.burned, previous.burned) +
    ' and issuance ' + movement(recent.minted, previous.minted) + '. ' + supply;
}

const programs = ['burnSales', 'burnMonthly', 'burnOther'];
function reconciled(window) {
  const amounts = window?.burnAttribution;
  if (!valid(window?.burned) || !programs.every(key => valid(amounts?.[key]))) return false;
  const total = programs.reduce((sum, key) => sum + amounts[key], 0);
  return Math.abs(total - window.burned) <= 32 * Number.EPSILON * Math.max(1, window.burned);
}

export function burnChangeDetail(recent) {
  const previous = recent?.previous;
  if (!adjacent(previous, recent) || !reconciled(recent) || !reconciled(previous)) return '';
  const change = recent.burned - previous.burned;
  const deltas = programs.map(key => recent.burnAttribution[key] - previous.burnAttribution[key]);
  if (change === 0 && deltas.every(value => value === 0)) return 'Burns were unchanged across all three programs compared with the preceding 30 days.';
  if (change === 0 || deltas.some(delta => delta * change < 0)) {
    return 'Compared with the preceding 30 days, purchase-linked burns changed by ' + signed(deltas[0]) + ' VVV, monthly buyback burns by ' +
      signed(deltas[1]) + ' VVV and other burns by ' + signed(deltas[2]) + ' VVV.';
  }
  return 'Compared with the preceding 30 days, purchase-linked burns accounted for about ' + round(deltas[0] / change * 100) +
    '% of the ' + (change > 0 ? 'increase' : 'decrease') + ' in VVV burned and monthly buybacks accounted for about ' +
    round(deltas[1] / change * 100) + '%.';
}

function breakdownText(recent) {
  if (!valid(recent?.ratio)) return '';
  const amounts = recent.burnAttribution;
  if (!Number.isFinite(recent.minted) || recent.minted <= 0 || !valid(amounts?.burnSales) || !valid(amounts?.burnMonthly)) {
    return 'The 30-day split by burn program is unavailable.';
  }
  const monthlyPoints = tenths.format(100 * (amounts.burnMonthly / recent.minted));
  return 'Purchase-linked burns covered ' + pct(amounts.burnSales / recent.minted) +
    ' of issuance. Monthly buybacks added ' + monthlyPoints + ' percentage ' + (monthlyPoints === '1.0' ? 'point.' : 'points.');
}

export function burnCoverContext(windows, history) {
  const recent = windows?.[30], ratio = windows?.[90]?.ratio;
  const threshold = THRESHOLDS.burnCover90d.watch;
  const boundary = (100 * threshold).toLocaleString('en-US') + '% threshold';
  let level = '90-day cover needs 90 complete days with positive total issuance.';
  let thresholdNote = 'Awaiting a complete 90-day reading';
  if (valid(ratio)) {
    const position = ratio < threshold ? 'below' : ratio > threshold ? 'above' : 'at';
    const relation = (ratio !== threshold && pct(ratio) === pct(threshold) ? 'just ' : '') + position + ' the ' + boundary;
    level = '90-day cover was ' + pct(ratio) + ', ' + relation + '.';
    const distance = Math.abs(ratio - threshold) * 100;
    const gap = distance < 0.05 ? 'less than 0.1 percentage point' :
      tenths.format(distance) + (tenths.format(distance) === '1.0' ? ' percentage point' : ' percentage points');
    const line = (100 * threshold).toLocaleString('en-US') + '% alert line';
    thresholdNote = 'Over 90 days, burns retired ' + (ratio * 100).toLocaleString('en-US',{maximumFractionDigits:1}) +
      ' VVV for every 100 minted. Cover is ' + (ratio === threshold ? 'at our own ' + line : gap + ' ' + position + ' our own ' + line) + '.';
  }
  return {level, thresholdNote, trend: coverComparison(recent), detail: trendDetail(recent, history), breakdown: breakdownText(recent)};
}
