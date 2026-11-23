import assert from 'node:assert/strict';
import { DEAD, VVV, ZERO } from '../lib/config.js';
import { dayOffset } from '../lib/metrics.js';
import { dataFile, readJSON } from './files.mjs';
import { addressWord, createRpc, hex } from './rpc.mjs';
import { deploymentBlock, emissionTopic, verifyHistoricalEmissions } from './historical-rules.mjs';
import { readLogRanges } from './protocol.mjs';

// Read the token itself at each boundary, independently of the event collectors.
const rpc = createRpc();
const snapshot = await readJSON(dataFile('latest.json'));
const checkpoints = new Map();
function readBoundary(blockNumber, day) {
  if (!checkpoints.has(blockNumber)) checkpoints.set(blockNumber, (async () => {
    const tag = hex(blockNumber);
    const calls = ['0x18160ddd', '0x70a08231' + addressWord(ZERO), '0x70a08231' + addressWord(DEAD)]
      .map(data => ({method: 'eth_call', params: [{to: VVV.token, data}, tag]}));
    const [total, zero, dead, block, next] = await rpc.batch([...calls,
      {method: 'eth_getBlockByNumber', params: [tag, false]},
      {method: 'eth_getBlockByNumber', params: [hex(blockNumber + 1), false]}]);
    const midnight = Date.parse(dayOffset(day, 1) + 'T00:00:00Z') / 1000;
    assert.equal(Number(BigInt(block.number)), blockNumber);
    assert.equal(Number(BigInt(next.number)), blockNumber + 1);
    assert.equal(next.parentHash, block.hash);
    assert(Number(BigInt(block.timestamp)) < midnight && Number(BigInt(next.timestamp)) >= midnight,
      'Block ' + blockNumber + ' must be the final block of ' + day);
    return {minted: BigInt(total), burned: BigInt(zero) + BigInt(dead)};
  })());
  return checkpoints.get(blockNumber);
}

for (const [days, window] of Object.entries(snapshot.supply.windows)) {
  assert(window, 'Missing ' + days + '-day window');
  const previousDay = dayOffset(window.start, -1);
  const [start, end] = await Promise.all([
    readBoundary(window.startBlock, previousDay), readBoundary(window.endBlock, window.end)
  ]);
  for (const key of ['minted', 'burned']) {
    const tokens = Number(end[key] - start[key]) / 1e18;
    assert(Math.abs(tokens - window[key]) < 0.000001, days + '-day ' + key + ' disagrees with Base');
  }
  console.log(days + ' days verified against Base blocks ' + window.startBlock + ' and ' + window.endBlock);
}

if (process.argv.includes('--rules') || process.argv.includes('--scan-rules')) {
  await verifyHistoricalEmissions(rpc);
  console.log('Historical emission receipts and their previous and new contract rates verified.');
}
if (process.argv.includes('--scan-rules')) {
  const logs = await readLogRanges(rpc, { fromBlock: deploymentBlock, toBlock: snapshot.evidence.endBlock }, [
    { address: VVV.staking, topics: [emissionTopic] }
  ]);
  const recorded = snapshot.rules.changes.filter(change => change.id === 'emissionRatePerYear' && change.tx)
    .map(change => change.tx + '/' + change.logIndex).sort();
  const observed = logs.map(log => {
    assert(!log.removed && log.address.toLowerCase() === VVV.staking.toLowerCase() && log.topics[0] === emissionTopic);
    return log.transactionHash + '/' + Number(BigInt(log.logIndex));
  }).sort();
  assert.deepEqual(observed, recorded, 'Emission history differs from the full proxy event log');
  console.log(observed.length + ' rate changes across Base blocks ' + deploymentBlock + '–' + snapshot.evidence.endBlock);
}
