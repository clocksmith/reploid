/** Browser-only numerical diagnosis with installed package and exact model bytes.
 * Direct local file serving is diagnostic evidence, not peer-acquisition proof. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { observeBrowserNumerics } from './browser-numerical-observer.js';
const reference = JSON.parse(await readFile(process.env.DOPPLER_PARTITION_REFERENCE_OUT, 'utf8'));
const output = process.env.REPLOID_CAPTURE_OUT;
assert(output, 'REPLOID_CAPTURE_OUT is required');
const remote = process.env.REPLOID_EXECUTOR_WS;
const browser = remote ? await chromium.connect(remote) : await chromium.launch({ headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
let context;
try {
  context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', error => console.error(error.message));
  await page.goto('http://localhost:8000/config/chat-files.json');
  const observer = await observeBrowserNumerics(page, 'node_modules/doppler-gpu', { countEmbeddings: true });
  const result = await page.evaluate(async reference => {
    const config = await import('/config/doppler-local-models.js');
    const base = new URL(config.DOPPLER_PARTITIONS_MODULE_URL, location.href);
    globalThis.__DOPPLER_KERNEL_BASE_PATH__ = config.DOPPLER_KERNEL_BASE_URL;
    const { createPipeline } = await import(new URL('./inference/pipelines/text.js', base));
    const { createHttpArtifactStorageContext } = await import(new URL('./storage/artifact-storage-context.js', base));
    const source = 'http://127.0.0.1:9230/';
    const bytes = await (await fetch(source + 'manifest.json')).arrayBuffer();
    const identity = 'sha256:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    if (identity !== reference.modelIdentity) throw Error('Diagnostic manifest mismatch');
    const manifest = JSON.parse(new TextDecoder().decode(bytes));
    const pipeline = await createPipeline(manifest, { runtimeConfig: {
      inference: { session: { kvcache: { maxSeqLen: reference.generation.maxSeqLen } } } },
      storage: createHttpArtifactStorageContext(source, manifest, { verifyHashes: true }) });
    const runs = [];
    try {
      for (let prompt = 0; prompt < reference.prompts.length; prompt++) {
        numericalObservation.prompt = prompt; numericalObservation.step = -1;
        let text = '';
        for await (const delta of pipeline.generate(reference.prompts[prompt], reference.generation)) text += delta;
        runs.push({ prompt, text });
      }
      const info = (await navigator.gpu.requestAdapter()).info;
      return { surface: 'browser', packageVersion: config.DOPPLER_PACKAGE_VERSION, modelIdentity: identity,
        generation: reference.generation, prompts: reference.prompts, observation: 'read-only last-row copies at existing probes; diagnostic flags unchanged',
        memoryScope: 'whole-model diagnostic without the cooperative allocation cap; not capacity evidence',
        adapter: info && { vendor: info.vendor, architecture: info.architecture, description: info.description }, runs };
    } finally { await pipeline.unload(); }
  }, reference);
  const observation = await observer.read();
  assert.deepEqual(observation.errors, []);
  assert(observation.records.length > 0, 'No browser probe records captured');
  assert(observation.records.every(record => record.data && !record.error), 'Incomplete browser tensor captures');
  for (const run of result.runs) run.logits = observation.records.filter(record => record.prompt === run.prompt && record.stage === 'logits').map(record => record.data);
  result.browser = browser.version(); result.platform = remote ? 'linux' : 'mac'; result.boundaries = observation.records;
  await writeFile(output, JSON.stringify(result));
  console.log(JSON.stringify({ output, records: observation.records.length, runs: result.runs.map(run => ({ text: run.text, steps: run.logits.length })) }));
  await observer.close();
} finally { await context?.close(); await browser.close(); }
