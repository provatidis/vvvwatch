const USAGE = 'https://venicestats.com/api/diem-usage';
const PRICE = 'https://api.coingecko.com/api/v3/simple/price?ids=venice-token,diem&vs_currencies=usd&include_last_updated_at=true';
const DAY = 86_400_000;

async function json(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(18_000)});
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}

export function summarizedUsage(data, lastDay) {
  const end = Date.parse(lastDay + 'T00:00:00Z');
  const latestClosed = data.summary?.latestClosedDay?.t;
  if (!Number.isFinite(latestClosed)) throw new Error('Missing closed usage day');
  const last = Math.min(end, latestClosed);
  if (end - last > 2 * DAY) throw new Error('Usage data is stale');
  const rows = data.days.filter(row => row.t <= last && row.t > last - 7 * DAY)
    .sort((a, b) => a.t - b.t);
  if (rows.length !== 7 || rows.some((row, i) =>
    row.t !== last - (6 - i) * DAY || !Number.isFinite(row.consumed) ||
    row.consumed < 0 || !Number.isFinite(row.staked) || row.staked <= 0)) {
    throw new Error('Incomplete seven-day DIEM usage series');
  }
  const mean = field => rows.reduce((n, row) => n + row[field], 0) / rows.length;
  const consumedPerDay = mean('consumed');
  const depositedPerDay = mean('staked');
  return {date: new Date(last).toISOString().slice(0, 10), days: 7, consumedPerDay,
    depositedPerDay, ratio: consumedPerDay / depositedPerDay, source: 'VeniceStats',
    url: 'https://venicestats.com/diem', dataUrl: USAGE};
}

function quotes(data, now) {
  function quote(id) {
    const p = data[id];
    const time = p?.last_updated_at * 1000;
    if (!(p?.usd > 0) || !Number.isFinite(time) || time > now + 300_000 || now - time > DAY) {
      throw new Error('Invalid price for ' + id);
    }
    return {usd: p.usd, asOf: new Date(time).toISOString()};
  }
  return {vvv: quote('venice-token'), diem: quote('diem'), url: PRICE};
}

export async function collectContext(previous, lastDay, now = Date.now()) {
  const [usage, price] = await Promise.allSettled([
    json(USAGE).then(data => summarizedUsage(data, lastDay)),
    json(PRICE).then(data => quotes(data, now))
  ]);
  for (const [name, result] of [['usage', usage], ['price', price]]) {
    if (result.status === 'rejected') console.warn(name + ': ' + result.reason.message);
  }
  const priorUsage = previous?.diem?.utilization;
  const usageAge = Date.parse(lastDay) - Date.parse(priorUsage?.date);
  const priorPrices = previous?.prices;
  const oldestQuote = Math.min(Date.parse(priorPrices?.vvv?.asOf), Date.parse(priorPrices?.diem?.asOf));
  return {
    utilization: usage.status === 'fulfilled' ? usage.value : usageAge <= 2 * DAY ? priorUsage : null,
    prices: price.status === 'fulfilled' ? price.value : now - oldestQuote <= DAY ? priorPrices : null
  };
}
