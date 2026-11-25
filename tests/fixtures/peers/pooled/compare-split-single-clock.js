// Matched single-requester-clock two-machine split comparison. Default is no-GPU metadata preflight.
// Usage: node compare-split-single-clock.js FREEZE --sha256 HEX --output DIR [--execute]
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
import { CompleteRequestClient } from '../../complete-request-client.js';
import { cleanEnvironment, clearProtectedCacheDirs, isEntry, parseCli, validateProtectedCacheDir,
  validateWorkloads } from './compare-complete.js';

const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;

export function summarizeSplitArm(workloadName, kind, startupWallMs, openedValue, rows, expectedRanges) {
  assert(rows.length === 3, 'Split arm requires one fresh request and two repeats');
  const split = openedValue.split;
  const ranges = split && typeof split === 'object' && !Array.isArray(split) && Object.hasOwn(split, 'ranges') ? split.ranges : split;
  assert(isDeepStrictEqual(ranges, expectedRanges),
    `Split placement ${JSON.stringify(ranges)} differs from frozen ${JSON.stringify(expectedRanges)}`);
  const firstClientMs = Number(rows[0].clientRequestWallMs);
  const firstCoreMs = Number(rows[0].requestWallMs);
  const repeatClientMs = [Number(rows[1].clientRequestWallMs), Number(rows[2].clientRequestWallMs)];
  const repeatCoreMs = [Number(rows[1].requestWallMs), Number(rows[2].requestWallMs)];
  return {
    workload: workloadName,
    kind,
    clockScope: 'single-requester-clock-monotonic/v1',
    expectedRanges,
    startupWallMs,
    clientOpenWallMs: Number(openedValue.clientOpenWallMs),
    postOpenFirstRequestClientMs: firstClientMs,
    postOpenFirstRequestCoreMs: firstCoreMs,
    openPlusFirstAnswerClientMs: startupWallMs + firstClientMs,
    openPlusFirstAnswerCoreMs: startupWallMs + firstCoreMs,
    repeatRequestClientMs: repeatClientMs,
    repeatRequestClientMeanMs: mean(repeatClientMs),
    repeatRequestCoreMs: repeatCoreMs,
    repeatRequestCoreMeanMs: mean(repeatCoreMs)
  };
}

export function aggregateSplitSummaries(armSummaries) {
  const byKind = {};
  for (const kind of [...new Set(armSummaries.map(row => row.kind))].sort()) {
    const subset = armSummaries.filter(row => row.kind === kind);
    const field = key => mean(subset.map(row => row[key]));
    byKind[kind] = {
      armCount: subset.length,
      startupWallMeanMs: field('startupWallMs'),
      postOpenFirstRequestClientMeanMs: field('postOpenFirstRequestClientMs'),
      postOpenFirstRequestCoreMeanMs: field('postOpenFirstRequestCoreMs'),
      openPlusFirstAnswerClientMeanMs: field('openPlusFirstAnswerClientMs'),
      openPlusFirstAnswerCoreMeanMs: field('openPlusFirstAnswerCoreMs'),
      repeatRequestClientMeanMs: mean(subset.flatMap(row => row.repeatRequestClientMs)),
      repeatRequestCoreMeanMs: mean(subset.flatMap(row => row.repeatRequestCoreMs))
    };
  }
  return byKind;
}

export async function runSingleClockArm({ command, workload, armDir, deadlineSeconds, expectedRanges,
  environment = null, stageLauncher = null }) {
  fs.mkdirSync(path.dirname(armDir), { recursive: true });
  fs.mkdirSync(armDir);
  const requests = [{ op: 'open' }, ...[0, 1, 2].map(repeat => ({ ...workload, op: 'request', repeat })),
    { op: 'receipts' }, { op: 'close' }];
  const rows = [];
  let stageHandle = null;
  const startupStarted = performance.now();
  try {
    if (stageLauncher) stageHandle = await stageLauncher(armDir);
    const client = new CompleteRequestClient(command, path.join(armDir, 'requester-protocol.log'), {
      env: cleanEnvironment(environment), maxResponseBytes: 16 * 1024 * 1024, armTimeoutSeconds: deadlineSeconds });
    const exitReceipt = await client.run(async () => {
      for (const request of requests) {
        const limit = { open: 310, request: 160 }[request.op] ?? 45;
        const extra = request.op === 'request' && stageHandle?.expectedProviders ? { expectedProviders: stageHandle.expectedProviders } : {};
        const response = await client.request({ ...request, ...extra }, Math.min(deadlineSeconds, limit));
        assert(response.requestOp === request.op, 'Split worker response operation differs');
        assert(!Object.hasOwn(response, 'error'), JSON.stringify(response.error));
        let value = response.value;
        if (request.op === 'open') {
          value = { ...value, startupWallMs: performance.now() - startupStarted,
            clientSetupScope: 'single-requester-clock-split-startup-open/v1', clientOpenWallMs: response.clientRequestWallMs };
          if (typeof stageHandle?.afterOpen === 'function') await stageHandle.afterOpen(value);
        } else if (request.op === 'request') {
          assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'Split request must return an object');
          value = { ...value, clientRequestWallMs: response.clientRequestWallMs, clientTimingScope: 'owned-local-stdio-jsonl/v1',
            clientRequestBytes: response.clientRequestBytes, clientResponseBytes: response.clientResponseBytes };
          value.clientOverheadMs = value.clientRequestWallMs - value.requestWallMs;
          assert(value.clientOverheadMs >= -0.01, 'Client duration does not contain core interval');
        }
        rows.push(value);
      }
      return client.finish(10);
    });
    rows[rows.length - 1] = { ...rows.at(-1), ownedProcessExit: exitReceipt };
  } finally {
    if (typeof stageHandle?.close === 'function') {
      const stageCleanup = await stageHandle.close();
      if (rows.length) rows[rows.length - 1] = { ...rows.at(-1), stageCleanup };
    }
  }
  const opened = rows[0];
  const requestRows = rows.slice(1, 4);
  const summary = summarizeSplitArm(workload.name, workload.kind ?? 'unknown', opened.startupWallMs, opened, requestRows, expectedRanges);
  return { opened, rows: requestRows, close: rows.at(-1), summary };
}

