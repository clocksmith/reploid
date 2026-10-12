import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import * as provider from 'webgpu';
import { configureDeviceMemoryBudget, inspectDeviceMemory } from 'doppler-gpu/partitions';
import { getDevice, destroyBufferPool, captureMemorySnapshot } from 'doppler-gpu/tooling';
import { doppler } from 'doppler-gpu/compat';

const repo = '/home/x/deco/reploid';
const fixture = JSON.parse(await fs.readFile(new URL('input.json', import.meta.url), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const expectedArchive = '7449618b1e3cf2b96ec18a2f30aa14ddf56c787ce9b871e535df7a9b107b367a';
const receipt = {
  startedAt: new Date().toISOString(), kind: 'Unsplit diagnostic: accepted archive plus bounded RoPE, buffer reuse, and hybrid KV allocation repairs; not source-model reference',
  parentArchiveSha256: fixture.archiveSha256, archiveSha256: sha(await fs.readFile('/var/tmp/doppler-allocation-v3-accepted-base.tgz')),
  fixture, cases: [], node: process.version, consumer: process.cwd(), cleanup: [],
};
if (receipt.archiveSha256 !== expectedArchive) throw new Error('Diagnostic archive identity mismatch');
receipt.providerPackage = JSON.parse(await fs.readFile(new URL('node_modules/webgpu/package.json', import.meta.url), 'utf8'));
const save = () => fs.writeFile(new URL('allocation-v3-result.json', import.meta.url), JSON.stringify(receipt, null, 2));
let session;
const saved = new Map(Object.keys(provider.globals).concat('navigator').map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
try {
  if (globalThis.navigator?.gpu) throw new Error('Refusing to replace another GPU owner');
  Object.assign(globalThis, provider.globals);
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu: provider.create(['backend=vulkan']) } });
  await configureDeviceMemoryBudget({ maxBytes: 1420000000 });
  const policy = JSON.parse(await fs.readFile(repo + '/self/config/partition-policy.json', 'utf8'));
  const catalog = JSON.parse(await fs.readFile(repo + '/self/config/chat-models.json', 'utf8'));
  const model = (Array.isArray(catalog) ? catalog : catalog.models).find(row => row.id === 'qwen-3-5-0-8b-q4k-ehaf16');
  const { resolvePartitionGeneration } = await import(pathToFileURL(repo + '/self/config/partition-generation.js'));
  receipt.generation = resolvePartitionGeneration(model);
  const modelPath = '/home/x/deco/doppler/models/local/qwen-3-5-0-8b-q4k-ehaf16/';
  receipt.manifestSha256 = sha(await fs.readFile(modelPath + 'manifest.json'));
  session = await doppler.open({ url: pathToFileURL(modelPath).href }, { cache: false, runtimeConfig: {
    shared: { bufferPool: policy.bufferPool, debug: { profiler: { enabled: false } } },
    inference: { session: { kvcache: { maxSeqLen: receipt.generation.maxSeqLen } }, prefillChunkLayers: policy.prefillChunkLayers, prefillTokenChunkSize: policy.prefillTokenChunkSize },
  } });
  receipt.adapterInfo = getDevice().adapterInfo;
  receipt.openMemory = inspectDeviceMemory();
  await save();
  for (const row of fixture.cases) {
    session.resetGenerationState();
    const promptTokenIds = Array.from(session.advanced.tokenizePrompt({ messages: row.messages }, { useChatTemplate: receipt.generation.useChatTemplate }));
    const startedAt = new Date().toISOString();
    receipt.pending = { id: row.id, startedAt, promptTokenIds };
    await save();
    const result = await session.generate({ messages: row.messages }, receipt.generation);
    receipt.cases.push({ id: row.id, startedAt, finishedAt: new Date().toISOString(), promptTokenIds, result,
      matchesMesh: result.outputText === row.meshOutput, memory: inspectDeviceMemory() });
    delete receipt.pending;
    await save();
  }
  receipt.executionPass = true;
} catch (error) {
  receipt.executionPass = false;
  receipt.error = error.stack;
  receipt.failureMemory = inspectDeviceMemory();
  receipt.failureStats = session?.advanced.getStats();
  receipt.failureSnapshot = captureMemorySnapshot();
} finally {
  const cleanupErrors = [];
  try { await session?.close(); receipt.cleanup.push('session closed'); } catch (error) { cleanupErrors.push(error.stack); }
  // This public tooling import resolves from the diagnostic consumer, never the checkout pin.
  const device = getDevice();
  if (device) {
    try { await device.queue.onSubmittedWorkDone(); receipt.cleanup.push('candidate queue settled'); } catch (error) { cleanupErrors.push(error.stack); }
    try { destroyBufferPool(device); receipt.cleanup.push('candidate buffer pool destroyed'); } catch (error) { cleanupErrors.push(error.stack); }
    try { device.destroy(); receipt.cleanup.push('candidate device destroyed'); } catch (error) { cleanupErrors.push(error.stack); }
  }
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
  receipt.cleanup.push('owned provider globals restored');
  receipt.settled = cleanupErrors.length === 0;
  receipt.cleanupErrors = cleanupErrors;
  receipt.finishedAt = new Date().toISOString();
  await save();
}
console.log(JSON.stringify({ executionPass: receipt.executionPass, settled: receipt.settled, error: receipt.error, cases: receipt.cases.map(row => ({ id: row.id, output: row.result.outputText, matchesMesh: row.matchesMesh })) }));
if (!receipt.executionPass || !receipt.settled) throw new Error('Diagnostic failed; see retained receipt');
