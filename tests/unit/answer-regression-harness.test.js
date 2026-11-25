// @vitest-environment node
// Focused tests of the answer regression harness. Synthetic answers only: no model, no GPU, no outside network
// (the judge and installed-route tests talk to a local loopback server).
import fs from 'node:fs';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildPlan, commandRun, main } from '../answer-regression/harness.js';
import * as checks from '../answer-regression/lib/checks.js';
import { NOT_EXECUTED, Sandbox, runCase, runReference, sameValue } from '../answer-regression/lib/code-exec.js';
import { HARNESS, JUDGE_LABEL, LABEL, SEARCH_SET, loadJson, round4, sha256File, writeJson } from '../answer-regression/lib/common.js';
import { loadCandidate } from '../answer-regression/lib/context-candidate.js';
import { evaluateRun } from '../answer-regression/lib/evaluation.js';
import { JUDGE_SCHEMA, Judge, parseReply } from '../answer-regression/lib/judge.js';
import { compareRuns, renderMarkdown, validateSearchInputs } from '../answer-regression/lib/report.js';
import { CPU_CONTROL_REFUSAL, loadTarget } from '../answer-regression/lib/targets.js';
import { checkJsOnly, findSpawnViolations } from '../../scripts/verify-js-only.js';

const temporary = [];
const tempDir = () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'arx-test-')));
  temporary.push(directory);
  return directory;
};
afterAll(() => {
  for (const directory of temporary) fs.rmSync(directory, { recursive: true, force: true });
});

const searchData = () => loadJson(SEARCH_SET);

async function withServer(handler, body) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    return await body(server.address().port);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const readBody = request => new Promise(resolve => {
  const chunks = [];
  request.on('data', chunk => chunks.push(chunk));
  request.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
});

const replyJson = (response, payload) => {
  const data = Buffer.from(JSON.stringify(payload));
  response.writeHead(200, { 'content-type': 'application/json', 'content-length': data.length });
  response.end(data);
};

describe('mechanical checks (JavaScript port of the frozen check types)', () => {
  it('keeps the frozen verdicts and Python-formatted details', () => {
    expect(checks.runCheck({ type: 'finalArray', equals: [4, 8], ignore: [[1, 2, 3, 4]] }, 'doubleEvens([1, 2, 3, 4]) // [4, 8]'))
      .toEqual({ type: 'finalArray', pass: true, detail: 'final [4.0, 8.0]' });
    expect(checks.runCheck({ type: 'onlyAnswer', pattern: 'yes' }, 'Yes, it is prime.').pass).toBe(false);
    expect(checks.runCheck({ type: 'contains', any: ["doesn't exist", 'missing'] }, 'It doesn’t exist.'))
      .toEqual({ type: 'contains', pass: true, detail: 'found ["doesn\'t exist"]' });
    expect(checks.runCheck({ type: 'number', value: 1969, tolerance: 0 }, 'Apollo 11 landed on July 20, 1969.').detail)
      .toBe('numbers [11.0, 20.0, 1969.0]');
    expect(checks.runCheck({ type: 'number', value: -3, tolerance: 0 }, 'x-3 is not negative; −3 is').pass).toBe(true);
    expect(checks.runCheck({ type: 'regex', pattern: '\\bAu\\b', caseSensitive: true }, 'The symbol is **Au**.').detail).toBe("match 'Au'");
    expect(checks.runCheck({ type: 'sentences', min: 2, max: 2 }, 'It opens at 9 a.m. daily. Bring ID!').pass).toBe(true);
  });

  it('parses JSON answers as Python json.loads does, including its error text', () => {
    const check = { type: 'json', equals: { city: 'Paris', country: 'France' } };
    expect(checks.runCheck(check, '```json\n{"city": "paris ", "country": "France"}\n```'))
      .toEqual({ type: 'json', pass: true, detail: "value {'city': 'paris ', 'country': 'France'}" });
    expect(checks.runCheck(check, '{"city": "Paris"}').detail).toBe("keys ['city']");
    expect(checks.runCheck(check, '{"city": "Paris",}').detail)
      .toBe('not JSON: Illegal trailing comma before end of object: line 1 column 17 (char 16)');
    expect(checks.runCheck(check, 'Paris, France').detail).toBe('not JSON: Expecting value: line 1 column 1 (char 0)');
  });

  it('grades an item through grade_arm; over the route prompt limit never passes', () => {
    const item = { id: 'x', category: 'arithmetic', judgment: 'mechanical',
      turns: [{ user: 'q', checks: [{ type: 'number', value: 12, tolerance: 0 }] }] };
    const runItem = { arm: 't', turns: [{ turn: 1, output: 'It is 12.', promptTokenCount: 300, overPromptLimit: true,
      stopReason: 'eos-token', decodeSteps: 4, seconds: 1, minMarginTop1Top2: 1 }] };
    const result = checks.mechanicalItem(item, runItem);
    expect(result.checksPass).toBe(true);
    expect(result.pass).toBe(false);
    expect(result.status).toBe('promptLimitExceeded');
  });

  it('rounds rates as Python round(x, 4) does', () => {
    expect([round4(32, 38), round4(5, 6), round4(1, 32), round4(3, 32)]).toEqual([0.8421, 0.8333, 0.0312, 0.0938]);
  });
});

