export const DAY = 86_400_000;
export const BLANK = '—';
export const round = (value, digits = 0) => Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: digits }) : BLANK;
export const compact = (value, digits = 2) => Number.isFinite(value) ? value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: digits }) : BLANK;
export const pct = (value, digits = 1) => Number.isFinite(value) ? `${round(value * 100, digits)}%` : BLANK;
export const money = (value, digits = 0) => Number.isFinite(value) ? `$${value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}` : BLANK;
export const moneyShort = value => Number.isFinite(value) ? `$${compact(value)}` : BLANK;
export const signed = (value, format = round) => Number.isFinite(value) ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${format(Math.abs(value))}` : BLANK;
export const divide = (value, denominator) => Number.isFinite(value) && denominator > 0 ? value / denominator : null;
export const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[char]);
export const date = (iso, withYear = true) => {
  if (!iso) return BLANK;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', ...(withYear ? {year:'numeric'} : {}) }) : BLANK;
};
export const blockLink = block => Number.isSafeInteger(block) && block > 0 ? `<a href="https://basescan.org/block/${block}">${round(block)}</a>` : BLANK;
export const utcMidnight = day => Date.parse(`${day}T00:00:00Z`);