export function validateSplitFreeze(freeze) {
  assert(freeze.schema === 'a1.split-single-clock-comparison/v1', 'Invalid split comparison schema');
  validateWorkloads(freeze.workloads);
  const expectedRanges = freeze.expectedRanges;
  assert(Array.isArray(expectedRanges) && expectedRanges.length >= 2
    && expectedRanges.every(range => Array.isArray(range) && range.length === 2 && range[0] < range[1]),
  'Explicit multi-stage expectedRanges required');
  const pattern = freeze.pattern;
  assert(Array.isArray(pattern) && isDeepStrictEqual([...new Set(pattern)].sort(), ['candidate', 'pooled']),
    'Interleaved split pattern must include both candidate and pooled');
  return expectedRanges;
}

const USAGE = 'usage: compare-split-single-clock.js [-h] --sha256 SHA256 --output OUTPUT [--execute] freeze';

export async function main(argv = process.argv.slice(2)) {
  const args = parseCli(argv, USAGE, ['execute']);
  const raw = fs.readFileSync(args.freeze);
  assert(createHash('sha256').update(raw).digest('hex') === args.sha256, 'Split freeze SHA-256 mismatch');
  const freeze = JSON.parse(raw.toString('utf8'));
  const expectedRanges = validateSplitFreeze(freeze);
  for (const pin of freeze.filePins ?? []) {
    assert(fs.statSync(pin.path).size === pin.bytes, String(pin.path));
    assert(createHash('sha256').update(fs.readFileSync(pin.path)).digest('hex') === pin.sha256, String(pin.path));
  }
  const out = args.output;
  fs.mkdirSync(out);
  const report = {
    schema: freeze.schema,
    scope: freeze.scope,
    freezeSha256: args.sha256,
    expectedRanges,
    started: Date.now() / 1000,
    metadataPreflightPassed: true,
    modelRunsStarted: false,
    completed: false,
    arms: []
  };
  const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  save();
  if (!args.execute) {
    process.stdout.write(JSON.stringify({ metadataPreflightPassed: true, expectedRanges, modelRunsStarted: false }) + '\n');
    return;
  }
  const cacheDirs = (freeze.protectedCacheDirectories ?? []).map(directory => validateProtectedCacheDir(directory));
  const summaries = [];
  try {
    for (const workload of freeze.workloads) {
      let referenceText = null;
      for (const [index, kind] of freeze.pattern.entries()) {
        const armDir = path.join(out, `${workload.name}-${index}-${kind}`);
        const clears = kind !== 'pooled' && cacheDirs.length;
        const clearedBefore = clears ? clearProtectedCacheDirs(cacheDirs) : null;
        let result, clearedAfter;
        try {
          const armSpec = freeze.arms[kind];
          result = await runSingleClockArm({ command: armSpec.command, workload: { ...workload, kind }, armDir,
            deadlineSeconds: Math.trunc(Number(freeze.armTimeoutSeconds)), expectedRanges, environment: armSpec.environment ?? {} });
        } finally {
          clearedAfter = clears ? clearProtectedCacheDirs(cacheDirs) : null;
        }
        report.modelRunsStarted = true;
        const texts = result.rows.map(row => row.text.trim());
        assert(new Set(texts).size === 1, 'Repeated split output text differed within arm');
        if (referenceText === null) referenceText = texts[0];
        assert(texts[0] === referenceText, 'Split candidate and pooled outputs differed');
        report.arms.push({ workload: workload.name, kind, exactTextMatch: true, protectedCacheClearedBefore: clearedBefore,
          protectedCacheClearedAfter: clearedAfter, summary: result.summary, rows: result.rows });
        summaries.push(result.summary);
        report.aggregates = aggregateSplitSummaries(summaries);
        save();
      }
    }
    report.completed = true;
  } catch (error) {
    report.completed = false;
    report.failure = String(error?.message ?? error);
    throw error;
  } finally {
    report.finished = Date.now() / 1000;
    save();
  }
}

if (isEntry(import.meta.url)) await main();
