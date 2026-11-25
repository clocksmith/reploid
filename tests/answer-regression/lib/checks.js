// Checks applied to a run. Every verdict is an automated regression signal, never an acceptance grade.
//
// - mechanical: the useful-answer set's check types (mechanical.js, a JavaScript port of its frozen
//   scripts/check.py with the same verdicts and detail text);
// - format: generic delivery checks on every generated turn;
// - instruction: the overlay's explicit-requirement checks;
// - code: answer code executed in a sandboxed scratch directory (code-exec.js), JavaScript only;
// - search: retrieval outcome, asked point and deterministic citation validity from the retrieval component.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { HARNESS, OVERLAY, OVERLAY_SHA256, RETRIEVAL_HELPER, fail, frozenFile, requireOutsideRepo,
  sha256File } from './common.js';
import { Sandbox } from './code-exec.js';
import { PORTED_FROM, gradeArm, normalize, runCheck as runFrozenCheck } from './mechanical.js';
import { cpLength, cpSlice, pyRepr, pySplit, pyStrip, reSearch } from './python-compat.js';

const MECHANICAL_MODULE = path.join(HARNESS, 'lib', 'mechanical.js');

export function mechanicalIdentity() {
  return { file: 'tests/answer-regression/lib/mechanical.js', sha256: sha256File(MECHANICAL_MODULE),
    use: 'run_check and grade_arm, ported to JavaScript with the same verdicts and detail text; no review file, '
      + 'so rubric items stay ungraded',
    portedFrom: PORTED_FROM };
}

export function runCheck(check, output) {
  const [ok, detail] = runFrozenCheck(check, output);
  return { type: check.type, pass: Boolean(ok), detail };
}

// ---- mechanical ---------------------------------------------------------------------------------

const FROZEN_ROW_KEYS = ['promptTokenCount', 'overPromptLimit', 'output', 'stopReason', 'decodeSteps', 'seconds', 'reusedFrom',
  'minMarginTop1Top2'];

export function frozenRow(turn) {
  const row = Object.fromEntries(FROZEN_ROW_KEYS.map(key => [key, turn[key] ?? null]));
  row.overPromptLimit = Boolean(turn.overPromptLimit);
  return row;
}

/** grade_arm, as the frozen script defines it. Rubric ('human') items return pass null. */
export function mechanicalItem(item, runItem) {
  const shaped = { arm: runItem.arm ?? 'target', turns: runItem.turns.map(frozenRow) };
  const graded = gradeArm(item, shaped, {});
  const turns = graded.turns.map(turn => ({ turn: turn.turn, notRun: turn.notRun ?? false, empty: turn.empty ?? null,
    pass: turn.pass, checks: turn.checks ?? [] }));
  return { grading: graded.grading, pass: graded.pass, checksPass: graded.checksPass ?? null,
    overPromptLimit: graded.overPromptLimit, status: graded.status ?? null, turns };
}

// ---- format -------------------------------------------------------------------------------------

const TEMPLATE_TOKEN = /<\|[A-Za-z0-9_]+\|>|<\/?think>/;
const REPLACEMENT = String.fromCodePoint(0xfffd);

function repeatedWindow(text, size = 12, times = 3) {
  const words = pySplit(text);
  const counts = new Map();
  for (let index = 0; index < words.length - size + 1; index += 1) {
    const key = words.slice(index, index + size).join('\0');
    counts.set(key, (counts.get(key) || 0) + 1);
    if (counts.get(key) >= times) return words.slice(index, index + size).join(' ');
  }
  return null;
}

function repeatedLines(text, times = 3) {
  let run = 1;
  let previous = null;
  for (const line of text.split('\n').map(value => pyStrip(value))) {
    if (!line) continue;
    run = line === previous && cpLength(line) >= 8 ? run + 1 : 1;
    previous = line;
    if (run >= times) return line;
  }
  return null;
}

