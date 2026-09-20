/** Explicit hardware run. No provider substitution, candidate fixture, approval or peer disclosure. */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

if (process.env.REPLOID_E2E_ACTUAL_INFERENCE !== '1') throw new Error('Set REPLOID_E2E_ACTUAL_INFERENCE=1 to run actual local inference');
const base = process.env.REPLOID_E2E_BASE_URL || 'http://localhost:8000';
const directory = process.env.REPLOID_ACTUAL_EVIDENCE_DIR
  || 'artifacts/actual-work-improvement/' + new Date().toISOString().replace(/[:.]/g, '-');
await mkdir(directory, { recursive: true });
const report = { schema: 'reploid.actual-work-attempt/v1', startedAt: new Date().toISOString(), base,
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  injectedInference: false, independentMachines: false, automaticAdoption: false,
  humanAssistance: ['Operator supplies a fenced JSON task and explicitly asks the model to investigate a tool failure. No candidate code supplied.'],
  qualification: 'One local hardware run; no cross-device, network benefit or recursive improvement claim.',
  console: [], failures: [], progress: [], sources: [] };
const save = () => writeFile(directory + '/report.json', JSON.stringify(report, null, 2) + '\n');
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu',
    ...(process.platform === 'darwin' ? [] : ['--enable-features=Vulkan', '--use-angle=vulkan', '--disable-gpu-sandbox'])] });
  report.browser = browser.version(); report.platform = process.platform; report.architecture = process.arch;
  const page = await browser.newPage();
  page.on('console', message => {
    if (report.console.length < 1000) report.console.push({ at: new Date().toISOString(), type: message.type(), text: message.text().slice(0, 2000) });
  });
  page.on('response', response => {
    if (response.status() >= 400 && report.failures.length < 100) report.failures.push({ url: response.url(), status: response.status() });
  });
  page.on('requestfailed', request => {
    if (report.failures.length < 100) report.failures.push({ url: request.url(), error: request.failure()?.errorText });
  });
  await page.goto(base);
  const manifest = await (await page.request.get(new URL('/config/browser-bundle-manifest.json', base).href)).json();
  report.bundle = manifest.bundleHash;
  // Retain the bytes that define this attempt, and verify them against the served manifest.
  for (const path of ['host/work-session.js', 'host/work-evolution.js', 'providers/work-provider.js',
    'config/work-profile.json', 'config/work-evolution.json', 'config/doppler-local-models.js',
    'vendor/reploid/agent/index.js', 'vendor/reploid/agent/engine.js', 'vendor/reploid/agent/task-strategy.js']) {
    const response = await page.request.get(new URL('/' + path, base).href);
    if (!response.ok()) throw new Error('Source unavailable: ' + path);
    const source = await response.body();
    const sha256 = 'sha256:' + createHash('sha256').update(source).digest('hex');
    if (manifest.files.find(item => item.path === path)?.sha256 !== sha256) throw new Error('Served source differs from manifest: ' + path);
    report.sources.push({ path, sha256 });
    await writeFile(directory + '/' + path.replaceAll('/', '__'), source);
  }
  report.adapter = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    return adapter ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture,
      device: adapter.info.device, description: adapter.info.description, isFallbackAdapter: adapter.info.isFallbackAdapter } : null;
  });
  if (!report.adapter || report.adapter.isFallbackAdapter) throw new Error('Hardware WebGPU adapter unavailable');
  const setup = await page.evaluate(async () => {
    const { createWorkSession, DEFAULT_WORK_MODELS } = await import('/host/work-session.js');
    const { createWorkEvolution } = await import('/host/work-evolution.js');
    const { default: policy } = await import('/config/work-profile.json', { with: { type: 'json' } });
    const model = DEFAULT_WORK_MODELS.find(item => item.provider === 'doppler' && item.recommended);
    if (!model) throw new Error('No declared local default');
    let app;
    const evolution = createWorkEvolution({ storage: localStorage, isBusy: () => app?.getState().busy === true });
    app = createWorkSession({ storage: localStorage, evolution });
    const task = {
      goal: 'Use the existing FormatJson tool to format the attached JSON text, preserving its values. If that tool fails on the input, investigate the failure and propose a repair to that tool. Record what actually happened. Do not adopt a candidate or invent test results.',
      criteria: 'The attached JSON values are preserved. Any proposed tool change must pass the host checks and remain pending operator approval.',
      modelId: model.id, allowImprovement: true,
      inputs: [{ name: 'example.txt', text: '```json\n{"service":"worker","retry":3,"enabled":true}\n```' }]
    };
    window.actualWork = { app, evolution, settled: false, error: null };
    window.actualWork.promise = app.start(task).catch(error => { window.actualWork.error = String(error.stack || error); })
      .finally(() => { window.actualWork.settled = true; });
    return { task, model, policy };
  });
  Object.assign(report, setup);
  const deadline = Date.now() + setup.policy.profile.config.agent.timeoutMs + 60000;
  let previous = '';
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const state = window.actualWork.app.getState();
      return { settled: window.actualWork.settled, busy: state.busy, activity: state.activity,
        cycle: state.cycle, status: state.records.at(-1)?.status };
    });
    const serialized = JSON.stringify(state);
    if (serialized !== previous) {
      previous = serialized; report.progress.push({ at: new Date().toISOString(), ...state });
      process.stdout.write(serialized + '\n'); await save();
    }
    if (state.settled) break;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  report.observation = await page.evaluate(() => ({ state: window.actualWork.app.getState(),
    records: window.actualWork.app.exportRecords(), settled: window.actualWork.settled, error: window.actualWork.error }));
  if (report.observation.settled) {
    report.candidates = await page.evaluate(async () => {
      const records = await window.actualWork.evolution.list();
      return Promise.all(records.map(record => window.actualWork.evolution.export(record.id)));
    });
  } else {
    await page.evaluate(() => window.actualWork.app.cancel());
    report.harnessLimitReached = true;
  }
  report.completedTask = report.observation.settled && report.observation.state.records.at(-1)?.status === 'review';
} catch (error) { report.error = String(error.stack || error); }
finally {
  report.finishedAt = new Date().toISOString(); await save(); await browser?.close();
  process.stdout.write('Evidence: ' + directory + '/report.json\n');
}
if (!report.completedTask) process.exitCode = 1;
