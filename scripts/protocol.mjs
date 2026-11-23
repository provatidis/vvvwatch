import { createHash } from 'node:crypto';
import { VVV, VENICE, ZERO, DEAD, SALES, RULES, IMPL_SLOT, POLICY_LOG } from '../lib/config.js';
import { addressWord, hex, word, readContractWords } from './rpc.mjs';
import { emissionTopic, historicalEmissions, labelCurveChange } from './historical-rules.mjs';

const UNIT = 10n ** 18n;
const YEAR = 365 * 86400;
const asUnits = (value, decimals = 18) => {
  const scale = 10n ** BigInt(decimals);
  return Number(value / scale) + Number(value % scale) / Number(scale);
};
const address = (value) => '0x' + value.slice(-40).toLowerCase();
const balance = (token, holder) => [token, '0x70a08231' + addressWord(holder)];
const transfer = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const stakingEvents = {
  '0x9e71bc8eea02a63969f509818f2dafb9254532904319f9dbda79b67bd34a5f3d': 'stakedIn',
  '0xc606a9f55fc42cd3159fcfc8ddcd749dd21c4574cca0b68a5a65d5f984b6c42c': 'exitsStarted',
  '0xc819022d26707b1e41f61d9adc9481024e27272d949e34a1dfec4d7abf168a33': 'exitsFinalized',
  '0xd081a649ef2f9530490e16b4ff4d6e1f46460e01107d1ecf7c576cca3cf9d357': 'diemMinted',
  '0x77e8c1608e07b1a4395fc907407d6244a50b86eead919f3ee61d8ce99e204bd6': 'diemBurned'
};
const fieldCalls = {
  minted: [VVV.token, '0x18160ddd'],
  zero: balance(VVV.token, ZERO),
  dead: balance(VVV.token, DEAD),
  staked: [VVV.staking, '0x18160ddd'],
  locked: [VVV.staking, '0x25bef746'],
  inStaking: balance(VVV.token, VVV.staking),
  diemSupply: [VVV.diem, '0x18160ddd'],
  diemStaked: [VVV.diem, '0x817b1cd2'],
  mintQuote: [VVV.staking, '0x87716cbf' + word(1000n * UNIT)],
  veniceVvv: balance(VVV.token, VENICE.controlSafe),
  veniceSvvv: balance(VVV.staking, VENICE.controlSafe),
  veniceDiem: balance(VVV.diem, VENICE.controlSafe),
  veniceStakes: [VVV.staking, '0x16934fc4' + addressWord(VENICE.controlSafe)],
  buybackVvv: balance(VVV.token, VENICE.buybackSafe),
  burnWalletUsdc: balance(SALES.usdc, VENICE.burnWallet),
  ...Object.fromEntries(RULES.map((rule) => [rule.id, [VVV[rule.to], rule.sel]]))
};
export async function readState(rpc, block) {
  const words = await readContractWords(rpc, Object.values(fieldCalls), block);
  return Object.fromEntries(Object.keys(fieldCalls).map((key, i) => [key, words[i]]));
}
export const dayAfter = (date) =>
  new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
export async function closingBlock(rpc, date, previousBlock, finalized) {
  const midnight = Date.parse(dayAfter(date) + 'T00:00:00Z') / 1000;
  if (finalized.time < midnight) throw Error('UTC day is not finalized: ' + date);
  const header = async (n) => {
    const b = await rpc.call('eth_getBlockByNumber', [hex(n), false]);
    if (!b || Number(BigInt(b.number)) !== n) throw Error('Invalid Base block ' + n);
    return { block: n, hash: b.hash, parentHash: b.parentHash, time: Number(BigInt(b.timestamp)) };
  };
  let low = previousBlock ?? 0,
    high = finalized.block;
  while (high - low > 1) {
    const mid = Math.floor((high + low) / 2);
    if ((await header(mid)).time < midnight) low = mid;
    else high = mid;
  }
  const [a, b] = await Promise.all([header(low), header(high)]);
  if (a.time >= midnight || b.time < midnight || a.hash !== b.parentHash)
    throw Error('UTC boundary mismatch: ' + date);
  return { date, block: low, hash: a.hash };
}
function ruleValues(raw) {
  return Object.fromEntries(
    RULES.map(({ id, format }) => {
      const v = raw[id];
      if (format === 'address') return [id, address(v)];
      if (format === 'perYear') return ['emissionRatePerYear', asUnits(BigInt(v) * BigInt(YEAR))];
      return [id, format === 'pct1e18' ? asUnits(BigInt(v)) : Number(BigInt(v))];
    })
  );
}

