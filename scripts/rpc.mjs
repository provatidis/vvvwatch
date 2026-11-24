import { setTimeout as delay } from 'node:timers/promises';
import { MULTICALL3, encodeAggregate3, decodeAggregate3 } from '../lib/multicall.js';

const publicNode = 'https://base-rpc.publicnode.com';
const base = 'https://mainnet.base.org';
const drpc = 'https://base.drpc.org';
const tenderly = 'https://base.gateway.tenderly.co';
export const hex = (n) => '0x' + BigInt(n).toString(16);
export const word = (n) => BigInt(n).toString(16).padStart(64, '0');
export const addressWord = (address) => address.toLowerCase().replace(/^0x/, '').padStart(64, '0');

export function createRpc({ customUrl = process.env.BASE_RPC_URL, fetcher = fetch } = {}) {
  const order = (method, params) => {
    if (method !== 'eth_getLogs')
      return [...new Set([customUrl, base, drpc, publicNode, tenderly].filter(Boolean))];
    const width = BigInt(params[0].toBlock) - BigInt(params[0].fromBlock) + 1n;
    const urls = [customUrl, publicNode, 'https://base.api.pocket.network', 'https://base.rpc.blxrbdn.com'];
    if (width <= 5000n) urls.push('https://base.public.blockpi.network/v1/rpc/public');
    if (width <= 1000n) urls.push(tenderly);
    return [...new Set([...urls, drpc, base].filter(Boolean))];
  };
  async function request(calls) {
    const errors = [];
    const urls = order(calls[0].method, calls[0].params);
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const url of urls) {
        try {
          const payload = calls.map(({ method, params }, i) => ({
            jsonrpc: '2.0',
            id: i + 1,
            method,
            params
          }));
          const response = await fetcher(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload.length === 1 ? payload[0] : payload),
            signal: AbortSignal.timeout(15_000)
          });
          if (!response.ok) throw Error('HTTP ' + response.status);
          const body = await response.json();
          const entries = Array.isArray(body) ? body : [body];
          const byId = new Map(entries.map((entry) => [entry.id, entry]));
          return payload.map(({ id }) => {
            const entry = byId.get(id);
            if (!entry || entry.error || entry.result == null)
              throw Error(entry?.error?.message || 'Missing RPC result');
            return entry.result;
          });
        } catch (error) {
          errors.push(error.message.replaceAll(customUrl || '----', '[custom RPC]'));
        }
      }
      if (!attempt) await delay(1200);
    }
    throw Error(calls[0].method + ' failed: ' + [...new Set(errors)].join(', '));
  }
  async function call(method, params) {
    const [result] = await request([{ method, params }]);
    return result;
  }
  async function batch(calls, size = 4) {
    const output = [];
    for (let i = 0; i < calls.length; i += size) output.push(...(await request(calls.slice(i, i + size))));
    return output;
  }
  return { call, batch };
}

export async function readContractWords(rpc, calls, block) {
  const packed = encodeAggregate3(calls.map(([to, data]) => ({ to, data, allowFailure: false })));
  const at = typeof block === 'object' ? block : hex(block);
  const raw = await rpc.call('eth_call', [{ to: MULTICALL3, data: packed }, at]);
  if (
    typeof raw !== 'string' ||
    !/^0x(?:[a-f0-9]{64}){2,}$/i.test(raw) ||
    BigInt('0x' + raw.slice(2, 66)) !== 32n ||
    BigInt('0x' + raw.slice(66, 130)) !== BigInt(calls.length)
  ) {
    throw Error('Malformed Multicall3 response at Base block ' + block);
  }
  const results = decodeAggregate3(raw);
  if (
    results.length !== calls.length ||
    results.some((r) => !r.success || !/^0x(?:[0-9a-f]{64})+$/i.test(r.data))
  ) {
    throw Error('Incomplete Multicall3 response at Base block ' + block);
  }
  return results.map((r) => r.data);
}

export async function getFinalized(rpc) {
  const block = await rpc.call('eth_getBlockByNumber', ['finalized', false]);
  if (!block?.number || !block.timestamp || !block.hash) throw Error('Invalid finalized Base block');
  return { block: Number(BigInt(block.number)), time: Number(BigInt(block.timestamp)), hash: block.hash };
}
