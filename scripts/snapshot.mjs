import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeSnapshot } from '../lib/metrics.js';
import { planAlerts } from '../lib/alerts.js';
import { dataFile, readJSON, saveJSON } from './files.mjs';
import { collectContext } from './context.mjs';

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
const context = await collectContext(previous, protocol.lastDay);
const latest = makeSnapshot(protocol, rawBurns, context, {failures});
const alerts = planAlerts(journal, latest);
await saveJSON(dataFile('latest.json'), latest);
await saveJSON(dataFile('alerts.json'), alerts);
console.log('Supply through ' + latest.lastDay + ', purchases through ' + latest.sales.asOf + '.');
for (const check of latest.checks) console.log(check.state + ' | ' + check.title + ' | ' + check.text);
if (failures.length) process.exitCode = 2;