export function stateRow(point, previous) {
  const { date, block, hash, raw: words } = point;
  for (const key of Object.keys(fieldCalls)) {
    const pattern = key === 'veniceStakes' ? /^0x[0-9a-f]{192}$/i : /^0x[0-9a-f]{64}$/i;
    if (!pattern.test(words[key])) throw Error('Invalid ' + key + ' at ' + block);
  }
  if (previous && (dayAfter(previous.date) !== date || previous.toBlock >= block))
    throw Error('Non-contiguous protocol data');
  const amounts = {};
  for (const key of [
    'minted',
    'staked',
    'locked',
    'inStaking',
    'diemSupply',
    'diemStaked',
    'veniceVvv',
    'veniceSvvv',
    'veniceDiem',
    'buybackVvv',
    'burnWalletUsdc'
  ])
    amounts[key] = BigInt(words[key]);
  amounts.burned = BigInt(words.zero) + BigInt(words.dead);
  amounts.effective = amounts.minted - amounts.burned;
  amounts.veniceCooldown = BigInt('0x' + words.veniceStakes.slice(-64));
  if (amounts.effective < 0n || amounts.diemStaked > amounts.diemSupply || amounts.locked > amounts.staked)
    throw Error('Invalid contract balances at ' + block);
  if (previous) {
    amounts.dailyMinted = amounts.minted - BigInt(previous.raw.minted);
    amounts.dailyBurned = amounts.burned - BigInt(previous.raw.burned);
    if (
      amounts.dailyMinted < 0n ||
      amounts.dailyBurned < 0n ||
      amounts.effective - BigInt(previous.raw.effective) !== amounts.dailyMinted - amounts.dailyBurned
    )
      throw Error('Supply reconciliation failed: ' + date);
  }
  const quote = BigInt(words.mintQuote);
  if (quote <= 0n) throw Error('Zero DIEM mint quote at ' + block);
  return {
    date,
    fromBlock: previous ? previous.toBlock + 1 : null,
    toBlock: block,
    blockHash: hash,
    dailyMinted: null,
    dailyBurned: null,
    ...Object.fromEntries(
      Object.entries(amounts).map(([k, v]) => [k, asUnits(v, k === 'burnWalletUsdc' ? 6 : 18)])
    ),
    mintRate: 1000 / asUnits(quote),
    raw: Object.fromEntries(Object.entries(amounts).map(([k, v]) => [k, v.toString()])),
    parameters: ruleValues(words),
    mintVenice: null,
    mintStakers: null,
    mintOther: null,
    stakedIn: null,
    exitsStarted: null,
    exitsFinalized: null,
    diemMinted: null,
    diemBurned: null,
    unexpectedMints: null,
    flowsVerified: false,
    ruleEvents: null,
    largeOutflows: null,
    externalOutflow: null,
    auditVerified: false
  };
}

