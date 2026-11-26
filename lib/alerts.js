import { CHAIN, THRESHOLDS, VENICE } from './config.js';
import { burnValueUsd } from './burn-value.js';

const rank = {healthy: 0, watch: 1, alert: 2};
const amount = n => n.toLocaleString('en-US', {maximumFractionDigits: 6});
const wallet = address => '[' + address + '](' + CHAIN.explorer + address + ')';
const transaction = tx => '[transaction](' + CHAIN.explorerTx + tx + ')';

function planEvidenceAlerts(journal, snapshot) {
  const days = snapshot.alertEvidence;
  if (!Array.isArray(days)) return;
  // Keep the launch date fixed. A verified day repaired after a newer one can still raise an issue.
  const baseline = journal.cursors.evidenceFrom ??= snapshot.lastDay;
  const tracker = journal.states.burnWalletRunway ??= {baselineLow: null, observations: {}};
  const {protocol, sales} = snapshot.sources;
  if (!protocol?.ok) return;
  for (const day of days) {
    if (day.date < baseline || day.date > protocol.asOf) continue;
    const fundingFresh = sales?.ok && day.date <= sales.asOf && day.runway !== null && day.runway !== undefined;
    if (day.date === baseline) {
      if (fundingFresh && tracker.baselineLow === null) tracker.baselineLow = day.runway.low;
      continue;
    }
    const mints = Map.groupBy(day.unexpectedMints ?? [], mint => mint.tx.toLowerCase());
    for (const [tx, records] of mints) {
      const lines = records.map(mint => '- ' + amount(mint.amount) + ' VVV to ' + wallet(mint.to));
      journal.issues['mint-' + tx] ??= {title: 'Unexpected VVV mint · ' + day.date,
        body: 'VVV was minted to a destination outside the staking contract and control Safe.\n\n' +
          lines.join('\n') + '\n\n[Mint transaction](' + CHAIN.explorerTx + tx + ')', open: true, once: true};
    }
    if (day.largeOutflows?.length && Number.isFinite(day.externalOutflow)) {
      const lines = day.largeOutflows.map(move =>
        '- ' + amount(move.amount) + ' VVV from ' + wallet(move.from) + ' to ' + wallet(move.to) + ' · ' + transaction(move.tx));
      journal.issues['safe-outflow-' + day.date] ??= {title: 'Large control Safe outflow · ' + day.date,
        body: 'The control Safe sent ' + amount(day.externalOutflow) + ' VVV externally during this UTC day.\n\n' +
          lines.join('\n'), open: true, once: true};
    }
    if (fundingFresh) {
      tracker.observations[day.date] ??= day.runway.low ? {block: day.block, ...day.runway} : false;
    }
  }
  if (!sales?.ok) return;
  // Reconstruct verified low periods so outage recovery and late interior days keep their original issue keys.
  let onset = null, suppressed = tracker.baselineLow === true;
  function notify() {
    if (onset && !suppressed) {
      const r = tracker.observations[onset];
      journal.issues['runway-' + onset] = {title: 'Burn wallet below one day of funding · ' + onset,
        body: 'The ' + wallet(VENICE.burnWallet) + ' burn wallet closed at ' + amount(r.balanceUsdc) +
          ' USDC, or ' + amount(r.days) + ' days at its average spend of ' + amount(r.dailySpendUsdc) +
          ' USDC per day from ' + r.start + ' through ' + onset + ' UTC.\n\n[Closing Base block](https://basescan.org/block/' +
          r.block + ')', open: true, once: true};
    }
  }
  for (const [date, reading] of Object.entries(tracker.observations).sort(([a], [b]) => a.localeCompare(b))) {
    if (reading) {
      onset ??= date;
      if (journal.issues['runway-' + date]) suppressed = true;
    } else {
      notify();
      onset = null;
      suppressed = false;
    }
  }
  notify();
}

// Store desired issue state in Git before contacting GitHub. Replaying an identical
// snapshot or retrying after a partial issue update yields the same identifiers.
export function planAlerts(prior, snapshot) {
  const journal = structuredClone(prior ?? {schemaVersion: 1, states: {}, cursors: {}, issues: {}});
  const {lastDay, checks, sources} = snapshot;
  for (const check of checks) {
    if (!Object.hasOwn(rank, check.state)) continue;
    const old = journal.states[check.id];
    let incident = old?.incident ?? null;
    if (old && rank[check.state] > rank[old.state] && !incident) incident = 'check-' + check.id + '-' + lastDay;
    if (incident) {
      const title = check.title + ' · ' + (check.state === 'healthy' ? 'Recovered' : check.state === 'alert' ? 'Alert' : 'Watch');
      let body = check.text + '\n\nCompleted UTC day: ' + lastDay + '.';
      if (check.id === 'exits') {
        const cutoff = amount(100 * THRESHOLDS.exits7d.good) + '%';
        body += '\n\nThe bot closes this issue when a fresh reading shows VVV entering cooldown over seven days at ' +
          cutoff + ' or less of ending staked supply.';
      }
      journal.issues[incident] = {title, body, open: check.state !== 'healthy'};
      if (check.state === 'healthy') incident = null;
    }
    journal.states[check.id] = {state: check.state, incident};
  }

  // On initial load, seed the cursor without posting the backfill as new activity.
  function events(group, source, items, record) {
    if (!source?.ok) return;
    const cursor = journal.cursors[group];
    if (cursor) for (const item of items) {
      if (item.date > cursor && item.date <= source.asOf) record(item);
    }
    journal.cursors[group] = source.asOf;
  }
  events('monthly', sources.buybacks ?? sources.burns, snapshot.buybacks.cycles, cycle => {
    const index = snapshot.buybacks.cycles.indexOf(cycle);
    const previous = snapshot.buybacks.cycles[index - 1];
    const usd = burnValueUsd(cycle), previousUsd = burnValueUsd(previous);
    const ratio = usd != null && previousUsd != null ? usd / previousUsd : null;
    const up = ratio >= THRESHOLDS.monthlyBurn.raised;
    journal.issues['burn-' + cycle.tx] = {
      title: (up ? 'Monthly burn value rose ' + Math.round((ratio - 1) * 100) + '%' : 'Monthly VVV burn') + ' · ' + cycle.date,
      body: cycle.burnedVvv.toLocaleString('en-US') + ' VVV retired.' +
        (usd == null ? ' Burn-block valuation is pending.' : ' Estimated value at the burn block was $' + Math.round(usd).toLocaleString('en-US') + '.') +
        (cycle.verified ? ' The Safe spent ' + cycle.spentUsdc.toLocaleString('en-US') + ' USDC during the cycle.' : '') +
        '\n\n[Base transaction](https://basescan.org/tx/' + cycle.tx + ')', open: true, once: true
    };
  });
  const groups = new Map();
  events('rules', sources.protocol, snapshot.rules.changes ?? [], event => {
    if (!groups.has(event.date)) groups.set(event.date, []);
    groups.get(event.date).push(event);
  });
  for (const [date, changes] of groups) {
    const lines = changes.map(change => {
      const tx = change.tx ? ' ([transaction](https://basescan.org/tx/' + change.tx + '))' : '';
      return '- ' + change.id + ': ' + JSON.stringify(change.from) + ' → ' + JSON.stringify(change.to) + tx;
    });
    journal.issues['rules-' + date] = {title: 'Venice rule changes · ' + date, body: lines.join('\n'), open: true, once: true};
  }
  planEvidenceAlerts(journal, snapshot);
  return journal;
}
