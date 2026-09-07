#!/usr/bin/env node
/** Execute the frozen support corpus. Semantic review is a separate bound artifact. */
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const assert = (ok, message) => { if (!ok) throw new Error(message); };

export async function readDocumentAnswerCorpus(config = {}) {
  const custom = config.corpusPath !== undefined;
  if (custom) {
    assert(typeof config.corpusPath === 'string' && config.corpusPath.trim(), 'Explicit corpusPath required');
    assert(/^sha256:[a-f0-9]{64}$/.test(config.corpusDigest ?? ''), 'Custom corpus requires a frozen corpusDigest');
  }
  const corpusPath = custom ? resolve(config.corpusPath)
    : resolve(root, 'tests/fixtures/document-answer-support-corpus.json');
  const bytes = await readFile(corpusPath);
  const corpusDigest = hash(bytes);
  if (config.corpusDigest !== undefined) assert(config.corpusDigest === corpusDigest, 'Frozen corpus digest mismatch');
  const corpus = JSON.parse(bytes);
  assert(corpus.schema === 'reploid.document-answer-support-corpus/v1'
    && typeof corpus.id === 'string' && corpus.id.trim()
    && Array.isArray(corpus.cases) && corpus.cases.length > 0, 'Frozen support corpus required');
  const acceptance = corpus.acceptance;
  assert(acceptance?.reviewEveryFactualSentence === true && acceptance.requireCitedPassageSupport === true
    && acceptance.allowUnsupportedFactualClaims === false && acceptance.requireAbstentionWhenUnanswerable === true
    && acceptance.requireCompleteCaseCoverage === true && acceptance.citationSyntaxIsNotSemanticSupport === true,
  'Corpus must preserve the complete semantic-support acceptance contract');
  const ids = new Set();
  const categories = new Set(['answerable', 'partially-answerable', 'contradictory', 'unanswerable']);
  for (const entry of corpus.cases) {
    assert(entry && typeof entry.id === 'string' && entry.id.trim() && !ids.has(entry.id)
      && categories.has(entry.category) && typeof entry.question === 'string' && entry.question.trim()
      && Array.isArray(entry.passages) && entry.passages.length > 0
      && entry.review && typeof entry.review === 'object' && !Array.isArray(entry.review), 'Invalid or duplicate corpus case');
    ids.add(entry.id);
    const passageIds = new Set();
    for (const passage of entry.passages) {
      assert(passage && typeof passage.id === 'string' && passage.id.trim() && !passageIds.has(passage.id)
        && typeof passage.text === 'string' && passage.text.trim(), 'Invalid or duplicate corpus passage');
      passageIds.add(passage.id);
    }
  }
  return { corpus, bytes, corpusPath, corpusDigest };
}

