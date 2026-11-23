import test from 'node:test';
import assert from 'node:assert/strict';
import { closingBlock, decodeFlows, decodeAudit, marginalAt, composeProtocol } from '../scripts/protocol.mjs';
import { VENICE, VVV } from '../lib/config.js';
import { hex, word, addressWord } from '../scripts/rpc.mjs';

const transfer = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const tx = '0x' + 'ab'.repeat(32),
  unit = 10n ** 18n;
const prior = {
  date: '2026-10-01',
  parameters: { cooldown: 10 },
  raw: { staked: String(5n * unit), diemSupply: '0' }
};
const row = {
  date: '2026-10-02',
  fromBlock: 11,
  toBlock: 20,
  parameters: { cooldown: 20 },
  raw: { dailyMinted: String(2n * unit), staked: String(5n * unit), diemSupply: '0' }
};
const event = {
  blockNumber: '0x10',
  logIndex: '0x2',
  transactionHash: tx,
  address: VVV.token,
  topics: [transfer, '0x' + word(0), '0x' + addressWord(VENICE.controlSafe)],
  data: '0x' + word(2n * unit)
};

test('finds the first UTC boundary across repeated timestamps and enforces finality', async () => {
  const midnight = Date.parse('2026-10-03T00:00:00Z') / 1000;
  const times = [-4, -2, -1, -1, 0, 0, 1];
  const rpc = {
    call: async (_, params) => {
      const i = Number(BigInt(params[0]));
      return {
        number: hex(i),
        timestamp: hex(midnight + times[i]),
        hash: 'h' + i,
        parentHash: 'h' + (i - 1)
      };
    }
  };
  const result = await closingBlock(rpc, row.date, 0, { block: 6, time: midnight + 1 });
  assert.equal(result.block, 3);
  await assert.rejects(closingBlock(rpc, row.date, 0, { block: 3, time: midnight - 1 }), /not finalized/);
});
test('mints reconcile to supply; a dropped mint and duplicate logs both fail', () => {
  const result = decodeFlows([event], row, prior);
  assert.equal(result.mintVenice, 2);
  assert.deepEqual(result.unexpectedMints, []);
  assert.throws(() => decodeFlows([], row, prior), /Mint logs/);
  assert.throws(() => decodeFlows([event, event], row, prior), /duplicated/);
  const unfamiliar = { ...event, topics: [...event.topics.slice(0, 2), '0x' + word(999)] };
  assert.equal(decodeFlows([unfamiliar], row, prior).unexpectedMints[0].tx, tx);
});
test('values stay exact in wei when checking for a missing mint', () => {
  assert.throws(
    () => decodeFlows([{ ...event, data: '0x' + word(2n * unit - 1n) }], row, prior),
    /Mint logs/
  );
});
test('governance includes a change and same-day reversal', () => {
  const update = (to, i) => ({
    ...event,
    address: VVV.staking,
    logIndex: hex(i),
    topics: ['0x3b919acbae27b7c60197957a5423655702d842fcc85c19c7631dc1c777f478f5'],
    data: '0x' + word(to)
  });
  const events = decodeAudit([update(30, 0), update(10, 1)], row, prior).ruleEvents;
  assert.deepEqual(
    events.map((e) => [e.from, e.to]),
    [
      [10, 30],
      [30, 10]
    ]
  );
  const result = composeProtocol(
    [prior, { ...row, parameters: { cooldown: 10 }, ruleEvents: events }],
    null,
    null
  );
  assert.equal(result.rules.changes.length, 2);
});
test('a transfer to the staking contract does not trigger a control-Safe outflow alert', () => {
  const out = {
    ...event,
    data: '0x' + word(251000n * unit),
    topics: [transfer, '0x' + addressWord(VENICE.controlSafe), '0x' + addressWord(VVV.staking)]
  };
  assert.deepEqual(decodeAudit([out], row, prior).largeOutflows, []);
  out.topics[2] = '0x' + word(1000);
  assert.equal(decodeAudit([out], row, prior).largeOutflows[0].amount, 251000);
  out.data = '0x' + word(250000n * unit);
  assert.deepEqual(decodeAudit([out], row, prior).largeOutflows, []);
  out.data = '0x' + word(250000n * unit + 1n);
  assert.equal(decodeAudit([out], row, prior).largeOutflows.length, 1);
});
test('a boundary supply uses the next DIEM price bucket', () => {
  assert.equal(marginalAt([hex(1000), hex(2n * unit), hex(500)], 500n), 2);
  assert.equal(marginalAt([hex(1000), hex(2n * unit), hex(500)], 1000n), null);
});