describe('format and instruction checks', () => {
  it('flags loops, leaked template tokens and length stops', () => {
    const good = { output: 'Canberra.', stopReason: 'eos-token', overPromptLimit: false, promptTokenCount: 19 };
    expect(checks.formatChecks(good).every(row => row.pass)).toBe(true);
    const loop = { ...good, output: Array(3).fill('the same twelve words repeat here again and again in this loop').join(' ') };
    expect(Object.fromEntries(checks.formatChecks(loop).map(row => [row.type, row.pass])).noDegenerateRepetition).toBe(false);
    const leak = Object.fromEntries(checks.formatChecks({ ...good, output: 'Answer<|im_end|>', stopReason: 'max-tokens' })
      .map(row => [row.type, row]));
    expect(leak.noTemplateTokens.pass).toBe(false);
    expect(leak.stoppedOnEndOfTurn).toMatchObject({ pass: false, detail: "stop reason 'max-tokens'" });
  });

  it('checks code-only answers; unfenced Python is recorded as not checked, never parsed', () => {
    const sandbox = new Sandbox();
    try {
      const python = { type: 'codeOnly', language: 'python' };
      const fenced = '```python\ndef is_palindrome(s):\n    return s.lower() == s.lower()[::-1]\n```';
      expect(checks.instructionCheck(python, fenced, sandbox).pass).toBe(true);
      expect(checks.instructionCheck(python, `Here it is:\n${fenced}`, sandbox).pass).toBe(false);
      const unfenced = checks.instructionCheck(python, 'def f(s):\n    return s', sandbox);
      expect(unfenced).toMatchObject({ pass: null, checked: false });
      expect(unfenced.detail).toContain('JavaScript-only');
      const javascript = { type: 'codeOnly', language: 'javascript' };
      expect(checks.instructionCheck(javascript, 'const f = s => s;', sandbox)).toMatchObject({ pass: true, detail: 'unfenced; parses as JavaScript' });
      expect(checks.instructionCheck(javascript, 'Here it is: f(', sandbox).pass).toBe(false);
    } finally {
      sandbox.close();
    }
  });
});

