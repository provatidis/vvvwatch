import { holderSummary } from './lib/holders.js';
import { money, utcMidnight } from './lib/format.js';
import { drawGauge, overviewFragments } from './lib/overview.js';
import { calcResult, empty, ledgerWindow, sectionFragments } from './lib/sections.js';

const $ = id => document.getElementById(id);

// Preserve old shared links. New links select a built-in ledger using a plain fragment.
function selectLedgerFromUrl(initial = false) {
  const url = new URL(location.href);
  const legacy = url.searchParams.get('days');
  const windows = $('ledger-windows');
  if (initial && legacy === '90') {
    windows.dataset.days = '90';
    if (url.hash === '#ledger') url.hash = '#ledger-90';
  }
  if (!['#ledger', '#ledger-90'].includes(url.hash)) return;
  windows.dataset.days = url.hash === '#ledger-90' ? '90' : '30';
  if (legacy === '30' || legacy === '90') {
    url.searchParams.delete('days');
    history.replaceState(history.state, '', url);
  }
}

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
    // The label describes the saved example, so it goes once the reader changes an input.
    $('calc-example').hidden = true;
    if (event.target.matches('input[type=number]')) edited.add(event.target);
    renderCalc(s, h, edited);
  });
  // The form is in the saved page with its inputs disabled, so enabling them moves nothing.
  renderCalc(s, h, edited);
  $('calc-controls').disabled = false;
}

function render(s) {
  renderOverview(s);
  fill({...sectionFragments(s), ledger: ledgerWindow(s, 30), 'ledger-90': ledgerWindow(s, 90)});
  wireCalculator(s);
}

async function load() {
  const initialHash = location.hash;
  $('error').hidden=true;
  try {
    const response=await fetch('./data/latest.json',{cache:'no-cache'});
    if (!response.ok) throw new Error(`Snapshot HTTP ${response.status}`);
    const s=await response.json();
    if (s.schemaVersion!==1 || !Number.isFinite(utcMidnight(s.lastDay))) throw new Error('Unsupported snapshot');
    render(s);
    // The holder panels above the ledger can move it past the browser's initial anchor.
    if (initialHash === location.hash && ['#ledger', '#ledger-90'].includes(initialHash)) {
      $(initialHash.slice(1)).scrollIntoView({behavior:'instant'});
    }
  } catch {
    const saved = $('overview').childElementCount > 0;
    if (!saved) {
      $('asof').textContent='Snapshot unavailable';
      $('cover-note').textContent='Awaiting a verified snapshot';
      $('gauge').innerHTML=drawGauge(null);
      $('check-list').innerHTML=empty('Data is unavailable.');
      for (const id of ['holders-panel','ledger','ledger-90','buyback-panel','sales-panel','diem-panel','treasury-panel','rules-panel']) $(id).innerHTML=empty('Data is unavailable.');
    }
    $('error').hidden=false;
    const message = saved ? 'Showing the saved snapshot. The latest data could not load.' : 'The dashboard could not load its daily snapshot.';
    $('error').innerHTML=message+' <button type="button" id="retry">Retry</button> <a href="./data/latest.json">Open snapshot JSON ↗</a>';
    $('retry').addEventListener('click',load,{once:true});
  }
}

theme();
selectLedgerFromUrl(true);
window.addEventListener('hashchange', () => selectLedgerFromUrl());
load();
