// Regression report: one run's evaluation against a stored baseline run of the same target.
//
// Flags changed answers and every verdict that newly fails or newly passes, tracks pass rates (mechanical, judge
// when both runs have one) and per-category counts, keeps per-item details, and labels every output
// "automated regression evaluation — not independent acceptance".
import path from 'node:path';
import { JUDGE_LABEL, LABEL, SCOPE_NOTE, SEARCH_SET, SEARCH_SET_SHA256, comparePython, fail, frozenFile, labelBlock, loadJson,
  nowIso, rateBlock, repoRelative, sha256File } from './common.js';
import { prepareRetrieval } from './checks.js';
import { candidateForRun } from './context-candidate.js';
import { cpLength, cpSlice, pyEqual, pyRepr, pyStr } from './python-compat.js';

export const USEFUL_FAMILIES = ['mechanical', 'format', 'instruction', 'code', 'judge'];
export const SEARCH_FAMILIES = ['retrievalOutcome', 'answer', 'citations', 'claimCoverage', 'item', 'format', 'judge'];
const VOLATILE = new Set(['seconds', 'runArmSeconds', 'loadSeconds', 'secondsOriginal', 'secondsReplaced', 'rawArmRunSha256', 'gitHead']);

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function loadPair(runDir, evaluation = null) {
  const runPath = path.join(runDir, 'run.json');
  const evaluationPath = evaluation ? path.resolve(evaluation) : path.join(runDir, 'evaluation.json');
  const run = loadJson(runPath);
  const result = loadJson(evaluationPath);
  if (result.run.sha256 !== sha256File(runPath)) fail(`${evaluationPath} does not evaluate ${runPath}`);
  return [run, result, runPath, evaluationPath];
}

export function verdict(row, family) {
  if (!row || row.notRun) return null;
  if (['retrievalOutcome', 'answer', 'citations', 'claimCoverage'].includes(family)) {
    const value = (row.search || {})[family];
    return isObject(value) ? value.pass ?? null : null;
  }
  if (family === 'item') return (row.search || {}).pass ?? null;
  const value = row[family];
  return isObject(value) ? value.pass ?? null : null;
}

function flatten(value, prefix = '') {
  if (isObject(value)) {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      if (VOLATILE.has(key)) continue;
      Object.assign(out, flatten(inner, prefix ? `${prefix}.${key}` : key));
    }
    return out;
  }
  return { [prefix]: value };
}

function identityChanges(baseline, candidate) {
  const a = flatten(baseline.identities || {});
  const b = flatten(candidate.identities || {});
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(comparePython);
  const rows = keys.filter(key => !pyEqual(a[key] ?? null, b[key] ?? null))
    .map(key => ({ path: key, baseline: a[key] ?? null, candidate: b[key] ?? null }));
  return [rows, rows.some(row => ['sampling', 'limits'].includes(row.path.split('.')[0]))];
}

function firstDivergence(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) if (a[index] !== b[index]) return index;
  return a.length === b.length ? null : Math.min(a.length, b.length);
}

function turnChanges(baseItem, candItem) {
  const rows = [];
  const baseTurns = new Map((baseItem?.turns || []).map(turn => [turn.turn, turn]));
  const candTurns = new Map((candItem?.turns || []).map(turn => [turn.turn, turn]));
  const numbers = [...new Set([...baseTurns.keys(), ...candTurns.keys()])].sort((x, y) => x - y);
  for (const number of numbers) {
    const a = baseTurns.get(number);
    const b = candTurns.get(number);
    if (!a || !b) {
      rows.push({ turn: number, changed: true, detail: 'turn present in only one run', baselineRan: Boolean(a), candidateRan: Boolean(b) });
      continue;
    }
    const both = key => a[key] !== null && a[key] !== undefined && b[key] !== null && b[key] !== undefined;
    const textChanged = (a.output || '') !== (b.output || '');
    const tokensChanged = both('outputTokenIds') ? !pyEqual(a.outputTokenIds, b.outputTokenIds) : null;
    const promptChanged = both('promptTokenIds') ? !pyEqual(a.promptTokenIds, b.promptTokenIds) : null;
    const row = { turn: number, changed: Boolean(textChanged || tokensChanged), textChanged, tokensChanged, promptChanged };
    if (row.changed) {
      Object.assign(row, { firstTokenDivergence: firstDivergence(a.outputTokenIds, b.outputTokenIds),
        baselineStopReason: a.stopReason ?? null, candidateStopReason: b.stopReason ?? null,
        baselineOutput: a.output ?? null, candidateOutput: b.output ?? null });
    }
    rows.push(row);
  }
  return rows;
}