export function decodeFlows(logs, row, previous) {
  const sums = {
    mintVenice: 0n,
    mintStakers: 0n,
    mintOther: 0n,
    stakedIn: 0n,
    exitsStarted: 0n,
    exitsFinalized: 0n,
    diemMinted: 0n,
    diemBurned: 0n
  };
  const seen = new Set(),
    unexpectedMints = [];
  for (const log of logs) {
    const block = Number(BigInt(log.blockNumber));
    const index = Number(BigInt(log.logIndex));
    const key = block + '/' + index;
    if (
      log.removed ||
      !row.fromBlock ||
      block < row.fromBlock ||
      block > row.toBlock ||
      seen.has(key) ||
      !/^0x[0-9a-f]{64}$/i.test(log.transactionHash)
    )
      throw Error('Invalid or duplicated protocol log: ' + key);
    seen.add(key);
    const target = log.address.toLowerCase(),
      topic = log.topics[0].toLowerCase();
    let field;
    if (
      target === VVV.token.toLowerCase() &&
      topic === transfer &&
      log.topics.length === 3 &&
      BigInt(log.topics[1]) === 0n
    ) {
      if (!/^0x[0-9a-f]{64}$/i.test(log.data)) throw Error('Invalid VVV mint data');
      const dest = address(log.topics[2]);
      field =
        dest === VENICE.controlSafe.toLowerCase()
          ? 'mintVenice'
          : dest === VVV.staking.toLowerCase()
            ? 'mintStakers'
            : 'mintOther';
      if (field === 'mintOther')
        unexpectedMints.push({
          date: row.date,
          block,
          tx: log.transactionHash,
          to: dest,
          amount: asUnits(BigInt(log.data))
        });
    } else if (target === VVV.staking.toLowerCase() && Object.hasOwn(stakingEvents, topic)) {
      field = stakingEvents[topic];
      const two = field === 'diemMinted' || field === 'diemBurned';
      if (log.data.length !== (two ? 130 : 66)) throw Error('Invalid ' + field + ' log');
    } else throw Error('Unexpected event in filtered response');
    sums[field] += BigInt('0x' + log.data.slice(-64));
  }
  if (sums.mintVenice + sums.mintStakers + sums.mintOther !== BigInt(row.raw.dailyMinted))
    throw Error('Mint logs disagree with supply on ' + row.date);
  if (BigInt(row.raw.staked) - BigInt(previous.raw.staked) !== sums.stakedIn - sums.exitsStarted)
    throw Error('Staking logs disagree with supply on ' + row.date);
  if (BigInt(row.raw.diemSupply) - BigInt(previous.raw.diemSupply) !== sums.diemMinted - sums.diemBurned)
    throw Error('DIEM logs disagree with supply on ' + row.date);
  return {
    ...Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, asUnits(v)])),
    unexpectedMints,
    flowsVerified: true
  };
}
export async function readLogRanges(rpc, row, filters) {
  const logs = [];
  async function read(filter, from, to) {
    let rows;
    try {
      rows = await rpc.call('eth_getLogs', [{ ...filter, fromBlock: hex(from), toBlock: hex(to) }]);
    } catch (error) {
      if (to - from < 5000) throw error;
      // Some archive providers only serve a 5,000-block log range.
      for (let start = from; start <= to; start += 5000)
        await read(filter, start, Math.min(start + 4999, to));
      return;
    }
    if (!Array.isArray(rows)) throw Error('Invalid Base log response');
    logs.push(...rows);
  }
  for (let from = row.fromBlock; from <= row.toBlock; from += 50000) {
    for (const filter of filters) await read(filter, from, Math.min(from + 49999, row.toBlock));
  }
  return logs;
}
export async function readFlows(rpc, row, previous) {
  const logs = await readLogRanges(rpc, row, [
    { address: VVV.token, topics: [transfer, '0x' + word(0)] },
    { address: VVV.staking, topics: [Object.keys(stakingEvents)] }
  ]);
  return decodeFlows(logs, row, previous);
}

