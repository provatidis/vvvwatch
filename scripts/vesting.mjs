const source = 'https://venicestats.com/vesting';
const dataUrl = 'https://venicestats.com/api/vesting';
const day = 86_400_000;

export function summarizeVesting(data, lastDay, now = Date.now()) {
  const at = Date.parse(data?.lastUpdated);
  const close = Date.parse(lastDay + 'T00:00:00Z');
  if (!Number.isFinite(at) || !Number.isFinite(close) || at > now + 300_000 || now - at > 2 * day ||
      at < close - day || at >= close + 2 * day) throw Error('Vesting observation is outside the reporting dates');
  if (![data.dailyDripRate,data.totalWithdrawn].every(value => Number.isFinite(value) && value >= 0) ||
      !Number.isSafeInteger(data.totalStreams) || data.totalStreams < 1) throw Error('Invalid vesting summary');
  const step = data.dripCliff;
  const date = step?.date;
  const drop = step?.dropPct;
  const canonicalDay = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date;
  const hasStep = canonicalDay && Number.isFinite(drop) && drop > 0 && drop <= 100 &&
    Number.isSafeInteger(step.streamCount) && step.streamCount > 0 && step.streamCount <= data.totalStreams;
  return {source:'VeniceStats', url:source, dataUrl, asOf:new Date(at).toISOString(), cached:false,
    dailyDripRate:data.dailyDripRate, totalWithdrawn:data.totalWithdrawn, totalStreams:data.totalStreams,
    dripCliff:hasStep ? {date, dropPct:drop, streamCount:step.streamCount} : null};
}

export async function collectVesting(previous, lastDay, now = Date.now(), fetcher = fetch) {
  let cached = null;
  if (previous?.dataUrl === dataUrl) {
    try {
      cached = summarizeVesting({...previous, lastUpdated:previous.asOf}, lastDay, now);
      cached.cached = true;
    } catch { /* Expired or incomplete observations cannot be reused. */ }
  }
  try {
    const response = await fetcher(dataUrl, {signal:AbortSignal.timeout(18_000)});
    if (!response.ok) throw Error('HTTP ' + response.status);
    const current = summarizeVesting(await response.json(), lastDay, now);
    return cached && cached.asOf > current.asOf ? cached : current;
  } catch (error) {
    console.warn('Vesting schedule: ' + error.message);
    return cached;
  }
}
