const uint = value => typeof value === 'string' && /^\d+$/.test(value);
const usdc = raw => Number(raw) / 1e6;
const runwayWindow = 7;

function verifiedSpend(day, sales, previous) {
  if (!sales || !day.blockHash || day.blockHash !== sales.blockHash ||
      day.fromBlock !== sales.fromBlock || day.toBlock !== sales.toBlock ||
      !/^[a-f\d]{64}$/i.test(sales.fundingEvidenceSha256 ?? '')) return null;
  const raw = sales.raw;
  if (!raw || !['openingUsdc','incomingUsdc','closingUsdc','recognizedUsdc','unknownUsdc'].every(k => uint(raw[k])) ||
      raw.closingUsdc !== day.raw?.burnWalletUsdc || raw.openingUsdc !== previous?.raw?.burnWalletUsdc) return null;
  const spend = BigInt(raw.recognizedUsdc) + BigInt(raw.unknownUsdc);
  return BigInt(raw.openingUsdc) + BigInt(raw.incomingUsdc) - BigInt(raw.closingUsdc) === spend ? spend : null;
}

export function alertEvidence(rows, salesByDate) {
  const spends = rows.map((day, i) => verifiedSpend(day, salesByDate.get(day.date), rows[i - 1]));
  return rows.map((day, i) => {
    const window = spends.slice(Math.max(0, i + 1 - runwayWindow), i + 1);
    let runway = null;
    if (window.length === runwayWindow && window.every(n => n !== null)) {
      const sum = window.reduce((a, b) => a + b, 0n);
      const balance = BigInt(day.raw.burnWalletUsdc);
      if (sum > 0n) runway = {
        low: balance * BigInt(runwayWindow) < sum, days: Number(balance) * runwayWindow / Number(sum),
        balanceUsdc: usdc(balance), dailySpendUsdc: usdc(sum) / runwayWindow,
        start: rows[i + 1 - runwayWindow].date
      };
    }
    return {date: day.date, block: day.toBlock, runway,
      unexpectedMints: day.flowsVerified === true && Array.isArray(day.unexpectedMints) ? day.unexpectedMints : null,
      // The collector tests the daily total against 250,000 VVV in integer wei before emitting this list.
      largeOutflows: day.auditVerified === true && Array.isArray(day.largeOutflows) ? day.largeOutflows : null,
      externalOutflow: day.auditVerified === true ? day.externalOutflow ?? null : null};
  });
}
