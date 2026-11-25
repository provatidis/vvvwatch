import { burnValueUsd } from './burn-value.js';
import { date, pct, round } from './format.js';

const valid = value => Number.isFinite(value) && value >= 0;

function movement(current, previous, unit) {
  if (current === previous) return 'was unchanged';
  if (previous === 0) return 'rose from zero to ' + round(current) + ' ' + unit;
  const change = Math.abs(current - previous) / previous;
  const amount = change < 0.0005 ? 'by less than 0.1%' : pct(change);
  return (current > previous ? 'rose ' : 'fell ') + amount;
}

export function buybackRecap(current, previous) {
  if (!current?.burnVerified || !previous?.burnVerified || !previous.tx || current.priorTx !== previous.tx ||
      !(current.block > previous.block) || ![current.date, previous.date].every(day => Number.isFinite(Date.parse(day))) ||
      ![current.burnedVvv, previous.burnedVvv].every(valid)) return '';
  const retired = movement(current.burnedVvv, previous.burnedVvv, 'VVV');
  const currentUsd = burnValueUsd(current), previousUsd = burnValueUsd(previous);
  let text = 'Compared with the ' + date(previous.date) + ' burn, the amount of VVV retired ' + retired;
  if (currentUsd !== null && previousUsd !== null) text += ' and its estimated value at the burn block ' + movement(currentUsd, previousUsd, 'USD');
  text += '.';
  if (!current.verified || !previous.verified) return text;
  if ([current.spentUsdc, previous.spentUsdc].every(valid)) text += ' USDC spent on purchases ' +
    movement(current.spentUsdc, previous.spentUsdc, 'USDC') + '.';
  if ([current.openingVvv, previous.openingVvv].every(valid)) {
    text += ' The Safe started with ' + round(current.openingVvv) + ' VVV in inventory, ' +
      (current.openingVvv === previous.openingVvv ? 'the same as in the previous cycle.' : 'compared with ' + round(previous.openingVvv) + ' VVV in the previous cycle.');
  }
  return text;
}
