import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeSnapshot } from '../lib/metrics.js';
import { planAlerts } from '../lib/alerts.js';
import { dataFile, readJSON, saveJSON } from './files.mjs';
import { collectContext } from './context.mjs';
import { refreshReference } from './burn-reference.mjs';
import { collectVestingHistory } from './vesting-history.mjs';
import { collectVesting } from './vesting.mjs';
import { collectWallets } from './wallets.mjs';
import { createRpc } from './rpc.mjs';

const failures = [];
if (!process.argv.includes('--compose-only')) {
  for (const name of ['protocol', 'burns']) {
    const script = fileURLToPath(new URL('./collect-' + name + '.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [script], {stdio: 'inherit'});
    if (run.error || run.status !== 0) {
      failures.push(name);
      console.error(name + ' collection failed. Retaining its last verified snapshot.');
    }
  }
}

const [protocol, rawBurns, previous, journal] = await Promise.all([
  readJSON(dataFile('protocol.json')), readJSON(dataFile('burns.json')),
  readJSON(dataFile('latest.json'), null), readJSON(dataFile('alerts.json'), null)
]);
const [context, vesting, reference] = await Promise.all([
  collectContext(previous, protocol.lastDay),
  collectVesting(previous?.vesting, protocol.lastDay),
  refreshReference(previous?.sales?.reference ?? rawBurns.sales.reference, protocol.lastDay)
]);
if (vesting) {
  try {
    vesting.history = await collectVestingHistory(createRpc(), protocol, vesting.totalStreams);
  } catch (error) {
    console.warn('Vesting history: ' + error.message);
    const prior = previous?.vesting?.history;
    vesting.history = prior?.blockHash === protocol.days.at(-1).blockHash && prior.asOf === protocol.lastDay ? prior : null;
  }
}
context.vesting = vesting;
rawBurns.sales.reference = reference;
const cached = previous?.treasury;
try {
  context.wallets = await collectWallets(createRpc(), protocol);
} catch (error) {
  console.warn('Wallet coverage: ' + error.message);
  failures.push('wallets');
  context.wallets = cached?.wallets?.length ? {asOf:cached.walletsAsOf,block:cached.walletsBlock,startBlock:cached.walletsStartBlock,
    wallets:cached.wallets,trackedSafeTotal:cached.trackedSafeTotal,trackedSafeChange30:cached.trackedSafeChange30} : null;
}
const latest = makeSnapshot(protocol, rawBurns, context, {failures});
const alerts = planAlerts(journal, latest);
const {alertEvidence, ...dashboard} = latest;
await saveJSON(dataFile('latest.json'), dashboard, {compact:true});
await saveJSON(dataFile('alerts.json'), alerts);
console.log('Supply through ' + latest.lastDay + ', purchases through ' + latest.sales.asOf + '.');
for (const check of latest.checks) console.log(check.state + ' | ' + check.title + ' | ' + check.text);
if (failures.length) process.exitCode = 2;