export async function evaluateDocumentAnswers(config) {
  for (const key of ['capsuleDirectory', 'openOptionsPath', 'outputDirectory', 'browserExecutablePath', 'requiredVendor']) {
    assert(typeof config[key] === 'string' && config[key], `Explicit ${key} required`);
  }
  assert(Array.isArray(config.browserArgs) && Number.isSafeInteger(config.timeoutMs) && config.timeoutMs > 0,
    'Explicit browser flags and timeout required');
  const { corpus, bytes: corpusBytes, corpusPath, corpusDigest } = await readDocumentAnswerCorpus(config);
  const output = resolve(config.outputDirectory);
  await mkdir(output); // No overwriting previous observations.
  const packageRoot = resolve(root, 'node_modules/doppler-gpu');
  const packageInfo = await read(resolve(packageRoot, 'package.json'));
  const locked = (await read(resolve(root, 'package-lock.json'))).packages['node_modules/doppler-gpu'];
  assert(packageInfo.version === locked.version && locked.integrity.startsWith('sha512-'), 'Locked runtime identity required');
  const { createStaticFileServer } = await import(pathToFileURL(resolve(packageRoot, 'src/tooling/node-browser-command-runner.js')));
  const { getCapsuleIdentity } = await import(pathToFileURL(resolve(packageRoot, 'src/config/capsule.js')));
  const { hashTargetPlan } = await import(pathToFileURL(resolve(packageRoot, 'src/config/target-plan.js')));
  const capsuleBytes = await readFile(resolve(config.capsuleDirectory, 'capsule.json'));
  const capsule = JSON.parse(capsuleBytes);
  const identity = getCapsuleIdentity(capsule);
  const model = { runtime: 'doppler', runtimeVersion: packageInfo.version, backend: 'browser-webgpu',
    modelId: capsule.modelId, executionMode: 'complete_pack_browser', workload: 'text-generation',
    modelHash: identity.semanticRoot, manifestHash: identity.envelopeDigest,
    executablePack: { ...identity, artifacts: capsule.artifacts, requiredOperation: 'generate',
      acceptedTargetPlanDigests: capsule.targetPlans.map(hashTargetPlan) },
    application: capsule.release.application, packOpenOptions: await read(config.openOptionsPath) };
  const report = { schema: 'reploid.document-answer-execution/v1', executionPassed: false,
    semanticSupportQualified: false, generatedAt: new Date().toISOString(), config,
    sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceDirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
    corpusPath, corpusDigest, corpus, capsuleBytesDigest: hash(capsuleBytes), model,
    runtime: { version: packageInfo.version, integrity: locked.integrity },
    boundary: { operatorCount: 1, independentOperators: false, privateRetrieval: false,
      scope: 'Real generation against frozen supplied passages using the product prompt and inspector; no retrieval or semantic-support claim' },
    cases: [], logs: [], requests: [], servedSources: [] };
  await writeFile(resolve(output, 'runner.js'), await readFile(fileURLToPath(import.meta.url)));
  await writeFile(resolve(output, 'corpus.json'), corpusBytes);
  let server, browser, timer;
  const recordings = [];
  const sources = new Map();
  try {
    server = await createStaticFileServer({ rootDir: packageRoot, host: '127.0.0.1', port: 0,
      staticMounts: [{ urlPrefix: '/self', rootDir: resolve(root, 'self') },
        { urlPrefix: '/capsule', rootDir: resolve(config.capsuleDirectory) }] });
    model.packSource = `${server.baseUrl}/capsule/capsule.json`;
    browser = await chromium.launch({ executablePath: config.browserExecutablePath, headless: true, args: config.browserArgs });
    timer = setTimeout(() => { report.timedOut = true; void browser.close(); }, config.timeoutMs);
    report.browser = { version: browser.version(), executableDigest: hash(await readFile(config.browserExecutablePath)) };
    const page = await browser.newPage();
    page.on('console', message => report.logs.push({ type: message.type(), text: message.text() }));
    page.on('pageerror', error => report.logs.push({ type: 'pageerror', text: error.message }));
    page.on('response', response => {
      const url = new URL(response.url());
      if (!response.ok() || !/\.(js|json|wgsl)$/.test(url.pathname) || url.pathname.startsWith('/capsule/')) return;
      recordings.push(response.body().then(async bytes => {
        const digest = hash(bytes);
        assert(!sources.has(url.pathname) || sources.get(url.pathname).digest === digest, 'Source changed during evaluation');
        sources.set(url.pathname, { path: url.pathname, digest, sizeBytes: bytes.length });
        const target = resolve(output, 'runtime', `.${url.pathname}`);
        assert(target.startsWith(resolve(output, 'runtime') + '/'), 'Source path escapes evidence directory');
        await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes);
      }));
    });
    await page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      report.requests.push({ url: url.href, method: request.method() });
      if (url.origin !== server.baseUrl || request.method() !== 'GET') return route.abort();
      if (url.pathname === '/evaluation') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Document answer evaluation</title>' });
      return route.continue();
    });
    await page.exposeFunction('retainCase', async row => {
      report.cases.push({ ...row, outputDigest: hash(row.output ?? '') });
      await writeFile(resolve(output, 'progress.json'), JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify({ caseId: row.id, status: row.inspection?.status, error: row.error, elapsedMs: row.elapsedMs }));
    });
    await page.goto(`${server.baseUrl}/evaluation`);
    report.execution = await page.evaluate(async ({ model, corpus, config }) => {
      const api = await import('/src/client/capsule-host.browser.js');
      const { DOPPLER_VERSION } = await import('/src/version.js');
      const { createReploidDopplerRuntimeService } = await import('/self/infrastructure/doppler-runtime-service.js');
      const { createLocalPackExecutor } = await import('/self/pool/local-pack-executor.js');
      const { buildDocumentAnswerPrompt, inspectDocumentAnswer } = await import('/self/pool/document-answer.js');
      const { default: policy } = await import('/self/pool/document-search-policy.json', { with: { type: 'json' } });
      const adapter = await navigator.gpu?.requestAdapter();
      const gpu = adapter && { ...Object.fromEntries(['vendor', 'architecture', 'device', 'description'].map(key => [key, adapter.info[key]])),
        fallback: adapter.isFallbackAdapter ?? adapter.info.isFallbackAdapter };
      if (!gpu || gpu.vendor !== config.requiredVendor || gpu.fallback !== false || /swiftshader|llvmpipe/i.test(JSON.stringify(gpu))) {
        throw new Error('Required physical GPU unavailable');
      }
      const service = createReploidDopplerRuntimeService({ expectedVersion: model.runtimeVersion,
        loadModule: async () => ({ ...api, DOPPLER_VERSION }) });
      const executor = createLocalPackExecutor({ service });
      try {
        for (const entry of corpus.cases) {
          const began = performance.now();
          const prompt = buildDocumentAnswerPrompt({ question: entry.question, passages: entry.passages,
            abstention: policy.answerAbstention, unknown: policy.answerUnknown });
          const row = { id: entry.id, question: entry.question, passages: entry.passages, input: { prompt }, options: config.generationOptions };
          try {
            const result = await executor.run({ model, input: row.input, options: row.options,
              limits: { maxInputBytes: policy.maxInputBytes, maxOutputBytes: policy.maxOutputBytes, deadlineAt: Date.now() + policy.maxOperationMs } });
            Object.assign(row, { output: result.output.text, tokenIds: result.output.tokenIds, receipt: result.receipt,
              inspection: inspectDocumentAnswer({ text: result.output.text, passages: entry.passages,
                abstention: policy.answerAbstention, unknown: policy.answerUnknown }) });
          } catch (error) { row.error = { name: error.name, message: error.message }; }
          row.elapsedMs = performance.now() - began; row.executor = executor.getState();
          await window.retainCase(row);
        }
        return { gpu, state: executor.getState() };
      } finally { await executor.close(); }
    }, { model, corpus, config });
    await Promise.all(recordings);
    report.executionPassed = report.cases.length === corpus.cases.length && report.cases.every(row => !row.error && row.receipt);
  } catch (error) { report.error = { name: error.name, message: error.message, stack: error.stack }; }
  finally {
    clearTimeout(timer);
    const cleanup = await Promise.allSettled([browser?.close(), server?.close()]);
    await Promise.allSettled(recordings);
    report.cleanupErrors = cleanup.filter(row => row.status === 'rejected').map(row => String(row.reason));
    report.executionPassed &&= report.cleanupErrors.length === 0;
    report.servedSources = [...sources.values()];
    await writeFile(resolve(output, 'execution.json'), JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv.length === 3, 'Usage: node scripts/evaluate-document-answers.js <config.json>');
  const report = await evaluateDocumentAnswers(await read(process.argv[2]));
  console.log(JSON.stringify({ executionPassed: report.executionPassed, semanticSupportQualified: false,
    error: report.error, outputDirectory: report.config.outputDirectory }));
  if (!report.executionPassed) process.exitCode = 1;
}
