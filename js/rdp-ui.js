/**
 * rdp-ui.js — UI controller for the Recursive Descent Parser page
 */

'use strict';

// ── State ───────────────────────────────────────────────────────────
let grammar   = null;
let simResult = null;   // { steps, tree, tokens }
let stepIdx   = -1;
let playing   = false;
let playTimer = null;
let callStack = [];     // runtime call stack for display

const EXAMPLES = {
  ex1: {
    grammar: `E -> T EP\nEP -> + T EP | ε\nT -> F TP\nTP -> * F TP | ε\nF -> id`,
    input: 'id + id * id'
  },
  ex2: {
    grammar: `S -> a S b | ε`,
    input: 'a a b b'
  },
  ex3: {
    grammar: `S -> a b | a`,
    input: 'a'
  },
  ex4: {
    grammar: `S -> a S | b`,
    input: 'a a b'
  }
};

// ── DOM helpers ─────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showEl(id, show=true) {
  const el = $(id);
  if (el) el.style.display = show ? '' : 'none';
}

function setStatus(state, text) {
  $('status-dot').className = 'status-indicator ' + state;
  $('status-text').innerHTML = text;
}

// ── Example loader ──────────────────────────────────────────────────
document.getElementById('example-select').addEventListener('change', function() {
  const ex = EXAMPLES[this.value];
  if (!ex) return;
  $('grammar-input').value = ex.grammar;
  $('input-string').value  = ex.input;
});

document.getElementById('speed-slider').addEventListener('input', function() {
  $('speed-label').textContent = this.value + ' ms';
});

// ── Main: load and simulate ─────────────────────────────────────────
function loadGrammar() {
  resetSim();

  const gText  = $('grammar-input').value.trim();
  const iStr   = $('input-string').value.trim();
  const errEl  = $('grammar-error');
  errEl.style.display = 'none';

  if (!gText) { showError('Please enter a grammar.'); return; }

  grammar = parseGrammar(gText);
  if (grammar.error) { showError(grammar.error); return; }

  if (!iStr && iStr !== '') {
    // empty string is valid
  }

  simResult = simulateRDP(grammar, iStr);
  stepIdx = -1;

  // show UI panels
  showEl('step-controls');
  showEl('legend-card');
  showEl('input-display-card');
  showEl('callstack-card');
  $('tree-placeholder').style.display = 'none';

  // render initial token strip
  renderTokenStrip(simResult.tokens, -1);
  updateStepCounter();
  $('btn-reset').disabled = false;

  // log
  addTrace('info', `Grammar loaded: ${grammar.nts.length} non-terminals, ${grammar.terminals.length} terminals, ${grammar.rules.length} rules.`);
  addTrace('info', `Input tokens: [${simResult.tokens.join(', ')}]`);
  addTrace('info', `Total simulation steps: ${simResult.steps.length}. Use Next/Play to step through.`);

  setStatus('running', 'Ready — click <strong>Next</strong> to begin stepping.');

  // Render empty tree root
  renderTree(simResult.tree, -1);
}

function showError(msg) {
  const errEl = $('grammar-error');
  errEl.textContent = '⚠ ' + msg;
  errEl.style.display = '';
}

// ── Step controls ───────────────────────────────────────────────────
function stepForward() {
  if (!simResult) return;
  if (stepIdx >= simResult.steps.length - 1) return;
  stepIdx++;
  applyStep(stepIdx);
  updateControls();
}

function stepBack() {
  if (!simResult) return;
  if (stepIdx <= 0) return;
  stepIdx--;
  // Replay from 0 to stepIdx for accurate state
  replayUpTo(stepIdx);
  updateControls();
}

function jumpEnd() {
  if (!simResult) return;
  stopPlay();
  while (stepIdx < simResult.steps.length - 1) {
    stepIdx++;
    applyStepQuiet(stepIdx);
  }
  // Full re-render at final state
  replayUpTo(stepIdx);
  updateControls();
}