export function formatChecks(turn) {
  const output = turn.output || '';
  const stop = turn.stopReason ?? null;
  const loop = repeatedWindow(output) ?? repeatedLines(output);
  const template = TEMPLATE_TOKEN.exec(output);
  return [
    { type: 'nonEmpty', pass: Boolean(pyStrip(output)), detail: `${cpLength(output)} characters` },
    { type: 'stoppedOnEndOfTurn', pass: ['eos-token', 'stop-token', 'stop'].includes(stop), detail: `stop reason ${pyRepr(stop)}` },
    { type: 'noTemplateTokens', pass: template === null, detail: template ? `found ${pyRepr(template[0])}` : 'none' },
    { type: 'noReplacementCharacters', pass: !output.includes(REPLACEMENT),
      detail: `${output.split(REPLACEMENT).length - 1} U+FFFD` },
    { type: 'noDegenerateRepetition', pass: loop === null, detail: loop !== null ? `repeats ${pyRepr(cpSlice(loop, 0, 80))}` : 'none' },
    { type: 'promptWithinRouteLimit', pass: !turn.overPromptLimit,
      detail: turn.promptTokenCount !== null && turn.promptTokenCount !== undefined ? `${turn.promptTokenCount} prompt tokens` : 'not reported' },
  ];
}

// ---- instruction --------------------------------------------------------------------------------

const FENCED = /```[^\n]*\n[\s\S]*?```/g;

/** [pass, detail]; pass is null when the answer would need Python to parse. */
function codeOnly(output, language, sandbox) {
  const blocks = output.match(FENCED) || [];
  if (blocks.length) {
    const outside = output.replace(FENCED, '');
    return [!pyStrip(outside), `${blocks.length} fenced block(s); outside text ${pyRepr(cpSlice(pyStrip(outside), 0, 60))}`];
  }
  if (language !== 'javascript') return [null, `unfenced; not checked: ${language} parsing removed (JavaScript-only)`];
  const caseDir = sandbox.syntaxDirectory();
  fs.writeFileSync(path.join(caseDir, 'main.js'), output, 'utf8');
  const done = spawnSync(process.execPath, ['--check', 'main.js'], { cwd: caseDir, encoding: 'utf8', timeout: 20000 });
  return [done.status === 0, `unfenced; ${done.status === 0 ? 'parses as JavaScript' : 'not JavaScript'}`];
}

export function instructionCheck(check, output, sandbox) {
  if (check.type === 'codeOnly') {
    const [ok, detail] = codeOnly(output, check.language, sandbox);
    return { type: 'codeOnly', pass: ok, detail, ...(ok === null ? { checked: false } : {}) };
  }
  return runCheck(check, output);
}

export const loadOverlay = () => [frozenFile(OVERLAY, OVERLAY_SHA256, 'useful-answer overlay'), OVERLAY_SHA256];

// ---- search -------------------------------------------------------------------------------------

export function nodeHelper(requests) {
  const done = spawnSync(process.execPath, [RETRIEVAL_HELPER], { input: JSON.stringify(requests), encoding: 'utf8',
    timeout: 120000, maxBuffer: 256 * 1024 * 1024 });
  if (done.status !== 0) fail(`retrieval helper failed: ${(done.stderr || String(done.error || '')).trim().slice(-400)}`);
  return JSON.parse(done.stdout);
}

export function prepareRetrieval(item, searchSet, messages) {
  const reply = nodeHelper({ op: 'prepare', documents: item.documents, query: item.query ?? item.prompt,
    limits: searchSet.retrieval.limits, now: searchSet.retrieval.fixedNow, messages });
  if (!reply.ok) fail(`retrieval for ${item.id} failed in the harness: ${reply.error}`);
  return reply;
}

export function verifyCitations(answer, record, policy = null) {
  const reply = nodeHelper({ op: 'verify', answer, record, policy });
  if (!reply.ok) fail(`citation verification failed in the harness: ${reply.error}`);
  return reply.verification;
}

