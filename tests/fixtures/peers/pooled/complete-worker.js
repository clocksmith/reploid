// Operator-local peer adapter. Importing this entry is a model execution request.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyPeerRuntime } from './runtime-identity.js';
import { runPooledCompleteRequest } from './complete-request.js';
import { closeOwnedPeerRoom } from './close-owned-room.js';
import { serveCompleteRequestProtocol } from '../../complete-request-protocol.js';

const config = JSON.parse(await fs.readFile(process.argv[2]));
assert(config.sdk && config.source && config.models && config.webgpuModule && config.memoryObserver
  && config.provenance && config.out && (config.protocol === true || config.cases?.length), 'Explicit frozen peer configuration required');
const result = { started: new Date().toISOString(), scope: 'Selected unmodified peer SDK with public complete-request timing', cases: [] };
const write = () => fs.writeFile(config.out, JSON.stringify(result, null, 2));
// Inventory before any SDK or native addon import, again after import and close.
result.provenanceBefore = await verifyPeerRuntime(config.provenance);
const { createRoom } = await import(pathToFileURL(config.sdk));
const { makeSampler } = await import(pathToFileURL(path.join(config.source, 'room/sampling.js')));
const { createGpuMemoryObserver } = await import(pathToFileURL(config.memoryObserver));
result.provenanceAfterImport = await verifyPeerRuntime(config.provenance);
const observer = createGpuMemoryObserver(config.gpuCapGB * 2 ** 30);
result.gpuMemory = observer.stats;
const abort = new AbortController();
const cancel = () => abort.abort(new Error('Owned peer process cancelled'));
process.once('SIGTERM', cancel); process.once('SIGINT', cancel);
async function memoryGuard() {
  if (process.platform !== 'linux') return;
  const text = await fs.readFile('/proc/meminfo', 'utf8');
  const available = Number(text.match(/^MemAvailable:\s+(\d+)/mu)?.[1]) * 1024;
  if (!Number.isFinite(available) || available < config.minAvailableGiB * 2 ** 30) {
    abort.abort(new Error('Peer host memory reserve exceeded'));
  }
}
let room;
const ownedGpus = new Set();
const timer = setInterval(() => { memoryGuard().catch(error => abort.abort(error)); }, 1000);
timer.unref();
async function open() {
  assert(!room, 'Peer model already opened');
  await memoryGuard(); abort.signal.throwIfAborted();
  room = await createRoom({ model: 'qwen3.8-flash', name: config.name, pledgeGB: config.gpuGB,
    ramGB: config.ramGB, expertDisk: true, signal: config.signal, modelDir: config.models, ctx: config.ctx,
    autoRedeal: false, ckpt: false, allowApi: false, relay: false, split: 'memory', gate: true,
    setup: { webgpu: async () => {
      const module = await import(pathToFileURL(config.webgpuModule));
      return { ...module, create(flags) {
        const gpu = module.create(flags), requestAdapter = gpu.requestAdapter.bind(gpu);
        ownedGpus.add(gpu);
        gpu.requestAdapter = async options => {
          const adapter = await requestAdapter(options);
          if (!adapter) return adapter;
          const requestDevice = adapter.requestDevice.bind(adapter);
          adapter.requestDevice = async descriptor => {
            const device = observer.attach(await requestDevice(descriptor)), createBuffer = device.createBuffer.bind(device);
            device.createBuffer = buffer => {
              const bytes = Math.ceil(Number(buffer.size) / 4) * 4;
              assert(Number.isSafeInteger(bytes) && bytes >= 0
                && observer.stats.liveBytes + bytes <= observer.stats.capBytes, 'Peer GPU allocation exceeds frozen ceiling');
              return createBuffer(buffer);
            };
            return device;
          };
          return adapter;
        };
        return gpu;
      } };
    } }, log: console.error });
  const started = performance.now();
  await room.start('qwen3.8-flash', { minDevices: config.minDevices, waitMs: 180000 });
  result.loadMs = performance.now() - started; result.split = room.split;
  assert.deepEqual(result.split?.ranges, config.expectedRanges, 'Peer placement differs from the frozen request');
  return { loadMs: result.loadMs, split: result.split };
}
async function requestOutput(request) {
  assert(room, 'Peer model is not open');
  await memoryGuard(); abort.signal.throwIfAborted();
  const row = await runPooledCompleteRequest({ room, makeSampler, ...request,
    timeoutMs: config.requestTimeoutMs, signal: abort.signal });
  assert.equal(observer.stats.errors.length, 0, 'Peer GPU errors invalidate the result');
  const output = { ...row, name: request.name, repeat: request.repeat,
    memory: { process: process.memoryUsage(), device: structuredClone(observer.stats) },
    expertStats: { ...room.ai.engine?.experts?.stats },
    diskReaderStats: { ...room.ai.engine?.experts?.reader?.stats } };
  result.cases.push(output);
  return output;
}
let closing;
function close() {
  if (!closing) closing = (async () => {
    clearInterval(timer);
    await closeOwnedPeerRoom(room, ownedGpus); room = null;
    result.provenanceAfterClose = await verifyPeerRuntime(config.provenance);
    result.cleanup = 'settled';
    result.finished = new Date().toISOString();
    await write();
    process.removeListener('SIGTERM', cancel); process.removeListener('SIGINT', cancel);
    return result;
  })();
  return closing;
}
if (config.protocol === true) {
  await serveCompleteRequestProtocol({ onClose: close, async invoke(request) {
    if (request.op === 'open') return open();
    if (request.op === 'request') return requestOutput(request);
    if (request.op === 'receipts') return { gpuMemory: structuredClone(observer.stats) };
    if (request.op === 'close') return close();
    throw new Error('Unknown peer diagnostic operation');
  } });
} else {
  try {
    await open();
    for (const request of config.cases) { await requestOutput(request); await write(); }
  } catch (error) { result.error = String(error.stack ?? error); process.exitCode = 1; }
  finally {
    try { await close(); }
    catch (error) { result.cleanupError = String(error.stack ?? error); process.exitCode = 1; await write(); }
  }
}
