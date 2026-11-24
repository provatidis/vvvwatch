import { VVV } from '../lib/config.js';
import { dayOffset } from '../lib/metrics.js';
import { readContractWords, word } from './rpc.mjs';

// Sablier's older Base deployments expose getAsset(id). Newer ones use getUnderlyingToken(id).
const assetGetter = new Map([
  ['0x4cb16d4153123a74bc724d161050959754f378d8', '0xeac8f5b8'],
  ['0xf4937657ed8b3f3cb379eed47b8818ee947beb1e', '0xeac8f5b8'],
  ['0xf9e9ed67dd2fab3b3ca024a2d66fcf0764d36742', '0xeac8f5b8'],
  ['0xb5d78dd3276325f5faf3106cc4acc56e28e0fe3b', '0xa4775772'],
  ['0xe261b366f231b12fcb58d6bbd71e57faee82431d', '0xa4775772'],
  ['0xc19a09a66887017f603e5df420ed3cb9a5c07c0a', '0xa4775772']
]);
const directory = 'https://venicestats.com/api/vesting?mode=streams&limit=200&sort=deposit';
const oneWord = /^0x[0-9a-f]{64}$/i;

async function streamDirectory(expectedCount) {
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 1) throw Error('Missing vesting stream count');
  const groups = new Map();
  const pages = Math.ceil(expectedCount / 200);
  for (let page = 1; page <= pages; page++) {
    const response = await fetch(directory + '&page=' + page, {signal: AbortSignal.timeout(18_000)});
    if (!response.ok) throw Error('Vesting directory HTTP ' + response.status);
    const {pagination, streams} = await response.json();
    if (pagination?.total !== expectedCount || pagination.pages !== pages || pagination.page !== page ||
        pagination.limit !== 200 || !Array.isArray(streams) || streams.length !== Math.min(200, expectedCount - (page - 1) * 200)) {
      throw Error('Incomplete vesting stream directory');
    }
    for (const stream of streams) {
      const address = stream.contractAddress?.toLowerCase();
      const id = stream.streamId?.match(/^(0x[0-9a-f]{40})-8453-([1-9]\d*)$/i);
      if (!id || id[1].toLowerCase() !== address || !assetGetter.has(address) || !Number.isSafeInteger(Number(id[2]))) {
        throw Error('Unrecognized Base vesting stream');
      }
      if (!groups.has(address)) groups.set(address, new Set());
      const ids = groups.get(address);
      if (ids.has(Number(id[2]))) throw Error('Duplicate vesting stream');
      ids.add(Number(id[2]));
    }
  }
  return Object.fromEntries([...groups].map(([address, ids]) => [address, [...ids].sort((a,b) => a-b)]));
}

// Stream IDs are consecutive within each deployment. IDs beyond the counter didn't exist at this block.
async function readBalances(rpc, streams, anchor) {
  const at = {blockHash:anchor.blockHash, requireCanonical:true};
  const deployments = Object.entries(streams);
  const counters = await readContractWords(rpc, deployments.map(([address]) => [address, '0x1e99d569']), at);
  const existing = [];
  for (const [i, [address, ids]] of deployments.entries()) {
    if (!oneWord.test(counters[i]) || BigInt(counters[i]) < 1n) throw Error('Invalid nextStreamId');
    for (const id of ids) if (BigInt(id) < BigInt(counters[i])) existing.push({address, id});
  }
  const balances = new Map();
  for (let i = 0; i < existing.length; i += 40) {
    const batch = existing.slice(i, i + 40);
    const calls = batch.flatMap(({address, id}) =>
      [assetGetter.get(address), '0x4869e12d', '0xd511609f'].map(selector => [address, selector + word(id)]));
    const data = await readContractWords(rpc, calls, at);
    for (const [j, {address, id}] of batch.entries()) {
      const words = data.slice(j*3, j*3+3);
      if (!words.every(x => oneWord.test(x))) throw Error('Invalid vesting contract response');
      const [asset, unlocked, withdrawn] = words.map(BigInt);
      if (asset !== BigInt(VVV.token) || withdrawn > unlocked || unlocked >= 2n**128n) throw Error('Invalid VVV stream balances');
      balances.set(address + '/' + id, {unlocked, withdrawn});
    }
  }
  return balances;
}

export function streamChanges(opening, closing) {
  let unlocked = 0n, withdrawn = 0n;
  for (const id of opening.keys()) if (!closing.has(id)) throw Error('Missing closing stream');
  for (const [id, end] of closing) {
    const start = opening.get(id) ?? {unlocked:0n, withdrawn:0n};
    if (end.unlocked < start.unlocked || end.withdrawn < start.withdrawn) throw Error('Stream balance moved backwards');
    unlocked += end.unlocked - start.unlocked;
    withdrawn += end.withdrawn - start.withdrawn;
  }
  return {unlocked:Number(unlocked)/1e18, withdrawn:Number(withdrawn)/1e18};
}

export async function collectVestingHistory(rpc, protocol, expectedCount) {
  const streams = await streamDirectory(expectedCount);
  return readVestingHistory(rpc, protocol, streams);
}

export async function readVestingHistory(rpc, protocol, streams) {
  const close = protocol.days.at(-1);
  const closing = await readBalances(rpc, streams, close);
  if (!closing.size) throw Error('No indexed streams at the closing block');
  const windows = {};
  for (const days of [30, 90]) {
    const open = protocol.days.at(-days-1);
    if (!open || dayOffset(close.date,-days) !== open.date) continue;
    const opening = await readBalances(rpc, streams, open);
    windows[days] = {start:dayOffset(open.date,1), end:close.date, startBlock:open.toBlock, endBlock:close.toBlock,
      ...streamChanges(opening, closing)};
  }
  return {asOf:close.date, blockHash:close.blockHash, source:directory, streamCount:closing.size, streams, windows};
}