/** Individual check verdicts that changed, per turn and family. */
function checkTransitions(baseRow, candRow) {
  const changes = [];
  if (!baseRow || !candRow || baseRow.notRun || candRow.notRun) return changes;
  const byKey = rows => new Map((rows || []).map((row, index) => [pyRepr([row.turn ?? null, row.type, index]).slice(1, -1),
    { key: [row.turn ?? null, row.type, index], pass: row.pass }]));
  const pairs = [];
  const b = new Map((baseRow.mechanical?.turns || []).map(turn => [turn.turn, turn]));
  const c = new Map((candRow.mechanical?.turns || []).map(turn => [turn.turn, turn]));
  for (const number of b.keys()) if (c.has(number)) pairs.push(['mechanical', number, b.get(number).checks, c.get(number).checks]);
  const bTurns = new Map((baseRow.turns || []).map(turn => [turn.turn, turn]));
  const cTurns = new Map((candRow.turns || []).map(turn => [turn.turn, turn]));
  for (const number of bTurns.keys()) {
    if (!cTurns.has(number)) continue;
    for (const family of ['format', 'instruction']) pairs.push([family, number, bTurns.get(number)[family], cTurns.get(number)[family]]);
  }
  for (const [family, number, a, z] of pairs) {
    const ka = byKey(a);
    const kz = byKey(z);
    // Python sorted these keys by str((turn, type, index)).
    const shared = [...ka.keys()].filter(key => kz.has(key)).sort((x, y) => comparePython(`(${x})`, `(${y})`));
    for (const key of shared) {
      const left = ka.get(key);
      const right = kz.get(key);
      if (left.pass !== right.pass) changes.push({ family, turn: number, check: left.key[1], baseline: left.pass, candidate: right.pass });
    }
  }
  return changes;
}

function tally(rows, family) {
  const graded = rows.map(row => verdict(row, family)).filter(value => value !== null);
  return rateBlock(graded.filter(Boolean).length, graded.length);
}

/**
 * Bind generated answers to the frozen documents and actual dispatched messages.
 *
 * Retrieval failures stay comparable failures. A generated answer with missing or changed source evidence cannot be
 * attributed to a model/package regression. Verification, timing and cost metadata are deliberately outside this identity.
 */
export function validateSearchInputs(run) {
  const data = frozenFile(SEARCH_SET, SEARCH_SET_SHA256, 'search-task set');
  if (run.itemSet.sha256 !== SEARCH_SET_SHA256) fail('Search comparison requires the frozen search-task set');
  const candidate = candidateForRun(run);
  const items = new Map(data.items.map(item => [item.id, item]));
  const seen = new Set();
  for (const row of run.items) {
    const itemId = row.id;
    if (seen.has(itemId) || !items.has(itemId)) fail(`${itemId}: duplicate or unknown search item`);
    seen.add(itemId);
    const item = items.get(itemId);
    const turns = row.turns || [];
    if (turns.length > 1) fail(`${itemId}: frozen search items have one turn`);
    for (const turn of turns) {
      if (turn.dispatched !== true) {
        if (turn.output || (turn.outputTokenIds && turn.outputTokenIds.length)) fail(`${itemId}: generated answer has no dispatched source evidence`);
        continue;
      }
      let expected;
      if (candidate) {
        const retained = candidate[0][itemId];
        expected = { record: retained.retrieval, dispatchedMessages: retained.dispatchedMessages };
      } else {
        expected = prepareRetrieval(item, data, [{ role: 'user', content: item.prompt }]);
      }
      const record = turn.retrieval || {};
      if (record.outcome !== 'retrieved'
          || !pyEqual(record.sources ?? null, expected.record.sources ?? null)
          || !pyEqual(record.context ?? null, expected.record.context ?? null)
          || !pyEqual(turn.messages ?? null, expected.dispatchedMessages ?? null)) {
        fail(`${itemId}: generated answer does not bind the frozen source context and dispatched messages`);
      }
    }
  }
}

