import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { readPublished, verifyPublication } from '../scripts/verify-publication.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const expected = {'/': hash('new HTML'), '/data/latest.json': hash('new JSON')};

test('the public page and the snapshot must both match the built release byte for byte', async () => {
  const read = (page, data) => readPublished('https://example.test', expected, async (url, options) => {
    assert.equal(options.cache, 'no-store');
    const value = url.pathname === '/' ? page : data;
    return typeof value === 'number' ? new Response(null, {status:value}) : new Response(value);
  }).then(readings => readings.map(r => r.state));
  assert.deepEqual(await read('new HTML','new JSON'), ['current','current']);
  assert.deepEqual(await read('old HTML','new JSON'), ['stale','current']);
  assert.deepEqual(await read('new HTML','old JSON'), ['current','stale']);
  assert.deepEqual(await read(503,404), ['unavailable','stale']);
});

function monitor(states, rebuild = true) {
  let probes = 0, requests = 0;
  const result = verifyPublication({
    probe: async () => [{path:'/',state:states[probes++] || 'stale',detail:'test'}],
    requestRebuild: rebuild ? async () => { requests++; if (rebuild instanceof Error) throw rebuild; } : null,
    wait: async () => {}, log: () => {}, attempts: 5, grace: 3
  });
  return {result, counts: () => [probes, requests]};
}

test('normal propagation completes without requesting another build', async () => {
  const run = monitor(['stale','current']);
  await run.result;
  assert.deepEqual(run.counts(), [2,0]);
});

test('legacy publication requests one rebuild after the grace period, even if its response is lost', async () => {
  const run = monitor(['stale','stale','stale','stale','current'], new Error('timeout'));
  await run.result;
  assert.deepEqual(run.counts(), [5,1]);
});

test('unreachable, stale and workflow-mode publications stop at the polling limit', async () => {
  for (const [states, rebuild, count] of [[Array(5).fill('unavailable'),true,0], [[],true,1], [[],false,0]]) {
    const run = monitor(states, rebuild);
    await assert.rejects(run.result, /could not both be verified/);
    assert.deepEqual(run.counts(), [5,count]);
  }
});
