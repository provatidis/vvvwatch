import { holderSummary } from './lib/holders.js';
import { money, utcMidnight } from './lib/format.js';
import { drawGauge, overviewFragments } from './lib/overview.js';
import { calcResult, empty, ledgerFragments, sectionFragments } from './lib/sections.js';

const $ = id => document.getElementById(id);

let snapshot;
const ledgerDaysFromUrl = () => new URLSearchParams(location.search).get('days') === '90' ? 90 : 30;
let selectedDays = ledgerDaysFromUrl();

function theme() {
  const toggle = $('theme');
  function update() {
    const dark = document.documentElement.dataset.theme === 'dark';
    toggle.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} theme`);
    toggle.title = toggle.getAttribute('aria-label');
    document.querySelector('meta[name="theme-color"]').content = dark ? '#0b1517' : '#f1efe8';
  }
  toggle.hidden = false;
  update();
  toggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('ap-theme', next); } catch { /* Local storage is optional. */ }
    update();
  });
}

// The static build writes the same markup; replacing it only when it differs avoids needless repaints.
function fill(fragments) {
  for (const [id, html] of Object.entries(fragments)) {
    const element = $(id);
    if (element && element.innerHTML !== html) element.innerHTML = html;
  }
}

function renderOverview(s) {
  const fragments = overviewFragments(s);
  fill(fragments);
  $('cover-context').hidden = !fragments['cover-note'] && !fragments['cover-recent'] && !fragments['cover-drivers'] && !fragments['cover-breakdown'];
}

function renderLedger(s) {
  document.querySelectorAll('[data-ledger-days]').forEach(btn => btn.setAttribute('aria-pressed', String(Number(btn.dataset.ledgerDays) === selectedDays)));
  fill(ledgerFragments(s, selectedDays));
}

function renderCalc(s, h, edited) {
  const existing = $('calc-mode').value === 'existing';
  const position = $('calc-position');
  position.hidden = position.disabled = !existing;
  const n = $('calc-n').valueAsNumber;
  const duration = $('calc-years').valueAsNumber;
  const use = $('calc-use').valueAsNumber;
  $('calc-use-out').textContent = money(use, 2);
  let incomplete = false;
  const problems = [];
  for (const field of $('diem-calc').querySelectorAll('input[type=number]')) {
    const invalid = !field.matches(':disabled') && (!field.validity.valid || !(field.valueAsNumber > 0));
    if (invalid) incomplete = true;
    if (invalid && edited.has(field)) {
      const message = document.createElement('span');
      message.id = field.id + '-error';
      message.textContent = field.dataset.error;
      problems.push(message);
      field.setAttribute('aria-invalid', 'true');
      field.setAttribute('aria-describedby', message.id);
    } else {
      field.removeAttribute('aria-invalid');
      field.removeAttribute('aria-describedby');
    }
  }
  $('calc-errors').replaceChildren(...problems.flatMap((message, i) => i ? [' ', message] : [message]));
  if (incomplete) {
    $('calc-out').innerHTML = problems.length ? '' : empty('Enter your outstanding DIEM and locked sVVV to see this wallet’s estimate.');
    return;
  }
  $('calc-out').innerHTML = calcResult(s, h, {n, use, duration, existing,
    priorDiem: existing ? $('calc-debt').valueAsNumber : 0, priorLocked: existing ? $('calc-locked').valueAsNumber : 0});
}

function wireCalculator(s) {
  const form = $('diem-calc');
  if (!form) return;
  const h = holderSummary(s);
  form.addEventListener('submit', event => event.preventDefault());
  const edited = new Set();
  form.addEventListener('input', event => {
    if (event.target.matches('input[type=number]')) edited.add(event.target);
    renderCalc(s, h, edited);
  });
  renderCalc(s, h, edited);
}

function render(s) {
  renderOverview(s);
  fill(sectionFragments(s, selectedDays));
  renderLedger(s);
  wireCalculator(s);
}

async function load() {
  const opensLedger = location.hash === '#ledger';
  $('error').hidden=true;
  try {
    const response=await fetch('./data/latest.json',{cache:'no-cache'});
    if (!response.ok) throw new Error(`Snapshot HTTP ${response.status}`);
    const s=await response.json();
    if (s.schemaVersion!==1 || !Number.isFinite(utcMidnight(s.lastDay))) throw new Error('Unsupported snapshot');
    snapshot=s;
    render(snapshot);
    // The holder panels above the ledger can move it past the browser's initial anchor.
    if (opensLedger && location.hash === '#ledger') $('ledger').scrollIntoView({behavior:'instant'});
  } catch {
    const saved = $('overview').childElementCount > 0;
    if (!saved) {
      $('asof').textContent='Snapshot unavailable';
      $('cover-note').textContent='Awaiting a verified snapshot';
      $('gauge').innerHTML=drawGauge(null);
      $('check-list').innerHTML=empty('Data is unavailable.');
      for (const id of ['holders-panel','ledger-summary','ledger-trend','buyback-panel','sales-panel','diem-panel','treasury-panel','rules-panel']) $(id).innerHTML=empty('Data is unavailable.');
    }
    $('error').hidden=false;
    const message = saved ? 'Showing the saved snapshot. The latest data could not load, so the calculator and ledger window are inactive.' : 'The dashboard could not load its daily snapshot.';
    $('error').innerHTML=message+' <button type="button" id="retry">Retry</button> <a href="./data/latest.json">Open snapshot JSON ↗</a>';
    $('retry').addEventListener('click',load,{once:true});
  }
}

theme();
window.addEventListener('popstate', () => {
  const days = ledgerDaysFromUrl();
  if (days === selectedDays) return;
  selectedDays = days;
  if (snapshot) renderLedger(snapshot);
});
document.querySelectorAll('[data-ledger-days]').forEach(button=>button.addEventListener('click',()=>{
  selectedDays=Number(button.dataset.ledgerDays);
  const url = new URL(location.href);
  if (selectedDays === 90) url.searchParams.set('days', '90');
  else url.searchParams.delete('days');
  history.replaceState(history.state, '', url);
  if (snapshot) renderLedger(snapshot);
}));
load();
