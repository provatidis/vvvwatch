import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { SALES_FROM, SALES } from '../lib/config.js';
import { dataFile, readJSON, saveJSON } from './files.mjs';

const url = 'https://venicestats.com/api/charts?period=tier-era';
const fields = {pro:'programmaticCountPro',proplus:'programmaticCountProPlus',max:'programmaticCountMax',credits:'programmaticCountCredits'};
const price = Object.fromEntries(Object.values(SALES.products).map(p=>[p.id,p.price]));

export function referenceFromChart(chart, through) {
  if (chart.period!=='tier-era' || !Array.isArray(chart.burns)) throw Error('Unrecognized external burn series');
  const days = [], dates = new Set();
  for (const row of chart.burns) {
    if (!Number.isSafeInteger(row.t) || row.t%86400000) throw Error('Invalid external UTC date');
    const date = new Date(row.t).toISOString().slice(0,10);
    if (row.t<SALES_FROM*1000 || date>through) continue;
    if (dates.has(date)) throw Error('Duplicate provider date '+date);
    dates.add(date);
    if (Object.values(fields).some(key=>!Number.isSafeInteger(row[key]) || row[key]<0)) continue;
    const day = {date};
    for (const [product,key] of Object.entries(fields)) day[product]=row[key];
    day.estimatedUsd=Object.keys(fields).reduce((sum,key)=>sum+day[key]*price[key],0);
    if (Number.isFinite(row.programmaticUsd) && row.programmaticUsd>=0) day.providerBurnUsd=row.programmaticUsd;
    days.push(day);
  }
  days.sort((a,b)=>a.date.localeCompare(b.date));
  if (!days.length) throw Error('No complete dated third-party records');
  return {source:url,asOf:days.at(-1).date,days};
}

export async function refreshReference(cached, through) {
  try {
    const response = await fetch(url, {signal: AbortSignal.timeout(18_000)});
    if (!response.ok) throw Error('HTTP ' + response.status);
    const current = referenceFromChart(await response.json(), through);
    const records = new Map();
    for (const day of cached?.days ?? []) {
      if (day.date <= through) records.set(day.date, day);
    }
    for (const day of current.days) records.set(day.date, day);
    const days = [...records.values()].sort((a,b) => a.date.localeCompare(b.date));
    return {source:url, asOf:days.at(-1).date, days};
  } catch (error) {
    console.warn('Purchase reference: ' + error.message);
    return cached ?? null;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
  const file=dataFile('burns.json'), local=process.argv[2];
  if (!local) throw Error('Pass the saved VeniceStats tier-era API response');
  const target=await readJSON(file,{version:1,lastDay:null,sales:{days:[]},buybacks:{asOf:null,cycles:[]}});
  const through=new Date(Date.now()-86400000).toISOString().slice(0,10);
  target.sales.reference=referenceFromChart(JSON.parse(await readFile(local,'utf8')),through);
  await saveJSON(file,target);
  console.log('Imported '+target.sales.reference.days.length+' external reference days through '+target.sales.reference.asOf);
}
