import test from 'node:test';
import assert from 'node:assert/strict';
import { treasuryPanel } from '../lib/sections.js';

const wallet = (label, threshold, ownerCount, inGrade = true) => ({label, address:'0x' + '1'.repeat(40), role:'Treasury',
  attribution:'Same signers as the control Safe', sourceUrl:'https://venicestats.com/treasury', threshold, ownerCount, inGrade,
  vvv:1000, svvv:200, cooldown:0, diem:0, change30:-5});
const snapshot = wallets => ({supply:{effective:1e6, staked:4e5, locked:1e5}, treasury:{address:'0x' + '2'.repeat(40), vvv:1000, svvv:200, cooldown:0,
  wallets, walletsAsOf:'2026-11-25', walletsBlock:62304121, trackedSafeTotal:2400, trackedSafeChange30:-0.004}});

test('the wallet list shows each Safe’s signing threshold and replaces the separate control Safe block', () => {
  const html = treasuryPanel(snapshot([wallet('Control Safe', 4, 6), wallet('Liquidity Safe', 3, 6), wallet('Staking Wallet A', null, null, false)]));
  const cells = [...html.matchAll(/<td role="cell" data-label="Signers">([^<]*)<\/td>/g)].map(m => m[1]);
  assert.deepEqual(cells, ['4 of 6', '3 of 6', '—']);
  assert.match(html, /<span class="wallet-name">Liquidity Safe<\/span> <span class="wallet-check">Included<\/span>/);
  assert.match(html, /<span class="wallet-check">Context only<\/span>/);
  assert.match(html, /data-label="30-day change \(VVV\)">−5</);
  assert.doesNotMatch(html, /Control Safe holdings/);
  assert.match(html, /Signers is how many of a Safe’s owners must approve a transaction\./);
  assert.match(html, /<summary>Show protocol-wide staking<\/summary>/);
});

test('snapshots without a wallet list still show the control Safe block', () => {
  const html = treasuryPanel(snapshot([]));
  assert.match(html, /<h3>Control Safe holdings<\/h3>/);
  assert.match(html, /Total tracked<\/span><strong>1.2K<\/strong>/);
  assert.doesNotMatch(html, /wallet-table/);
});
