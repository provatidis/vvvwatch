import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { dataFile, readJSON, saveJSON } from './files.mjs';
import { createRpc, hex } from './rpc.mjs';
import { classifyPurchases, decodeLogs, digestEvents, filters } from './burn-events.mjs';
import { CHAIN, SALES_FROM } from '../lib/config.js';

const shift = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n*86400000).toISOString().slice(0,10);
const startOfPolicy = new Date(SALES_FROM*1000).toISOString().slice(0,10);
const empty = () => ({version:1,lastDay:null,sales:{days:[]},buybacks:{asOf:null,cycles:[]}});

export async function readRange(rpc, name, from, to, cacheDir) {
  const filter = filters[name];
  const file = cacheDir && join(cacheDir, [name,from,to].join('-') + '.json.gz');
  if (file) {
    try {
      return decodeLogs(JSON.parse(gunzipSync(await readFile(file))), filter, from, to);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  let logs;
  try {
    logs = await rpc.call('eth_getLogs', [{...filter, fromBlock:hex(from), toBlock:hex(to)}]);
  } catch (error) {
    // Some keyless nodes return a maximum range, log count or payload size rather than imposing a fixed cap.
    if (to-from < 499 || !/range|limit|too many|too large|invalid params|413|timeout|timed out/i.test(error.message)) throw error;
    const caps = [...error.message.matchAll(/(?:maximum|max(?:imum)? allowed is|limited to (?:0 - )?)\s*(\d+)/gi)]
      .map(match=>Number(match[1])).filter(n=>n>0 && n<to-from+1);
    const width = caps.length ? Math.max(...caps) : Math.ceil((to-from+1)/2);
    const ranges = [];
    for (let start=from;start<=to;start+=width) ranges.push([start,Math.min(to,start+width-1)]);
    const parts = await mapParallel(ranges,2,([start,end])=>readRange(rpc,name,start,end,cacheDir));
    return parts.flat();
  }
  const events = decodeLogs(logs,filter,from,to);
  if (file) {
    const tmp = file + '.' + process.pid + '.tmp';
    await writeFile(tmp,gzipSync(JSON.stringify(logs)));
    await rename(tmp,file);
  }
  return events;
}

async function mapParallel(tasks, count, fn) {
  let cursor = 0;
  const results = [];
  await Promise.all(Array.from({length:Math.min(count,tasks.length)}, async () => {
    while (cursor < tasks.length) {
      const index = cursor++;
      results[index] = await fn(tasks[index]);
    }
  }));
  return results;
}

export async function collectDay(rpc, day, options = {}) {
  const chunks = [];
  const chunkSize = options.chunkSize || CHAIN.maxLogRange;
  for (let from=day.fromBlock; from<=day.toBlock; from+=chunkSize) {
    const to = Math.min(day.toBlock,from+chunkSize-1);
    for (const name of ['payments','burns',...(day.openingUsdc != null ? ['funding'] : [])]) chunks.push({name,from,to});
  }
  const parts = await mapParallel(chunks, options.concurrency || 4, async ({name,from,to}) =>
    ({name,logs:await readRange(rpc,name,from,to,options.cacheDir)}));
  const all = name => parts.filter(p=>p.name===name).flatMap(p=>p.logs);
  const result = classifyPurchases(day,all('payments'),all('burns'));
  const rawTotal = BigInt(result.raw.salesVvv)+BigInt(result.raw.monthlyVvv)+BigInt(result.raw.otherVvv);
  const mismatch = day.raw?.dailyBurned != null ? rawTotal !== BigInt(day.raw.dailyBurned)
    : day.dailyBurned != null && Math.abs(result.burnSales+result.burnMonthly+result.burnOther-day.dailyBurned)>0.000001;
  if (mismatch) throw Error('Burn log sum does not reconcile with the independent balance change on '+day.date);
  if (day.raw?.dailyBurned != null) result.raw.balanceChangeVvv = day.raw.dailyBurned;
  if (day.openingUsdc != null) {
    const funding = all('funding');
    const incoming = funding.reduce((total,x)=>total+x.amount,0n);
    const outgoing = BigInt(result.raw.recognizedUsdc)+BigInt(result.raw.unknownUsdc);
    if (BigInt(day.openingUsdc)+incoming-outgoing!==BigInt(day.raw.burnWalletUsdc))
      throw Error('Burn wallet USDC logs do not reconcile with the independent balance change on '+day.date);
    result.fundingEvidenceSha256=digestEvents(funding);
    Object.assign(result.raw,{openingUsdc:day.openingUsdc,incomingUsdc:String(incoming),closingUsdc:day.raw.burnWalletUsdc});
  }
  return result;
}

export function boundariesFromCache(rows) {
  return rows.slice(1).map((row,i) => {
    if (shift(rows[i].date,1)!==row.date || !Number.isSafeInteger(row.block) || row.block<=rows[i].block)
      throw Error('Invalid UTC boundary for ' + row.date);
    return {date:row.date, fromBlock:rows[i].block+1, toBlock:row.block, blockHash:row.hash};
  });
}

async function run() {
  const file = process.env.BURN_OUTPUT ? pathToFileURL(process.env.BURN_OUTPUT) : dataFile('burns.json');
  const cacheDir = process.env.BURN_LOG_CACHE;
  if (cacheDir) await mkdir(cacheDir,{recursive:true});
  const current = await readJSON(file,empty());
  const rpc = createRpc();
  const logsRpc = createRpc({customUrl:process.env.BASE_RPC_URL || 'https://base-rpc.publicnode.com'});
  const alternate = createRpc({customUrl:'https://rpc.nodeflare.app/base/public'});
  const proto = await readJSON(dataFile('protocol.json'),{days:[]});
  const states = new Map(proto.days.map((d,i)=>[d.date,{...d,openingUsdc:proto.days[i-1]?.raw?.burnWalletUsdc}]));
  const bounds = process.env.BURN_BOUNDARIES ? boundariesFromCache(JSON.parse(await readFile(process.env.BURN_BOUNDARIES,'utf8')))
    .map(d=>{
      const state=states.get(d.date);
      if (state && (state.blockHash!==d.blockHash || state.toBlock!==d.toBlock || state.fromBlock!==d.fromBlock)) throw Error('Local and protocol block anchors disagree on '+d.date);
      return {...state,...d};
    }) : [...states.values()];
  const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
  const end = process.env.BURN_TO || yesterday;
  if (end>yesterday) throw Error('Cannot collect an incomplete UTC day');
  const days = current.sales.days;
  const next = process.env.BURN_FROM || (days.length ? shift(days.at(-1).date,1) : end);
  if (next < startOfPolicy) throw Error('Backfill starts on or after ' + startOfPolicy);
  const dates = bounds.filter(d=>d.date>=next && d.date<=end);
  if (next<=end && (dates[0]?.date!==next || dates.at(-1)?.date!==end)) throw Error('Missing protocol day boundaries in '+next+' through '+end);
  if (days.length && dates.length && (end<shift(days[0].date,-1) || next>shift(days.at(-1).date,1))) throw Error('Requested dates must adjoin the verified sales series');
  const known = new Set(days.map(d=>d.date));
  const pending = dates.filter(d=>!known.has(d.date));
  const oldest = days[0]?.date || next;
  const ordered = [...pending.filter(d=>d.date<oldest).reverse(),...pending.filter(d=>d.date>=oldest)];
  for (let i=0; i<ordered.length; i+=4) {
    const chunk = ordered.slice(i,i+4);
    const records = await mapParallel(chunk,Number(process.env.BURN_PARALLEL_DAYS)||1,async day=>{
      if (!day.raw?.dailyBurned || !day.raw?.burnWalletUsdc || !day.openingUsdc) throw Error('Independent token and payer balances are required on '+day.date);
      try { return await collectDay(logsRpc,day,{cacheDir}); }
      catch (error) {
        if (!error.message.includes('do not reconcile') && !error.message.includes('does not reconcile')) throw error;
        // A pruned RPC can silently return an empty result. Re-read smaller ranges from a different provider.
        return collectDay(alternate,day,{chunkSize:5000});
      }
    });
    days.push(...records);
    days.sort((a,b)=>a.date.localeCompare(b.date));
    if (days.some((d,i)=>i && shift(days[i-1].date,1)!==d.date)) throw Error('Noncontiguous purchase history');
    current.lastDay = days.at(-1).date;
    for (const day of records) console.log(day.date + ': ' + day.confirmedBurnEvents + ' matched, ' + day.unknown + ' unclassified.');
    await saveJSON(file,current);
  }
  if (process.env.BURN_SALES_ONLY==='1' || current.buybacks.asOf >= end) return;
  const boundary = bounds.find(d=>d.date === end);
  if (!boundary) throw Error('No end block for buyback collection on '+end);
  const { collectBuybacks } = await import('./buybacks.mjs');
  current.buybacks = await collectBuybacks(rpc,end,boundary.toBlock,current.buybacks);
  await saveJSON(file,current);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url)
  run().catch(error=>{console.error(error.message);process.exitCode=1;});
