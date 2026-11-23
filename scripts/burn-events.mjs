import { createHash } from 'node:crypto';
import { VVV, VENICE, POOLS, SALES, SALES_FROM, ZERO, DEAD } from '../lib/config.js';

export const transfer = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const topic = address => '0x' + address.toLowerCase().slice(2).padStart(64, '0');
const lower = value => value.toLowerCase();
const safe = lower(VENICE.buybackSafe), wallet = lower(VENICE.burnWallet);
const pool = lower(POOLS.aerodromeVvvWeth), burnedTo = [lower(ZERO), lower(DEAD)];
const ethereumHash = /^0x[0-9a-f]{64}$/i;
const token = lower(VVV.token), usdc = lower(SALES.usdc);
export const units = (raw, decimals) => Number(raw) / 10 ** decimals;

export const filters = {
  payments: {address: usdc, topics: [transfer, topic(wallet)]},
  funding: {address: usdc, topics:[transfer,null,topic(wallet)]},
  burns: {address: token, topics: [transfer, null, burnedTo.map(topic)]},
  acquired: {address: token, topics: [transfer, null, topic(safe)]},
  disposed: {address: token, topics: [transfer, topic(safe)]},
  spend: {address: usdc, topics: [transfer, topic(safe)]},
  refund: {address: usdc, topics: [transfer, null, topic(safe)]}
};

export function decodeLogs(logs, filter, fromBlock, toBlock) {
  if (!Array.isArray(logs)) throw Error('Missing log array');
  const seen = new Set();
  return logs.map(log => {
    const block = Number(BigInt(log.blockNumber)), index = Number(BigInt(log.logIndex));
    const key = block + '/' + index;
    if (seen.has(key) || log.removed || block < fromBlock || block > toBlock ||
        !ethereumHash.test(log.transactionHash) || !ethereumHash.test(log.blockHash) ||
        !ethereumHash.test(log.data) || !Array.isArray(log.topics) || log.topics.length !== 3 ||
        !log.topics.every(t => ethereumHash.test(t)) || lower(log.address) !== filter.address ||
        filter.topics.some((want, i) => want && ![want].flat().includes(lower(log.topics[i])))) {
      throw Error('Invalid or duplicate ERC-20 log at ' + key);
    }
    seen.add(key);
    return {block, index, tx: lower(log.transactionHash), hash: lower(log.blockHash),
      addr: lower(log.address), from: '0x' + lower(log.topics[1]).slice(-40),
      to: '0x' + lower(log.topics[2]).slice(-40), amount: BigInt(log.data)};
  }).sort((a, b) => a.block - b.block || a.index - b.index);
}

export function digestEvents(events) {
  const hash = createHash('sha256');
  for (const e of [...events].sort((a,b) => a.block-b.block || a.index-b.index))
    hash.update([e.block,e.hash,e.index,e.tx,e.addr,e.from,e.to,e.amount].join('|') + '\n');
  return hash.digest('hex');
}

const sum = events => events.reduce((total, log) => total + log.amount, 0n);
function group(events) {
  const groups = new Map();
  for (const e of events) {
    if (!groups.has(e.tx)) groups.set(e.tx, []);
    groups.get(e.tx).push(e);
  }
  return groups;
}

export function classifyPurchases({date, fromBlock, toBlock, blockHash}, payments, burns) {
  if (Date.parse(date + 'T00:00:00Z') < SALES_FROM * 1000) throw Error('Incomplete sales policy epoch: ' + date);
  const transfers = group(payments), sinks = group(burns);
  const result = {date, fromBlock, toBlock, blockHash, pro:0, proplus:0, max:0, credits:0,
    unknown:0, estimatedUsd:0, burnUsdc:0, confirmedBurnEvents:0};
  let recognized = 0n, unknownUsdc = 0n, salesVvv = 0n;
  const unknownReasons = {}, examples = {};
  const matched = new Set();
  for (const [tx, moves] of transfers) {
    const retired = sinks.get(tx) || [];
    const product = SALES.products[moves[0].amount.toString()];
    let reason;
    if (moves.length !== 1) reason = 'multiplePayments';
    else if (!product) reason = 'unrecognizedAmount';
    else if (!retired.length) reason = 'noBurn';
    else if (retired.length !== 1 || retired[0].from !== pool || retired[0].amount === 0n || moves[0].index >= retired[0].index) reason = 'unrecognizedRoute';
    if (reason) {
      result.unknown += moves.length;
      unknownUsdc += sum(moves);
      unknownReasons[reason] = (unknownReasons[reason] || 0) + moves.length;
      examples[reason] ??= tx;
      continue;
    }
    matched.add(tx);
    result[product.id]++;
    result.estimatedUsd += product.price;
    result.burnUsdc += product.burn;
    result.confirmedBurnEvents++;
    recognized += moves[0].amount;
    salesVvv += retired[0].amount;
    examples[product.id] ??= tx;
  }
  const monthly = sum(burns.filter(e => e.from === safe));
  const total = sum(burns);
  const other = total - salesVvv - monthly;
  const unpairedPoolBurns = burns.filter(e=>e.from===pool && !matched.has(e.tx)).length;
  return {...result,unknownReasons,examples,unpairedPoolBurns, burnSales:units(salesVvv,18), burnMonthly:units(monthly,18),
    burnOther:units(other,18), burnTx:sinks.size,
    raw:{salesVvv:String(salesVvv), monthlyVvv:String(monthly), otherVvv:String(other),
      recognizedUsdc:String(recognized), unknownUsdc:String(unknownUsdc)},
    evidenceSha256:digestEvents([...payments,...burns])};
}

export function reconcileCycle({opening, closing, fromBlock, toBlock, date, tx, priorTx, blockHash}, flows) {
  const received = group(flows.acquired), spent = group(flows.spend), refunds = group(flows.refund);
  let bought = 0n, purchaseCost = 0n, fillCount = 0, unrelatedOut = 0n;
  for (const [hash, debits] of spent) {
    const debit = sum(debits);
    const fills = received.get(hash) || [];
    const netPaid = debit - sum(refunds.get(hash) || []);
    if (fills.length && netPaid > 0n) {
      purchaseCost += netPaid;
      bought += sum(fills);
      fillCount++;
    } else unrelatedOut += debit;
  }
  const destroyed = flows.disposed.filter(e => e.tx === tx && burnedTo.includes(e.to));
  if (destroyed.length !== 1) throw Error('Expected one closing burn at ' + tx);
  const burned = sum(destroyed);
  const other = sum(flows.acquired) - bought - (sum(flows.disposed) - burned);
  if (opening + bought + other - burned !== closing) throw Error('Safe inventory mismatch at ' + tx);
  return {date, tx, priorTx, block:toBlock, fromBlock, toBlock, blockHash, openingVvv:units(opening,18),
    boughtVvv:units(bought,18), burnedVvv:units(burned,18), closingVvv:units(closing,18),
    spentUsdc:units(purchaseCost,6), otherVvv:units(other,18), unmatchedUsdcOut:units(unrelatedOut,6),
    verified: fillCount > 0 && unrelatedOut === 0n, fillCount,
    raw:{openingVvv:String(opening),boughtVvv:String(bought),burnedVvv:String(burned),
      closingVvv:String(closing),otherVvv:String(other),spentUsdc:String(purchaseCost),unmatchedUsdcOut:String(unrelatedOut)},
    evidenceSha256:digestEvents(Object.values(flows).flat())};
}
