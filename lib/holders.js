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

function verifiedSafeTotal(snapshot, window) {
  const treasury = snapshot?.treasury;
  const closeDate = snapshot?.lastDay ?? window?.end;
  const closeBlock = snapshot?.evidence?.endBlock ?? window?.endBlock;
  if (!closeDate || treasury?.walletsAsOf !== closeDate || !Number.isSafeInteger(closeBlock) ||
      treasury.walletsBlock !== closeBlock || snapshot.sources?.wallets?.ok === false) return null;
  // The collector clears this total if any of the three required Safes fails verification.
  return finite(treasury.trackedSafeTotal) && treasury.trackedSafeTotal >= 0 ? treasury.trackedSafeTotal : null;
}

export function holderValue(snapshot, now = Date.now()) {
  const w = snapshot?.supply?.windows?.['30'];
  const effective = snapshot?.supply?.effective;
  const perYear = amount => finite(amount) && effective > 0 ? amount * 365 / 30 / effective : null;
  const price = freshPrice(snapshot?.prices?.vvv, now);
  const period = snapshot?.sales?.window30;
  const salesEnd = /^\d{4}-\d{2}-\d{2}$/.test(period?.end) ? period.end : null;
  const sales = salesEnd && finite(period.annualizedUsd) ? period.annualizedUsd : null;
  const tracked = verifiedSafeTotal(snapshot, w);
  const mvAll = price && effective > 0 ? effective * price : null;
  const mvExVenice = mvAll !== null && tracked !== null && tracked <= effective ? (effective - tracked) * price : null;
  return {
    burnRate: perYear(w?.burned),
    emitRate: perYear(w?.minted),
    salesEnd,
    salesShare: salesEnd && finite(period.totalBurnShare) ? period.totalBurnShare : null,
    mvAll, mvExVenice,
    psAll: mvAll !== null && sales > 0 ? mvAll / sales : null,
    psExVenice: mvExVenice !== null && sales > 0 ? mvExVenice / sales : null,
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
export function diemTradeoff({n, usePerDay, years, supply, curve, aprU, aprL, pVVV = null, pDIEM = null,
  priorDiem = 0, priorLocked = 0}) {
  const svvv = svvvForDiem(n, supply, curve);
  if (svvv === null || !finite(years) || years <= 0 || !finite(usePerDay) || usePerDay < 0 || usePerDay > 1) return null;
  if (!finite(priorDiem) || !finite(priorLocked) || priorDiem < 0 || priorLocked < 0 ||
      (priorDiem === 0) !== (priorLocked === 0)) return null;
  // burnDiem releases the fraction of the wallet's pooled collateral represented by the DIEM burned.
  const collateral = priorLocked + svvv;
  const debt = priorDiem + n;
  const unlocked = collateral * (n / debt);
  const remainingLocked = collateral * (priorDiem / debt);
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
    svvv, rateAvg, rateNow, unlocked, remainingLocked,
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