export function extendedRuleCalls() {
  const list = [
    ...['controlSafe', 'buybackSafe'].flatMap((key) => [
      [VENICE[key], '0xe75235b8'],
      [VENICE[key], '0xa0e67e2b']
    ])
  ];
  for (let i = 0; i < 256; i++)
    list.push([VVV.staking, '0xb4f70f72' + word(i)], [VVV.staking, '0xe3a68402' + word(i)]);
  return list;
}
export function decodeRules(row, words, slot) {
  if (words.length !== 516 || !/^0x[0-9a-f]{64}$/i.test(slot)) throw Error('Invalid rules response');
  function safe(i) {
    const threshold = Number(BigInt(words[i])),
      data = words[i + 1].slice(2);
    if (BigInt('0x' + data.slice(0, 64)) !== 32n) throw Error('Invalid Safe owner array');
    const count = Number(BigInt('0x' + data.slice(64, 128)));
    if (count < 1 || threshold < 1 || threshold > count || data.length !== 128 + 64 * count)
      throw Error('Invalid Safe owners or threshold');
    const owners = Array.from({ length: count }, (_, j) =>
      address(data.slice(128 + j * 64, 192 + j * 64))
    ).sort();
    if (new Set(owners).size !== count) throw Error('Duplicate Safe owner');
    return { threshold, owners };
  }
  const curve = [],
    hash = createHash('sha256');
  let previous = 0n;
  for (let i = 4; i < words.length; i += 2) {
    const supply = BigInt(words[i]),
      rate = BigInt(words[i + 1]);
    if (supply <= previous || rate === 0n) throw Error('Invalid DIEM curve');
    previous = supply;
    curve.push({ supply: asUnits(supply), rate: asUnits(rate) });
    hash.update(Buffer.from(words[i].slice(2) + words[i + 1].slice(2), 'hex'));
  }
  return {
    asOf: row.date,
    block: row.toBlock,
    values: {
      ...row.parameters,
      implementation: address(slot),
      controlSafe: safe(0),
      buybackSafe: safe(2),
      curve,
      curveHash: hash.digest('hex')
    }
  };
}
export async function readRules(rpc, row) {
  const calls = extendedRuleCalls(),
    words = [];
  for (let i = 0; i < calls.length; i += 64)
    words.push(...(await readContractWords(rpc, calls.slice(i, i + 64), row.toBlock)));
  const slot = await rpc.call('eth_getStorageAt', [VVV.staking, IMPL_SLOT, hex(row.toBlock)]);
  return decodeRules(row, words, slot);
}

export function composeProtocol(rows, ruleSnapshot, priorRules) {
  if (!rows.length) throw Error('Empty protocol series');
  const last = rows.at(-1),
    changes = [...(priorRules?.changes || [])];
  const knownLogs = new Map(changes.map((c, i) => [c.tx + '/' + c.logIndex, i]));
  for (const row of rows)
    for (const event of row.ruleEvents || []) {
      const key = event.tx + '/' + event.logIndex;
      if (!knownLogs.has(key)) {
        knownLogs.set(key, changes.length);
        changes.push(event);
      } else if (event.from !== null) {
        changes[knownLogs.get(key)] = { ...changes[knownLogs.get(key)], ...event };
      }
    }
  for (const checkpoint of historicalEmissions) {
    if (checkpoint.block > last.toBlock) continue;
    const key = checkpoint.tx + '/' + checkpoint.logIndex;
    if (knownLogs.has(key)) changes[knownLogs.get(key)] = checkpoint;
    else changes.push(checkpoint);
  }
  const sourced = new Set(changes.filter((c) => c.tx).map((c) => c.date + '/' + c.id));
  const keys = new Set(changes.map((c) => c.date + '/' + c.id + '/' + JSON.stringify(c.to)));
  function record(row, id, from, to) {
    const key = row.date + '/' + id + '/' + JSON.stringify(to);
    if (JSON.stringify(from) !== JSON.stringify(to) && !keys.has(key) && !sourced.has(row.date + '/' + id)) {
      changes.push({ date: row.date, block: row.toBlock, id, from, to, tx: null });
      keys.add(key);
    }
  }
  for (let i = 1; i < rows.length; i++)
    for (const id of Object.keys(rows[i].parameters))
      record(rows[i], id, rows[i - 1].parameters[id], rows[i].parameters[id]);
  if (ruleSnapshot?.asOf === last.date && priorRules?.values?.curveHash)
    for (const id of ['implementation', 'controlSafe', 'buybackSafe', 'curveHash']) {
      record(last, id, priorRules.values[id], ruleSnapshot.values[id]);
    }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    lastDay: last.date,
    source: {
      name: 'Base mainnet · finalized UTC closing blocks',
      url: 'https://basescan.org/token/' + VVV.token,
      staking: 'https://basescan.org/address/' + VVV.staking,
      diem: 'https://basescan.org/token/' + VVV.diem,
      methods: {
        dailyMinted: 'Exact change in VVV totalSupply',
        dailyBurned: 'Exact change in zero-address and dead-address balances',
        diemStaked: 'Includes deposits pending withdrawal',
        mintRate: 'Marginal sVVV per DIEM in the current onchain bucket',
        mintVenice: 'VVV minted directly to the control Safe',
        externalOutflow: 'Control Safe VVV transfers excluding both Safes, staking and burn addresses'
      }
    },
    coverage: {
      firstClosingCheckpoint: rows[0].date,
      verifiedFlowDays: rows.filter((r) => r.flowsVerified).length,
      verifiedAuditDays: rows.filter((r) => r.auditVerified).length
    },
    days: rows,
    rules: {
      ...(ruleSnapshot || priorRules || { asOf: last.date, block: last.toBlock, values: last.parameters }),
      changes: changes
        .filter((c) => c.tx || !sourced.has(c.date + '/' + c.id))
        .map(labelCurveChange)
        .sort((a, b) => a.block - b.block || (a.logIndex ?? 0) - (b.logIndex ?? 0))
    },
    policy: POLICY_LOG.filter((event) => event.date <= last.date)
  };
}

