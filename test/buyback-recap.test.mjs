import assert from 'node:assert/strict';
import test from 'node:test';
import { buybackRecap } from '../lib/buyback-recap.js';

const previous = {date:'2026-10-07', block:1, tx:'october', blockHash:'a', burnVerified:true, verified:true,
  burnedVvv:100, openingVvv:300, spentUsdc:500, valuation:{block:1,blockHash:'a',usd:800,priceUsd:8}};
const current = {date:'2026-11-09', block:2, priorTx:'october', blockHash:'b', burnVerified:true, verified:true,
  burnedVvv:150, openingVvv:20, spentUsdc:200, valuation:{block:2,blockHash:'b',usd:600,priceUsd:4}};

test('the monthly recap distinguishes volume, block-end value, spending and inventory', () => {
  const text = buybackRecap(current, previous);
  assert.match(text, /7 Oct 2026 burn, the amount of VVV retired rose 50%/);
  assert.match(text, /value at the burn block fell 25%/);
  assert.match(text, /USDC spent on purchases fell 60%/);
  assert.match(text, /20 VVV in inventory, compared with 300 VVV/);
  assert.match(buybackRecap(current, {...previous,spentUsdc:0}), /rose from zero to 200 USDC/);
  assert.match(buybackRecap({...current,burnedVvv:100}, previous), /VVV retired was unchanged/);
});

test('each comparison requires the matching evidence', () => {
  for (const prior of [null, {...previous,tx:'older'}, {...previous,burnVerified:false}]) assert.equal(buybackRecap(current,prior), '');
  const partial = buybackRecap({...current,verified:false,valuation:{...current.valuation,blockHash:'wrong'}},previous);
  assert.match(partial, /VVV retired rose 50%/);
  assert.doesNotMatch(partial, /USDC|inventory|estimated value/);
});
