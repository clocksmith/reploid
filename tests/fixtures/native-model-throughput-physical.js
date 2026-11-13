// Explicit resident native measurement, with loading separate from inference.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { createHash } from 'node:crypto';
import * as webgpu from 'webgpu';
import * as runtime from 'doppler-gpu/compat';
import { getKernelCapabilities } from 'doppler-gpu/tooling/device';
import { createNativeGpuHost } from '../../server/native-participant.js';
import { createWorkResidentProvider } from '../../apps/poolday/providers/work-resident-provider.js';
import { createReploidDopplerRuntimeService } from '../../shared/infrastructure/doppler-runtime-service.js';

assert.equal(process.env.REPLOID_CONTEXT_PHYSICAL, '1', 'Explicit physical opt-in required');
const config = JSON.parse(await fs.readFile(process.argv[2]));
for (const key of ['baseUrl', 'modelId', 'output', 'prompt']) assert.equal(typeof config[key], 'string', key);
for (const key of ['warmupRuns', 'measuredRuns', 'maxOutputTokens']) assert(Number.isSafeInteger(config[key]) && config[key] > 0, key);
const sha = value => createHash('sha256').update(value).digest('hex');
const correct = content => {
  if (config.expectedJson !== undefined) {
    try { return JSON.stringify(JSON.parse(content)) === JSON.stringify(config.expectedJson); }
    catch { return false; }
  }
  return config.expectedAnswer === undefined ? null : content.trim() === config.expectedAnswer;
};
const catalog = JSON.parse(await fs.readFile(new URL('../../shared/config/chat-models.json', import.meta.url)));
const model = catalog.find(row => row.id === config.modelId);
assert(model, 'Use an exact catalog model');
if (config.generation) model.generation = config.generation;
if (config.loadOptions) model.loadOptions = config.loadOptions;
assert(model.generation, 'Explicit matched generation settings required');
const pin = JSON.parse(await fs.readFile(new URL('../../shared/config/doppler-package.json', import.meta.url)));
const response = await fetch(new URL('manifest.json', config.baseUrl), { signal: AbortSignal.timeout(30000) });
assert(response.ok, 'Manifest request failed');
const manifestText = await response.text(), manifestHash = sha(manifestText);
assert.equal('sha256:' + manifestHash, model.identity, 'Source differs from catalog');
const manifest = JSON.parse(manifestText);
const gpu = createNativeGpuHost(async () => webgpu);
const service = createReploidDopplerRuntimeService({ loadModule: async () => runtime, expectedVersion: pin.version });
const report = { schema: 'reploid.native-model-throughput/v1', at: new Date().toISOString(), passed: false,
  platform: process.platform, node: process.version, cpu: os.cpus()[0]?.model,
  totalMemoryBytes: os.totalmem(), initialFreeMemoryBytes: os.freemem(),
  runtimeVersion: runtime.DOPPLER_VERSION, packageIntegrity: pin.integrity,
  modelId: model.id, modelIdentity: model.identity, sourceWeightBytes: manifest.totalSize,
  loadOptions: model.loadOptions, generation: model.generation,
  workload: { prompt: config.prompt, maxOutputTokens: config.maxOutputTokens,
    warmupRuns: config.warmupRuns, measuredRuns: config.measuredRuns, contextReuse: false },
  scope: 'Native resident application profile; transport/load time excluded from throughput. No full-logit or general quality qualification.', rows: [] };
const save = () => fs.writeFile(config.output, JSON.stringify(report, null, 2) + '\n');
let progressAt = 0;
const provider = createWorkResidentProvider({ model, service, generation: model.generation, maxOutcomeCharacters: 20000,
  loadOptions: model.loadOptions, source: { manifest, manifestText, manifestHash, baseUrl: config.baseUrl },
  onChange(state) {
    if (performance.now() - progressAt > 2000) { console.log(JSON.stringify({ phase: state.phase, progress: state.progress })); progressAt = performance.now(); }
  } });
const abort = new AbortController();
process.once('SIGTERM', () => { abort.abort(new Error('Measurement stopped')); void provider.close(); });
try {
  report.phase = 'loading'; await save();
  await gpu.open();
  const loadStart = performance.now();
  await provider.prepare();
  report.loadMs = performance.now() - loadStart;
  report.adapter = getKernelCapabilities().adapterInfo;
  assert(!/swiftshader|llvmpipe|software/i.test(JSON.stringify(report.adapter)), 'Physical GPU required');
  report.phase = 'generation'; await save();
  for (let i = 0; i < config.warmupRuns + config.measuredRuns; i++) {
    if (i === config.warmupRuns && config.readyFile && config.startFile) {
      await fs.writeFile(config.readyFile, new Date().toISOString());
      const deadline = Date.now() + 300000;
      while (true) {
        try { await fs.access(config.startFile); break; } catch {}
        assert(Date.now() < deadline, 'Measurement start barrier timed out');
        await new Promise(resolve => setTimeout(resolve, 50));
        abort.signal.throwIfAborted();
      }
    }
    const start = performance.now();
    let firstUpdateMs = null;
    const memoryBefore = process.memoryUsage();
    const result = await provider.generate([{ role: 'user', content: config.prompt }], update => {
      if (firstUpdateMs === null && update) firstUpdateMs = performance.now() - start;
    },
      { signal: abort.signal, maxOutputTokens: config.maxOutputTokens });
    const wallMs = performance.now() - start;
    assert.equal(result.modelIdentity, model.identity);
    const t = result.timing, count = t.generatedTokenCount;
    assert(count > 1 && t.decodeMs > 0 && t.prefillMs > 0);
    assert.equal(t.reusedPrefixTokens, 0, 'Fresh-prefix measurements must not reuse a context');
    const row = { run: i, warmup: i < config.warmupRuns, startedAtMs: performance.timeOrigin + start,
      endedAtMs: performance.timeOrigin + performance.now(), wallMs, timing: t, completion: result.completion,
      firstUpdateMs, memoryBefore, memoryAfter: process.memoryUsage(), resourceUsage: process.resourceUsage(),
      hardware: provider.getState().hardware,
      expectedAnswerMatched: correct(result.content),
      answer: result.content, answerSha256: sha(result.content),
      decodeTokensPerSecond: (count - 1) * 1000 / t.decodeMs,
      prefillTokensPerSecond: t.prefillComputedTokens * 1000 / t.prefillMs,
      requestTokensPerSecond: count * 1000 / wallMs };
    report.rows.push(row); await save(); console.log(JSON.stringify({ run: i, warmup: row.warmup, count, decodeTokensPerSecond: row.decodeTokensPerSecond }));
  }
  report.repeatableOutput = new Set(report.rows.map(row => row.answerSha256)).size === 1;
  assert(report.repeatableOutput, 'Greedy output changed between identical requests');
  report.passed = true;
} catch (error) { report.failure = String(error); process.exitCode = 1; }
finally {
  try { await provider.close(); await service.closeAll(); await gpu.close(); report.cleanup = 'settled'; }
  catch (error) { report.passed = false; report.cleanupFailure = String(error); process.exitCode = 1; }
  await save(); console.log(JSON.stringify({ passed: report.passed, failure: report.failure, cleanup: report.cleanup }));
}
