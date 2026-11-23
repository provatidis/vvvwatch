import { VVV } from '../lib/config.js';
import { hex } from './rpc.mjs';

// Safe executions identified by the setter selector, then checked against the event,
// the canonical block, and the staking proxy's state on both sides of the block.
export const emissionTopic = '0xffcc630bf88a67ba7c8b27440787c31777ae923aee1e9bbd0127feea56da2cd0';
export const deploymentBlock = 25430182;
const emissionCheckpoints = [
  { date: '2025-08-20', block: 34455099, logIndex: 148,
    tx: '0x06d3e5fd3e29d971074631f258041b24287f4f8e8efea14d206149d5b9590692',
    blockHash: '0xd6b7fabac39534dbd0dd25a16185675c496a7042c148fd9bfae943e1158c7e00',
    before: '443937087772704211', after: '316880878140289502' },
  { date: '2025-10-23', block: 37229573, logIndex: 376,
    tx: '0xe3a3e13a9c5e1661c40a5c9782167e9861a860a42b5d6f162b06cb20aea9f12c',
    blockHash: '0x7f291eefd8d89d5ed13840abf04a72446ff4f391c63fabcf963bade06c6e37f4',
    before: '316880878140289502', after: '253678335900000000' },
  { date: '2026-02-11', block: 42018042, logIndex: 1243,
    tx: '0x424dd14ac00569f5e0d768a3a45459d2248567f3b8665a337131cd2235939b6d',
    blockHash: '0xc1ffa15b1015767c3bd215ce05b2686acebc072b6de3a93c1c19434c17c452dc',
    before: '253678335900000000', after: '190258751902587519' },
  { date: '2026-05-01', block: 45427555, logIndex: 527,
    tx: '0x63ee397744efb3e8ef90a768fb90670da3636f5d70933d69274c5abdc5d1e741',
    blockHash: '0x1a3b5e6f676087a2f70cafab28114b9abf4e867911a4888da923753f3ae31913',
    before: '190258751902587519', after: '158548959918822912' },
  { date: '2026-06-01', block: 46768600, logIndex: 348,
    tx: '0x8fedfafcdf42fbb0ef74a4d7d13c17bdb90943704a60cc7263298ada29ea3243',
    blockHash: '0x257b24698668919ea58f04db3646fa309977e2416aee046c97018684e962f0de',
    before: '158548959918822912', after: '126839167935058336' },
  { date: '2026-07-01', block: 48063121, logIndex: 488,
    tx: '0xabe2ca8a4cd4038b8451e3c90de6be17508ff0b8adc0cd387e2c93df4b5a9747',
    blockHash: '0x0beb209f093ff53625404cfe0258a7b40bbfb8f1da655ce8d8cb371ae2d81dd1',
    before: '126839167935058336', after: '95129375951293760' },
  { date: '2026-09-01', block: 50745796, logIndex: 92,
    tx: '0x5750a5fb05993c4ca146c17eed4cf59320c9641140951fe8179a77c87ae24618',
    blockHash: '0x9f4d87c0343e413d3f7db3278a521f3c625b79f199bbaaf39fd8f218e0512014',
    before: '95129375951293760', after: '79274479959411466' },
  { date: '2026-10-01', block: 52037242, logIndex: 949,
    tx: '0xe7297702f9dfd683c9c645e3abb49888addd3e47e2d1fdebf89c6349008a2799',
    blockHash: '0x819f58898c9c137154c7e6d36bab9797b659eeae586d49e0b89f2e8308980d75',
    before: '79274479959411466', after: '63419583967529173' }
];

const annualRate = raw => Number(BigInt(raw) * 31_536_000n) / 1e18;
export const historicalEmissions = emissionCheckpoints.map(({ date, block, blockHash, logIndex, tx, before, after }) => ({
  date, block, blockHash, logIndex, tx, id: 'emissionRatePerYear',
  from: annualRate(before), to: annualRate(after),
  raw: { fromWeiPerSecond: before, toWeiPerSecond: after }
}));

// These are Venice's published *targets*, not a supply cap encoded in the table.
const expansion = new Map([
  ['0x50f788fa3d85df08a3036de164ddbcb0731d4861edd787a8a570b795dd4dae6d', [38000, 38500]],
  ['0x886145f8ed0652c7011c60925035e51547cd601f32d4b499abfbc656a0da33fb', [38500, 39000]],
  ['0x8ae564e1163b32927ea2a485300c1cd7b23e9ae68801ed7af34d35251f57ba54', [39000, 39500]],
  ['0x7398616bc77e480cca19624270e66b0a9ea7219ab782263d1c6f2993f59475ee', [39500, 40000]]
]);

export function labelCurveChange(change) {
  const targets = change.id === 'curveHash' && expansion.get(change.tx);
  if (!targets) return change;
  return { ...change, policyTarget: {
    from: targets[0], to: targets[1], sourceLabel: 'Venice schedule',
    sourceUrl: 'https://venice.ai/blog/tokenomics-update-credit-burns-and-diem-supply-expansion'
  } };
}

export function verifyEmissionCheckpoint(checkpoint, receipt, block, previous, current) {
  const matches = receipt.logs.filter(log => log.address.toLowerCase() === VVV.staking.toLowerCase() &&
    log.topics[0] === emissionTopic && Number(BigInt(log.logIndex)) === checkpoint.logIndex);
  const event = matches[0];
  if (matches.length !== 1 || event.removed || receipt.status !== '0x1' ||
      receipt.transactionHash !== checkpoint.tx || event.transactionHash !== checkpoint.tx ||
      Number(BigInt(receipt.blockNumber)) !== checkpoint.block || Number(BigInt(block.number)) !== checkpoint.block ||
      event.blockHash !== block.hash || receipt.blockHash !== block.hash || block.hash !== checkpoint.blockHash ||
      new Date(Number(BigInt(block.timestamp)) * 1000).toISOString().slice(0, 10) !== checkpoint.date ||
      BigInt(previous).toString() !== checkpoint.raw.fromWeiPerSecond ||
      BigInt(current).toString() !== checkpoint.raw.toWeiPerSecond || BigInt(event.data) !== BigInt(current)) {
    throw Error('Unverified emission-rate checkpoint at ' + checkpoint.tx);
  }
}

export async function verifyHistoricalEmissions(rpc) {
  for (const checkpoint of historicalEmissions) {
    const read = height => ({ method: 'eth_call', params: [
      { to: VVV.staking, data: '0xa80152d6' }, hex(height)
    ] });
    const replies = await rpc.batch([
      { method: 'eth_getTransactionReceipt', params: [checkpoint.tx] },
      { method: 'eth_getBlockByNumber', params: [hex(checkpoint.block), false] },
      read(checkpoint.block - 1), read(checkpoint.block)
    ]);
    verifyEmissionCheckpoint(checkpoint, ...replies);
  }
}
