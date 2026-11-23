import assert from 'node:assert/strict';
import test from 'node:test';
import { VVV } from '../lib/config.js';
import { composeProtocol } from '../scripts/protocol.mjs';
import { emissionTopic, historicalEmissions, labelCurveChange, verifyEmissionCheckpoint } from '../scripts/historical-rules.mjs';

test('historical emissions require a canonical receipt, exact previous rate and matching event', () => {
  const cut = historicalEmissions[0];
  const log = {
    address: VVV.staking, logIndex: '0x' + cut.logIndex.toString(16), topics: [emissionTopic],
    transactionHash: cut.tx, blockHash: cut.blockHash, data: '0x' + BigInt(cut.raw.toWeiPerSecond).toString(16)
  };
  const block = { number: '0x' + cut.block.toString(16), hash: cut.blockHash, timestamp: Date.parse(cut.date) / 1000 };
  const receipt = { status: '0x1', logs: [log], transactionHash: cut.tx, blockNumber: block.number, blockHash: cut.blockHash };
  const verify = (input, previous = cut.raw.fromWeiPerSecond) =>
    verifyEmissionCheckpoint(cut, input, block, previous, cut.raw.toWeiPerSecond);
  verify(receipt);
  assert.throws(() => verify(receipt, '1'), /Unverified/);
  assert.throws(() => verify({ ...receipt, logs: [{ ...log, data: '0x1' }] }), /Unverified/);
  assert.throws(() => verify({ ...receipt, blockHash: cut.tx }), /Unverified/);
  assert.throws(() => verify({ ...receipt, logs: [log, log] }), /Unverified/);
});

test('rule history is cutoff-aware, idempotent, and binds published targets to known curve transactions only', () => {
  const cut = historicalEmissions[0];
  const first = { date: cut.date, toBlock: cut.block, parameters: {}, ruleEvents: [{ ...cut, raw: undefined }] };
  const initial = composeProtocol([first], null, null);
  assert.deepEqual(initial.rules.changes, [cut]);
  assert.deepEqual(composeProtocol([first], null, initial.rules).rules.changes, [cut]);
  const early = composeProtocol([{ ...first, date: '2025-01-26', toBlock: cut.block-1, ruleEvents: [] }], null, null);
  assert.deepEqual(early.rules.changes, []);
  assert.deepEqual(early.policy, []);
  const tx = '0x7398616bc77e480cca19624270e66b0a9ea7219ab782263d1c6f2993f59475ee';
  assert.equal(labelCurveChange({ id: 'curveHash', tx }).policyTarget.to, 40000);
  assert.equal(labelCurveChange({ id: 'curveHash', tx: cut.tx }).policyTarget, undefined);
});
