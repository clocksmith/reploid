// Fresh application-quality comparison through the installed browser delivery.
// This never edits production sampling or protected acceptance fixtures.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { physicalWebGpuBrowserOptions } from './physical-webgpu-browser.js';
import { routeDiagnosticModel } from './capacity-observer.js';
import { resolveGenerationOptions } from '../../self/config/doppler-generation-contract.js';

const [destination, suitePath] = process.argv.slice(2);
assert(destination && process.env.DOPPLER_CHAT_MODEL_DIR, 'Supply report path and DOPPLER_CHAT_MODEL_DIR');
const root = resolve(new URL('../../', import.meta.url).pathname);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const suiteBytes = await readFile(suitePath || new URL('./chat-task-quality.json', import.meta.url));
const suite = JSON.parse(suiteBytes);
const profile = JSON.parse(await readFile(resolve(root, 'self/config/work-profile.json')));
const policy = JSON.parse(await readFile(resolve(root, 'self/config/partition-policy.json')));
const selected = JSON.parse(await readFile(resolve(root, 'self/config/chat-models.json'))).find(m => m.id === suite.modelId);
assert(selected);
const generation = resolveGenerationOptions({ ...profile.generation, ...policy.generation, maxSeqLen: policy.maxSeqLen });
const pin = JSON.parse(await readFile(resolve(root, 'self/config/doppler-package.json')));
const archive = await readFile(resolve(root, pin.spec.slice(5)));
const manifestBytes = await readFile(resolve(process.env.DOPPLER_CHAT_MODEL_DIR, 'manifest.json'));
assert.equal('sha256:' + hash(manifestBytes), selected.identity);
const eosTokenIds = [JSON.parse(manifestBytes).eos_token_id].flat();
const report = { schema: 'reploid.chat-task-quality-result/v1', scope: suite.scope, qualified: false,
  suiteSha256: hash(suiteBytes), producerSha256: hash(await readFile(new URL(import.meta.url))),
  package: pin, archiveSha256: hash(archive), modelIdentity: selected.identity, eosTokenIds, results: [] };
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html>'); return; }
    const file = resolve(root, 'self', '.' + pathname);
    assert(file.startsWith(resolve(root, 'self') + '/'));
    response.setHeader('Content-Type', { '.js': 'text/javascript', '.json': 'application/json', '.wgsl': 'text/plain' }[extname(file)] || 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
let browser, modelServer;
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  process.env.REPLOID_MODEL_PORT = '0';
  ({ server: modelServer } = await import('./numerical-model-server.js'));
  if (!modelServer.listening) await once(modelServer, 'listening');
  browser = await chromium.launch(physicalWebGpuBrowserOptions(process.platform));
  report.browser = browser.version(); report.platform = process.platform;
  const context = await browser.newContext();
  await routeDiagnosticModel(context, selected, process.env.DOPPLER_CHAT_MODEL_DIR, `http://127.0.0.1:${modelServer.address().port}/`);
  const page = await context.newPage();
  await page.exposeFunction('retainQualityResult', async row => {
    const task = suite.cases.find(item => item.id === row.id);
    const normalize = value => value.trim().replace(/\s+/g, ' ');
    const variant = suite.variants.find(item => item.id === row.variant);
    row.exactText = normalize(variant.templateThinking ? row.result.finalAnswer : row.result.evidence.outputText)
      === normalize(task.expected);
    row.naturalStop = ['stop-token', 'stop-token-or-sequence'].includes(row.result.evidence.stats.stopReason)
      && eosTokenIds.includes(row.result.evidence.stats.stopTokenId);
    row.passed = row.exactText && row.naturalStop;
    report.results.push(row);
    await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ id: row.id, variant: row.variant, passed: row.passed,
      text: row.result.evidence.outputText, stopReason: row.result.evidence.stats.stopReason }));
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  report.memory = await page.evaluate(async ({ suite, selected, generation, policy }) => {
    const config = await import('/config/doppler-local-models.js');
    globalThis.__DOPPLER_KERNEL_BASE_PATH__ = config.DOPPLER_KERNEL_BASE_URL;
    const runtime = await import(config.DOPPLER_PARTITIONS_MODULE_URL);
    const { load } = await import(config.DOPPLER_MODULE_URL);
    const { formatChatMessages } = await import(new URL('./inference/pipelines/text/chat-format.js', new URL(config.DOPPLER_MODULE_URL, location.href)).href);
    const { createHttpArtifactStorageContext } = await import(new URL('./storage/artifact-storage-context.js', new URL(config.DOPPLER_MODULE_URL, location.href)).href);
    const bytes = await (await fetch(selected.source.baseUrl + 'manifest.json')).arrayBuffer();
    const identity = 'sha256:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    if (identity !== selected.identity) throw Error('Model identity mismatch');
    const manifestText = new TextDecoder().decode(bytes), manifest = JSON.parse(manifestText);
    await runtime.configureDeviceMemoryBudget({ maxBytes: suite.maxGpuBufferBytes });
    let handle;
    try {
      handle = await load({ manifest, manifestText, manifestHash: identity.slice(7), baseUrl: selected.source.baseUrl,
        storage: createHttpArtifactStorageContext(selected.source.baseUrl, manifest, { verifyHashes: true }) },
      { runtimeConfig: { shared: { bufferPool: policy.bufferPool }, inference: { session: {
        kvcache: { maxSeqLen: generation.maxSeqLen }, prefillChunkLayers: policy.prefillChunkLayers,
        prefillTokenChunkSize: policy.prefillTokenChunkSize } } } });
      for (const variant of suite.variants) for (const task of suite.cases) {
        const messages = [
          ...(variant.instruction ? [{ role: 'system', content: variant.instruction }] : []),
          { role: 'user', content: task.prompt },
        ];
        const settings = { ...generation, repetitionPenalty: variant.repetitionPenalty };
        const renderedPrompt = variant.templateThinking
          ? formatChatMessages(messages, manifest.inference.chatTemplate.type, { thinking: true }) : null;
        const tokenIds = renderedPrompt === null ? handle.advanced.tokenizePrompt(messages, settings)
          : handle.advanced.tokenizeText(renderedPrompt);
        const { maxSeqLen, ...options } = settings;
        const evidence = await handle.generateWithEvidence('', { ...options, inputIds: tokenIds, disableCommandBatching: true });
        let finalAnswer = evidence.outputText;
        if (variant.templateThinking) {
          // Diagnostic channel split only. Preserve raw output and every token;
          // application streaming must qualify its own channel handling.
          const marker = handle.advanced.tokenizeText('</think>');
          if (marker.length !== 1) throw Error('Reasoning diagnostic requires a single closing marker');
          const boundary = evidence.tokenIds.indexOf(marker[0]);
          finalAnswer = boundary < 0 ? '' : handle.advanced.decodeTokens(evidence.tokenIds.slice(boundary + 1));
        }
        await globalThis.retainQualityResult({ id: task.id, variant: variant.id,
          input: { messages, generation: settings, ...(renderedPrompt === null ? {} : { renderedPrompt, templateThinking: true }) },
          result: { tokenIds, evidence, ...(variant.templateThinking ? { finalAnswer } : {}) } });
      }
    } finally { await handle?.unload(); }
    return runtime.inspectDeviceMemory();
  }, { suite, selected, generation, policy });
  report.variantResults = suite.variants.map(variant => {
    const rows = report.results.filter(row => row.variant === variant.id);
    return { id: variant.id, passed: rows.length === suite.cases.length && rows.every(row => row.passed) };
  });
} catch (error) {
  report.failure = { name: error.name, message: error.message }; process.exitCode = 1;
} finally {
  await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  for (const owned of [server, modelServer].filter(Boolean)) {
    owned.closeAllConnections(); await new Promise(done => owned.close(done));
  }
}