describe('code execution', () => {
  let sandbox;
  beforeAll(() => {
    sandbox = new Sandbox(null, 3);
  });
  afterAll(() => sandbox.close());
  const caseOf = (language, fn, probes) => ({ item: 'x', turn: 1, language, function: fn, probes });

  it('does not execute Python-language cases or reference programs', async () => {
    const before = sandbox.count;
    const answer = '```python\ndef sum_of_squares(nums):\n    return sum(n * n for n in nums)\n```';
    const result = await runCase(sandbox, caseOf('python', 'sum_of_squares', [{ args: [[1, 2, 3]], expect: 14 }]), answer);
    expect(result).toMatchObject({ pass: null, executed: false, reason: NOT_EXECUTED, probes: [] });
    expect(result.execution).toBeUndefined();
    const reference = await runReference(sandbox, { item: 'r', language: 'python', program: 'print(1)', expectStdout: '1\n' });
    expect(reference).toMatchObject({ pass: null, execution: null, reason: NOT_EXECUTED });
    expect(sandbox.count).toBe(before);
    const pythonLanguage = 'python';
    await expect(sandbox.run(pythonLanguage, 'print(1)', 'refused')).rejects.toThrow(/JavaScript-only/);
  });

  it('runs JavaScript in a child node process, calls the first declared function and keeps bool strictness', async () => {
    const answer = '```javascript\nconst reverseString = (s) => s.split("").reverse().join("");\n```';
    const result = await runCase(sandbox, caseOf('javascript', null, [{ args: ['stressed'], expect: 'desserts' }]), answer);
    expect(result.pass).toBe(true);
    expect(result.function).toBe('reverseString');
    expect(result.execution.command).toBe('node main.js');
    expect(sameValue(1, true)).toBe(false);
    const thrown = await runCase(sandbox, caseOf('javascript', 'f', [{ args: [], expect: 1 }]), '```js\nfunction f() { return g(); }\n```');
    expect(thrown.pass).toBe(false);
    expect(thrown.probes[0].observed.error).toContain('ReferenceError');
  });

  it('times out, limits file size and, under sandbox-exec, denies writes outside the case directory', async () => {
    const loop = '```js\nfunction f() { return 1; }\nwhile (true) {}\n```';
    const timedOut = await runCase(sandbox, caseOf('javascript', 'f', [{ args: [], expect: 1 }]), loop);
    expect(timedOut.execution.timedOut).toBe(true);
    expect(timedOut.pass).toBe(false);
    const big = '```js\nfunction f() { try { require("fs").writeFileSync("big.bin", Buffer.alloc(9 * 1024 * 1024)); return "wrote"; } '
      + 'catch (error) { return error.code; } }\n```';
    expect((await runCase(sandbox, caseOf('javascript', 'f', [{ args: [], expect: 'EFBIG' }]), big)).pass).toBe(true);
    if (sandbox.isolation.kind === 'sandbox-exec') {
      const escape = path.join(os.tmpdir(), `arx-escape-${process.pid}.txt`);
      const write = `\`\`\`js\nfunction f() { try { require("fs").writeFileSync(${JSON.stringify(escape)}, "x"); return "open"; } `
        + 'catch (error) { return "blocked"; } }\n```';
      expect((await runCase(sandbox, caseOf('javascript', 'f', [{ args: [], expect: 'blocked' }]), write)).pass).toBe(true);
      expect(fs.existsSync(escape)).toBe(false);
    }
  }, 20000);
});

describe('citations', () => {
  const data = searchData();
  const items = Object.fromEntries(data.items.map(item => [item.id, item]));
  const runItem = (itemId, answer) => {
    const item = items[itemId];
    const prepared = checks.prepareRetrieval(item, data, [{ role: 'user', content: item.prompt }]);
    const dispatched = prepared.dispatchedMessages !== null;
    const turn = { turn: 1, output: dispatched ? answer : null, retrieval: prepared.record, dispatched, overPromptLimit: false };
    return checks.searchItem(item, { turns: [turn] }, data);
  };

  it('separates valid and invalid citations', () => {
    const good = runItem('search-kettle-recall-models', 'The recall covers BrewMate models BM-200 and BM-210 [1].');
    expect(good.pass).toBe(true);
    expect(good.claimCoverage.pass).toBe(true);
    const invented = runItem('search-kettle-recall-models', 'The recall covers BM-200 and BM-210 [7]. See https://example.com/recall for details [1].');
    const names = Object.fromEntries(invented.citations.checks.map(row => [row.type, row.pass]));
    expect(names.citationsResolve).toBe(false);
    expect(names.noUnrecordedUrls).toBe(false);
    expect(invented.pass).toBe(false);
  }, 20000);

  it('requires the expected source, accepts abstention and keeps empty retrieval undispatched', () => {
    const wrongSource = runItem('search-kayak-parking-total', 'The total is $50 [1].');
    expect(wrongSource.answer.pass).toBe(true);
    expect(wrongSource.citations.pass).toBe(false);
    expect(runItem('search-pool-phone-unanswerable',
      'The retrieved sources do not include a phone number for the Ashbury Community Pool.').pass).toBe(true);
    expect(runItem('search-pool-phone-unanswerable', 'The pool phone number is 555-0142 [3].').answer.pass).toBe(false);
    const empty = runItem('search-no-results', '');
    expect(empty.retrievalOutcome.observed).toBe('empty');
    expect(empty.pass).toBe(true);
  }, 20000);
});

