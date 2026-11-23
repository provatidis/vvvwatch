import { THRESHOLDS } from './config.js';

const rank = {healthy: 0, watch: 1, alert: 2};

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
      journal.issues[incident] = {title, body: check.text + '\n\nCompleted UTC day: ' + lastDay + '.',
        open: check.state !== 'healthy'};
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
    const ratio = cycle.verified && previous?.verified && previous.spentUsdc > 0
      ? cycle.spentUsdc / previous.spentUsdc : null;
    const up = ratio >= THRESHOLDS.monthlyBurn.raised;
    journal.issues['burn-' + cycle.tx] = {
      title: (up ? 'Monthly buyback spending up ' + Math.round((ratio - 1) * 100) + '%' : 'Monthly VVV burn') + ' · ' + cycle.date,
      body: cycle.burnedVvv.toLocaleString('en-US') + ' VVV retired.' +
        (cycle.verified ? ' Reconciled cycle spending: ' + cycle.spentUsdc.toLocaleString('en-US') + ' USDC.' : '') +
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
  return journal;
}
