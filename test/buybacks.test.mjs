import test from 'node:test';
import assert from 'node:assert/strict';
import { verifiedInventory } from '../scripts/buybacks.mjs';
import { SALES, VENICE, VVV, ZERO } from '../lib/config.js';

const safe = VENICE.buybackSafe;
const settlement = '0x9008d19f58aabd9ed0d60971565aa8510560ab41';
const buyTx = '0x' + 'ab'.repeat(32), burnTx = '0x' + 'cd'.repeat(32);
const wei = n => BigInt(n) * 10n ** 18n;
const prior = {block: 100, tx: '0x' + '11'.repeat(32), raw: {closingVvv: String(wei(2)), closingUsdc: '1000000000'}};
const burn = {date: '2026-11-09', block: 110, tx: burnTx, blockHash: '0x' + 'ee'.repeat(32),
  raw: {closingVvv: String(wei(4)), burnedVvv: String(wei(10)), closingUsdc: '900000000'}};
const log = (tx, index, tokenAddress, from, to, value) => ({
  blockNumber: tx === burnTx ? 110 : 105, transactionHash: tx, transferId: 'e'+tx.slice(2)+index,
  tokenAddress, from, to, value: String(value)
});
const transfers = [
  log(buyTx, 3, SALES.usdc, safe, settlement, 100000000),
  log(buyTx, 8, VVV.token, settlement, safe, wei(12)),
  log(burnTx, 21, VVV.token, safe, ZERO, wei(10))
];
test('Safe spending requires VVV and USDC inventory, a matched fill and the closing receipt', () => {
  const result = verifiedInventory(prior, burn, transfers);
  assert.equal(result.verified, true);
  assert.equal(result.spentUsdc, 100);
  assert.equal(result.closingVvv, 4);
  assert.equal(result.fillCount, 1);
  assert.throws(() => verifiedInventory(prior, burn, transfers.slice(1)), /USDC transfers/);
  assert.throws(() => verifiedInventory(prior, burn, [...transfers, transfers[0]]), /Invalid indexed/);
  assert.throws(() => verifiedInventory(prior, {...burn,raw:{...burn.raw,burnedVvv:'1'}}, transfers), /differs from receipt/);
});