function togglePlay() {
  if (playing) stopPlay();
  else startPlay();
}

function startPlay() {
  if (!simResult) return;
  playing = true;
  $('btn-play').textContent = '⏸ Pause';
  $('btn-play').className = 'btn btn-warning btn-sm';
  scheduleNext();
}

function stopPlay() {
  playing = false;
  clearTimeout(playTimer);
  $('btn-play').textContent = '▶ Play';
  $('btn-play').className = 'btn btn-success btn-sm';
}

function scheduleNext() {
  if (!playing) return;
  const delay = parseInt($('speed-slider').value);
  playTimer = setTimeout(() => {
    if (stepIdx >= simResult.steps.length - 1) { stopPlay(); return; }
    stepForward();
    scheduleNext();
  }, delay);
}

function resetSim() {
  stopPlay();
  grammar = null; simResult = null; stepIdx = -1; callStack = [];
  showEl('step-controls', false);
  showEl('legend-card', false);
  showEl('input-display-card', false);
  showEl('callstack-card', false);
  $('tree-placeholder').style.display = '';
  $('trace-log').innerHTML = '<div class="trace-line info">Load a grammar to begin...</div>';
  $('verdict-area').innerHTML = '';
  $('call-stack').innerHTML = '';
  $('input-strip').innerHTML = '';
  clearSVG();
  $('btn-reset').disabled = true;
  setStatus('idle', 'Ready');
}

function updateControls() {
  $('btn-prev').disabled = stepIdx <= 0;
  $('btn-next').disabled = stepIdx >= (simResult ? simResult.steps.length - 1 : 0);
  updateStepCounter();
}

function updateStepCounter() {
  $('step-counter').textContent = `${Math.max(0, stepIdx+1)} / ${simResult ? simResult.steps.length : 0}`;
}

// ── Apply a step (with UI updates) ─────────────────────────────────
function applyStep(idx) {
  const step = simResult.steps[idx];

  // Update call stack
  updateCallStack(step);

  // Update input pointer highlight
  renderTokenStrip(simResult.tokens, step.ip);

  // Update trace
  const cls = {
    expand: 'expand', try: 'info', match: 'match',
    backtrack: 'back', fail: 'fail', return: 'match',
    accept: 'accept', reject: 'reject'
  }[step.type] || 'info';

  addTrace(cls, step.msg, true);

  // Re-render tree up to current state
  renderTree(simResult.tree, idx);

  // Verdict
  if (step.type === 'accept' || step.type === 'reject') {
    showVerdict(step.type === 'accept', step.msg);
    stopPlay();
  }

  // Status
  const statusMap = {
    expand:    ['running', `Expanding <strong>${step.nt || ''}</strong>`],
    try:       ['running', `Trying production…`],
    match:     ['ok',      `Matched`],
    backtrack: ['warn',    `Backtracking…`],
    fail:      ['err',     `Failed`],
    return:    ['ok',      `Returned success`],
    accept:    ['ok',      `<strong>ACCEPT</strong>`],
    reject:    ['err',     `<strong>REJECT</strong>`],
  };
  const [s, t] = statusMap[step.type] || ['running', ''];
  setStatus(s, t);
}

function applyStepQuiet(idx) {
  // no DOM updates, just for jumping to end
}

function replayUpTo(idx) {
  // Re-render token strip and tree based on step state
  if (idx < 0) { renderTokenStrip(simResult.tokens, -1); clearSVG(); $('call-stack').innerHTML=''; return; }
  const step = simResult.steps[idx];
  renderTokenStrip(simResult.tokens, step.ip);
  renderTree(simResult.tree, idx);
  updateCallStack(step);

  // Rebuild trace log
  $('trace-log').innerHTML = '';
  for (let i = 0; i <= idx; i++) {
    const s = simResult.steps[i];
    const cls = {
      expand:'expand',try:'info',match:'match',backtrack:'back',
      fail:'fail',return:'match',accept:'accept',reject:'reject'
    }[s.type] || 'info';
    addTrace(cls, s.msg);
  }

  if (step.type === 'accept' || step.type === 'reject') {
    showVerdict(step.type === 'accept', step.msg);
  } else {
    $('verdict-area').innerHTML = '';
  }
}

