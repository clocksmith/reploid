#!/usr/bin/env node
// Reploid answer regression harness — automated regression evaluation, not independent acceptance.
//
// Commands (run with node from the repository root; see README.md):
//   run               Generate answers on one target and write its run record.
//   evaluate          Apply the checks (and an optional automated judge) to a run.
//   compare           Compare a run's evaluation with a stored baseline run of the same target.
//   reproduce         Confirm the harness reproduces the useful-answer set's frozen mechanical results.
//   search-preflight  Retrieval and prompt sizes for the frozen search set; no model is run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { HarnessError, LABEL, SCOPE_NOTE, SEARCH_SET, SEARCH_SET_SHA256, USEFUL_ANSWER_SET, USEFUL_ANSWER_SET_FILE,
  USEFUL_ANSWER_SET_SHA256, fail, frozenFile, harnessIdentity, labelBlock, nowIso, repoRelative, requireOutsideRepo,
  retrievalComponentIdentity, writeJson, writeText } from './lib/common.js';
import { prepareRetrieval } from './lib/checks.js';
import { loadCandidate } from './lib/context-candidate.js';
import { evaluateRun } from './lib/evaluation.js';
import { compareRuns, renderMarkdown } from './lib/report.js';
import { reproduce } from './lib/reproduce.js';
import { preflight } from './lib/search-preflight.js';
import { loadTarget } from './lib/targets.js';

export const log = message => process.stderr.write(`[answer-regression] ${message}\n`);

export function loadItemSet(kind) {
  if (kind === 'useful-answer') {
    const data = frozenFile(USEFUL_ANSWER_SET, USEFUL_ANSWER_SET_SHA256, 'frozen useful-answer set');
    return [data, { kind, name: data.name, file: USEFUL_ANSWER_SET_FILE, sha256: USEFUL_ANSWER_SET_SHA256 }];
  }
  const data = frozenFile(SEARCH_SET, SEARCH_SET_SHA256, 'search-task set');
  return [data, { kind, name: data.name, file: repoRelative(SEARCH_SET), sha256: SEARCH_SET_SHA256 }];
}

/** The exact content to send per turn. Search turns carry the retrieval record and dispatched content. */
export function buildPlan(kind, data, only, target, contextCandidate = null) {
  if (contextCandidate && kind !== 'search') fail('Context candidates apply only to search runs');
  const items = data.items.filter(item => !only.length || only.includes(item.id));
  if (only.length && items.length !== only.length) {
    const known = new Set(items.map(item => item.id));
    fail(`unknown item ids: ${JSON.stringify(only.filter(id => !known.has(id)).sort())}`);
  }
  const plan = { setKind: kind, setPath: kind === 'useful-answer' ? USEFUL_ANSWER_SET : SEARCH_SET, maxTokens: 1024, items: [] };
  const [supported, reason] = kind === 'search' ? target.supportsSearch() : [true, null];
  for (const item of items) {
    if (kind === 'useful-answer') {
      plan.items.push({ id: item.id, category: item.category,
        turns: item.turns.map(turn => ({ user: turn.user, send: turn.user, dispatch: true, retrieval: null })) });
      continue;
    }
    let prepared;
    if (contextCandidate) {
      const retained = contextCandidate[item.id];
      prepared = { record: retained.retrieval, dispatchedMessages: retained.dispatchedMessages, failureMessage: null };
    } else {
      prepared = prepareRetrieval(item, data, [{ role: 'user', content: item.prompt }]);
    }
    const dispatched = prepared.dispatchedMessages;
    plan.items.push({ id: item.id, category: item.kind ?? 'search', turns: [{ user: item.prompt,
      send: dispatched ? dispatched.at(-1).content : null, dispatch: Boolean(dispatched) && supported,
      retrieval: prepared.record, failureMessage: prepared.failureMessage ?? null, unsupported: supported ? null : reason }] });
  }
  if (only.length && kind === 'useful-answer') {
    log('a partial useful-answer run cannot use the frozen file directly; only full runs are supported for this target');
  }
  return plan;
}

const compact = value => value.replaceAll(':', '').replaceAll('-', '');

