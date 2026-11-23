// Arithmetic for the "For holders" section. Pure functions: no DOM, no network.
// The formulas follow StakingV2 on Base (_updateGlobalReward, getDiemAmountOut, burnDiem).
// They describe today's settings and prices; they do not recommend anything.

const finite = Number.isFinite;
const PRICE_MAX_AGE_MS = 24 * 3600 * 1000;

// Simple yearly staking rates in VVV. Emissions are split by sVVV balance; locked sVVV
// keeps (1 - venicePctLocked) of its share and the rest is minted to Venice's treasury.
export function stakingYields(values, supply) {
  const {emissionRatePerYear: E, venicePct, venicePctLocked} = values ?? {};
  const staked = supply?.staked;
  if (![E, venicePct, venicePctLocked, staked].every(finite) || staked <= 0 || E < 0) return null;
  const aprU = E * (1 - venicePct) / staked;
  return {aprU, aprL: aprU * (1 - venicePctLocked)};
}

// Change in a holding's share of effective supply over a year, given its own growth and supply growth g.
export const shareChange = (growth, g) => finite(growth) && finite(g) && g > -1 ? (1 + growth) / (1 + g) - 1 : null;

// A CoinGecko quote from the snapshot, or null when missing or older than a day.
export function freshPrice(quote, now = Date.now()) {
  if (!finite(quote?.usd) || quote.usd <= 0) return null;
  const at = Date.parse(quote.asOf);
  return finite(at) && now - at <= PRICE_MAX_AGE_MS && at - now <= 3600e3 ? quote.usd : null;
}

function trackedSafes(treasury) {
  if (finite(treasury?.trackedSafeTotal)) return treasury.trackedSafeTotal;
  const wallets = (treasury?.wallets ?? []).filter(w => w.inGrade);
  if (!wallets.length) return null;
  const total = wallets.reduce((sum, w) => sum + (w.vvv ?? NaN) + (w.svvv ?? NaN) + (w.cooldown ?? 0), 0);
  return finite(total) ? total : null;
}

export function holderValue(snapshot, now = Date.now()) {
  const w = snapshot?.supply?.windows?.['30'];
  const effective = snapshot?.supply?.effective;
  const perYear = amount => finite(amount) && effective > 0 ? amount * 365 / 30 / effective : null;
  const price = freshPrice(snapshot?.prices?.vvv, now);
  const sales = snapshot?.sales?.window30?.annualizedUsd;
  const tracked = trackedSafes(snapshot?.treasury);
  const mvAll = price && effective > 0 ? effective * price : null;
  const mvExVenice = mvAll && finite(tracked) && tracked >= 0 && tracked < effective ? (effective - tracked) * price : null;
  return {
    burnRate: perYear(w?.burned),
    emitRate: perYear(w?.minted),
    salesShare: finite(snapshot?.sales?.window30?.totalBurnShare) ? snapshot.sales.window30.totalBurnShare : null,
    mvAll, mvExVenice,
    psAll: mvAll && sales > 0 ? mvAll / sales : null,
    psExVenice: mvExVenice && sales > 0 ? mvExVenice / sales : null,
    tracked
  };
}

function curvePoints(curve) {
  return (Array.isArray(curve) ? curve : [])
    .filter(p => finite(p?.supply) && finite(p?.rate) && p.supply > 0 && p.rate > 0)
    .sort((a, b) => a.supply - b.supply);
}

// sVVV per DIEM for the next DIEM minted at this supply (the bucket whose upper bound is above it).
export function currentMintRate(supply, curve) {
  if (!finite(supply) || supply < 0) return null;
  return curvePoints(curve).find(p => supply < p.supply)?.rate ?? null;
}

// sVVV needed to mint n DIEM from the given supply: each curve bucket charges its own rate
// for the DIEM minted inside it, as getDiemAmountOut does. Null when n runs past the curve.
export function svvvForDiem(n, supply, curve) {
  if (!(finite(n) && n > 0 && finite(supply) && supply >= 0)) return null;
  let at = supply, left = n, need = 0;
  for (const p of curvePoints(curve)) {
    if (at >= p.supply) continue;
    const take = Math.min(p.supply - at, left);
    need += take * p.rate;
    left -= take;
    at += take;
    if (left <= n * 1e-12) return need;
  }
  return null;
}

// Mint n DIEM and either use the credits or sell the DIEM. Prices may be null: token figures still work.
export function diemTradeoff({n, usePerDay, years, supply, curve, aprU, aprL, pVVV = null, pDIEM = null}) {
  const svvv = svvvForDiem(n, supply, curve);
  if (svvv === null || !(finite(years) && years > 0) || !(finite(usePerDay) && usePerDay >= 0)) return null;
  const rateAvg = svvv / n;
  const rateNow = currentMintRate(supply, curve);
  const gap = finite(aprU) && finite(aprL) ? Math.max(0, aprU - aprL) : null;
  const forgoneVVV = gap === null ? null : svvv * gap * years;
  const lockedUsd = pVVV ? svvv * pVVV : null;
  const forgoneUsd = pVVV && forgoneVVV !== null ? forgoneVVV * pVVV : null;
  const creditsUsd = n * usePerDay * 365 * years;
  const saleUsd = pDIEM ? n * pDIEM : null;
  const buybackTotal = saleUsd !== null && forgoneUsd !== null ? saleUsd - forgoneUsd : null;
  return {
    svvv, rateAvg, rateNow,
    crossesStep: finite(rateNow) && rateAvg > rateNow * (1 + 1e-9),
    gap, forgoneVVV, lockedUsd, forgoneUsd, creditsUsd,
    creditsNet: forgoneUsd !== null ? creditsUsd - forgoneUsd : null,
    saleUsd, buybackTotal,
    buybackEach: buybackTotal !== null ? buybackTotal / n : null,
    parity: pVVV && pDIEM ? pDIEM / (rateAvg * pVVV) : null,
    breakEvenUse: pVVV && gap !== null ? gap * rateAvg * pVVV / 365 : null
  };
}

// Everything the section shows that doesn't depend on the reader's inputs.
export function holderSummary(snapshot, now = Date.now()) {
  const values = snapshot?.rules?.values;
  const yields = stakingYields(values, snapshot?.supply);
  const g = snapshot?.supply?.windows?.['30']?.annualized;
  return {
    yields,
    g: finite(g) ? g : null,
    share: {
      unstaked: shareChange(0, g),
      staked: yields ? shareChange(yields.aprU, g) : null,
      locked: yields ? shareChange(yields.aprL, g) : null
    },
    cooldownDays: finite(values?.cooldown) ? values.cooldown / 86400 : null,
    lockedKeeps: finite(values?.venicePctLocked) ? 1 - values.venicePctLocked : null,
    value: holderValue(snapshot, now),
    pVVV: freshPrice(snapshot?.prices?.vvv, now),
    pDIEM: freshPrice(snapshot?.prices?.diem, now)
  };
}
