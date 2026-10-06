/**
 * ll1-ui.js — UI controller for the LL(1) Parser page
 */

'use strict';

// ── Global state ─────────────────────────────────────────────────────
let grammar   = null;
let firstData = null;   // { first: Map, steps: [] }
let followData= null;   // { follow: Map, steps: [] }
let tableData = null;   // { table, conflicts, steps }

let ffStepIdx   = -1;
let tblStepIdx  = -1;
let parseStepIdx= -1;
let parseTrace  = null;
let parsePlaying= false;
let parseTimer  = null;

// Combined first+follow steps for unified stepping
let ffAllSteps = [];

const EXAMPLES = {
  expr: `E -> T EP\nEP -> + T EP | ε\nT -> F TP\nTP -> * F TP | ε\nF -> ( E ) | id`,
  simple: `S -> a B | b\nB -> b B | ε`,
  conflict: `S -> a | a b`,
  ab: `S -> a S b | ε`
};

// ── DOM ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Examples ──────────────────────────────────────────────────────────
$('example-select').addEventListener('change', function () {
  const g = EXAMPLES[this.value];
  if (g) $('grammar-input').value = g;
});

// ── Tab switching ─────────────────────────────────────────────────────
function switchTab(name) {
  ['ff', 'table', 'parse'].forEach(t => {
    $('tc-' + t).classList.toggle('active', t === name);
    $('tab-' + t).classList.toggle('active', t === name);
  });

  // When switching to table tab: ensure table is set up if FF done
  if (name === 'table' && grammar && firstData && followData && !tableData) {
    initTableUI();
  }
  // When switching to parse tab: show parse controls if table done
  if (name === 'parse' && grammar && tableData) {
    showParseControls();
  }
}

// ── Load Grammar ──────────────────────────────────────────────────────
function loadLL1Grammar() {
  resetAll();

  const txt = $('grammar-input').value.trim();
  if (!txt) { showErr('Please enter a grammar.'); return; }

  grammar = parseGrammar(txt);
  if (grammar.error) { showErr(grammar.error); return; }

  // Show parsed rules
  const rl = $('rules-list');
  rl.innerHTML = '';
  grammar.rules.forEach((r, i) => {
    const d = document.createElement('div');
    d.style.cssText = 'color:var(--text-secondary);padding:0.15rem 0;';
    d.innerHTML = `<span style="color:var(--accent-purple);font-weight:600;">${r.lhs}</span> <span style="color:var(--text-muted)">→</span> <span style="color:var(--text-primary)">${r.rhs.join(' ')}</span>`;
    rl.appendChild(d);
  });
  $('rules-card').style.display = '';

  // Compute full first & follow (for step-by-step display)
  firstData  = computeFirstSets(grammar);
  followData = computeFollowSets(grammar, firstData.first);

  // Build combined steps array
  ffAllSteps = [
    ...firstData.steps.map(s => ({ ...s, kind: 'first' })),
    ...followData.steps.map(s => ({ ...s, kind: 'follow' }))
  ];

  // Init FF tab
  initFFUI();

  $('btn-reset').disabled = false;
}

function showErr(msg) {
  const e = $('grammar-error');
  e.textContent = '⚠ ' + msg;
  e.style.display = '';
}

// ── FIRST & FOLLOW UI ─────────────────────────────────────────────────
function initFFUI() {
  $('ff-placeholder').style.display = 'none';
  $('ff-controls').style.display = '';
  ffStepIdx = -1;

  $('ff-counter').textContent = `0 / ${ffAllSteps.length}`;
  setFFStatus('running', 'Ready — click Next Step');
  $('ff-explain').innerHTML = 'Click <strong>Next Step</strong> to begin First set computation.';

  // Build empty set cards
  buildSetCards('first-grid', grammar.nts, 'FIRST', {});
  buildSetCards('follow-grid', grammar.nts, 'FOLLOW', {});

  $('ff-trace').innerHTML = '';
  $('ff-prev').disabled = true;
  $('ff-next').disabled = false;
  $('ff-all').disabled = false;
}

function buildSetCards(gridId, nts, label, currentSets) {
  const grid = $(gridId);
  grid.innerHTML = '';
  for (const nt of nts) {
    const vals = currentSets[nt] ? [...currentSets[nt]].join(', ') : '{ }';
    const card = document.createElement('div');
    card.className = 'set-card';
    card.id = `set-card-${label}-${nt}`;
    card.innerHTML = `
      <div class="set-label">${label}(·)</div>
      <div class="nt">${nt}</div>
      <div class="set-val">{&thinsp;${vals}&thinsp;}</div>`;
    grid.appendChild(card);
  }
}

