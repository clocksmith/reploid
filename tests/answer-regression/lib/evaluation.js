// Applies every configured check to one run and writes an evaluation record.
//
// Verdict families per item: mechanical, format, instruction, code (useful-answer set); retrievalOutcome, answer,
// citations, claimCoverage (search set); judge (only when a judge is configured). A family whose rows are all
// ungraded (pass null, such as Python-language code that is no longer executed) has pass null.
import { JUDGE_LABEL, OVERLAY, SEARCH_SET, USEFUL_ANSWER_SET, USEFUL_ANSWER_SET_FILE, environmentVersions, fail,
  harnessIdentity, labelBlock, loadJson, nowIso, rateBlock as rate, repoRelative, retrievalComponentIdentity, sha256File, sha256Text }
  from './common.js';
import fs from 'node:fs';
import * as checks from './checks.js';
import { runCase, runReference } from './code-exec.js';
import { candidateForRun } from './context-candidate.js';
import { loadJudge } from './judge.js';
import { validateSearchInputs } from './report.js';

export const FORMAT_DEFINITION = {
  nonEmpty: 'The delivered answer is not empty after trimming.',
  stoppedOnEndOfTurn: "Generation stopped on the model's end-of-turn or stop token, not a length limit.",
  noTemplateTokens: 'No chat-template control token (<|...|>, <think>) appears in the delivered text.',
  noReplacementCharacters: 'No U+FFFD replacement character (broken decoding) appears.',
  noDegenerateRepetition: 'No 12-word sequence occurs three times, and no line of 8+ characters repeats three times in a row.',
  promptWithinRouteLimit: "The prompt fits the target's declared route prompt limit.",
};

export function policyLetter(item, kind) {
  if (kind === 'search') return 'R';
  return item.category === 'rewrite' ? 'S' : 'Q';
}

const allPass = rows => rows.every(row => row.pass);

/** All graded rows pass; null when no row is graded. */
function gradedPass(rows) {
  const graded = rows.filter(row => row.pass !== null && row.pass !== undefined);
  return graded.length ? allPass(graded) : null;
}

async function evaluateUseful(data, run, sandbox, judge, log) {
  const [overlay, overlaySha] = checks.loadOverlay();
  if (overlay.appliesTo.sha256 !== run.itemSet.sha256) fail('The overlay applies to a different item set');
  const key = (item, turn) => `${item}\0${turn}`;
  const instructions = new Map(overlay.instructionChecks.items.map(entry => [key(entry.item, entry.turn), entry]));
  const cases = new Map(overlay.codeExecution.cases.map(row => [key(row.item, row.turn), row]));
  const references = [];
  for (const reference of overlay.codeExecution.referencePrograms) references.push(await runReference(sandbox, reference));
  const runItems = new Map(run.items.map(item => [item.id, item]));
  const rows = [];
  for (const item of data.items) {
    const runItem = runItems.get(item.id);
    if (!runItem) {
      rows.push({ id: item.id, category: item.category, notRun: true });
      continue;
    }
    const mechanical = checks.mechanicalItem(item, runItem);
    const turns = [];
    const instructionRows = [];
    const codeRows = [];
    for (let index = 0; index < item.turns.length; index += 1) {
      const number = index + 1;
      const turn = index < runItem.turns.length ? runItem.turns[index] : null;
      const entry = instructions.get(key(item.id, number));
      const case_ = cases.get(key(item.id, number));
      if (turn === null) {
        turns.push({ turn: number, notRun: true });
        if (entry) instructionRows.push({ type: 'turnNotRun', turn: number, pass: false, detail: 'turn not run' });
        if (case_) codeRows.push({ item: item.id, turn: number, pass: false, reason: 'turn not run' });
        continue;
      }
      const output = turn.output || '';
      const format = checks.formatChecks(turn);
      const instruction = entry ? entry.checks.map(check => ({ ...checks.instructionCheck(check, output, sandbox), turn: number })) : [];
      instructionRows.push(...instruction);
      if (case_) codeRows.push(await runCase(sandbox, case_, output));
      turns.push({ turn: number, outputSha256: sha256Text(output), stopReason: turn.stopReason ?? null, format,
        formatPass: allPass(format), instruction });
    }
    const ran = turns.filter(turn => !turn.notRun);
    const row = { id: item.id, category: item.category, judgment: item.judgment, policy: policyLetter(item, 'useful'),
      turns, mechanical,
      format: { pass: ran.length > 0 && ran.length === item.turns.length && ran.every(turn => turn.formatPass) },
      instruction: { pass: instructionRows.length ? gradedPass(instructionRows) : null },
      code: { pass: codeRows.length ? gradedPass(codeRows) : null, cases: codeRows } };
    if (judge) row.judge = await judgeItem(judge, item, runItem, 'useful', codeRows, log);
    rows.push(row);
  }
  return [rows, { overlay: { file: repoRelative(OVERLAY), sha256: overlaySha }, formatDefinition: FORMAT_DEFINITION,
    referencePrograms: references }];
}

