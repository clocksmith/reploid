/** Explicit hardware diagnostic. Production provider/evaluator; no supplied candidate or automatic adoption. */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

if (process.env.REPLOID_E2E_ACTUAL_INFERENCE !== '1') throw new Error('Set REPLOID_E2E_ACTUAL_INFERENCE=1');
const base = process.env.REPLOID_E2E_BASE_URL || 'http://localhost:8000';
const diagnosticTimeoutMs = Number(process.env.REPLOID_ACTUAL_TIMEOUT_MS || 300000);
if (!Number.isSafeInteger(diagnosticTimeoutMs) || diagnosticTimeoutMs < 1000 || diagnosticTimeoutMs > 900000) throw new Error('Invalid diagnostic timeout (maximum 900000 ms)');
const directory = process.env.REPLOID_ACTUAL_EVIDENCE_DIR || 'artifacts/actual-tool-repair/' + new Date().toISOString().replace(/[:.]/g, '-');
await mkdir(directory, { recursive: true });
const report = { schema: 'reploid.actual-tool-repair/v1', startedAt: new Date().toISOString(), base,
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  injectedInference: false, independentMachines: false, automaticAdoption: false,
  qualification: 'Focused diagnostic generation with bounded feedback, not the full Work planner or independent-machine proof.',
  humanAssistance: ['Operator selects an observed FormatJson failure. The public contract states required fence and BOM handling explicitly. No candidate implementation or protected cases supplied.'],
  maxAttempts: 4, diagnosticTimeoutMs, sources: [], console: [], progress: [] };