const governanceTopics = {
  [emissionTopic]: 'emissionRatePerYear',
  '0x3fa751adc7d77b89491ef674a701215e6998cd5d3d73b083cc69e15c85f0790d': 'venicePct',
  '0x38a604e8a36592c14768cd04d016e8f0be9e11c140f1643cd8d4266f9e28e9e4': 'venicePctLocked',
  '0x3b919acbae27b7c60197957a5423655702d842fcc85c19c7631dc1c777f478f5': 'cooldown',
  '0x7dae230f18360d76a040c81f050aa14eb9d6dc7901b20fc5d855e2a20fe814d1': 'treasury',
  '0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0': 'ownership',
  '0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b': 'implementation',
  '0xa17dd66150b8ad4ee99c4d23c5cdbb44eaa4076e6e1d854c3005aa021511da5a': 'curveHash',
  '0x9465fa0c962cc76958e6373a993326400c1c94f8be2fe3a952adfa7f60b2ea26': 'ownerAdded',
  '0xf8d49fc529812e9a7c5c50e69c20f0dccc0db8fa95c98bc58cc9a4f1c1299eaf': 'ownerRemoved',
  '0x610f7ff2b304ae8903c3de74c60c6ab1f7d6226b3f52c5161905bb5ad4039c93': 'threshold',
  '0x2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d': 'roleGranted',
  '0xf6391f5c32d9c69d2a47ea670b442974b53935d1edc7fd64eb21e047a839171b': 'roleRevoked'
};
export const auditFilters = [
  {
    address: [VVV.token, VVV.staking, VVV.diem, VENICE.controlSafe, VENICE.buybackSafe],
    topics: [Object.keys(governanceTopics)]
  },
  { address: VVV.token, topics: [transfer, '0x' + addressWord(VENICE.controlSafe)] }
];
function readChange(log, row, previousValue) {
  const contract = log.address.toLowerCase();
  let id = governanceTopics[log.topics[0]],
    from = null,
    to;
  const scalar = log.topics[1] || log.data;
  switch (id) {
    case 'emissionRatePerYear':
      to = asUnits(BigInt(log.data) * BigInt(YEAR));
      break;
    case 'venicePct':
    case 'venicePctLocked':
      to = asUnits(BigInt(log.data));
      break;
    case 'cooldown':
      if (contract === VVV.diem.toLowerCase()) id = 'diemCooldown';
      to = Number(BigInt(log.data));
      break;
    case 'treasury':
    case 'implementation':
      to = address(scalar);
      break;
    case 'ownership': {
      id = contract === VVV.token.toLowerCase() ? 'vvvOwner' : 'stakingOwner';
      from = address(log.topics[1]);
      to = address(log.topics[2]);
      break;
    }
    case 'curveHash': {
      const values = log.data.slice(2).match(/.{64}/g);
      if (values?.length !== 512) throw Error('Invalid curve update');
      const hash = createHash('sha256');
      for (let i = 0; i < 256; i++) hash.update(Buffer.from(values[i] + values[i + 256], 'hex'));
      to = hash.digest('hex');
      break;
    }
    case 'roleGranted':
    case 'roleRevoked': {
      to = id === 'roleGranted';
      from = !to;
      id = 'DIEM role ' + log.topics[1] + ' for ' + address(log.topics[2]);
      break;
    }
    case 'ownerAdded':
    case 'ownerRemoved':
    case 'threshold': {
      const safe = contract === VENICE.controlSafe.toLowerCase() ? 'controlSafe.' : 'buybackSafe.';
      if (id === 'threshold') {
        id = safe + 'threshold';
        to = Number(BigInt(scalar));
      } else {
        to = id === 'ownerAdded';
        from = !to;
        id = safe + 'owner ' + address(scalar);
      }
      break;
    }
    default:
      throw Error('Unknown governance event');
  }
  if (from === null && previousValue.has(id)) from = previousValue.get(id);
  previousValue.set(id, to);
  return {
    date: row.date,
    block: Number(BigInt(log.blockNumber)),
    logIndex: Number(BigInt(log.logIndex)),
    id,
    from,
    to,
    tx: log.transactionHash
  };
}
export function decodeAudit(logs, row, previous) {
  const ruleEvents = [],
    outgoing = [];
  const previousValue = new Map(Object.entries(previous.parameters));
  let gross = 0n;
  const internal = new Set(
    [VENICE.controlSafe, VENICE.buybackSafe, VVV.staking, ZERO, DEAD].map((a) => a.toLowerCase())
  );
  const unique = new Set();
  for (const log of [...logs].sort(
    (a, b) =>
      Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) || Number(BigInt(a.logIndex) - BigInt(b.logIndex))
  )) {
    const block = Number(BigInt(log.blockNumber)),
      key = block + '/' + log.logIndex;
    if (
      !Number.isSafeInteger(block) ||
      block < row.fromBlock ||
      block > row.toBlock ||
      log.removed ||
      unique.has(key) ||
      !/^0x[\da-f]{64}$/i.test(log.transactionHash)
    )
      throw Error('Invalid control event');
    unique.add(key);
    if (log.topics[0] !== transfer) {
      ruleEvents.push(readChange(log, row, previousValue));
      continue;
    }
    if (
      log.address.toLowerCase() !== VVV.token.toLowerCase() ||
      address(log.topics[1]) !== VENICE.controlSafe.toLowerCase()
    )
      throw Error('Unexpected treasury transfer');
    const dest = address(log.topics[2]);
    if (internal.has(dest)) continue;
    const amount = BigInt(log.data);
    gross += amount;
    outgoing.push({
      date: row.date,
      block,
      tx: log.transactionHash,
      from: VENICE.controlSafe,
      to: dest,
      amount: asUnits(amount)
    });
  }
  return {
    ruleEvents,
    externalOutflow: asUnits(gross),
    largeOutflows: gross > 250000n * UNIT ? outgoing : [],
    auditVerified: true
  };
}
export async function readAudit(rpc, row, previous) {
  return decodeAudit(await readLogRanges(rpc, row, auditFilters), row, previous);
}