describe('judge', () => {
  const generator = { names: ['qwen-3-5-0-8b-q4k-ef16-af32-vf16', 'Qwen/Qwen3.5-0.8B'], manifestIdentity: 'sha256:abc', routeBaseUrl: null };
  let policyFile;
  beforeAll(() => {
    policyFile = path.join(tempDir(), 'policies.md');
    fs.writeFileSync(policyFile, '# Synthetic evaluation policies\n');
    process.env.ARX_TEST_JUDGE_KEY = 'test-key';
  });
  const config = (model, endpoint = 'http://127.0.0.1:9/v1/chat/completions') => ({ schema: JUDGE_SCHEMA, adapter: 'openai-chat',
    endpoint, model, credentials: { env: 'ARX_TEST_JUDGE_KEY' }, policyFile });

  it('must differ from the generator', () => {
    for (const same of ['Qwen/Qwen3.5-0.8B', 'qwen3.5-0.8b-instruct', 'qwen-3-5-0-8b-q4k-ef16-af32-vf16', 'Qwen3.5']) {
      expect(() => new Judge(config(same), generator)).toThrow(/different model/);
    }
    expect(() => new Judge({ ...config('other'), modelIdentity: 'sha256:abc' }, generator)).toThrow(/manifest identity/);
    expect(new Judge(config('other-judge-model'), generator).describe().label).toBe(JUDGE_LABEL);
  });

  it('round-trips with labels and discards replies from the generator or another model', async () => {
    let replyModel = 'other-judge-model-1';
    let last;
    await withServer(async (request, response) => {
      last = { auth: request.headers.authorization, body: await readBody(request) };
      const text = JSON.stringify({ reference: [], status: 'whole-answer-correct',
        elements: [{ kind: 'fact', quote: 'Canberra', claim: 'capital', addition: false, grade: 'correct', basis: 'known' }] });
      replyJson(response, { id: 'r1', model: replyModel, choices: [{ message: { content: text } }] });
    }, async port => {
      const judge = new Judge(config('other-judge-model', `http://127.0.0.1:${port}/v1/chat/completions`), generator);
      const record = await judge.judge({ itemId: 'x', policy: 'Q', context: [], prompt: 'Capital of Australia?', answer: 'Canberra.' });
      expect(record.label).toBe(JUDGE_LABEL);
      expect(record.status).toBe('whole-answer-correct');
      expect(last.auth).toBe('Bearer test-key');
      expect(last.body.temperature).toBe(0);
      expect(JSON.stringify(record) + JSON.stringify(judge.describe())).not.toContain('test-key');
      replyModel = 'Qwen3.5-0.8B';
      expect((await judge.judge({ itemId: 'x', policy: 'Q', context: [], prompt: 'p', answer: 'a' })).error).toContain('generator');
      replyModel = 'unrelated-model';
      expect((await judge.judge({ itemId: 'x', policy: 'Q', context: [], prompt: 'p', answer: 'a' })).error).toContain('not the configured judge');
    });
  });

  it('derives the status from the grades', () => {
    const parsed = parseReply('```json\n{"status": "whole-answer-correct", "elements": [{"grade": "correct"}, {"grade": "unverified"}]}\n```');
    expect(parsed.status).toBe('unverified-only');
    expect(parsed.statusCorrected).toBe(true);
  });
});

