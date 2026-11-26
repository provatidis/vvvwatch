import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export async function readPublished(base, expected, get = fetch) {
  const readings = await Promise.all(Object.entries(expected).map(async ([path, sha]) => {
    try {
      const reply = await get(new URL(path, base), {cache:'no-store', signal:AbortSignal.timeout(10_000)});
      if (!reply.ok) return {path, state:reply.status === 404 ? 'stale' : 'unavailable', detail:'HTTP ' + reply.status};
      const actual = createHash('sha256').update(Buffer.from(await reply.arrayBuffer())).digest('hex');
      return {path, state:actual === sha ? 'current' : 'stale', detail:'SHA-256 ' + actual.slice(0,12)};
    } catch (error) {
      return {path, state:'unavailable', detail:error.message};
    }
  }));
  return readings;
}

export async function verifyPublication({probe, requestRebuild, wait = sleep, log = console.log,
  attempts = 25, grace = 5, interval = 30_000}) {
  let requested = false;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const readings = await probe();
    log(readings.map(r => r.path + ' ' + r.state + ' (' + r.detail + ')').join(', '));
    if (readings.every(r => r.state === 'current')) return;

    // Give a branch-triggered deployment time to arrive before requesting one rebuild.
    if (!requested && requestRebuild && attempt >= grace && attempt < attempts && readings.some(r => r.state === 'stale')) {
      requested = true;
      try {
        await requestRebuild();
        log('Requested one GitHub Pages branch rebuild.');
      } catch (error) {
        // GitHub can accept the request even when the response times out.
        log('::warning::Pages rebuild request failed. Continuing the public checks. ' + error.message);
      }
    }
    if (attempt < attempts) await wait(interval);
  }
  throw Error('The public homepage and snapshot could not both be verified against this build.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const {EXPECTED_INDEX_SHA, EXPECTED_SNAPSHOT_SHA, PAGES_MODE, GITHUB_REPOSITORY} = process.env;
  const expected = {'/':EXPECTED_INDEX_SHA, '/data/latest.json':EXPECTED_SNAPSHOT_SHA};
  if (!Object.values(expected).every(hash => /^[0-9a-f]{64}$/.test(hash))) throw Error('Missing expected release hashes');
  if (!['legacy','workflow'].includes(PAGES_MODE)) throw Error('Unknown Pages publishing mode');
  const domain = (await readFile(new URL('../CNAME', import.meta.url), 'utf8')).trim();
  await verifyPublication({
    probe: () => readPublished('https://' + domain, expected),
    // Workflow-mode deployments are already submitted by actions/deploy-pages.
    requestRebuild: PAGES_MODE === 'legacy'
      ? () => exec('gh', ['api','--method','POST','repos/' + GITHUB_REPOSITORY + '/pages/builds','--silent'], {timeout:20_000})
      : null
  });
}