export async function commandRun(args, { loadTarget: load = loadTarget } = {}) {
  const target = load(args.target);
  const [data, itemSet] = loadItemSet(args.set);
  let contextCandidate = null;
  if (args.contextCandidate) {
    if (args.set !== 'search') fail('Context candidates apply only to search runs');
    const [identity, rows] = loadCandidate(args.contextCandidate);
    contextCandidate = rows;
    itemSet.contextCandidate = identity;
  }
  const work = path.resolve(args.work);
  requireOutsideRepo(work, 'The work directory');
  if (fs.existsSync(work) && fs.readdirSync(work).length) fail(`The work directory must be empty: ${work}`);
  fs.mkdirSync(work, { recursive: true });
  const out = path.resolve(args.out);
  if (fs.existsSync(path.join(out, 'run.json'))) fail(`${path.join(out, 'run.json')} exists; runs are never overwritten`);
  const only = (args.items || '').split(',').filter(Boolean);
  if (only.length && args.set === 'useful-answer' && target.kind === 'cpu-q4k-control') {
    fail('The CPU control runs the frozen useful-answer file as a whole; --items is not supported there.');
  }
  const started = nowIso();
  const plan = buildPlan(args.set, data, only, target, contextCandidate);
  if (args.preflight) {
    if (target.kind !== 'doppler-single-machine') fail('--preflight applies to the doppler-single-machine target');
    const [, identities, details] = await target.generate(plan, work, log, { preflight: true });
    const report = { schema: 'reploid.answer-regression.preflight/v1', ...labelBlock(), target: target.describe(),
      identities, details, itemSet, checkedAt: nowIso() };
    writeJson(path.join(out, 'preflight.json'), report);
    log(`preflight written to ${path.join(out, 'preflight.json')}`);
    return;
  }
  const [items, identities, details] = await target.generate(plan, work, log);
  const record = {
    schema: 'reploid.answer-regression.run/v1', ...labelBlock(),
    runId: `${target.id}-${compact(started)}`,
    startedAt: started, finishedAt: nowIso(),
    harness: harnessIdentity(),
    target: target.describe(), identities, details, itemSet,
    retrieval: args.set === 'search' ? { component: retrievalComponentIdentity(), provider: data.retrieval.provider,
      fixedNow: data.retrieval.fixedNow, limits: contextCandidate ? null : data.retrieval.limits,
      perItemLimits: contextCandidate ? Object.fromEntries(Object.entries(contextCandidate).map(([key, row]) => [key, row.limits])) : null }
      : null,
    items,
  };
  writeJson(path.join(out, 'run.json'), record);
  log(`run written to ${path.join(out, 'run.json')}`);
}

export async function commandEvaluate(args) {
  const runDir = path.resolve(args.run);
  const out = args.out ? path.resolve(args.out) : path.join(runDir, 'evaluation.json');
  if (fs.existsSync(out)) fail(`${out} exists; evaluations are never overwritten`);
  if (args.scratch) requireOutsideRepo(path.resolve(args.scratch), 'The code-execution scratch directory');
  const evaluation = await evaluateRun(path.join(runDir, 'run.json'), { judgePath: args.judge ?? null, scratch: args.scratch ?? null, log });
  writeJson(out, evaluation);
  log(`evaluation written to ${out}`);
}

export function commandCompare(args) {
  const report = compareRuns(path.resolve(args.baseline), path.resolve(args.candidate),
    { baselineEvaluation: args.baselineEvaluation ?? null, candidateEvaluation: args.candidateEvaluation ?? null });
  const out = path.resolve(args.out);
  const prefix = path.extname(out) ? out.slice(0, -path.extname(out).length) : out;
  writeJson(`${prefix}.json`, report);
  writeText(`${prefix}.md`, renderMarkdown(report));
  log(`report written to ${prefix}.json and ${prefix}.md`);
  const regressions = report.summary.newlyFailingTotal;
  console.log(`${LABEL}: ${regressions} newly failing verdicts, ${report.summary.newlyPassingTotal} newly passing, `
    + `${report.summary.answersChanged} changed answers`);
  return args.failOnRegression && regressions ? 1 : 0;
}

export async function commandReproduce(args) {
  const out = path.resolve(args.out);
  if (fs.existsSync(out)) fail(`${out} exists`);
  const report = await reproduce(path.resolve(args.run), { scratch: args.scratch ?? null, log });
  writeJson(out, report);
  log(`reproduction written to ${out}: ${report.verdict}`);
}

export async function commandSearchPreflight(args) {
  const out = path.resolve(args.out);
  if (fs.existsSync(out)) fail(`${out} exists`);
  writeJson(out, await preflight(args.packageArchive ?? null, args.capsule ?? null, log));
  log(`search preflight written to ${out}`);
}

