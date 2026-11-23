import { POOLS, VVV } from '../lib/config.js';
import { hex } from './rpc.mjs';

const pool = POOLS.aerodromeVvvWeth;
// Chainlink's Base ETH/USD proxy from its official feed directory.
const oracle = '0x71041dddad3595f9ced3dccfbe3d1f4b0a16bb70';
const weth = '0x4200000000000000000000000000000000000006';
const queries = [
  [pool, '0x0dfe1681'],   // token0()
  [pool, '0xd21220a7'],   // token1()
  [pool, '0x0902f1ac'],   // getReserves()
  [pool, '0x22be3de1'],   // stable()
  [oracle, '0xfeaf968c'], // latestRoundData()
  [oracle, '0x313ce567']  // decimals()
];

function words(data, length) {
  if (typeof data !== 'string' || data.length !== 2+64*length || !/^0x[0-9a-f]+$/i.test(data)) {
    throw Error('Malformed burn-price contract response');
  }
  return data.slice(2).match(/.{64}/g).map(w => BigInt('0x' + w));
}

function observedAt(seconds, timestamp) {
  // Both inputs must be current within 20 minutes of the burn block.
  if (seconds <= 0n || seconds > BigInt(timestamp) || BigInt(timestamp) - seconds > 1200n) {
    throw Error('Burn-price observation is stale or in the future');
  }
  return new Date(Number(seconds)*1000).toISOString();
}

export async function readBurnValuation(rpc, cycle) {
  if (!cycle?.burnVerified || !Number.isSafeInteger(cycle.timestamp) ||
      !Number.isSafeInteger(cycle.block) || !/^\d+$/.test(cycle.raw?.burnedVvv)) {
    throw Error('Missing burn receipt');
  }
  const tag = hex(cycle.block);
  const [header, token0, token1, reserves, stable, round, decimals] = await rpc.batch([
    {method:'eth_getBlockByNumber', params:[tag,false]},
    ...queries.map(([to,data]) => ({method:'eth_call', params:[{to,data},tag]}))
  ]);
  if (header?.hash !== cycle.blockHash || BigInt(header.number) !== BigInt(cycle.block) ||
      BigInt(header.timestamp) !== BigInt(cycle.timestamp)) throw Error('Burn receipt and pricing block disagree');
  if (words(token0,1)[0] !== BigInt(weth) || words(token1,1)[0] !== BigInt(VVV.token) ||
      words(stable,1)[0] !== 0n) throw Error('Unexpected VVV pricing pool');
  const [reserveWeth,reserveVvv,poolTime] = words(reserves,3);
  const [roundId,answer,started,updated,answeredInRound] = words(round,5);
  // ETH/USD uses signed int256. Reject negative and incomplete answers before conversion.
  if (reserveWeth === 0n || reserveVvv === 0n || words(decimals,1)[0] !== 8n ||
      answer === 0n || BigInt.asIntN(256,answer) <= 0n || roundId === 0n ||
      answeredInRound < roundId || started === 0n || started > updated) throw Error('Invalid burn-price inputs');
  const poolUpdatedAt = observedAt(poolTime,cycle.timestamp);
  const oracleUpdatedAt = observedAt(updated,cycle.timestamp);
  // WETH and VVV both use 18 decimals. The reserve ratio is the marginal pool price before fees.
  const priceUsd = Number(reserveWeth * answer) / Number(reserveVvv * 100000000n);
  const usd = Number(BigInt(cycle.raw.burnedVvv)) / 1e18 * priceUsd;
  if (!Number.isFinite(usd) || usd <= 0) throw Error('Invalid USD burn value');
  return {usd,priceUsd,block:cycle.block,blockHash:cycle.blockHash,asOf:new Date(cycle.timestamp*1000).toISOString(),
    pool,oracle,poolUpdatedAt,oracleUpdatedAt,roundId:String(roundId),ethUsdAnswer:String(answer),oracleDecimals:8,
    reserveWeth:String(reserveWeth),reserveVvv:String(reserveVvv)};
}