/** Verdict families for one search item: answer, citation validity, claim coverage. */
export function searchItem(item, runItem, searchSet, policy = null) {
  const turn = runItem.turns[0];
  const record = turn.retrieval;
  const outcome = record ? record.outcome : null;
  const outcomeOk = outcome === item.expectedOutcome;
  const result = { retrievalOutcome: { expected: item.expectedOutcome, observed: outcome, pass: outcomeOk } };
  if (turn.unsupported) return { ...result, exercised: false, reason: turn.unsupported, pass: null };
  if (item.expectedOutcome !== 'retrieved' || outcome !== 'retrieved') {
    const nothingSent = !turn.dispatched;
    return { ...result, exercised: true, answer: null, citations: null, claimCoverage: null, nothingDispatched: nothingSent,
      pass: outcomeOk && nothingSent };
  }
  const output = turn.output || '';
  const answer = item.answerChecks.map(check => runCheck(check, output));
  if (item.abstain) {
    const match = reSearch(searchSet.abstentionPattern, normalize(output), true);
    answer.push({ type: 'abstains', pass: match !== null, detail: match !== null ? `match ${pyRepr(match)}` : 'no match' });
  }
  const verification = verifyCitations(output, record, policy);
  const numbers = Object.fromEntries(record.sources.map(source => [source.sourceId, source.number]));
  const cited = new Set(verification.claims.flatMap(claim => claim.citations.filter(c => c.resolved).map(c => c.marker)));
  const flags = verification.flags.map(flag => flag.kind);
  const spans = verification.claimSupport ?? null;
  const badReferences = flags.filter(kind => kind === 'unresolved-reference' || kind === 'mismatched-reference').length;
  const validity = [
    { type: 'citationsResolve', pass: verification.summary.unresolvedCitations === 0,
      detail: `${verification.summary.unresolvedCitations} unresolved of ${verification.summary.citations}` },
    { type: 'referencesResolve', pass: badReferences === 0, detail: `${badReferences} bad reference entries` },
    { type: 'noUnrecordedUrls', pass: !verification.unrecordedUrls.length, detail: pyRepr(verification.unrecordedUrls.slice(0, 5)) },
  ];
  if (spans !== null) {
    const problems = [...new Set(spans.claims.flatMap(claim => claim.citations.flatMap(c => c.problems)))].sort();
    validity.push(
      { type: 'contextDigestHolds', pass: Boolean(spans.contextValid), detail: `contextValid ${pyRepr(spans.contextValid)}` },
      { type: 'citationSpansValid', pass: spans.summary.invalidCitations === 0,
        detail: `${spans.summary.validCitations} valid, ${spans.summary.invalidCitations} invalid; problems ${pyRepr(problems)}` });
  }
  for (const source of item.citedSources) {
    const marker = numbers[source] ?? null;
    validity.push({ type: 'citesExpectedSource', source, marker, pass: cited.has(marker),
      detail: `marker ${pyRepr(marker)} cited: ${pyRepr(cited.has(marker))}` });
  }
  const coverage = item.abstain ? null : { pass: verification.summary.uncitedClaims === 0,
    detail: `${verification.summary.uncitedClaims} uncited of ${verification.summary.claims} claims` };
  const over = Boolean(turn.overPromptLimit);
  const answerPass = Boolean(pyStrip(output)) && answer.every(check => check.pass) && !over;
  const validityPass = validity.every(check => check.pass);
  return { ...result, exercised: true, answer: { checks: answer, pass: answerPass, overPromptLimit: over },
    citations: { checks: validity, pass: validityPass, summary: verification.summary, flags: verification.flags.slice(0, 40),
      claimSupportSummary: spans ? spans.summary : null, supportJudged: false },
    claimCoverage: coverage, pass: outcomeOk && answerPass && validityPass };
}

export function newSandbox(root, timeout) {
  if (root !== null && root !== undefined) requireOutsideRepo(path.resolve(root), 'The code-execution scratch directory');
  return new Sandbox(root ?? null, timeout);
}