const COMMANDS = {
  run: { help: 'generate answers on one target', run: commandRun, required: ['target', 'work', 'out'],
    options: { target: 'target configuration JSON', set: 'useful-answer (default) or search',
      'context-candidate': 'search only: whole-passages-250, a separately bound retained development input; requires its own baseline',
      work: 'empty work directory outside the repository (raw outputs and logs)', out: 'run directory; run.json is written there',
      items: 'comma-separated item ids (targets that support partial runs)',
      preflight: ['boolean', 'doppler-single-machine: identities and prompt sizes, no GPU'] } },
  evaluate: { help: 'apply the checks to a run', run: commandEvaluate, required: ['run'],
    options: { run: 'run directory containing run.json', out: 'evaluation file (default: <run>/evaluation.json)',
      judge: 'automated judge configuration JSON; off unless given',
      scratch: 'code-execution scratch root outside the repository (default: a new temp dir)' } },
  compare: { help: 'compare a run with a stored baseline of the same target', run: commandCompare, required: ['baseline', 'candidate', 'out'],
    options: { baseline: 'baseline run directory', candidate: 'candidate run directory',
      'baseline-evaluation': 'baseline evaluation file (default: <baseline>/evaluation.json)',
      'candidate-evaluation': 'candidate evaluation file (default: <candidate>/evaluation.json)',
      out: 'report path prefix; writes .json and .md',
      'fail-on-regression': ['boolean', 'exit 1 when any verdict newly fails'] } },
  reproduce: { help: 'confirm the frozen useful-answer mechanical results are reproduced', run: commandReproduce, required: ['run', 'out'],
    options: { run: 'a cpu-q4k-control run directory of the useful-answer set', out: 'reproduction JSON file',
      scratch: 'code-execution scratch root outside the repository' } },
  'search-preflight': { help: 'retrieval records and prompt sizes for the search set; no model', run: commandSearchPreflight,
    required: ['out'],
    options: { 'package-archive': 'Doppler archive for prompt token counts (optional)',
      capsule: 'Capsule directory for the tokenizer (optional)', out: 'search preflight JSON file' } },
};

function usage(command = null) {
  if (!command) {
    return [`usage: node tests/answer-regression/harness.js {${Object.keys(COMMANDS).join(',')}} ...`, '',
      `Reploid answer regression harness (${LABEL}). ${SCOPE_NOTE}`, '',
      ...Object.entries(COMMANDS).map(([name, spec]) => `  ${name.padEnd(18)}${spec.help}`)].join('\n');
  }
  const spec = COMMANDS[command];
  return [`usage: node tests/answer-regression/harness.js ${command} [options]`, '', spec.help, '',
    ...Object.entries(spec.options).map(([name, text]) => {
      const [type, help] = Array.isArray(text) ? text : ['string', text];
      return `  --${name}${type === 'string' ? ' VALUE' : ''}${spec.required.includes(name) ? ' (required)' : ''}\n      ${help}`;
    })].join('\n');
}

const camel = name => name.replace(/-([a-z])/g, (_, char) => char.toUpperCase());

export function parseCommandLine(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '-h' || command === '--help') return { help: usage() };
  const spec = COMMANDS[command];
  if (!spec) throw new HarnessError(`unknown command ${JSON.stringify(command)}\n${usage()}`);
  if (rest.includes('-h') || rest.includes('--help')) return { help: usage(command) };
  const options = Object.fromEntries(Object.entries(spec.options).map(([name, text]) => [name,
    { type: Array.isArray(text) ? text[0] : 'string' }]));
  let values;
  try {
    ({ values } = parseArgs({ args: rest, options, strict: true, allowPositionals: false }));
  } catch (error) {
    throw new HarnessError(`${error.message}\n${usage(command)}`);
  }
  for (const name of spec.required) if (values[name] === undefined) throw new HarnessError(`--${name} is required\n${usage(command)}`);
  const args = Object.fromEntries(Object.entries(values).map(([key, value]) => [camel(key), value]));
  if (command === 'run') {
    args.set = args.set ?? 'useful-answer';
    if (!['useful-answer', 'search'].includes(args.set)) throw new HarnessError('--set must be useful-answer or search');
    if (args.contextCandidate && args.contextCandidate !== 'whole-passages-250') {
      throw new HarnessError('--context-candidate must be whole-passages-250');
    }
  }
  return { command, args, run: spec.run };
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const parsed = parseCommandLine(argv);
    if (parsed.help) {
      console.log(parsed.help);
      return 0;
    }
    return (await parsed.run(parsed.args)) || 0;
  } catch (error) {
    if (!(error instanceof HarnessError)) throw error;
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
