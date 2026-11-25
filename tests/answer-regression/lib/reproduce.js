// Confirms the harness reproduces the useful-answer set's frozen mechanical results exactly.
//
// 1. Check equivalence: the harness's mechanical verdicts for the stored 2026-10-14 Q4_K and bf16 arm runs equal
//    results.json item by item, turn by turn and check by check (pass and detail text).
// 2. Generation reproduction: the run's prompts and outputs equal the stored Q4_K arm run token for token.
// 3. Baseline verdicts: the run's mechanical verdicts equal results.json's Q4_K verdicts.
// 4. Rates: the harness's mechanical pass rates by category equal results.json's mechanical rates for both arms.
// 5. Whole evaluation: when the run directory has evaluation.json, the stored Q4_K arm run is evaluated now and every
//    verdict family must agree with it. Verdicts that the stored evaluation graded by executing or parsing Python, and
//    that this JavaScript-only harness leaves ungraded (null), are listed separately as such, not hidden.
//
// Only mechanical fields of results.json are read. Its review section, provisional rubric grades and reviewer-adjusted
// view are earlier grades and are not used.
import fs from 'node:fs';
import path from 'node:path';
import { PYTHON_REMOVED, USEFUL_ANSWER_DIR, USEFUL_ANSWER_REL, USEFUL_ANSWER_SET, USEFUL_ANSWER_SET_SHA256, fail, frozenFile,
  labelBlock, loadJson, nowIso, rateBlock, repoRelative, sha256File } from './common.js';
import { mechanicalItem } from './checks.js';
import { evaluateRun } from './evaluation.js';
import { pyEqual } from './python-compat.js';
import { USEFUL_FAMILIES, verdict } from './report.js';
import { armRunItems } from './targets.js';

const PINS = { 'results.json': '5a915efda2fc381506589c2ab8a5d576d4b2c69be53ef60d7894710b427db97c',
  'q4k-run.json': 'bb26a677e58b9ab721ca0859e172ee430419a15063e329c76bd78e887cd85c09',
  'bf16-run.json': 'f18c9089eacefe071dff8ed4408e49808c1ee8962fa3000a4a3cbf40443e8b4b' };
const TURN_KEYS = ['promptTokenIds', 'renderedPromptSha256', 'outputTokenIds', 'output', 'stopReason', 'decodeSteps',
  'minMarginTop1Top2', 'minMarginStep', 'reusedFrom'];

const frozen = name => frozenFile(path.join(USEFUL_ANSWER_DIR, name), PINS[name], `useful-answer ${name}`);

function mechanicalView(result) {
  return { pass: result.pass, checksPass: result.checksPass ?? null, overPromptLimit: result.overPromptLimit,
    turns: result.turns.map(turn => ({ turn: turn.turn, pass: turn.pass, empty: turn.empty ?? null,
      checks: (turn.checks || []).map(check => [check.type, check.pass, check.detail]) })) };
}

function compareMechanical(answerSet, runItems, frozenItems, arm, label) {
  const byRun = new Map(runItems.map(item => [item.id, item]));
  const byFrozen = new Map(frozenItems.map(item => [item.id, item]));
  const mismatches = [];
  let checks = 0;
  let compared = 0;
  for (const item of answerSet.items) {
    if (item.judgment !== 'mechanical') continue;
    compared += 1;
    const harness = mechanicalView(mechanicalItem(item, byRun.get(item.id)));
    const expected = mechanicalView(byFrozen.get(item.id).arms[arm]);
    checks += expected.turns.reduce((sum, turn) => sum + turn.checks.length, 0);
    if (!pyEqual(harness, expected)) mismatches.push({ comparison: label, item: item.id, harness, frozen: expected });
  }
  return [{ comparison: label, items: compared, checks, mismatches: mismatches.length }, mismatches];
}

function mechanicalRates(answerSet, runItems) {
  const byRun = new Map(runItems.map(item => [item.id, item]));
  const rows = answerSet.items.filter(item => item.judgment === 'mechanical')
    .map(item => [item.category, mechanicalItem(item, byRun.get(item.id)).pass]);
  const categories = [...new Set(answerSet.items.map(item => item.category))];
  const block = subset => rateBlock(subset.filter(([, ok]) => ok).length, subset.length);
  return { overall: block(rows), byCategory: Object.fromEntries(categories.map(c => [c, block(rows.filter(row => row[0] === c))])) };
}

/** Did this row leave a case or check ungraded because grading it needed Python? */
function pythonRemoved(row, family) {
  if (family === 'code') return row.code.cases.some(c => c.executed === false);
  if (family === 'instruction') return row.turns.some(turn => (turn.instruction || []).some(check => check.checked === false));
  return false;
}