function updateSetCard(label, nt, val, highlight) {
  const card = $(`set-card-${label}-${nt}`);
  if (!card) return;
  // Get current values from displayed text
  const valDiv = card.querySelector('.set-val');

  // Rebuild from scratch using actual computed sets
  let set;
  if (label === 'FIRST') {
    set = firstData.first.get(nt);
  } else {
    set = followData.follow.get(nt);
  }
  // Only show elements up to current step
  const currentVals = getCurrentSetUpTo(label, nt, ffStepIdx);
  valDiv.textContent = '{' + (currentVals.length ? ' ' + currentVals.join(', ') + ' ' : ' ') + '}';

  if (highlight) {
    card.classList.add('active');
    setTimeout(() => card.classList.remove('active'), 800);
  }
}

function getCurrentSetUpTo(label, nt, maxIdx) {
  const vals = new Set();
  const kind = label === 'FIRST' ? 'first' : 'follow';
  for (let i = 0; i <= maxIdx; i++) {
    const s = ffAllSteps[i];
    if (!s) continue;
    if (s.kind === kind && s.nt === nt) vals.add(s.added);
  }
  return [...vals];
}

function ffNext() {
  if (ffStepIdx >= ffAllSteps.length - 1) {
    setFFStatus('ok', 'Computation complete!');
    $('ff-next').disabled = true;
    showTableReadyHint();
    return;
  }
  ffStepIdx++;
  applyFFStep(ffStepIdx);
  $('ff-prev').disabled = ffStepIdx <= 0;
  $('ff-counter').textContent = `${ffStepIdx + 1} / ${ffAllSteps.length}`;
}

function ffPrev() {
  if (ffStepIdx <= 0) return;
  ffStepIdx--;
  // Rebuild set cards from scratch
  rebuildAllSetCards();
  $('ff-prev').disabled = ffStepIdx <= 0;
  $('ff-counter').textContent = `${ffStepIdx + 1} / ${ffAllSteps.length}`;
  $('ff-next').disabled = false;

  // Rebuild trace
  $('ff-trace').innerHTML = '';
  for (let i = 0; i <= ffStepIdx; i++) {
    const s = ffAllSteps[i];
    ffTraceLog(s);
  }
  // Rebuild explain
  const s = ffAllSteps[ffStepIdx];
  showFFExplain(s);
}

function ffAll() {
  ffStepIdx = ffAllSteps.length - 1;
  rebuildAllSetCards();
  $('ff-counter').textContent = `${ffAllSteps.length} / ${ffAllSteps.length}`;
  $('ff-prev').disabled = false;
  $('ff-next').disabled = true;
  $('ff-all').disabled = true;

  // Full trace
  $('ff-trace').innerHTML = '';
  for (const s of ffAllSteps) ffTraceLog(s);

  setFFStatus('ok', 'All sets computed!');
  showFFExplain(ffAllSteps[ffAllSteps.length - 1]);
  showTableReadyHint();
}

function rebuildAllSetCards() {
  buildSetCards('first-grid', grammar.nts, 'FIRST', {});
  buildSetCards('follow-grid', grammar.nts, 'FOLLOW', {});
  for (let i = 0; i <= ffStepIdx; i++) {
    const s = ffAllSteps[i];
    const label = s.kind === 'first' ? 'FIRST' : 'FOLLOW';
    updateSetCardDirect(label, s.nt, i);
  }
}

function updateSetCardDirect(label, nt, maxIdx) {
  const card = $(`set-card-${label}-${nt}`);
  if (!card) return;
  const vals = getCurrentSetUpTo(label, nt, maxIdx);
  card.querySelector('.set-val').textContent = '{' + (vals.length ? ' ' + vals.join(', ') + ' ' : ' ') + '}';
}

function applyFFStep(idx) {
  const s = ffAllSteps[idx];
  const label = s.kind === 'first' ? 'FIRST' : 'FOLLOW';
  updateSetCardDirect(label, s.nt, idx);

  // Highlight
  const card = $(`set-card-${label}-${s.nt}`);
  if (card) { card.classList.add('active'); setTimeout(() => card.classList.remove('active'), 700); }

  ffTraceLog(s);
  showFFExplain(s);
  setFFStatus('running', `${label}(${s.nt}) ← "${s.added}"`);
}

function showFFExplain(s) {
  if (!s) return;
  const label = s.kind === 'first' ? 'FIRST' : 'FOLLOW';
  $('ff-explain').innerHTML = `
    <strong>${label}(${s.nt})</strong> gets <code>"${s.added}"</code>
    from rule <code>${s.rule}</code>
    — ${s.reason}`;
}

