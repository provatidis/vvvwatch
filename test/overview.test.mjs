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
      windows: {90: {ratio:0.375, net:75}, 30: {start:'2026-01-16',end:'2026-02-14', ratio:0.35, priorRatio:0.25, minted:100, burned:35,
        previous:{start:'2025-12-17',end:'2026-01-15', minted:100, burned:25}}}},
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
  assert.doesNotMatch(html, /<!--\/?snapshot/);
  assert.match(html, /<summary>How the checks are graded<\/summary>/);
  assert.match(html, /id="rules-panel"><p class="empty">Rules and administrative controls are unavailable for this snapshot\.<\/p><\/div>/);
  assert.match(html, /id="ledger-summary"[^>]*><h3>30-day reconciliation<\/h3>/);
  assert.match(html, /id="ledger-summary-90"><h3>90-day reconciliation<\/h3>[\s\S]*?<dt>Burn cover<\/dt><dd>37\.5%/);
  assert.match(html, /id="ledger-90"[^>]*>[\s\S]*?<a href="#ledger-90" aria-current="location">90 days<\/a>/);
  assert.match(html, /id="holders-panel"><article class="panel">/);
  assert.match(html, /id="calc-example">Example for a first mint of 1 DIEM held for one year, using \$1 of credit per day/);
  assert.match(html, /<form id="diem-calc"[^>]* hidden>/);
  assert.match(html, /<fieldset [^>]*id="calc-controls"[^>]* disabled>/);
  assert.match(html, /id="calc-out" aria-live="polite"><p class="empty">DIEM supply or the mint curve is unavailable\.<\/p><\/div>/);
  const card = html.slice(html.indexOf('id="cover-value"'), html.indexOf('id="overview"'));
  const paragraphs = [...card.matchAll(/id="(cover-grade|cover-note|cover-recent|cover-drivers|cover-breakdown)"/g)];
  assert.deepEqual(paragraphs.map(match => match[1]), ['cover-grade','cover-note','cover-recent','cover-drivers','cover-breakdown']);
  assert.match(card, /class="badge watch">Watch</);
  assert.match(card, /id="cover-note">Over 90 days/);
  assert.match(card, /id="cover-recent">Burns covered 35\.0%[^<]*preceding 30 days\.<\/p>/);
  assert.match(card, /id="cover-drivers">The amount burned rose 40\.0%/);
  assert.match(html, /Break-even <b>100%<\/b>/);
  assert.match(html, /href="#ledger-90">View 90-day ledger/);
  assert.equal((html.match(/class="metric"/g) || []).length, 6);
  assert.match(html, /\$6\.51M</);
  assert.doesNotMatch(html, /\$79\.2M\/year/);
  assert.ok(html.includes('Test &lt;check&gt;'));
  assert.ok(html.includes('Cash $&amp; and &quot;$1&quot;.'));
  assert.doesNotMatch(html, /Loading daily snapshot|<!--snapshot:/);
  assert.equal(await readFile(join(dir, 'dist/data/latest.json'), 'utf8'), json);
  const notFound = await readFile(join(dir, 'dist/404.html'), 'utf8');
  assert.match(notFound, /href="\/"/);
  for (const scheme of ['light', 'dark']) {
    assert.ok(notFound.includes(`media="(prefers-color-scheme: ${scheme})"`));
  }
});

test('partial snapshots keep missing figures and grades explicit', () => {
  const view = overviewFragments({lastDay:'2026-02-14', checks:[]}, Date.UTC(2026, 1, 20));
  assert.equal(view['cover-value'], '—');
  assert.equal(view['cover-drivers'], '');
  assert.match(view['cover-grade'], /class="badge pending">Pending</);
  assert.match(view['check-list'], /Check results are unavailable/);
  assert.match(view.asof, /older snapshot/);
  assert.doesNotMatch(view.overview, /NaN|undefined|\$0\/year/);
});

test('the overview quotes qualifying credit purchase value for matching, reconciled days', () => {
  const end = Date.UTC(2026,10,24);
  const rows = Array.from({length:30},(_,i)=>({date:new Date(end-(29-i)*86_400_000).toISOString().slice(0,10),
    pro:1,proplus:0,max:0,credits:1,estimatedUsd:118}));
  const window30 = {estimatedUsd:3540,annualizedUsd:43070,start:rows[0].date,end:rows.at(-1).date};
  const note = (days, w=window30) => overviewFragments({lastDay:'2026-11-24',sales:{window30:w, days}}).overview;
  assert.match(note(rows),/At list prices · 85% from API credit purchases/);
  for (const invalid of [rows.slice(1),[rows[0],...rows.slice(0,-1)], [{...rows[0],credits:0},...rows.slice(1)]]) {
    assert.doesNotMatch(note(invalid), /% of this value/);
  }
  assert.doesNotMatch(note(rows,{...window30,estimatedUsd:3539}), /% of this value/);
  assert.doesNotMatch(note(rows,{...window30,estimatedUsd:0}), /% of this value/);
  assert.doesNotMatch(note(rows), /annualized|\/year/i);
});
