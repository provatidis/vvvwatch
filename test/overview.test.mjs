import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { overviewFragments } from '../lib/overview.js';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

test('the static build serves dated readings and escapes snapshot text in the initial HTML', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'vvvwatch-build-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  for (const name of ['package.json', '.nojekyll', 'CNAME', '404.html', 'app.js', 'styles.css', 'index.html', 'lib', 'assets', 'scripts']) {
    await cp(join(root, name), join(dir, name), {recursive:true});
  }
  const snapshot = {
    schemaVersion: 1, lastDay: '2026-02-14', evidence: {endBlock: 123456},
    supply: {history: [{date:'2026-02-14'}], effective: 1000, staked: 400,
      windows: {90: {ratio:0.375, net:75}, 30: {ratio:0.35, priorRatio:0.25}}},
    sales: {window30:{estimatedUsd:6512345, annualizedUsd:79233531}},
    checks: [{id:'cover', state:'watch', title:'Test <check>', text:'Cash $& and "$1".'}]
  };
  const json = JSON.stringify(snapshot);
  await mkdir(join(dir, 'data'));
  await writeFile(join(dir, 'data/latest.json'), json);
  await exec(process.execPath, ['scripts/build.mjs'], {cwd:dir});
  const html = await readFile(join(dir, 'dist/index.html'), 'utf8');
  assert.match(html, /14 Feb 2026 UTC/);
  assert.match(html, /id="cover-value">37\.5%<\/strong>/);
  assert.match(html, /class="badge watch">Watch</);
  assert.equal((html.match(/class="metric"/g) || []).length, 6);
  assert.match(html, /\$6\.51M</);
  assert.match(html, /\$79\.2M\/year at this 30-day pace/);
  assert.ok(html.includes('Test &lt;check&gt;'));
  assert.ok(html.includes('Cash $&amp; and &quot;$1&quot;.'));
  assert.doesNotMatch(html, /Loading daily snapshot|<!--snapshot:/);
  assert.equal(await readFile(join(dir, 'dist/data/latest.json'), 'utf8'), json);
  assert.match(await readFile(join(dir, 'dist/404.html'), 'utf8'), /href="\/"/);
});

test('partial snapshots keep missing figures and grades explicit', () => {
  const view = overviewFragments({lastDay:'2026-02-14', checks:[]}, Date.UTC(2026, 1, 20));
  assert.equal(view['cover-value'], '—');
  assert.match(view['cover-grade'], /class="badge pending">Pending</);
  assert.match(view['check-list'], /Check results are unavailable/);
  assert.match(view.asof, /older snapshot/);
  assert.doesNotMatch(view.overview, /NaN|undefined|\$0\/year/);
});