describe('targets', () => {
  afterEach(() => vi.restoreAllMocks());

  it('(a) refuses to generate: it ran a Python control', async () => {
    const target = loadTarget(path.join(HARNESS, 'targets', 'cpu-q4k-mac.json'));
    expect(target.kind).toBe('cpu-q4k-control');
    await expect(target.generate({ items: [] }, tempDir(), () => {})).rejects.toThrow(CPU_CONTROL_REFUSAL);
    expect(CPU_CONTROL_REFUSAL).toContain('target (a) ran a Python control; removed under the JavaScript-only order');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const root = tempDir();
    const status = await main(['run', '--target', path.join(HARNESS, 'targets', 'cpu-q4k-mac.json'), '--set', 'search',
      '--work', path.join(root, 'work'), '--out', path.join(root, 'out')]);
    expect(status).toBe(1);
    expect(stderr.mock.calls.map(call => String(call[0])).join('')).toContain('target (a) ran a Python control');
    expect(fs.existsSync(path.join(root, 'out', 'run.json'))).toBe(false);
  }, 20000);

  it('(c) keeps the two-turn history, records identities without machine paths and refuses search', async () => {
    const requests = [];
    await withServer(async (request, response) => {
      const body = await readBody(request);
      requests.push({ path: request.url, auth: request.headers.authorization, body });
      replyJson(response, { id: 'c', object: 'chat.completion', model: body.model, choices: [{ index: 0,
        message: { role: 'assistant', content: body.messages.length === 1 ? 'Canberra.' : 'Wellington.' }, finish_reason: 'stop' }] });
    }, async port => {
      const root = tempDir();
      const app = path.join(root, 'app');
      writeJson(path.join(app, 'self', 'config', 'chat-models.json'), [{ id: 'm', identity: `sha256:${'0'.repeat(64)}`,
        capsule: { capsuleId: 'cap', targetPlans: [] }, generation: { temperature: 0, maxTokens: 64 } }]);
      writeJson(path.join(root, 'target.json'), { schema: 'reploid.answer-regression.target/v1', id: 'route', kind: 'installed-route',
        protocol: 'chat-completions', baseUrl: '${ARX_TEST_ROUTE}', modelId: 'm', routePromptTokenLimit: 250,
        auth: { env: 'ARX_TEST_ROUTE_TOKEN' }, paths: { installedApp: '${ARX_TEST_APP}' } });
      process.env.ARX_TEST_ROUTE_TOKEN = 'route-token';
      const target = loadTarget(path.join(root, 'target.json'), { ARX_TEST_ROUTE: `http://127.0.0.1:${port}`, ARX_TEST_APP: app });
      const plan = { setKind: 'useful-answer', items: [{ id: 'x', category: 'follow-up', turns: [
        { user: 'Capital of Australia?', send: 'Capital of Australia?', dispatch: true, retrieval: null },
        { user: 'And New Zealand?', send: 'And New Zealand?', dispatch: true, retrieval: null }] }] };
      const [items, identities] = await target.generate(plan, path.join(root, 'work'), () => {});
      const turns = items[0].turns;
      expect(turns.map(turn => turn.output)).toEqual(['Canberra.', 'Wellington.']);
      expect(requests[1].body.messages[1]).toEqual({ role: 'assistant', content: 'Canberra.' });
      expect(requests[0].auth).toBe('Bearer route-token');
      expect(requests[0].body).not.toHaveProperty('temperature');
      expect(turns[0].responseModel).toBe('m');
      expect(identities.route.baseUrl).toEqual({ configured: '${ARX_TEST_ROUTE}' });
      expect(JSON.stringify(identities)).not.toContain(app);
      expect(target.supportsSearch()[0]).toBe(false);
    });
  });
});