const sameSet = (a, b) => a.size === b.size && [...a].every(value => b.has(value));

export function compareRuns(baselineDir, candidateDir, { baselineEvaluation = null, candidateEvaluation = null } = {}) {
  const [bRun, bEval, bRunPath, bEvalPath] = loadPair(baselineDir, baselineEvaluation);
  const [cRun, cEval, cRunPath, cEvalPath] = loadPair(candidateDir, candidateEvaluation);
  if (bRun.target.id !== cRun.target.id || bRun.target.kind !== cRun.target.kind) {
    fail(`The baseline and candidate must be runs of the same target (${bRun.target.id} vs ${cRun.target.id})`);
  }
  if (bRun.itemSet.sha256 !== cRun.itemSet.sha256) fail('The baseline and candidate ran different item sets');
  if (!pyEqual(bRun.itemSet.contextCandidate ?? null, cRun.itemSet.contextCandidate ?? null)) {
    fail('Changed source context requires a separate context-candidate baseline');
  }
  const kind = bRun.itemSet.kind;
  if (kind === 'search') {
    validateSearchInputs(bRun);
    validateSearchInputs(cRun);
    const itemRows = [bRun.items, cRun.items, bEval.items, cEval.items];
    const memberships = itemRows.map(rows => new Set(rows.map(row => row.id)));
    if (itemRows.some((rows, index) => rows.length !== memberships[index].size)) fail('Search comparison requires unique evaluated item IDs');
    // Evaluators retain notRun rows for the rest of a frozen set on partial runs.
    // Those placeholders must not conceal missing evaluations or changed subsets.
    const runIds = memberships[0];
    if (!sameSet(memberships[1], runIds) || !sameSet(memberships[2], memberships[3])
        || ![...runIds].every(id => memberships[2].has(id))
        || itemRows.slice(2).some(rows => rows.some(row => !runIds.has(row.id) && !row.notRun))) {
      fail('Search comparison requires the same evaluated item IDs in both runs');
    }
  }
  const families = kind === 'useful-answer' ? USEFUL_FAMILIES : SEARCH_FAMILIES;
  const bItems = new Map(bEval.items.map(row => [row.id, row]));
  const cItems = new Map(cEval.items.map(row => [row.id, row]));
  const bRuns = new Map(bRun.items.map(item => [item.id, item]));
  const cRuns = new Map(cRun.items.map(item => [item.id, item]));
  const order = [...new Set([...bEval.items.map(row => row.id), ...cEval.items.map(row => row.id)])];
  const items = [];
  const newlyFailing = Object.fromEntries(families.map(family => [family, []]));
  const newlyPassing = Object.fromEntries(families.map(family => [family, []]));
  for (const itemId of order) {
    const bRow = bItems.get(itemId);
    const cRow = cItems.get(itemId);
    const transitions = {};
    for (const family of families) {
      const a = verdict(bRow, family);
      const b = verdict(cRow, family);
      if (a === b) continue;
      let change = 'availability changed';
      if (a === true && b === false) change = 'newly failing';
      else if (a === false && b === true) change = 'newly passing';
      transitions[family] = { baseline: a, candidate: b, change };
      if (change === 'newly failing') newlyFailing[family].push(itemId);
      else if (change === 'newly passing') newlyPassing[family].push(itemId);
    }
    const turns = turnChanges(bRuns.get(itemId), cRuns.get(itemId));
    const row = bRow || cRow;
    items.push({ id: itemId, category: row.category ?? null, answerChanged: turns.some(turn => turn.changed), turns, transitions,
      checkChanges: checkTransitions(bRow, cRow),
      baseline: Object.fromEntries(families.map(family => [family, verdict(bRow, family)])),
      candidate: Object.fromEntries(families.map(family => [family, verdict(cRow, family)])) });
  }
  const categories = [...new Set(items.map(item => item.category))];
  const bRows = [...bItems.values()];
  const cRows = [...cItems.values()];
  const rates = Object.fromEntries(families.map(family => [family, { baseline: tally(bRows, family), candidate: tally(cRows, family) }]));
  if (kind === 'useful-answer') rates.mechanical = { baseline: bEval.summary.mechanical, candidate: cEval.summary.mechanical };
  const judgePresent = Boolean(bEval.judge) && Boolean(cEval.judge);
  if (!judgePresent) delete rates.judge;
  const byCategory = Object.fromEntries(categories.map(category => [category, Object.fromEntries(families
    .filter(family => family !== 'judge' || judgePresent)
    .map(family => [family, { baseline: tally(bRows.filter(row => row.category === category), family),
      candidate: tally(cRows.filter(row => row.category === category), family) }]))]));
  const [changes, samplingChanged] = identityChanges(bRun, cRun);
  const changedTurns = items.reduce((total, item) => total + item.turns.filter(turn => turn.changed).length, 0);
  const nonEmpty = groups => Object.fromEntries(Object.entries(groups).filter(([, ids]) => ids.length));
  const total = groups => Object.values(groups).reduce((sum, ids) => sum + ids.length, 0);
  return {
    schema: 'reploid.answer-regression.report/v1', ...labelBlock(), comparedAt: nowIso(),
    judgeLabel: judgePresent ? JUDGE_LABEL : null,
    baseline: { runId: bRun.runId ?? null, run: repoRelative(bRunPath), runSha256: sha256File(bRunPath),
      evaluation: repoRelative(bEvalPath), evaluationSha256: sha256File(bEvalPath), judge: bEval.judge ?? null },
    candidate: { runId: cRun.runId ?? null, run: repoRelative(cRunPath), runSha256: sha256File(cRunPath),
      evaluation: repoRelative(cEvalPath), evaluationSha256: sha256File(cEvalPath), judge: cEval.judge ?? null },
    target: bRun.target, itemSet: bRun.itemSet,
    identityChanges: changes,
    samplingOrLimitsChanged: samplingChanged,
    samplingNote: samplingChanged
      ? 'Sampling or limits differ between the runs, so answer differences are not attributable to arithmetic alone.' : null,
    summary: { answersChanged: changedTurns, itemsWithChangedAnswers: items.filter(item => item.answerChanged).length,
      newlyFailing: nonEmpty(newlyFailing), newlyPassing: nonEmpty(newlyPassing),
      newlyFailingTotal: total(newlyFailing), newlyPassingTotal: total(newlyPassing), rates },
    byCategory,
    items,
  };
}

