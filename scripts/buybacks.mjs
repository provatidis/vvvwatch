import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { VENICE, VVV, SALES, ZERO, DEAD } from '../lib/config.js';
import { decodeLogs, filters, reconcileCycle, topic, transfer } from './burn-events.mjs';
import { addressWord, hex, readContractWords } from './rpc.mjs';

const safe = VENICE.buybackSafe.toLowerCase();
const service = 'https://api.safe.global/tx-service/base/api/v1/safes/0x35Fb3b67C57849Bf57EB24b061EEF0B5E560dc57/transfers/';
const knownBurns = [
  '0x49f63326b4d8def31929186b24a9d8ccb93908f446db93b6a11d0ccc15df72f4',
  '0x4782737fdd05229d102fa37188bc750f303241e996913a933c8b5df407c2d19b',
  '0xdff1fb3d033aaa374f6808cac03e85288eb389b106c9613cc3acbc90623afbdb',
  '0x8f3efd93511f6e60d7cc9c8f4b96d978ca667b0bbd2c2db6a9f2c6c1e2bc3184',
  '0x3ec87b7611f6370613dca1b8f570fa15f544f1624b157c8f74357740318a659f',
  '0x5b4f177e555ebff42c335a4807b46bd4daee7a4833305a76f3d351cd12024fe4'
];
const sinks = [ZERO.toLowerCase(), DEAD.toLowerCase()];
const token = VVV.token.toLowerCase(), usdc = SALES.usdc.toLowerCase();
const seconds = date => Date.parse(date) / 1000;
const iso = time => new Date(time * 1000).toISOString().replace('.000Z', 'Z');
const amount = value => Number(value) / 1e18;

async function snapshotBalance(rpc, block) {
  const call = '0x70a08231' + addressWord(safe);
  const values = await readContractWords(rpc, [[token,call],[usdc,call]],block);
  return values.map(BigInt);
}

async function burnReceipt(rpc, tx) {
  const receipt = await rpc.call('eth_getTransactionReceipt', [tx]);
  if (receipt.status !== '0x1' || receipt.transactionHash.toLowerCase() !== tx) throw Error('Invalid Safe burn receipt');
  const block = Number(BigInt(receipt.blockNumber));
  const burnt = receipt.logs.filter(log => log.address.toLowerCase() === token && log.topics[0] === transfer &&
    log.topics[1] === topic(safe) && sinks.map(topic).includes(log.topics[2]));
  const logs = decodeLogs(burnt, filters.disposed, block, block);
  if (logs.length !== 1 || logs[0].amount === 0n) throw Error('Expected one VVV burn from the Safe at ' + tx);
  const [header, [vvv, dollars]] = await Promise.all([
    rpc.call('eth_getBlockByNumber', [hex(block),false]), snapshotBalance(rpc,block)
  ]);
  if (header.hash !== receipt.blockHash) throw Error('Receipt and block hash disagree at ' + block);
  const timestamp = Number(BigInt(header.timestamp));
  return {date:iso(timestamp).slice(0,10),timestamp,tx,block,blockHash:header.hash,
    burnedVvv:amount(logs[0].amount),closingVvv:amount(vvv),burnVerified:true,verified:false,
    openingVvv:null,boughtVvv:null,spentUsdc:null,otherVvv:null,
    raw:{burnedVvv:String(logs[0].amount),closingVvv:String(vvv),closingUsdc:String(dollars)}};
}