describe('compare', () => {
  const make = (root, name, output, tokens, mechanical, target = 't') => {
    const run = { schema: 'reploid.answer-regression.run/v1', label: LABEL, runId: name,
      target: { id: target, kind: 'cpu-q4k-control' }, itemSet: { kind: 'useful-answer', sha256: 's', name: 'n' },
      identities: { package: { archive: { sha256: name } }, sampling: { temperature: 0 } },
      items: [{ id: 'a', turns: [{ turn: 1, output, outputTokenIds: tokens }] },
        { id: 'b', turns: [{ turn: 1, output: 'same', outputTokenIds: [9] }] }] };
    const directory = path.join(root, name);
    writeJson(path.join(directory, 'run.json'), run);
    writeJson(path.join(directory, 'evaluation.json'), { run: { sha256: sha256File(path.join(directory, 'run.json')) }, judge: null,
      summary: { mechanical: { pass: Number(mechanical) + 1, total: 2 } },
      items: [{ id: 'a', category: 'code', mechanical: { pass: mechanical }, format: { pass: true }, instruction: { pass: null },
        code: { pass: null }, turns: [] },
      { id: 'b', category: 'factual', mechanical: { pass: true }, format: { pass: true }, instruction: { pass: null },
        code: { pass: null }, turns: [] }] });
    return directory;
  };

  it('reports newly failing verdicts, changed answers and labels', () => {
    const root = tempDir();
    const base = make(root, 'base', '[4, 8]', [1, 2, 3], true);
    const cand = make(root, 'cand', '[2, 4, 6, 8]', [1, 5, 3], false);
    const result = compareRuns(base, cand);
    expect(result.label).toBe(LABEL);
    expect(result.summary.newlyFailing).toEqual({ mechanical: ['a'] });
    expect(result.summary.answersChanged).toBe(1);
    expect(result.items[0].turns[0].firstTokenDivergence).toBe(1);
    expect(result.identityChanges.map(row => row.path)).toEqual(['package.archive.sha256']);
    expect(result.samplingOrLimitsChanged).toBe(false);
    const markdown = renderMarkdown(result);
    expect(markdown).toContain(LABEL);
    expect(markdown).toContain('Newly failing');
    const other = make(root, 'other', 'x', [1], true, 'different');
    expect(() => compareRuns(base, other)).toThrow(/same target/);
  });
});

describe('fixed-document compare', () => {
  const data = searchData();
  const item = data.items[0];
  let prepared;
  beforeAll(() => {
    prepared = checks.prepareRetrieval(item, data, [{ role: 'user', content: item.prompt }]);
  });
  const runRecord = () => structuredClone({ itemSet: { kind: 'search', sha256: sha256File(SEARCH_SET) },
    items: [{ id: item.id, turns: [{ turn: 1, dispatched: true, messages: prepared.dispatchedMessages, retrieval: prepared.record,
      output: 'A wrong answer remains evidence, even when it was fast.', seconds: 0.001 }] }] });

  it('accepts the exact context without grading the answer or its speed', () => {
    const run = runRecord();
    validateSearchInputs(run);
    const turn = run.items[0].turns[0];
    turn.retrieval.verification = { pass: false };
    turn.seconds = 900;
    validateSearchInputs(run);
  }, 20000);

  it('rejects changed or missing dispatched source evidence', () => {
    const mutations = [turn => delete turn.retrieval,
      turn => Object.assign(turn.retrieval.sources[0], { passage: 'Replacement source' }),
      turn => Object.assign(turn.retrieval.context, { digest: 'sha256:substituted' }),
      turn => Object.assign(turn.messages.at(-1), { content: 'Question without sources' }),
      turn => delete turn.messages];
    for (const mutate of mutations) {
      const run = runRecord();
      mutate(run.items[0].turns[0]);
      expect(() => validateSearchInputs(run)).toThrow(/frozen source context/);
    }
  }, 30000);

  it('rejects generated output without dispatch evidence and keeps non-dispatched failures', () => {
    const run = runRecord();
    delete run.items[0].turns[0].dispatched;
    expect(() => validateSearchInputs(run)).toThrow(/no dispatched source evidence/);
    const failed = runRecord();
    failed.items[0].turns[0] = { turn: 1, dispatched: false, output: null, retrieval: { outcome: 'failed', error: { code: 'provider-error' } } };
    validateSearchInputs(failed);
  });

  it('keeps a wrong fast answer failed and refuses changed item membership', () => {
    const root = tempDir();
    const directories = [['baseline', true, 10], ['candidate', false, 0.001]].map(([name, passed, seconds]) => {
      const run = { ...runRecord(), runId: name, target: { id: 'fixed', kind: 'installed-route' }, identities: {} };
      Object.assign(run.items[0].turns[0], { seconds, output: passed ? 'BM-200 and BM-210 [1].' : 'BM-300 [1].' });
      const directory = path.join(root, name);
      writeJson(path.join(directory, 'run.json'), run);
      writeJson(path.join(directory, 'evaluation.json'), { run: { sha256: sha256File(path.join(directory, 'run.json')) }, judge: null,
        items: [{ id: item.id, category: 'search', search: { answer: { pass: passed }, pass: passed } }] });
      return directory;
    });
    const result = compareRuns(...directories);
    expect(result.summary.newlyFailing).toEqual({ answer: [item.id], item: [item.id] });
    expect(result.items[0].turns[0].candidateOutput).toBe('BM-300 [1].');
    const evaluation = loadJson(path.join(directories[1], 'evaluation.json'));
    evaluation.items = [];
    writeJson(path.join(directories[1], 'evaluation.json'), evaluation, false);
    expect(() => compareRuns(...directories)).toThrow(/same evaluated item IDs/);
  }, 30000);
});