function fmtRate(value) {
  if (!value || value.total === null || value.total === undefined || value.total === 0) return 'n/a';
  return `${value.pass}/${value.total}` + (value.rate !== null && value.rate !== undefined ? ` (${(value.rate * 100).toFixed(1)}%)` : '');
}

function excerpt(text, limit = 160) {
  text = (text || '').replaceAll('\n', ' ⏎ ').replaceAll('|', '\\|');
  return cpLength(text) <= limit ? text : `${cpSlice(text, 0, limit)}…`;
}

const str = value => (value === null || value === undefined ? 'None' : pyStr(value));

export function renderMarkdown(report) {
  const lines = [`# Answer regression report: ${report.target.id}`, '', `**${LABEL}.**`, '', SCOPE_NOTE, ''];
  lines.push('| | Baseline | Candidate |', '|---|---|---|',
    `| Run | \`${report.baseline.runId}\` | \`${report.candidate.runId}\` |`,
    `| Run sha256 | \`${report.baseline.runSha256.slice(0, 16)}…\` | \`${report.candidate.runSha256.slice(0, 16)}…\` |`,
    `| Item set | ${report.itemSet.name} (\`${report.itemSet.sha256.slice(0, 16)}…\`) | same |`, '');
  if (report.judgeLabel) lines.push(`Judge rows are labeled **${report.judgeLabel}**.`, '');
  lines.push('## Identity changes', '');
  if (report.identityChanges.length) {
    lines.push('| Identity | Baseline | Candidate |', '|---|---|---|');
    for (const row of report.identityChanges.slice(0, 60)) {
      lines.push(`| \`${row.path}\` | ${excerpt(str(row.baseline), 70)} | ${excerpt(str(row.candidate), 70)} |`);
    }
    if (report.identityChanges.length > 60) lines.push(`| … | ${report.identityChanges.length - 60} more in the JSON report | |`);
  } else {
    lines.push('None: both runs recorded the same package, model, Capsule, placement, sampling and limits.');
  }
  if (report.samplingNote) lines.push('', `**${report.samplingNote}**`);
  const summary = report.summary;
  lines.push('', '## Summary', '', `- Changed answers: ${summary.answersChanged} turns in ${summary.itemsWithChangedAnswers} items.`,
    `- Newly failing verdicts: ${summary.newlyFailingTotal}; newly passing: ${summary.newlyPassingTotal}.`, '',
    '| Verdict family | Baseline | Candidate |', '|---|---|---|');
  for (const [family, values] of Object.entries(summary.rates)) lines.push(`| ${family} | ${fmtRate(values.baseline)} | ${fmtRate(values.candidate)} |`);
  for (const [title, groups] of [['Newly failing', summary.newlyFailing], ['Newly passing', summary.newlyPassing]]) {
    lines.push('', `## ${title}`, '');
    const entries = Object.entries(groups);
    if (entries.length) for (const [family, ids] of entries) lines.push(`- **${family}**: ${ids.map(id => `\`${id}\``).join(', ')}`);
    else lines.push('None.');
  }
  lines.push('', '## Changed answers', '');
  const changed = report.items.flatMap(item => item.turns.filter(turn => turn.changed).map(turn => [item, turn]));
  if (changed.length) {
    lines.push('| Item | Turn | First token divergence | Baseline | Candidate |', '|---|---|---|---|---|');
    for (const [item, turn] of changed) {
      lines.push(`| \`${item.id}\` | ${turn.turn} | ${str(turn.firstTokenDivergence)} | ${excerpt(turn.baselineOutput)} | `
        + `${excerpt(turn.candidateOutput)} |`);
    }
  } else {
    lines.push('None: every answer is identical to the baseline.');
  }
  lines.push('', '## By category', '');
  const firstCategory = Object.values(report.byCategory)[0];
  const families = firstCategory ? Object.keys(firstCategory) : [];
  if (families.length) {
    lines.push(`| Category | ${families.join(' | ')} |`, `|---|${'---|'.repeat(families.length)}`);
    for (const [category, values] of Object.entries(report.byCategory)) {
      const cells = families.map(family => `${fmtRate(values[family].baseline)} → ${fmtRate(values[family].candidate)}`);
      lines.push(`| ${category} | ${cells.join(' | ')} |`);
    }
  }
  const detail = report.items.filter(item => Object.keys(item.transitions).length || item.checkChanges.length);
  lines.push('', '## Item details', '');
  if (detail.length) {
    for (const item of detail) {
      const transitions = Object.entries(item.transitions).map(([family, t]) => `${family} ${str(t.baseline)} → ${str(t.candidate)}`).join('; ');
      const checks = item.checkChanges.length
        ? ` | checks: ${item.checkChanges.map(c => `t${c.turn} ${c.family}.${c.check} ${str(c.baseline)} → ${str(c.candidate)}`).join(', ')}` : '';
      lines.push(`- \`${item.id}\` (${item.category}): ${transitions}${checks}`);
    }
  } else {
    lines.push('No verdict changed. Per-item details for every item are in the JSON report.');
  }
  lines.push('', '---', `*${LABEL}.*`, '');
  return lines.join('\n');
}