async function readPage(url) {
  const dir = process.env.BUYBACK_CACHE;
  const file = dir && join(dir,encodeURIComponent(url.searchParams.toString()) + '.json');
  if (file) try { return JSON.parse(await readFile(file,'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  let error;
  for (let attempt=0; attempt<3; attempt++) {
    try {
      const response = await fetch(url,{signal:AbortSignal.timeout(20000), headers:{accept:'application/json'}});
      if (!response.ok) throw Error('Safe transfer service returned HTTP ' + response.status);
      const page = await response.json();
      if (!Array.isArray(page.results) || !Number.isInteger(page.count) || page.count < 0) throw Error('Invalid Safe transfer page');
      if (file) { await mkdir(dir,{recursive:true}); await writeFile(file,JSON.stringify(page)); }
      return page;
    } catch (e) { error=e; if (attempt<2) await new Promise(resolve=>setTimeout(resolve,500*(attempt+1))); }
  }
  throw error;
}

async function indexedTransfers(start, stop, step = 2*86400) {
  const events = [];
  for (let from=start; from<stop; from+=step) {
    const to = Math.min(from+step,stop);
    const url = new URL(service);
    url.searchParams.set('execution_date__gte',iso(from));
    url.searchParams.set('execution_date__lt',iso(to));
    url.searchParams.set('limit','200');
    let total = null;
    const seen = new Set();
    const partition = [];
    for (let offset=0;;offset+=200) {
      url.searchParams.set('offset',String(offset));
      const page = await readPage(url);
      if (total===null) total=page.count;
      if (total!==page.count || offset+page.results.length>total) throw Error('Incomplete indexed Safe time range');
      const repeated = page.results.some(item => {
        if (seen.has(item.transferId)) return true;
        seen.add(item.transferId);
        return false;
      });
      if (repeated || total >= 2000) {
        if (step <= 1) throw Error('Ambiguous Safe transfer pagination');
        partition.length=0;
        partition.push(...await indexedTransfers(from,to,Math.max(1,Math.floor(step/2))));
        break;
      }
      for (const item of page.results) {
        const timestamp=seconds(item.executionDate);
        if (!Number.isFinite(timestamp) || timestamp<from || timestamp>=to) throw Error('Transfer outside requested Safe time range');
        if (item.type==='ERC20_TRANSFER' && [token,usdc].includes(item.tokenAddress?.toLowerCase())) partition.push(item);
      }
      if (offset+page.results.length===total) break;
      if (page.results.length!==200 || !page.next) throw Error('Short Safe transfer page');
    }
    events.push(...partition);
  }
  return events;
}

export function verifiedInventory(prior, burn, indexed) {
  const flows = {acquired:[],disposed:[],spend:[],refund:[]};
  const unique=new Set();
  for (const item of indexed) {
    const block=item.blockNumber;
    if (block<=prior.block || block>burn.block) continue;
    const addr=item.tokenAddress.toLowerCase(), from=item.from.toLowerCase(), to=item.to.toLowerCase();
    const tx=item.transactionHash.toLowerCase(), id=item.transferId.toLowerCase();
    if (!item.value || !/^\d+$/.test(item.value) || !/^0x[0-9a-f]{64}$/.test(tx) ||
        !Number.isSafeInteger(block) || unique.has(id) || !id.startsWith('e'+tx.slice(2)) ||
        !/^\d+$/.test(id.slice(65))) throw Error('Invalid indexed Safe transfer in ' + tx);
    unique.add(id);
    const event={tx,hash:'',index:Number(id.slice(65)),addr,from,to,block,amount:BigInt(item.value)};
    if (from===safe) flows[addr===token?'disposed':'spend'].push(event);
    if (to===safe) flows[addr===token?'acquired':'refund'].push(event);
  }
  const net = xs=>xs.reduce((n,x)=>n+x.amount,0n);
  if (BigInt(prior.raw.closingUsdc)+net(flows.refund)-net(flows.spend)!==BigInt(burn.raw.closingUsdc))
    throw Error('USDC transfers do not reconcile to archive balances');
  const result = reconcileCycle({opening:BigInt(prior.raw.closingVvv),closing:BigInt(burn.raw.closingVvv),
    fromBlock:prior.block+1,toBlock:burn.block,date:burn.date,tx:burn.tx,priorTx:prior.tx,blockHash:burn.blockHash},flows);
  if (result.raw.burnedVvv!==burn.raw.burnedVvv) throw Error('Indexed burn differs from receipt');
  const {verificationError, ...receipt} = burn;
  return {...receipt,...result,inventoryReconciled:true,raw:{...burn.raw,...result.raw,openingUsdc:prior.raw.closingUsdc},
    source:'Safe Transaction Service transfers reconciled to VVV and USDC contract balances'};
}

export async function collectBuybacks(rpc, lastDay, endBlock, existing={}) {
  const cycles=[...(existing.cycles || [])];
  let since = existing.asOf ? seconds(existing.asOf)+86400 : null;
  for (const tx of knownBurns) if (!cycles.some(c=>c.tx===tx)) {
    const burn=await burnReceipt(rpc,tx);
    if (burn.block<=endBlock) cycles.push(burn);
  }
  cycles.sort((a,b)=>a.block-b.block);
  const latest=cycles.at(-1);
  since ??= latest?.timestamp ?? seconds(lastDay);
  const until=seconds(lastDay)+86400;
  if (since<until) {
    const recent=await indexedTransfers(since,until);
    for (const item of recent) if (item.tokenAddress.toLowerCase()===token && item.from.toLowerCase()===safe &&
      sinks.includes(item.to.toLowerCase()) && item.blockNumber<=endBlock && !cycles.some(c=>c.tx===item.transactionHash)) {
      cycles.push(await burnReceipt(rpc,item.transactionHash));
    }
  }
  cycles.sort((a,b)=>a.block-b.block);
  for (let i=cycles.length-1;i>=1;i--) {
    const current=cycles[i],prior=cycles[i-1];
    if (current.inventoryReconciled || current.verified) continue;
    try {
      const indexed=await indexedTransfers(prior.timestamp,current.timestamp+1);
      cycles[i]=verifiedInventory(prior,current,indexed);
    } catch(e) {
      console.warn('Safe cycle ' + current.date + ': ' + e.message);
      cycles[i]={...current,verificationError:e.message};
    }
  }
  return {asOf:lastDay,endBlock,cycles};
}