// The retained fixture must replay through the current public retrieval API before any candidate test can bind it.
// On a checkout where the retrieval record shape moved on, the harness refuses the candidate; that refusal is tested.
const replay = spawnSync(process.execPath, [path.join(HARNESS, 'test-context-candidate.js')], { encoding: 'utf8', timeout: 30000 });
const replayPasses = replay.status === 0;

it.runIf(!replayPasses)('refuses the retained context candidate when its fixture no longer replays', () => {
  expect(() => loadCandidate('whole-passages-250')).toThrow(/failed public retrieval replay/);
}, 30000);

describe.skipIf(!replayPasses)('retained context candidate', () => {
  const data = searchData();
  let identity;
  let retained;
  let policy;
  beforeAll(() => {
    [identity, retained, policy] = loadCandidate('whole-passages-250');
  }, 30000);
  const runRecord = () => structuredClone({ runId: 'synthetic', target: { id: 'mock', kind: 'installed-route' }, identities: {},
    itemSet: { kind: 'search', name: 'frozen search', sha256: sha256File(SEARCH_SET), contextCandidate: identity },
    items: data.items.map(item => {
      const row = retained[item.id];
      return { id: item.id, category: 'search', turns: [{ turn: 1, dispatched: row.dispatchedMessages !== null,
        messages: row.dispatchedMessages, retrieval: row.retrieval, output: row.dispatchedMessages ? 'BM-300 [1].' : '',
        stopReason: 'eos-token', seconds: 0.001, overPromptLimit: false }] };
    }) });
  const target = { kind: 'installed-route', id: 'synthetic', supportsSearch: () => [true, null],
    describe() {
      return { id: this.id, kind: this.kind };
    },
    // This injected target emits no answer and performs no inference.
    generate: async plan => [[], {}, { syntheticPlanItems: plan.items.length }] };

  it('plans full retained passages and does not dispatch empty retrieval', () => {
    const plan = buildPlan('search', data, [], target, retained);
    expect(plan.items).toHaveLength(8);
    expect(plan.items.filter(row => row.turns[0].dispatch)).toHaveLength(7);
    const kettle = plan.items[0].turns[0];
    expect(kettle.send).toContain('The BrewMate BM-300 is not part of this recall.');
    expect(kettle.retrieval).toEqual(retained[plan.items[0].id].retrieval);
    expect(() => buildPlan('useful-answer', data, [], target, retained)).toThrow(/only to search/);
  });

  it('records the exact candidate and per-item limits without a model', async () => {
    const root = tempDir();
    const args = { target: 'unused.json', set: 'search', contextCandidate: 'whole-passages-250', work: path.join(root, 'work'),
      out: path.join(root, 'out'), items: null, preflight: false };
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await commandRun(args, { loadTarget: () => target });
    vi.restoreAllMocks();
    const run = loadJson(path.join(args.out, 'run.json'));
    expect(run.itemSet.contextCandidate).toEqual(identity);
    expect(run.retrieval.limits).toBeNull();
    expect(run.retrieval.perItemLimits).toEqual(Object.fromEntries(Object.entries(retained).map(([key, row]) => [key, row.limits])));
    expect(run.details.syntheticPlanItems).toBe(8);
  }, 30000);

  it('rejects a tampered candidate identity or dispatched context', () => {
    validateSearchInputs(runRecord());
    const tampered = runRecord();
    tampered.itemSet.contextCandidate.selectedInputSha256 = 'changed';
    expect(() => validateSearchInputs(tampered)).toThrow(/exact retained/);
    const changed = runRecord();
    changed.items[0].turns[0].messages[0].content += ' extra instruction';
    expect(() => validateSearchInputs(changed)).toThrow(/frozen source context/);
  }, 30000);

  it('binds citations with its own policy and keeps the wrong answer failed', () => {
    const item = data.items[0];
    const row = runRecord().items[0];
    const result = checks.searchItem(item, row, data, policy);
    const validity = Object.fromEntries(result.citations.checks.map(check => [check.type, check.pass]));
    expect(validity.contextDigestHolds).toBe(true);
    expect(result.answer.pass).toBe(false);
    expect(result.pass).toBe(false);
    expect(result.citations.supportJudged).toBe(false);
    // Original-policy verification must not silently approve changed instructions.
    const original = checks.searchItem(item, row, data);
    expect(Object.fromEntries(original.citations.checks.map(check => [check.type, check.pass])).contextDigestHolds).toBe(false);
  }, 20000);

  it('compares partial runs with notRun placeholders and needs a separate baseline for a changed context', async () => {
    const root = tempDir();
    const quiet = () => {};
    const directories = [];
    for (const name of ['baseline', 'candidate']) {
      const directory = path.join(root, name);
      const run = runRecord();
      run.runId = name;
      run.items = run.items.slice(0, 1);
      writeJson(path.join(directory, 'run.json'), run);
      const evaluated = await evaluateRun(path.join(directory, 'run.json'), { log: quiet });
      expect(evaluated.summary.notRun).toHaveLength(7);
      writeJson(path.join(directory, 'evaluation.json'), evaluated);
      directories.push(directory);
    }
    const compared = compareRuns(...directories);
    expect(compared.summary.newlyFailingTotal).toBe(0);
    expect(compared.items[0].candidate.answer).toBe(false);
    expect(compared.itemSet.contextCandidate).toEqual(identity);
    const subset = runRecord();
    subset.items = subset.items.slice(1, 2);
    writeJson(path.join(directories[1], 'run.json'), subset, false);
    writeJson(path.join(directories[1], 'evaluation.json'), await evaluateRun(path.join(directories[1], 'run.json'), { log: quiet }), false);
    expect(() => compareRuns(...directories)).toThrow(/same evaluated item IDs/);
    // Same frozen documents are insufficient when dispatched context differs.
    const plain = runRecord();
    plain.items = plain.items.slice(0, 1);
    delete plain.itemSet.contextCandidate;
    writeJson(path.join(directories[1], 'run.json'), plain, false);
    const evaluation = loadJson(path.join(directories[0], 'evaluation.json'));
    evaluation.run.sha256 = sha256File(path.join(directories[1], 'run.json'));
    writeJson(path.join(directories[1], 'evaluation.json'), evaluation, false);
    expect(() => compareRuns(...directories)).toThrow(/separate context-candidate baseline/);
  }, 60000);
});

describe('JavaScript only', () => {
  it('has no Python files and starts no Python or Go process', () => {
    const files = [];
    const walk = (directory, prefix) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const rel = `${prefix}${entry.name}`;
        if (entry.isDirectory()) walk(path.join(directory, entry.name), `${rel}/`);
        else files.push(rel);
      }
    };
    walk(HARNESS, 'tests/answer-regression/');
    expect(files.filter(file => /\.py[cw]?$|__pycache__/.test(file))).toEqual([]);
    const root = path.resolve(HARNESS, '..', '..');
    expect(checkJsOnly({ root, files })).toEqual([]);
    expect(findSpawnViolations(fs.readFileSync(new URL(import.meta.url), 'utf8'))).toEqual([]);
  });
});
