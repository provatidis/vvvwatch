import { createRpc, getFinalized, hex } from './rpc.mjs';
import { dataFile, readJSON, saveJSON } from './files.mjs';
import {
  stateRow,
  closingBlock,
  readState,
  readRules,
  readFlows,
  readAudit,
  composeProtocol,
  dayAfter,
  readMarginal
} from './protocol.mjs';

const rpc = createRpc(),
  file = dataFile('protocol.json'),
  prior = await readJSON(file, null);
if (BigInt(await rpc.call('eth_chainId', [])) !== 8453n) throw Error('Expected Base mainnet, chain ID 8453');
const finalized = await getFinalized(rpc);
const end = new Date(Math.min(Date.now(), finalized.time * 1000) - 86400000).toISOString().slice(0, 10);
const rows = prior?.days || [];
if (rows.length && rows.at(-1).date > end)
  throw Error('Provider finalized height is behind the saved series');
if (rows.length) {
  const anchor = rows.at(-1);
  const saved = await rpc.call('eth_getBlockByNumber', [hex(anchor.toBlock), false]);
  if (saved.hash !== anchor.blockHash) throw Error('Saved Base closing block no longer matches the provider');
}
const lastSaved = rows.at(-1)?.date;
const newRows = [];
for (let date = lastSaved ? dayAfter(lastSaved) : '2026-07-17'; date <= end; date = dayAfter(date)) {
  const previous = rows.at(-1);
  const point = await closingBlock(rpc, date, previous?.toBlock, finalized);
  const row = stateRow({ ...point, raw: await readState(rpc, point.block) }, previous);
  row.mintRate = await readMarginal(rpc, row);
  rows.push(row);
  newRows.push(rows.length - 1);
}
const last = rows.at(-1);
if (!last || last.date !== end) throw Error('No finalized protocol snapshot through ' + end);
const rules = await readRules(rpc, last);
// Capture intermediate Safe/curve snapshots on each missed day, not only the last missed day.
let rolling = prior?.rules;
for (const i of newRows) {
  const row = rows[i];
  const sampled = row === last ? rules : await readRules(rpc, row);
  rolling = composeProtocol(rows.slice(0, i + 1), sampled, rolling).rules;
}
let current = composeProtocol(rows, rules, rolling ?? prior?.rules);
const pending = rows
  .map((row, i) => (i > 0 && (!row.flowsVerified || !row.auditVerified) ? i : null))
  .filter((i) => i !== null);
const latestPending = pending.filter((i) => newRows.includes(i) || i === rows.length - 1);
const historic = pending.filter((i) => !latestPending.includes(i));
const cursor = prior?.repairCursor ?? '';
const older = historic.sort(
  (a, b) => Number(rows[a].date <= cursor) - Number(rows[b].date <= cursor) || a - b
);
const repairLimit = Number(process.env.PROTOCOL_REPAIR_DAYS ?? 1);
if (!Number.isSafeInteger(repairLimit) || repairLimit < 0)
  throw Error('PROTOCOL_REPAIR_DAYS must be a nonnegative integer');
const repair = process.argv.includes('--repair-all') ? older : older.slice(0, repairLimit);
const retry = [...new Set([...latestPending.reverse(), ...repair])];
const failures = [];
// Persist verified closing states before attempting optional historical log repair.
current.repairCursor = prior?.repairCursor ?? '';
await saveJSON(file, current);
for (const i of retry) {
  const row = rows[i],
    previous = rows[i - 1];
  for (const [verified, reader] of [
    ['flowsVerified', readFlows],
    ['auditVerified', readAudit]
  ]) {
    if (row[verified]) continue;
    try {
      Object.assign(row, await reader(rpc, row, previous));
    } catch (error) {
      failures.push(row.date + ' ' + verified + ': ' + error.message);
    }
  }
  // Every completed retry survives a later failure or a workflow timeout.
  current = composeProtocol(rows, rules, current.rules);
  current.repairCursor = repair.includes(i) ? row.date : (prior?.repairCursor ?? '');
  await saveJSON(file, current);
}
current = composeProtocol(rows, rules, current.rules);
current.repairCursor = repair.length ? rows[repair.at(-1)].date : (prior?.repairCursor ?? '');
await saveJSON(file, current);
for (const error of failures) console.warn(error);
console.log(
  'Protocol data through ' +
    last.date +
    ' (' +
    rows.length +
    ' finalized checkpoints, ' +
    rows.filter((r) => r.flowsVerified).length +
    ' fully reconciled flow days).'
);
