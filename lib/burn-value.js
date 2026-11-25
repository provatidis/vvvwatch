// Receipt verification and spend attribution are independent of a burn's block-end market value.
export function burnValueUsd(cycle) {
  const quote = cycle?.valuation;
  if (cycle?.burnVerified !== true || !quote || quote.block !== cycle.block ||
      !cycle.blockHash || quote.blockHash !== cycle.blockHash) return null;
  if (![cycle.burnedVvv,quote.priceUsd,quote.usd].every(value => Number.isFinite(value) && value > 0)) return null;
  const expected = cycle.burnedVvv * quote.priceUsd;
  if (!Number.isFinite(expected) || Math.abs(expected - quote.usd) > 4 * Number.EPSILON * expected) return null;
  return quote.usd;
}