// Estimate the bucket index from the original 500-DIEM spacing, then verify both
// bounds against the actual table. A replacement curve falls back to binary search.
export function marginalCalls(index) {
  return [
    [VVV.staking, '0xb4f70f72' + word(index)],
    [VVV.staking, '0xe3a68402' + word(index)],
    ...(index > 0 ? [[VVV.staking, '0xb4f70f72' + word(index - 1)]] : [])
  ];
}
export function marginalAt(words, supply) {
  const upper = BigInt(words[0]),
    rate = BigInt(words[1]),
    lower = words.length === 3 ? BigInt(words[2]) : 0n;
  if (rate === 0n) throw Error('Zero DIEM bucket rate');
  return lower <= supply && supply < upper ? asUnits(rate) : null;
}
export async function readMarginal(rpc, row) {
  const supply = BigInt(row.raw.diemSupply);
  let low = 0,
    high = 255,
    index = Math.min(255, Number(supply / (500n * UNIT)));
  while (low <= high) {
    const values = await readContractWords(rpc, marginalCalls(index), row.toBlock);
    const rate = marginalAt(values, supply);
    if (rate !== null) return rate;
    if (supply >= BigInt(values[0])) low = index + 1;
    else high = index - 1;
    index = Math.floor((low + high) / 2);
  }
  throw Error('DIEM supply exceeds all mint buckets');
}