// ── Call stack display ──────────────────────────────────────────────
function updateCallStack(step) {
  // Build call stack by replaying expand/return events up to current step
  const frames = [];
  for (let i = 0; i <= stepIdx; i++) {
    const s = simResult.steps[i];
    if (s.type === 'expand') frames.push({ nt: s.nt, depth: s.depth, state: 'active' });
    else if (s.type === 'return') {
      // pop matching frame
      for (let j = frames.length-1; j >= 0; j--) {
        if (frames[j].nt === s.nt) { frames[j].state = 'done'; frames.splice(j, 1); break; }
      }
    } else if (s.type === 'fail' && s.nt) {
      for (let j = frames.length-1; j >= 0; j--) {
        if (frames[j].nt === s.nt) { frames.splice(j, 1); break; }
      }
    }
  }

  const cs = $('call-stack');
  cs.innerHTML = '';
  if (!frames.length) {
    cs.innerHTML = '<div style="color:var(--text-muted);font-size:0.78rem;padding:0.25rem 0.5rem;">Stack empty</div>';
    return;
  }
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i];
    const div = document.createElement('div');
    div.className = 'call-frame ' + (i === frames.length-1 ? 'top' : 'other');
    div.innerHTML = `<span class="depth-indicator">${f.depth}</span><span>${f.nt}()</span>`;
    cs.appendChild(div);
  }
}

// ── Token strip ─────────────────────────────────────────────────────
function renderTokenStrip(tokens, ip) {
  const strip = $('input-strip');
  strip.innerHTML = '';
  tokens.forEach((t, i) => {
    const div = document.createElement('div');
    div.className = 'input-tok';
    if (i < ip) div.classList.add('consumed');
    else if (i === ip) div.classList.add('current');
    else div.classList.add('future');
    div.textContent = t;
    strip.appendChild(div);
  });
}

// ── Trace log ───────────────────────────────────────────────────────
function addTrace(cls, msg, scroll=false) {
  const log = $('trace-log');
  const div = document.createElement('div');
  div.className = 'trace-line ' + cls;
  div.textContent = msg;
  log.appendChild(div);
  if (scroll) log.scrollTop = log.scrollHeight;
}

// ── Verdict banner ──────────────────────────────────────────────────
function showVerdict(accept, msg) {
  $('verdict-area').innerHTML = `
    <div class="verdict ${accept ? 'accept' : 'reject'}">
      <span>${accept ? '✅' : '❌'}</span>
      <span>${msg}</span>
    </div>`;
}

// ── Parse Tree SVG Renderer ─────────────────────────────────────────
const NODE_R = 22;
const LEVEL_H = 80;
const MIN_X_GAP = 12;

function clearSVG() {
  document.getElementById('tree-g').innerHTML = '';
}

function fitTree() {
  if (!simResult) return;
  renderTree(simResult.tree, stepIdx);
}

/**
 * Compute subtree layout using a simple recursive algorithm.
 * Returns { x, y } for each node.
 */
function layoutTree(root) {
  const positions = new Map();

  function subtreeWidth(node) {
    if (!node.children || node.children.length === 0) return NODE_R * 2 + MIN_X_GAP;
    const w = node.children.reduce((s, c) => s + subtreeWidth(c), 0);
    return Math.max(w, NODE_R * 2 + MIN_X_GAP);
  }

  function assignPositions(node, x, y, width) {
    positions.set(node.id, { x: x + width / 2, y });
    let cx = x;
    for (const child of (node.children || [])) {
      const cw = subtreeWidth(child);
      assignPositions(child, cx, y + LEVEL_H, cw);
      cx += cw;
    }
  }

  const tw = subtreeWidth(root);
  const W = Math.max(tw, 300);
  assignPositions(root, 0, NODE_R + 10, W);

  // Compute bounding box
  let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pos of positions.values()) {
    minX = Math.min(minX, pos.x);
    maxX = Math.max(maxX, pos.x);
    maxY = Math.max(maxY, pos.y);
  }

  return { positions, width: maxX - minX + NODE_R*2 + 20, height: maxY + NODE_R + 10 };
}