export async function reproduce(runDir, { scratch = null, log = console.error } = {}) {
  const runPath = path.join(runDir, 'run.json');
  const run = loadJson(runPath);
  if (run.target.kind !== 'cpu-q4k-control' || run.itemSet.kind !== 'useful-answer') {
    fail('Reproduction needs a cpu-q4k-control run of the useful-answer set');
  }
  const answerSet = frozenFile(USEFUL_ANSWER_SET, USEFUL_ANSWER_SET_SHA256, 'useful-answer set');
  const results = frozen('results.json');
  const q4kRaw = frozen('q4k-run.json');
  const bf16Raw = frozen('bf16-run.json');
  const limit = run.target.routePromptTokenLimit;
  const stored = { q4k: armRunItems(q4kRaw, 'useful-answer-set-20261014-q4k', limit),
    bf16: armRunItems(bf16Raw, 'useful-answer-set-20261014-bf16', limit) };
  const sections = {};
  const mismatches = [];

  // 1. Check equivalence on the stored arm runs.
  for (const arm of ['q4k', 'bf16']) {
    const [summary, rows] = compareMechanical(answerSet, stored[arm], results.items, arm, `stored ${arm} arm run vs results.json`);
    sections[`checkEquivalence${arm.toUpperCase()}`] = summary;
    mismatches.push(...rows);
  }

  // 2. Generation reproduction against the stored Q4_K arm run.
  const byStored = new Map(stored.q4k.map(item => [item.id, item]));
  let turnsCompared = 0;
  const differing = [];
  for (const item of run.items) {
    const old = byStored.get(item.id);
    if (old.turns.length !== item.turns.length) {
      differing.push({ item: item.id, detail: 'different number of turns' });
      continue;
    }
    item.turns.forEach((newTurn, index) => {
      turnsCompared += 1;
      const keys = TURN_KEYS.filter(key => !pyEqual(newTurn[key] ?? null, old.turns[index][key] ?? null));
      if (keys.length) differing.push({ item: item.id, turn: newTurn.turn, fields: keys });
    });
  }
  sections.generationReproduction = { comparison: 'run vs stored Q4_K arm run (2026-10-14)', turns: turnsCompared,
    fieldsCompared: TURN_KEYS, differingTurns: differing.length };
  mismatches.push(...differing.map(row => ({ comparison: 'generation', ...row })));

  // 3. The run's mechanical verdicts against results.json.
  const [baselineSummary, baselineRows] = compareMechanical(answerSet, run.items, results.items, 'q4k', 'run vs results.json q4k');
  sections.baselineVerdicts = baselineSummary;
  mismatches.push(...baselineRows);

  // 4. Mechanical rates.
  const rates = { fresh: mechanicalRates(answerSet, run.items), storedQ4K: mechanicalRates(answerSet, stored.q4k),
    storedBF16: mechanicalRates(answerSet, stored.bf16) };
  const frozenRates = results.rates.mechanicalItems;
  const rateRows = [];
  for (const [name, arm] of [['fresh', 'q4k'], ['storedQ4K', 'q4k'], ['storedBF16', 'bf16']]) {
    const expected = { overall: frozenRates.overall[arm],
      byCategory: Object.fromEntries(Object.entries(frozenRates.byCategory).map(([c, v]) => [c, v[arm]])) };
    const equal = pyEqual(rates[name], expected);
    rateRows.push({ harness: name, frozenArm: arm, equal });
    if (!equal) mismatches.push({ comparison: `rates ${name} vs results.json ${arm}`, harness: rates[name], frozen: expected });
  }
  sections.mechanicalRates = { rows: rateRows, harness: rates };

  // 5. Whole evaluation of the stored Q4_K run against the run directory's evaluation.
  const ungraded = [];
  const evaluationPath = path.join(runDir, 'evaluation.json');
  if (fs.existsSync(evaluationPath)) {
    const baselineEval = loadJson(evaluationPath);
    const storedEval = await evaluateRun(null, { scratch, log, run: { ...run, items: stored.q4k } });
    const baselineRows = new Map(baselineEval.items.map(row => [row.id, row]));
    const familyMismatch = [];
    for (const row of storedEval.items) {
      for (const family of USEFUL_FAMILIES) {
        const now = verdict(row, family);
        const before = verdict(baselineRows.get(row.id), family);
        if (now === before) continue;
        const entry = { item: row.id, family, stored: now, fresh: before };
        if (pythonRemoved(row, family)) {
          ungraded.push({ ...entry, cause: family === 'instruction' ? 'python parsing removed (JavaScript-only)' : PYTHON_REMOVED });
        }
        else familyMismatch.push(entry);
      }
    }
    sections.wholeEvaluation = { comparison: 'stored Q4_K arm run evaluated now vs the run directory evaluation',
      families: USEFUL_FAMILIES.filter(family => family !== 'judge'), items: storedEval.items.length,
      differences: familyMismatch.length, ungradedWithoutPython: ungraded.length };
    mismatches.push(...familyMismatch.map(row => ({ comparison: 'whole evaluation', ...row })));
  }

  let verdictText = mismatches.length ? `${mismatches.length} differences` : 'reproduced exactly';
  if (!mismatches.length && ungraded.length) {
    verdictText = `reproduced exactly, except ${ungraded.length} verdicts that need Python and are now ungraded (JavaScript-only)`;
  }
  return { schema: 'reploid.answer-regression.reproduction/v1', ...labelBlock(), checkedAt: nowIso(),
    run: { runId: run.runId, file: repoRelative(runPath), sha256: sha256File(runPath) },
    frozen: Object.fromEntries(Object.entries(PINS).map(([name, sha]) => [name, { file: `${USEFUL_ANSWER_REL}/${name}`, sha256: sha }])),
    notUsed: 'results.json review, provisional rubric grades and reviewer-adjusted view (earlier grades)',
    sections, mismatches, ungradedWithoutPython: ungraded, verdict: verdictText };
}