async function evaluateSearch(data, run, judge, log) {
  const candidate = candidateForRun(run);
  if (candidate) validateSearchInputs(run);
  const policy = candidate ? candidate[1] : null;
  const runItems = new Map(run.items.map(item => [item.id, item]));
  const rows = [];
  for (const item of data.items) {
    const runItem = runItems.get(item.id);
    if (!runItem || !runItem.turns.length) {
      rows.push({ id: item.id, category: 'search', kind: item.kind, notRun: true });
      continue;
    }
    const result = checks.searchItem(item, runItem, data, policy);
    const turn = runItem.turns[0];
    const format = turn.dispatched ? checks.formatChecks(turn) : [];
    const row = { id: item.id, category: 'search', kind: item.kind, policy: 'R', search: result,
      turns: [{ turn: 1, outputSha256: sha256Text(turn.output || ''), stopReason: turn.stopReason ?? null, format,
        formatPass: format.length ? allPass(format) : null }],
      format: { pass: format.length ? allPass(format) : null } };
    if (judge && turn.dispatched && result.exercised) row.judge = await judgeItem(judge, item, runItem, 'search', [], log);
    rows.push(row);
  }
  return [rows, { searchSet: { file: repoRelative(SEARCH_SET), sha256: sha256File(SEARCH_SET) },
    retrievalComponent: retrievalComponentIdentity(), formatDefinition: FORMAT_DEFINITION }];
}

/** Judges each turn; the item passes only when every turn is whole-answer correct. */
async function judgeItem(judge, item, runItem, kind, codeRows, log) {
  const records = [];
  const context = [];
  for (const [index, turn] of runItem.turns.entries()) {
    if (!turn.dispatched) continue;
    const prompt = turn.userTyped || (kind === 'search' ? item.prompt : item.turns[index].user);
    const executions = codeRows.filter(row => row.turn === index + 1).map(row => ({ probes: row.probes ?? null, reason: row.reason ?? null }));
    const record = await judge.judge({ itemId: item.id, policy: policyLetter(item, kind), context: [...context], prompt,
      answer: turn.output || '', retrieval: turn.retrieval ?? null, executions });
    records.push({ turn: index + 1, ...record });
    context.push({ prompt, answer: turn.output || '' });
    log(`judge ${item.id} turn ${index + 1}: ${record.status || record.error}`);
  }
  const usable = records.filter(record => record.status);
  const complete = usable.length === records.length && records.length === (item.turns ? item.turns.length : 1);
  let verdict;
  if (usable.some(record => record.status !== 'whole-answer-correct')) verdict = false;
  else verdict = complete ? true : null;
  return { label: JUDGE_LABEL, turns: records, pass: verdict };
}

function count(rows, family, key = null) {
  const values = rows.filter(row => !row.notRun).map(row => (key === null ? row[family]?.pass : row[family]?.[key]?.pass));
  const graded = values.filter(value => value !== null && value !== undefined);
  return rate(graded.filter(Boolean).length, graded.length);
}