function getNodeStateAtStep(nodeId, stepIdx) {
  // Replay steps to determine node state
  let state = 'pending';
  for (let i = 0; i <= stepIdx; i++) {
    const s = simResult.steps[i];
    if (s.nodeId === nodeId) {
      if (s.type === 'expand') state = 'active';
      else if (s.type === 'match') state = 'match';
      else if (s.type === 'return') state = 'match';
      else if (s.type === 'fail') state = 'fail';
      else if (s.type === 'backtrack') state = 'backtrack';
    }
    // If children were cleared (backtrack), reset them
    if (s.type === 'backtrack' && s.nodeId === nodeId) state = 'active';
  }
  return state;
}

function renderTree(root, currentStepIdx) {
  const svg = $('tree-svg');
  const g = $('tree-g');
  g.innerHTML = '';

  if (!root) return;

  // Collect all visible nodes (only nodes that have been revealed)
  // A node is visible if its parent's expand step index <= currentStepIdx
  const visibleNodes = [];
  const visibleEdges = [];

  function collect(node, parentPos) {
    visibleNodes.push(node);
    if (parentPos) visibleEdges.push({ from: parentPos, to: node });
    for (const child of (node.children || [])) collect(child, node);
  }
  collect(root, null);

  if (visibleNodes.length === 0) return;

  const { positions, width, height } = layoutTree(root);

  // Resize SVG
  const canvas = $('tree-canvas');
  const svgWidth  = Math.max(width + 40, canvas.clientWidth);
  const svgHeight = Math.max(height + 40, 400);
  svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
  svg.setAttribute('width', svgWidth);
  svg.setAttribute('height', svgHeight);
  canvas.style.minHeight = svgHeight + 'px';

  const offsetX = (svgWidth - width) / 2;

  // Draw edges first
  for (const edge of visibleEdges) {
    const fp = positions.get(edge.from.id);
    const tp = positions.get(edge.to.id);
    if (!fp || !tp) continue;

    const toState = getNodeStateAtStep(edge.to.id, currentStepIdx);
    let cls = 'tree-edge';
    if (toState === 'match') cls += ' success';
    else if (toState === 'fail' || toState === 'backtrack') cls += ' backtrack';
    else if (toState === 'active') cls += ' active';

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', fp.x + offsetX);
    line.setAttribute('y1', fp.y + NODE_R);
    line.setAttribute('x2', tp.x + offsetX);
    line.setAttribute('y2', tp.y - NODE_R);
    line.setAttribute('class', cls);
    g.appendChild(line);
  }

  // Draw nodes
  for (const node of visibleNodes) {
    const pos = positions.get(node.id);
    if (!pos) continue;

    const state = getNodeStateAtStep(node.id, currentStepIdx);
    const isNTSym = grammar && grammar.ntSet.has(node.sym);
    const isEps = node.sym === 'ε';

    const grp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    grp.setAttribute('class', 'tree-node');
    grp.setAttribute('transform', `translate(${pos.x + offsetX}, ${pos.y})`);

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('r', NODE_R);
    let circleClass = isEps ? 'epsilon' : (isNTSym ? 'nt' : 'terminal');
    if (state === 'active') circleClass = 'active';
    else if (state === 'fail' || state === 'backtrack') circleClass = 'backtrack';
    else if (state === 'match' && !isNTSym) circleClass = 'terminal';
    circle.setAttribute('class', circleClass);
    grp.appendChild(circle);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.textContent = node.sym;
    grp.appendChild(text);

    g.appendChild(grp);
  }
}