function ffTraceLog(s) {
  const log = $('ff-trace');
  const label = s.kind === 'first' ? 'FIRST' : 'FOLLOW';
  const div = document.createElement('div');
  div.className = 'trace-line ' + (s.kind === 'first' ? 'expand' : 'match');
  div.textContent = `${label}(${s.nt}) ← "${s.added}"  [${s.rule}] — ${s.reason}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function showTableReadyHint() {
  // Prime the table tab
  initTableUI();
}

function setFFStatus(state, text) {
  $('ff-dot').className = 'status-indicator ' + state;
  $('ff-text').innerHTML = text;
}

// ── PARSE TABLE UI ────────────────────────────────────────────────────
function initTableUI() {
  if (!grammar || !firstData || !followData) return;

  tableData = buildLL1Table(grammar, firstData.first, followData.follow);
  tblStepIdx = -1;

  $('table-placeholder').style.display = 'none';
  $('table-controls').style.display = '';

  $('tbl-counter').textContent = `0 / ${tableData.steps.length}`;
  setTblStatus('running', 'Ready — click Next Step');
  $('tbl-explain').innerHTML = 'Click <strong>Next Step</strong> to place a rule into the parse table.';
  $('tbl-trace').innerHTML = '';

  // Build empty table
  buildEmptyParseTable();

  // Conflict display
  const cl = $('conflict-list');
  cl.innerHTML = '';
  if (tableData.conflicts.length > 0) {
    const div = document.createElement('div');
    div.className = 'conflict-msg';
    div.innerHTML = `⚠ <strong>Grammar is NOT LL(1)</strong> — ${tableData.conflicts.length} conflict(s) detected:<br/>` +
      tableData.conflicts.map(c => `M[${c.nt}, ${c.term}]: "${c.existing}" vs "${c.incoming}"`).join('<br/>');
    cl.appendChild(div);
  }

  $('tbl-prev').disabled = true;
  $('tbl-next').disabled = false;
  $('tbl-all').disabled = false;
}

function buildEmptyParseTable() {
  const tbl = $('parse-table-el');
  tbl.innerHTML = '';

  const allTerminals = [...grammar.terminals, '$'];
  // header
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  hr.appendChild(th('NT \\ Terminal'));
  for (const t of allTerminals) hr.appendChild(th(t));
  thead.appendChild(hr);
  tbl.appendChild(thead);

  // body
  const tbody = document.createElement('tbody');
  for (const nt of grammar.nts) {
    const tr = document.createElement('tr');
    const ntTd = document.createElement('td');
    ntTd.className = 'nt-col'; ntTd.textContent = nt;
    tr.appendChild(ntTd);
    for (const t of allTerminals) {
      const td = document.createElement('td');
      td.id = `tbl-${nt}-${t}`;
      td.textContent = '';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  tbl.appendChild(tbody);
}

function th(text) {
  const el = document.createElement('th');
  el.textContent = text;
  return el;
}

function tblNext() {
  if (tblStepIdx >= tableData.steps.length - 1) {
    setTblStatus('ok', 'Table complete!');
    $('tbl-next').disabled = true;
    showParseControls();
    return;
  }
  tblStepIdx++;
  applyTblStep(tblStepIdx);
  $('tbl-prev').disabled = tblStepIdx <= 0;
  $('tbl-counter').textContent = `${tblStepIdx + 1} / ${tableData.steps.length}`;
}

function tblPrev() {
  if (tblStepIdx <= 0) return;
  tblStepIdx--;
  rebuildTable();
  $('tbl-prev').disabled = tblStepIdx <= 0;
  $('tbl-counter').textContent = `${tblStepIdx + 1} / ${tableData.steps.length}`;
  $('tbl-next').disabled = false;
}

function tblAll() {
  tblStepIdx = tableData.steps.length - 1;
  rebuildTable();
  $('tbl-counter').textContent = `${tableData.steps.length} / ${tableData.steps.length}`;
  $('tbl-prev').disabled = false;
  $('tbl-next').disabled = true;
  $('tbl-all').disabled = true;
  setTblStatus('ok', 'Table complete!');

  $('tbl-trace').innerHTML = '';
  for (const s of tableData.steps) tblTraceLog(s);

  showParseControls();
}

function rebuildTable() {
  buildEmptyParseTable();
  $('tbl-trace').innerHTML = '';

  // Remove prev highlights
  for (let i = 0; i <= tblStepIdx; i++) {
    const s = tableData.steps[i];
    const td = $(`tbl-${s.nt}-${s.term}`);
    if (!td) continue;

    // Get the rule that won (first one placed wins unless conflict)
    if (!td.dataset.filled) {
      td.textContent = formatRule(s.rule);
      td.classList.add('filled');
      td.dataset.filled = '1';
    }
    if (s.conflict) td.classList.add('conflict');
    tblTraceLog(s);
  }

  const s = tableData.steps[tblStepIdx];
  if (s) showTblExplain(s);
}

function applyTblStep(idx) {
  const s = tableData.steps[idx];
  const td = $(`tbl-${s.nt}-${s.term}`);

  if (td) {
    // Remove prev highlight
    document.querySelectorAll('.ll-table td.highlighted').forEach(el => el.classList.remove('highlighted'));

    if (!td.dataset.filled) {
      td.textContent = formatRule(s.rule);
      td.classList.add('filled');
      td.dataset.filled = '1';
    }
    if (s.conflict) {
      td.classList.add('conflict');
      td.textContent = '⚠ CONFLICT';
    }
    td.classList.add('highlighted');
    td.classList.add('cell-pop');
    setTimeout(() => { td.classList.remove('highlighted'); td.classList.remove('cell-pop'); }, 1200);
  }

  tblTraceLog(s);
  showTblExplain(s);
  setTblStatus(s.conflict ? 'err' : 'running', s.conflict ? `CONFLICT at M[${s.nt}, ${s.term}]` : `M[${s.nt}, ${s.term}] ← ${formatRule(s.rule)}`);
}

function formatRule(ruleStr) {
  // "S → A B" → "A B"
  const parts = ruleStr.split('→');
  return parts.length > 1 ? parts[1].trim() : ruleStr;
}

function showTblExplain(s) {
  $('tbl-explain').innerHTML = `Place <code>${s.rule}</code> into M[<strong>${s.nt}</strong>, <strong>${s.term}</strong>] because: ${s.reason}`;
  if (s.conflict) $('tbl-explain').innerHTML += ` &nbsp;<span style="color:var(--accent-red)">⚠ Conflict!</span>`;
}

function tblTraceLog(s) {
  const log = $('tbl-trace');
  const div = document.createElement('div');
  div.className = 'trace-line ' + (s.conflict ? 'fail' : 'expand');
  div.textContent = `M[${s.nt}, ${s.term}] ← ${formatRule(s.rule)}${s.conflict ? ' ⚠ CONFLICT' : ''}  (${s.reason})`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function setTblStatus(state, text) {
  $('tbl-dot').className = 'status-indicator ' + state;
  $('tbl-text').innerHTML = text;
}

// ── String Parsing UI ─────────────────────────────────────────────────
function showParseControls() {
  $('parse-placeholder').style.display = 'none';
  $('parse-controls').style.display = '';
}

function startParsing() {
  if (!grammar || !tableData) return;
  const inputStr = $('parse-input').value.trim();

  parseTrace = ll1ParseString(grammar, tableData.table, inputStr);
  parseStepIdx = -1;

  // Clear previous
  $('ll-trace-body').innerHTML = '';
  $('parse-verdict').innerHTML = '';
  $('stack-input-display').style.display = '';
  $('parse-explain').style.display = '';
  $('parse-counter').textContent = `0 / ${parseTrace.length}`;

  $('parse-prev').disabled = true;
  $('parse-next').disabled = false;
  $('parse-play').disabled = false;
  $('parse-end').disabled  = false;

  setParseStatus('running', 'Ready — click Next Step');
  updateStackInputDisplay(parseTrace[0] || { stack: grammar.start + ' $', input: inputStr + ' $', action: '' });
}

function parseNext() {
  if (!parseTrace) return;
  if (parseStepIdx >= parseTrace.length - 1) return;
  parseStepIdx++;
  applyParseStep(parseStepIdx);
  $('parse-prev').disabled = parseStepIdx <= 0;
  $('parse-counter').textContent = `${parseStepIdx + 1} / ${parseTrace.length}`;
}

function parsePrev() {
  if (parseStepIdx <= 0) return;
  parseStepIdx--;
  rebuildParseTrace();
  $('parse-prev').disabled = parseStepIdx <= 0;
  $('parse-counter').textContent = `${parseStepIdx + 1} / ${parseTrace.length}`;
}

function parsePlay() {
  if (parsePlaying) {
    parsePlaying = false;
    clearInterval(parseTimer);
    $('parse-play').textContent = '▶ Play';
    $('parse-play').className = 'btn btn-success btn-sm';
    return;
  }
  parsePlaying = true;
  $('parse-play').textContent = '⏸ Pause';
  $('parse-play').className = 'btn btn-warning btn-sm';
  parseTimer = setInterval(() => {
    if (parseStepIdx >= parseTrace.length - 1) {
      parsePlaying = false;
      clearInterval(parseTimer);
      $('parse-play').textContent = '▶ Play';
      $('parse-play').className = 'btn btn-success btn-sm';
      return;
    }
    parseNext();
  }, 700);
}

function parseEnd() {
  if (!parseTrace) return;
  parsePlaying = false;
  clearInterval(parseTimer);
  while (parseStepIdx < parseTrace.length - 1) parseStepIdx++;
  rebuildParseTrace();
  $('parse-counter').textContent = `${parseTrace.length} / ${parseTrace.length}`;
}

function rebuildParseTrace() {
  $('ll-trace-body').innerHTML = '';
  $('parse-verdict').innerHTML = '';
  for (let i = 0; i <= parseStepIdx; i++) applyParseStep(i, true);
  const step = parseTrace[parseStepIdx];
  if (step) {
    updateStackInputDisplay(step);
    showParseExplain(step);
    if (step.verdict) showParseVerdict(step.verdict === 'accept', step.action);
  }
}

function applyParseStep(idx, quiet = false) {
  const step = parseTrace[idx];
  if (!step) return;

  // Add row to trace table
  const tbody = $('ll-trace-body');
  const tr = document.createElement('tr');
  if (step.verdict === 'accept') tr.className = 'accept-row';
  else if (step.verdict === 'reject') tr.className = 'reject-row';
  else if (!quiet && idx === parseStepIdx) tr.className = 'active-row';

  tr.innerHTML = `
    <td>${idx + 1}</td>
    <td style="font-family:var(--font-mono);font-size:0.75rem;">${step.stack}</td>
    <td style="font-family:var(--font-mono);font-size:0.75rem;">${step.input}</td>
    <td style="font-size:0.75rem;">${step.action}</td>`;
  tbody.appendChild(tr);
  tbody.scrollTop = tbody.scrollHeight;

  if (!quiet) {
    updateStackInputDisplay(step);
    showParseExplain(step);
    if (step.verdict) {
      showParseVerdict(step.verdict === 'accept', step.action);
      parsePlaying = false; clearInterval(parseTimer);
    }
  }
}

function updateStackInputDisplay(step) {
  // Parse stack string "$ A B C" → tokens
  const stackTokens = (step.stack || '').split(/\s+/).filter(Boolean);
  const inputTokens = (step.input || '').split(/\s+/).filter(Boolean);

  const stEl = $('stack-tokens');
  stEl.innerHTML = '';
  stackTokens.forEach((t, i) => {
    const span = document.createElement('span');
    span.className = 'token' + (i === stackTokens.length - 1 ? ' top' : '') + (t === '$' ? ' dollar' : '');
    span.textContent = t;
    stEl.appendChild(span);
  });

  const inEl = $('input-tokens');
  inEl.innerHTML = '';
  inputTokens.forEach((t, i) => {
    const span = document.createElement('span');
    span.className = 'token' + (i === 0 ? ' head' : '') + (t === '$' ? ' dollar' : '');
    span.textContent = t;
    inEl.appendChild(span);
  });
}

function showParseExplain(step) {
  const ex = $('parse-explain');
  ex.style.display = '';
  ex.innerHTML = `<strong>Action:</strong> ${step.action}`;
}

function showParseVerdict(accept, msg) {
  $('parse-verdict').innerHTML = `
    <div class="verdict ${accept ? 'accept' : 'reject'}">
      <span>${accept ? '✅' : '❌'}</span>
      <span>${msg}</span>
    </div>`;
}

function setParseStatus(state, text) {
  $('parse-dot').className = 'status-indicator ' + state;
  $('parse-text').innerHTML = text;
}

// ── Reset All ─────────────────────────────────────────────────────────
function resetAll() {
  grammar = null; firstData = null; followData = null;
  tableData = null; ffAllSteps = [];
  ffStepIdx = -1; tblStepIdx = -1; parseStepIdx = -1;
  parseTrace = null; parsePlaying = false; clearInterval(parseTimer);

  // FF tab
  $('ff-placeholder').style.display = '';
  $('ff-controls').style.display = 'none';

  // Table tab
  $('table-placeholder').style.display = '';
  $('table-controls').style.display = 'none';

  // Parse tab
  $('parse-placeholder').style.display = '';
  $('parse-controls').style.display = 'none';

  // Rules
  $('rules-card').style.display = 'none';
  $('rules-list').innerHTML = '';

  $('grammar-error').style.display = 'none';
  $('btn-reset').disabled = true;
}