function summarize(kind, rows) {
  const categories = [...new Set(rows.map(row => row.category))];
  const summary = { items: rows.length, notRun: rows.filter(row => row.notRun).map(row => row.id) };
  const judged = rows.some(row => 'judge' in row);
  if (kind === 'useful-answer') {
    const mechanical = rows.filter(row => row.judgment === 'mechanical' && !row.notRun);
    summary.mechanical = { ...rate(mechanical.filter(row => row.mechanical.pass).length, mechanical.length),
      note: 'Mechanical items only; the two rubric items are not graded by the harness.' };
    summary.rubricItemsNotGraded = rows.filter(row => row.judgment === 'human').map(row => row.id);
    summary.format = count(rows, 'format');
    summary.instruction = count(rows, 'instruction');
    summary.code = count(rows, 'code');
    summary.byCategory = Object.fromEntries(categories.map(category => {
      const inCategory = rows.filter(row => row.category === category);
      const mechanicalInCategory = mechanical.filter(row => row.category === category);
      return [category, { items: inCategory.length,
        mechanical: rate(mechanicalInCategory.filter(row => row.mechanical.pass).length, mechanicalInCategory.length),
        format: count(inCategory, 'format'), instruction: count(inCategory, 'instruction'), code: count(inCategory, 'code'),
        ...(judged ? { judge: count(inCategory, 'judge') } : {}) }];
    }));
  } else {
    const exercised = rows.filter(row => !row.notRun && row.search.exercised);
    summary.exercised = exercised.length;
    summary.unexercised = rows.filter(row => row.notRun || !row.search.exercised).map(row => row.id);
    for (const family of ['retrievalOutcome', 'answer', 'citations', 'claimCoverage']) summary[family] = count(exercised, 'search', family);
    summary.item = count(exercised, 'search');
    summary.format = count(exercised, 'format');
  }
  if (judged) {
    summary.judge = { ...count(rows, 'judge'), label: JUDGE_LABEL,
      errors: rows.flatMap(row => row.judge?.turns ?? []).filter(turn => turn.error).length };
  }
  return summary;
}

/** The evaluation record for one run (file path, or an in-memory run with runPath null). */
export async function evaluateRun(runPath, { judgePath = null, scratch = null, log = console.error, run = null } = {}) {
  run = run ?? loadJson(runPath);
  const runSha = runPath ? sha256File(runPath) : null;
  const kind = run.itemSet.kind;
  const setPath = kind === 'useful-answer' ? USEFUL_ANSWER_SET : SEARCH_SET;
  if (kind === 'useful-answer' && !fs.existsSync(setPath)) {
    fail(`The frozen useful-answer set is missing at ${setPath}; restore it with `
      + `node scripts/restore-evidence.js artifacts/useful-answer-set-20261014 (or set REPLOID_ARX_EVIDENCE_ROOT)`);
  }
  if (sha256File(setPath) !== run.itemSet.sha256) fail(`The run used a different ${kind} set than the one in this checkout`);
  const data = loadJson(setPath);
  const judge = judgePath ? loadJudge(judgePath, run) : null;
  const sandbox = checks.newSandbox(scratch, 10);
  let rows;
  let sources;
  let environment;
  try {
    [rows, sources] = kind === 'useful-answer'
      ? await evaluateUseful(data, run, sandbox, judge, log)
      : await evaluateSearch(data, run, judge, log);
    environment = sandbox.environment();
  } finally {
    sandbox.close();
  }
  return {
    schema: 'reploid.answer-regression.evaluation/v1', ...labelBlock(), evaluatedAt: nowIso(),
    harness: harnessIdentity(),
    run: { runId: run.runId ?? null, file: runPath ? repoRelative(runPath) : null, sha256: runSha, target: run.target },
    itemSet: run.itemSet,
    checkSources: { mechanical: checks.mechanicalIdentity(), ...sources, codeExecution: environment,
      harnessEnvironment: environmentVersions(),
      ...(kind === 'useful-answer' ? { usefulAnswerSet: USEFUL_ANSWER_SET_FILE } : {}) },
    judge: judge ? judge.describe() : null,
    summary: summarize(kind, rows),
    items: rows,
  };
}
