/**
 * grammar.js — Grammar parsing & utilities shared by RDP and LL(1) modules.
 *
 * Grammar input format (one rule per line):
 *   S -> A B | C
 *   A -> a | ε
 *   B -> b B | ε
 *   C -> c
 *
 * Conventions:
 *  - Single uppercase letter or uppercase-letter word = non-terminal
 *  - Everything else = terminal
 *  - ε or eps or epsilon = empty production
 *  - $ = end-of-input marker
 */

'use strict';

// ──────────────────────────────────────────────────────────────────
// parseGrammar(text)  →  { start, rules, nts, terminals, error }
// ──────────────────────────────────────────────────────────────────
function parseGrammar(text) {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'));
  if (!lines.length) return { error: 'Grammar is empty.' };

  const rules = [];   // [{lhs: 'S', rhs: ['A','B']}, ...]
  const ntSet = new Set();
  const termSet = new Set();
  let start = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const arrowMatch = line.match(/^([A-Z][A-Za-z0-9_']*)\s*->\s*(.+)$/);
    if (!arrowMatch) return { error: `Line ${i+1}: expected "NT -> production" but got: "${line}"` };

    const lhs = arrowMatch[1];
    if (!start) start = lhs;
    ntSet.add(lhs);

    const alts = arrowMatch[2].split('|').map(a => a.trim());
    for (const alt of alts) {
      const rhs = tokenizeRHS(alt);
      rules.push({ lhs, rhs });
    }
  }

  // classify terminals
  for (const r of rules) {
    for (const sym of r.rhs) {
      if (!isEpsilon(sym) && !ntSet.has(sym)) termSet.add(sym);
    }
  }

  // validation: every NT used on rhs must be defined on lhs
  for (const r of rules) {
    for (const sym of r.rhs) {
      if (!isEpsilon(sym) && isNT(sym, ntSet) && !ntSet.has(sym)) {
        return { error: `Undefined non-terminal "${sym}" used in rule ${r.lhs} -> ${r.rhs.join(' ')}` };
      }
    }
  }

  return {
    start,
    rules,
    nts: [...ntSet],
    terminals: [...termSet],
    ntSet,
    termSet,
    error: null
  };
}

function tokenizeRHS(alt) {
  if (isEpsilon(alt)) return ['ε'];
  // split on whitespace — each symbol is a token
  const parts = alt.trim().split(/\s+/).filter(Boolean);
  return parts.map(p => normalizeEpsilon(p));
}

function isEpsilon(s) {
  return s === 'ε' || s.toLowerCase() === 'eps' || s.toLowerCase() === 'epsilon' || s === '';
}

function normalizeEpsilon(s) {
  return isEpsilon(s) ? 'ε' : s;
}

function isNT(sym, ntSet) {
  return ntSet && ntSet.has(sym);
}

// ──────────────────────────────────────────────────────────────────
// FIRST sets
// Returns Map<NT, Set<terminal|'ε'>>
// ──────────────────────────────────────────────────────────────────
function computeFirstSets(grammar) {
  const { rules, nts, ntSet } = grammar;
  const first = new Map();
  for (const nt of nts) first.set(nt, new Set());

  // Terminals: FIRST(a) = {a}
  // We track per-NT sets only

  let changed = true;
  const steps = []; // audit trail for step-by-step display

  while (changed) {
    changed = false;
    for (const rule of rules) {
      const { lhs, rhs } = rule;
      const before = new Set(first.get(lhs));

      const added = firstOfSequence(rhs, ntSet, first);
      for (const s of added) {
        if (!first.get(lhs).has(s)) {
          first.get(lhs).add(s);
          changed = true;
          steps.push({
            rule: `${lhs} → ${rhs.join(' ')}`,
            added: s,
            nt: lhs,
            reason: deriveFirstReason(s, rhs, ntSet, first)
          });
        }
      }
    }
  }

  return { first, steps };
}

function firstOfSequence(rhs, ntSet, firstMap) {
  const result = new Set();
  if (!rhs || rhs.length === 0) { result.add('ε'); return result; }

  let allEpsilon = true;
  for (let i = 0; i < rhs.length; i++) {
    const sym = rhs[i];
    if (sym === 'ε') {
      if (rhs.length === 1) result.add('ε');
      allEpsilon = false; break;
    }
    if (!ntSet.has(sym)) {
      result.add(sym); allEpsilon = false; break;
    }
    const f = firstMap.get(sym) || new Set();
    for (const s of f) if (s !== 'ε') result.add(s);
    if (!f.has('ε')) { allEpsilon = false; break; }
  }
  if (allEpsilon) result.add('ε');
  return result;
}

function deriveFirstReason(sym, rhs, ntSet, firstMap) {
  if (sym === 'ε') return 'ε production';
  if (!ntSet.has(rhs[0])) return `"${rhs[0]}" is a terminal`;
  return `FIRST(${rhs[0]}) contains "${sym}"`;
}

// ──────────────────────────────────────────────────────────────────
// FOLLOW sets
// Returns Map<NT, Set<terminal|'$'>>
// ──────────────────────────────────────────────────────────────────
function computeFollowSets(grammar, firstMap) {
  const { rules, nts, ntSet, start } = grammar;
  const follow = new Map();
  for (const nt of nts) follow.set(nt, new Set());
  follow.get(start).add('$');

  const steps = [];
  let changed = true;

  while (changed) {
    changed = false;
    for (const rule of rules) {
      const { lhs, rhs } = rule;
      for (let i = 0; i < rhs.length; i++) {
        const B = rhs[i];
        if (!ntSet.has(B)) continue;

        const beta = rhs.slice(i + 1);
        const firstBeta = firstOfSequence(beta.length ? beta : ['ε'], ntSet, firstMap);

        for (const s of firstBeta) {
          if (s !== 'ε' && !follow.get(B).has(s)) {
            follow.get(B).add(s);
            changed = true;
            steps.push({
              rule: `${lhs} → ${rhs.join(' ')}`,
              nt: B,
              added: s,
              reason: beta.length ? `FIRST(${beta.join(' ')}) contains "${s}"` : `end of rule → FOLLOW(${lhs}) ⊇ {${s}}`
            });
          }
        }

        // if β ⇒* ε (or β is empty), FOLLOW(B) ⊇ FOLLOW(lhs)
        if (firstBeta.has('ε') || !beta.length) {
          for (const s of follow.get(lhs)) {
            if (!follow.get(B).has(s)) {
              follow.get(B).add(s);
              changed = true;
              steps.push({
                rule: `${lhs} → ${rhs.join(' ')}`,
                nt: B,
                added: s,
                reason: `β ⇒* ε → FOLLOW(${lhs}) ⊇ {${s}}`
              });
            }
          }
        }
      }
    }
  }

  return { follow, steps };
}

// ──────────────────────────────────────────────────────────────────
// LL(1) Parse Table
// Returns { table: Map<NT, Map<term, [rule]>>, conflicts: [] }
// ──────────────────────────────────────────────────────────────────
function buildLL1Table(grammar, firstMap, followMap) {
  const { rules, nts, terminals, ntSet } = grammar;
  const table = new Map();
  for (const nt of nts) table.set(nt, new Map());

  const conflicts = [];
  const steps = [];

  for (const rule of rules) {
    const { lhs, rhs } = rule;
    const ruleStr = `${lhs} → ${rhs.join(' ')}`;

    const firstAlpha = firstOfSequence(rhs, ntSet, firstMap);

    // For each a in FIRST(α) \ {ε}, add to M[lhs, a]
    for (const a of firstAlpha) {
      if (a === 'ε') continue;
      const cell = table.get(lhs);
      const step = { rule: ruleStr, nt: lhs, term: a, reason: `"${a}" ∈ FIRST(${rhs.join(' ')})` };
      if (cell.has(a)) {
        if (cell.get(a) !== ruleStr) {
          conflicts.push({ nt: lhs, term: a, existing: cell.get(a), incoming: ruleStr });
          step.conflict = true;
        }
      } else {
        cell.set(a, ruleStr);
      }
      steps.push(step);
    }

    // If ε ∈ FIRST(α), for each b in FOLLOW(lhs), add to M[lhs, b]
    if (firstAlpha.has('ε')) {
      for (const b of followMap.get(lhs)) {
        const cell = table.get(lhs);
        const step = { rule: ruleStr, nt: lhs, term: b, reason: `ε ∈ FIRST(${rhs.join(' ')}) and "${b}" ∈ FOLLOW(${lhs})` };
        if (cell.has(b)) {
          if (cell.get(b) !== ruleStr) {
            conflicts.push({ nt: lhs, term: b, existing: cell.get(b), incoming: ruleStr });
            step.conflict = true;
          }
        } else {
          cell.set(b, ruleStr);
        }
        steps.push(step);
      }
    }
  }

  return { table, conflicts, steps };
}

// ──────────────────────────────────────────────────────────────────
// LL(1) String Parsing — produces full trace
// ──────────────────────────────────────────────────────────────────
function ll1ParseString(grammar, table, inputStr) {
  const tokens = tokenizeInput(inputStr);
  tokens.push('$');

  const stack = ['$', grammar.start];
  const trace = [];
  let ip = 0;  // input pointer

  const snapshot = () => ({
    stack: [...stack].reverse().join(' '),
    input: tokens.slice(ip).join(' '),
    action: ''
  });

  while (true) {
    const top = stack[stack.length - 1];
    const a   = tokens[ip];

    const step = snapshot();

    if (top === '$' && a === '$') {
      step.action = 'ACCEPT';
      step.verdict = 'accept';
      trace.push(step);
      break;
    }

    if (top === '$') {
      step.action = `REJECT — input remaining but stack empty`;
      step.verdict = 'reject';
      trace.push(step);
      break;
    }

    if (!grammar.ntSet.has(top)) {
      // top is terminal
      if (top === a) {
        step.action = `match "${a}" — pop`;
        trace.push(step);
        stack.pop(); ip++;
      } else {
        step.action = `REJECT — expected "${top}" but saw "${a}"`;
        step.verdict = 'reject';
        trace.push(step);
        break;
      }
    } else {
      // top is NT
      const cell = table.get(top);
      if (!cell || !cell.has(a)) {
        step.action = `REJECT — no entry in M[${top}, ${a}]`;
        step.verdict = 'reject';
        trace.push(step);
        break;
      }
      const production = cell.get(a);   // e.g. "S → A B"
      const rhs = production.split('→')[1].trim().split(/\s+/);
      step.action = `output ${production}`;
      trace.push(step);

      stack.pop();
      if (!(rhs.length === 1 && rhs[0] === 'ε')) {
        for (let i = rhs.length - 1; i >= 0; i--) stack.push(rhs[i]);
      }
    }
  }

  return trace;
}

// ──────────────────────────────────────────────────────────────────
// Tokenize input string (space-separated or char-by-char for single chars)
// ──────────────────────────────────────────────────────────────────
function tokenizeInput(str) {
  str = str.trim();
  if (!str) return [];
  // If the string contains spaces, split on spaces; otherwise split char-by-char
  if (str.includes(' ')) return str.split(/\s+/).filter(Boolean);
  return str.split('').filter(Boolean);
}

// ──────────────────────────────────────────────────────────────────
// RDP Simulation
// ──────────────────────────────────────────────────────────────────

function simulateRDP(grammar, inputStr) {
  const tokens = tokenizeInput(inputStr);
  const steps  = [];    // each step is a snapshot of the call/return state
  const tree   = { id: 0, sym: grammar.start, children: [], state: 'pending' };
  let   nodeId = 1;
  let   ip     = 0;
  let   callDepth = 0;

  // Get all productions for an NT
  const prodsFor = (nt) => grammar.rules.filter(r => r.lhs === nt);

  function addStep(type, msg, extra) {
    steps.push({ type, msg, ip, depth: callDepth, ...extra });
  }

  function parse(nt, node) {
    callDepth++;
    addStep('expand', `Expanding ${nt}`, { nt, nodeId: node.id });
    node.state = 'active';

    const prods = prodsFor(nt);
    if (!prods.length) {
      addStep('fail', `No productions for ${nt}`, { nodeId: node.id });
      node.state = 'fail';
      callDepth--;
      return false;
    }

    const savedIp = ip;

    for (let pi = 0; pi < prods.length; pi++) {
      const { rhs } = prods[pi];
      addStep('try', `  Trying ${nt} → ${rhs.join(' ')} (alt ${pi+1}/${prods.length})`, { nt, rhs, prodIndex: pi, nodeId: node.id });

      // Build child nodes
      const childNodes = rhs.map(sym => {
        const cn = { id: nodeId++, sym, children: [], state: 'pending', parentId: node.id };
        node.children.push(cn);
        return cn;
      });

      ip = savedIp;
      let success = true;

      for (let si = 0; si < rhs.length; si++) {
        const sym = rhs[si];
        const child = childNodes[si];

        if (sym === 'ε') {
          child.state = 'match';
          addStep('match', `  ε — matched (empty)`, { sym, nodeId: child.id });
          continue;
        }

        if (!grammar.ntSet.has(sym)) {
          // terminal
          if (ip < tokens.length && tokens[ip] === sym) {
            child.state = 'match';
            addStep('match', `  Matched terminal "${sym}" at pos ${ip}`, { sym, nodeId: child.id, tokenPos: ip });
            ip++;
          } else {
            const got = ip < tokens.length ? tokens[ip] : 'EOF';
            child.state = 'fail';
            addStep('fail', `  Expected "${sym}", got "${got}" — mismatch`, { sym, nodeId: child.id });
            success = false;
            break;
          }
        } else {
          const ok = parse(sym, child);
          if (!ok) { success = false; break; }
        }
      }

      if (success) {
        node.state = 'match';
        addStep('return', `Returned from ${nt} — SUCCESS`, { nt, nodeId: node.id });
        callDepth--;
        return true;
      }

      // Backtrack
      node.children = [];
      nodeId = (childNodes[0] ? childNodes[0].id : nodeId);
      ip = savedIp;
      if (pi < prods.length - 1) {
        addStep('backtrack', `  Backtracking in ${nt}, trying next alternative`, { nt, nodeId: node.id });
        node.state = 'active';
      }
    }

    node.state = 'fail';
    addStep('fail', `All alternatives for ${nt} exhausted — FAIL`, { nt, nodeId: node.id });
    callDepth--;
    return false;
  }

  const accepted = parse(grammar.start, tree);

  if (accepted && ip === tokens.length) {
    addStep('accept', '✓ ACCEPT — Input fully consumed', { verdict: 'accept' });
  } else if (accepted && ip < tokens.length) {
    addStep('reject', `✗ REJECT — Parse succeeded but ${tokens.length - ip} token(s) remaining`, { verdict: 'reject' });
  } else {
    addStep('reject', '✗ REJECT — No production sequence matched the input', { verdict: 'reject' });
  }

  return { steps, tree, tokens };
}

// ──────────────────────────────────────────────────────────────────
// Export (works in both module and plain-script contexts)
// ──────────────────────────────────────────────────────────────────
if (typeof module !== 'undefined') {
  module.exports = { parseGrammar, computeFirstSets, computeFollowSets, buildLL1Table, ll1ParseString, simulateRDP, firstOfSequence, tokenizeInput, isEpsilon };
}
