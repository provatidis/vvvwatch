import { THRESHOLDS } from './config.js';

const valid = value => Number.isFinite(value) && value >= 0;
const tenths = new Intl.NumberFormat('en-US', {minimumFractionDigits: 1, maximumFractionDigits: 1});
const pct = ratio => tenths.format(100 * ratio) + '%';

function trendText(recent) {
  const current = recent?.ratio, prior = recent?.priorRatio;
  if (!valid(current)) return '30-day cover needs 30 complete days with positive total issuance.';
  const latest = 'Burns covered ' + pct(current) + ' of issuance in the last 30 days';
  if (!valid(prior)) return latest + '. The preceding 30-day comparison is unavailable.';
  if (current === prior) return latest + ', unchanged from the preceding 30 days.';
  const direction = current > prior ? 'up' : 'down';
  if (pct(current) === pct(prior)) return latest + ', slightly ' + direction + ' from the preceding 30 days at the same displayed percentage.';
  return latest + ', ' + direction + ' from ' + pct(prior) + ' in the preceding 30 days.';
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

export function burnCoverContext(windows) {
  const recent = windows?.[30], ratio = windows?.[90]?.ratio;
  const threshold = THRESHOLDS.burnCover90d.watch;
  const boundary = (100 * threshold).toLocaleString('en-US') + '% threshold';
  let level = '90-day cover needs 90 complete days with positive total issuance.';
  let thresholdNote = 'Awaiting a complete 90-day reading';
  if (valid(ratio)) {
    const position = ratio < threshold ? 'below' : ratio > threshold ? 'above' : 'at';
    const relation = (ratio !== threshold && pct(ratio) === pct(threshold) ? 'just ' : '') + position + ' the ' + boundary;
    level = '90-day cover was ' + pct(ratio) + ', ' + relation + '.';
    thresholdNote = relation[0].toUpperCase() + relation.slice(1);
  }
  return {level, thresholdNote, trend: trendText(recent), breakdown: breakdownText(recent)};
}
