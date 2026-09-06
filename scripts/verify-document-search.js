#!/usr/bin/env node
/** Internally operated physical browser evaluation of the real document workflow. */
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validateOperationModel } from '../self/pool/operation-model.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

export async function verifyDocumentSearch(config) {
  for (const key of ['packageBundlePath', 'corpusPath', 'configurationPath', 'outputDir', 'browserExecutablePath']) {
    requireValue(typeof config?.[key] === 'string' && config[key], `Required ${key}`);
  }
  requireValue(Number.isSafeInteger(config.timeoutMs) && config.timeoutMs > 0
    && Array.isArray(config.browserArgs) && typeof config.requiredVendor === 'string', 'Explicit browser policy required');
  const packageRoot = resolve(config.packageBundlePath, 'consumer/node_modules/doppler-gpu');
  const installed = JSON.parse(await readFile(resolve(config.packageBundlePath, 'receipt.json'), 'utf8'));
  requireValue(installed.passed && hash(await readFile(resolve(config.packageBundlePath, installed.package.filename)))
    === `sha256:${installed.package.sha256}`, 'Retained package receipt or tarball mismatch');
  const corpusBytes = await readFile(config.corpusPath);
  const corpus = JSON.parse(corpusBytes);
  requireValue(corpus.schema === 'reploid.document-relevance-corpus/v1' && corpus.documents.length > 0
    && corpus.queries.length > 0 && corpus.acceptance.mrrAt3 > 0 && corpus.acceptance.recallAt3 > 0, 'Frozen corpus and acceptance required');
  const selected = JSON.parse(await readFile(config.configurationPath, 'utf8'));
  const { getPackIdentity } = await import(pathToFileURL(resolve(packageRoot, 'src/config/pack.js')));
  const { hashTargetPlan } = await import(pathToFileURL(resolve(packageRoot, 'src/config/target-plan.js')));
  const { createStaticFileServer } = await import(pathToFileURL(resolve(packageRoot, 'src/tooling/node-browser-command-runner.js')));
  const { DOPPLER_VERSION } = await import(pathToFileURL(resolve(packageRoot, 'src/version.js')));
  const models = { schema: 'reploid.document-models/v1', queryPrefix: selected.queryPrefix };
  const mounts = [{ urlPrefix: '/self', rootDir: resolve(ROOT, 'self') }];
  for (const [role, operation, workload] of [['embedding', 'embed', 'embedding'], ['reranker', 'rerank', 'reranking']]) {
    const choice = selected[role];
    requireValue(choice?.packPath && choice.openOptions?.trustedSigners && choice.application, `${role} requires explicit Pack trust and application`);
    const pack = JSON.parse(await readFile(choice.packPath, 'utf8'));
    const identity = getPackIdentity(pack);
    const manifest = pack.artifacts.find(artifact => artifact.role === 'manifest');
    const sourceManifest = JSON.parse(await readFile(resolve(dirname(choice.packPath), manifest.path), 'utf8'));
    const executablePack = { ...identity, artifacts: pack.artifacts, requiredOperation: operation,
      acceptedTargetPlanDigests: pack.targetPlans.map(hashTargetPlan) };
    models[role] = { modelId: sourceManifest.modelId, runtime: 'doppler', backend: 'browser-webgpu',
      executionMode: 'complete_pack_browser', workload, runtimeVersion: DOPPLER_VERSION,
      modelHash: identity.semanticRoot, manifestHash: identity.envelopeDigest, executablePack,
      application: choice.application, packOpenOptions: choice.openOptions };
    requireValue(validateOperationModel(models[role]).ok, `Invalid ${role} operation model`);
    mounts.push({ urlPrefix: `/packs/${role}`, rootDir: dirname(resolve(choice.packPath)) });
    models[role].packSource = `/packs/${role}/${encodeURIComponent(choice.packPath.split('/').at(-1))}`;
  }
  await mkdir(config.outputDir);
  const runner = await readFile(fileURLToPath(import.meta.url));
  await writeFile(resolve(config.outputDir, 'runner.js'), runner);
  const browserBytes = await readFile(config.browserExecutablePath);
  const report = { schema: 'reploid.document-search-qualification/v1', passed: false, generatedAt: new Date().toISOString(),
    config, corpusDigest: hash(corpusBytes), corpus, installedPackage: installed.package, models,
    runnerHash: hash(runner), browserExecutable: { path: config.browserExecutablePath,
      hash: hash(browserBytes), sizeBytes: browserBytes.length },
    boundary: { operatorCount: 1, independentMachines: false, independentUsers: false,
      referencedGeneration: false, sourceNumericalComparison: false, coldOperatingSystemCache: false, isolatedHost: false,
      corpus: corpus.boundary }, requests: [], logs: [], servedFiles: [], observations: [], modelOpenings: [], stage: 'launch' };
  let server;
  let browser;
  let timer;
  const sources = new Map();
  try {
    server = await createStaticFileServer({ rootDir: packageRoot, host: '127.0.0.1', port: 0, staticMounts: mounts });
    for (const role of ['embedding', 'reranker']) models[role].packSource = server.baseUrl + models[role].packSource;
    browser = await chromium.launch({ headless: true, executablePath: config.browserExecutablePath, args: config.browserArgs });
    timer = setTimeout(() => browser.close().catch(() => {}), config.timeoutMs);
    report.browserVersion = browser.version();
    const page = await browser.newPage();
    await page.exposeFunction('retainDocumentObservation', async observation => {
      report.observations.push(observation);
      await writeFile(resolve(config.outputDir, 'progress.json'), JSON.stringify({ completedQueries: report.observations.length,
        mode: observation.mode, queryIndex: observation.queryIndex, elapsedMs: observation.elapsedMs }) + '\n');
    });
    await page.exposeFunction('retainDocumentOpening', observation => {
      report.modelOpenings.push(observation);
    });
    page.on('console', message => report.logs.push({ type: message.type(), text: message.text() }));
    page.on('pageerror', error => report.logs.push({ type: 'pageerror', text: error.message }));
    const recording = [];
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.pathname.startsWith('/packs/') || !response.ok()) return;
      recording.push(response.body().then(async bytes => {
        const receipt = { path: url.pathname, hash: hash(bytes), sizeBytes: bytes.length };
        const previous = sources.get(url.pathname);
        if (previous) {
          requireValue(previous.hash === receipt.hash, `Runtime source changed during evaluation: ${url.pathname}`);
          return;
        }
        sources.set(url.pathname, receipt);
        const output = resolve(config.outputDir, 'runtime', '.' + url.pathname);
        requireValue(output.startsWith(resolve(config.outputDir, 'runtime') + '/'), 'Runtime source path escapes archive');
        await mkdir(dirname(output), { recursive: true });
        await writeFile(output, bytes, { flag: 'wx' });
      }).catch(error => {
        report.logs.push({ type: 'source-read-error', text: error.message });
      }));
    });
    await page.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      report.requests.push({ url: url.href, method: request.method() });
      if (url.origin !== server.baseUrl || request.method() !== 'GET') return route.abort();
      if (url.pathname === '/qualification') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Reploid document qualification</title>' });
      return route.continue();
    });
    await page.goto(`${server.baseUrl}/qualification`);
    report.adapter = await page.evaluate(async () => {
      const adapter = await navigator.gpu?.requestAdapter();
      if (!adapter) throw new Error('No WebGPU adapter');
      return { vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device,
        description: adapter.info.description, isFallbackAdapter: adapter.isFallbackAdapter ?? adapter.info.isFallbackAdapter };
    });
    requireValue(report.adapter.vendor === config.requiredVendor && report.adapter.isFallbackAdapter === false
      && !/swiftshader|llvmpipe/i.test(JSON.stringify(report.adapter)), 'Physical required GPU unavailable');
    report.stage = 'search';
    report.raw = await page.evaluate(async ({ models, corpus }) => {
      const { createDocumentSearch } = await import('/self/pool/document-search.js');
      const { createLocalPackExecutor } = await import('/self/pool/local-pack-executor.js');
      const api = await import('/src/client/doppler-api.browser.js');
      const { DOPPLER_VERSION } = await import('/src/version.js');
      const { getBufferPool } = await import('/src/memory/buffer-pool.js');
      const openings = [];
      let session;
      const memory = () => ({ heap: performance.memory ? { used: performance.memory.usedJSHeapSize,
        total: performance.memory.totalJSHeapSize, limit: performance.memory.jsHeapSizeLimit } : null,
        buffers: getBufferPool().getStats() });
      const service = {
        async prepare() { return { version: DOPPLER_VERSION }; },
        async openPack({ source, options }) {
          if (session) throw new Error('Overlapping model sessions');
          const start = performance.now();
          session = await api.openPack(source, options);
          const observation = { source, modelId: session.modelId, loadMs: performance.now() - start, memory: memory() };
          openings.push(observation);
          await window.retainDocumentOpening(observation);
          return session;
        },
        async close() { try { await session?.close(); } finally { session = null; } }
      };
      const search = createDocumentSearch({ executor: createLocalPackExecutor({ service }) });
      const results = [];
      const started = performance.now();
      try {
        search.configure(models);
        await search.setDocuments(corpus.documents.map((text, index) => ({ name: `document-${index}.txt`, text })));
        for (const mode of ['embedding', 'rerank', 'repeat-rerank']) {
          for (const [queryIndex, query] of corpus.queries.entries()) {
            const began = performance.now();
            const result = await search.search({ query: query.text, topK: 3, rerank: mode !== 'embedding' });
            const observation = { mode, queryIndex, elapsedMs: performance.now() - began, result, memory: memory() };
            results.push(observation);
            await window.retainDocumentObservation(observation);
          }
        }
        return { results, openings, elapsedMs: performance.now() - started,
          memoryScope: 'Chromium JS heap and Doppler buffer pool; excludes untracked GPU and process overhead' };
      } finally { await search.close(); }
    }, { models, corpus });
    await Promise.all(recording);
    requireValue(!report.logs.some(row => row.type === 'source-read-error'), 'Runtime source retention failed');
    report.servedFiles = [...sources.values()].sort((a, b) => a.path.localeCompare(b.path));
    report.metrics = {};
    for (const mode of ['embedding', 'rerank', 'repeat-rerank']) {
      const rows = report.raw.results.filter(row => row.mode === mode);
      const scores = rows.map(row => {
        const relevant = corpus.queries[row.queryIndex].relevance;
        const ids = row.result.matches.map(match => Number(/^document-(\d+)\.txt$/.exec(match.sources[0])[1]));
        const first = ids.findIndex(id => (relevant[id] ?? 0) > 0);
        return { queryIndex: row.queryIndex, ids, reciprocalRank: first < 0 ? 0 : 1 / (first + 1),
          recall: ids.filter(id => (relevant[id] ?? 0) > 0).length / Object.values(relevant).filter(grade => grade > 0).length };
      });
      report.metrics[mode] = { mrrAt3: scores.reduce((sum, row) => sum + row.reciprocalRank, 0) / scores.length,
        recallAt3: scores.reduce((sum, row) => sum + row.recall, 0) / scores.length, scores };
    }
    report.passed = Object.values(report.metrics).every(metrics => metrics.mrrAt3 >= corpus.acceptance.mrrAt3
      && metrics.recallAt3 >= corpus.acceptance.recallAt3);
    report.stage = 'complete';
  } catch (error) { report.error = { name: error.name, message: error.message, stack: error.stack }; }
  finally {
    clearTimeout(timer);
    report.servedFiles = [...sources.values()].sort((a, b) => a.path.localeCompare(b.path));
    const errors = [];
    for (const resource of [browser, server]) {
      try { await resource?.close(); } catch (error) { errors.push(error.message); }
    }
    report.cleanup = { passed: !errors.length, errors };
    report.passed &&= !errors.length;
    await writeFile(resolve(config.outputDir, 'qualification.json'), JSON.stringify(report, null, 2) + '\n');
  }
  requireValue(report.passed, `Document qualification failed: ${report.error?.message ?? 'frozen relevance acceptance'}; retained at ${config.outputDir}`);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  requireValue(process.argv.length === 3, 'Usage: node scripts/verify-document-search.js <config.json>');
  verifyDocumentSearch(JSON.parse(await readFile(process.argv[2], 'utf8')))
    .then(report => console.log(JSON.stringify({ passed: report.passed, metrics: report.metrics, outputDir: report.config.outputDir })))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
