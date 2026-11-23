// Multicall3's aggregate3 reads several contracts against the same Base block.
export const MULTICALL3 = '0xca11bde05977b3631167028862be2a173976ca11'; // same address on every chain we use

const strip = h => String(h).replace(/^0x/, '').toLowerCase();
const word = n => BigInt(n).toString(16).padStart(64, '0');
const padRight = h => h.padEnd(Math.ceil(h.length / 64) * 64, '0');

// Encodes an array of dynamic tuples: a length, one offset per element, then the elements.
function encodeArray(elems) {
  let offset = elems.length * 32;
  const offsets = elems.map(e => { const o = word(offset); offset += e.length / 2; return o; });
  return word(0x20) + word(elems.length) + offsets.join('') + elems.join('');
}

// calls: [{ to, data, allowFailure = true }]
export function encodeAggregate3(calls) {
  return '0x82ad56cb' + encodeArray(calls.map(c => {
    const d = strip(c.data);
    return strip(c.to).padStart(64, '0') + word(c.allowFailure === false ? 0 : 1) + word(0x60) + word(d.length / 2) + padRight(d);
  }));
}

// Returns [{ success, data }] for aggregate3's (bool success, bytes returnData)[].
export function decodeAggregate3(result) {
  const h = strip(result);
  const at = byte => BigInt('0x' + (h.slice(byte * 2, byte * 2 + 64) || '0'));
  const base = Number(at(0));
  const n = Number(at(base));
  const start = base + 32;
  const out = [];
  for (let k = 0; k < n; k++) {
    const e = start + Number(at(start + k * 32));
    const d = e + Number(at(e + 32));
    const len = Number(at(d));
    out.push({ success: at(e) === 1n, data: '0x' + h.slice((d + 32) * 2, (d + 32 + len) * 2) });
  }
  return out;
}

// The other direction, for tests and the fake chain: read calls out of an aggregate3 payload and
// encode results the way Multicall3 returns them.
export function decodeAggregate3Calls(data) {
  const h = strip(data).slice(8);
  const at = byte => BigInt('0x' + h.slice(byte * 2, byte * 2 + 64));
  const base = Number(at(0));
  const n = Number(at(base));
  const start = base + 32;
  return Array.from({ length: n }, (_, k) => {
    const e = start + Number(at(start + k * 32));
    const d = e + Number(at(e + 64));
    const len = Number(at(d));
    return { to: '0x' + h.slice(e * 2 + 24, e * 2 + 64), allowFailure: at(e + 32) === 1n, data: '0x' + h.slice((d + 32) * 2, (d + 32 + len) * 2) };
  });
}

export function encodeAggregate3Results(results) {
  return '0x' + encodeArray(results.map(r => {
    const d = strip(r.data || '');
    return word(r.success ? 1 : 0) + word(0x40) + word(d.length / 2) + padRight(d);
  }));
}