const save = () => writeFile(directory + '/report.json', JSON.stringify(report, null, 2) + '\n');
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu',
    ...(process.platform === 'darwin' ? [] : ['--enable-features=Vulkan', '--use-angle=vulkan', '--disable-gpu-sandbox'])] });
  report.browser = browser.version(); report.platform = process.platform;
  const page = await browser.newPage();
  page.on('console', event => { if (report.console.length < 1000) report.console.push({ at: new Date().toISOString(), type: event.type(), text: event.text() }); });
  await page.goto(base);
  for (const path of ['host/work-evolution.js', 'providers/work-provider.js', 'infrastructure/code-sandbox.js',
    'infrastructure/doppler-runtime-service.js', 'config/work-evolution.json', 'config/work-profile.json',
    'config/doppler-local-models.js', 'vendor/reploid/improvement/code-evolution.js', 'vendor/reploid/improvement/tool-objective.js']) {
    const response = await page.request.get(new URL('/' + path, base).href);
    if (!response.ok()) throw new Error('Source unavailable: ' + path);
    const source = await response.body();
    report.sources.push({ path, sha256: 'sha256:' + createHash('sha256').update(source).digest('hex') });
    await writeFile(directory + '/' + path.replaceAll('/', '__'), source);
  }
  const setup = await page.evaluate(async ({ maxAttempts, diagnosticTimeoutMs }) => {
    const { createWorkEvolution } = await import('/host/work-evolution.js');
    const { openWorkProvider } = await import('/providers/work-provider.js');
    const { createReploidDopplerRuntimeService } = await import('/infrastructure/doppler-runtime-service.js');
    const { DEFAULT_WORK_MODELS } = await import('/host/work-session.js');
    const { default: policy } = await import('/config/work-profile.json', { with: { type: 'json' } });
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter || adapter.info.isFallbackAdapter) throw new Error('Hardware WebGPU adapter unavailable');
    const device = { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description };
    const model = DEFAULT_WORK_MODELS.find(item => item.id === policy.defaultModelId && item.provider === 'doppler');
    if (!model) throw new Error('Configured local default unavailable');
    const evolution = createWorkEvolution({ storage: localStorage, isBusy: () => false });
    const target = (await evolution.describe())[0];
    const input = { text: '```json\n{"service":"worker","retry":3,"enabled":true}\n```' };
    let observation;
    try { observation = { result: await evolution.run(target.id, input) }; }
    catch (error) { observation = { error: error.message }; }
    if (!observation.error) throw new Error('Diagnostic input did not expose a failure');
    const messages = [{ role: 'system', content: 'You are a JavaScript developer. Implement the requested function. Return only one complete JavaScript function expression, without Markdown or explanation. No tests, network or storage.' },
      { role: 'user', content: target.description + '\nReplace this implementation:\n' + target.code
        + '\nObserved failure:\n' + JSON.stringify({ input, observation }) }];
    const generation = { ...policy.generation, maxTokens: 512 };
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(new Error('Diagnostic deadline reached')), diagnosticTimeoutMs);
    const service = createReploidDopplerRuntimeService(), scope = 'reploid:actual-tool-repair';
    const state = window.actualRepair = { settled: false, phase: 'loading', attempts: [], text: '', error: null, qualified: false };
    state.promise = (async () => {
      try {
        const provider = await openWorkProvider({ model, service, scope, signal: controller.signal, generation,
          maxOutcomeCharacters: policy.maxOutcomeCharacters, onProgress: event => { state.phase = typeof event === 'string' ? event : event.message || event.stage || 'loading'; } });
        for (let index = 0; index < maxAttempts; index++) {
          controller.signal.throwIfAborted(); state.phase = 'generating'; state.text = '';
          const instruction = structuredClone(messages);
          const result = await provider.generate(messages, delta => { state.text += delta; }, { signal: controller.signal });
          // Strip an outer presentation fence only. Never edit or repair model code in the harness.
          const code = result.content.trim().replace(/^```(?:javascript|js)?\s*\n([\s\S]*?)\n```$/, '$1');
          state.phase = 'evaluating';
          const candidate = await evolution.propose({ targetId: target.id, code, reason: 'Repair the observed JSON wrapper failure while preserving values',
            baselineGeneration: target.generationId, taskId: 'actual-focused-repair',
            generator: { implementation: 'actual-doppler-diagnostic', model: { requested: result.requestedModel, actual: result.model, provider: result.provider }, instruction: JSON.stringify(instruction) } }, { signal: controller.signal });
          const evidence = await evolution.export(candidate.id);
          state.attempts.push({ instruction, response: result, code, candidate, evidence });
          if (candidate.status === 'awaiting-approval') {
            state.qualified = true; state.offer = await evolution.exportOffer(candidate.id); break;
          }
          const feedback = candidate.error || 'The host comparison rejected this candidate. Check the complete public contract and preserve JSON values.';
          messages.push({ role: 'assistant', content: result.content }, { role: 'user', content: 'The host rejected that candidate: ' + feedback + '\nReturn a corrected function expression only.' });
        }
      } catch (error) { state.error = String(error.stack || error); }
      finally {
        clearTimeout(timer);
        try { await service.close(scope); } catch (error) { state.error ||= String(error.stack || error); }
        state.phase = 'settled'; state.settled = true;
      }
    })();
    return { model, device, generation, timeoutMs: diagnosticTimeoutMs, input, observation, initialMessages: messages.slice(0, 2) };
  }, { maxAttempts: report.maxAttempts, diagnosticTimeoutMs });
  Object.assign(report, setup); await save();
  const deadline = Date.now() + setup.timeoutMs + 60000;
  let previous;
  while (Date.now() < deadline) {
    const status = await page.evaluate(() => ({ settled: window.actualRepair.settled, phase: window.actualRepair.phase,
      attempts: window.actualRepair.attempts.length, text: window.actualRepair.text }));
    const serialized = JSON.stringify(status);
    if (serialized !== previous) { previous = serialized; report.progress.push({ at: new Date().toISOString(), ...status }); process.stdout.write(serialized + '\n'); await save(); }
    if (status.settled) break;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  report.result = await page.evaluate(() => { const { promise, ...state } = window.actualRepair; return state; });
  if (report.result.offer) await writeFile(directory + '/candidate.json', JSON.stringify(report.result.offer, null, 2) + '\n');
} catch (error) { report.error = String(error.stack || error); }
finally { report.finishedAt = new Date().toISOString(); await save(); await browser?.close(); process.stdout.write('Evidence: ' + directory + '/report.json\n'); }
if (!report.result?.qualified || !report.result.settled || report.result.error) process.exitCode = 1;
