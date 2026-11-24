#!/usr/bin/env node
/**
 * The harness-owned entry on a Stage 1 host. `--control` performs one operation and exits; `--session` stays up over
 * JSON lines and exits when its standard input closes. Requests arrive on standard input, including credentials.
 */
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import catalog from '../../shared/config/chat-models.json' with { type: 'json' };
import { createPeerIdFromPublicJwk } from '../../packages/reploid/src/artifacts/identity.js';
import { measureDirectoryBytes, measureHeldRanges } from './inventory.js';
import { assertCompleteCopy, deleteFullCopy, killExactProcess, parseMemoryPressure, processStart, scanHostWeights, serviceAction } from './host-control.js';
import { claimsMemory, classifySoloFailure } from './solo-failure.js';
import { STAGE1_MODEL_ID } from './expectations.js';

const STAGE1_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

/** Identifies the harness code itself, so a host running other code is refused before it does anything. */
export async function harnessDigest(directory = STAGE1_DIRECTORY) {
  const hash = createHash('sha256');
  for (const name of (await fs.readdir(directory)).filter(file => file.endsWith('.js')).sort()) {
    hash.update(name).update('\0').update(await fs.readFile(path.join(directory, name))).update('\0');
  }
  return 'sha256:' + hash.digest('hex');
}

/** The persistent enrolled identity. It must already exist: enrollment is an operator step, not a side effect. */
export async function readHostIdentity(file) {
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat?.isFile() || (stat.mode & 0o077) !== 0) throw Object.assign(Error('identity-unavailable: a private identity file is required'), { code: 'identity-unavailable' });
  const identity = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!identity.privateJwk || await createPeerIdFromPublicJwk(identity.publicJwk) !== identity.peerId) {
    throw Object.assign(Error('identity-unavailable: the identity file is invalid'), { code: 'identity-unavailable' });
  }
  return identity;
}

/** What only a real host does. Nothing here runs at import, and the GPU binding loads only inside these calls. */
export function realHostPorts() {
  return {
    measure: measureHeldRanges,
    readPressure: () => fs.readFile('/proc/pressure/memory', 'utf8'),
    service: request => serviceAction(request),
    async openParticipant({ stageIndex, identity, config }) {
      const [{ createNativeGpuHost }, { openStage1Participant }] = await Promise.all([import('../../server/native-gpu-host.js'), import('./stage-participant.js')]);
      const gpu = createNativeGpuHost(() => import('webgpu'));
      const participant = await openStage1Participant({ stageIndex, identity, config, nativeGpu: () => gpu.open() });
      return { ...participant, async close() { try { await participant.close(); } finally { await gpu.close(); } return {}; } };
    },
    async loadSolo({ model, directory, messages, maxOutputTokens, signal }) {
      const [{ createNativeGpuHost }, { createNativeWholeModel }, partitions] = await Promise.all([import('../../server/native-gpu-host.js'),
        import('../../server/native-whole-model.js'), import('dopplerx/partitions')]);
      const gpu = createNativeGpuHost(() => import('webgpu'));
      const whole = createNativeWholeModel({ model, modelDirectory: directory, nativeGpu: () => gpu.open() });
      const stop = () => { whole.stop().catch(() => {}); };
      signal.addEventListener('abort', stop, { once: true });
      const mark = (error, during) => Object.assign(error, { stage1During: during, stage1Memory: partitions.inspectDeviceMemory() });
      try {
        try { await whole.contribute(true); } catch (error) { throw mark(error, 'whole-model-load'); }
        signal.throwIfAborted();
        try { await whole.generate(messages, () => {}, { signal, settings: { maxOutputTokens } }); } catch (error) { throw mark(error, 'generation'); }
      } finally {
        signal.removeEventListener('abort', stop);
        await whole.close().catch(() => {});
        await gpu.close().catch(() => {});
      }
    }
  };
}

export function createControlOperations(ports) {
  return {
    'scan-weights': body => scanHostWeights({ ...body, measure: ports.measure }),
    'delete-full-copy': body => deleteFullCopy(body),
    'directory-bytes': ({ directories }) => measureDirectoryBytes(directories),
    'memory-pressure': async () => parseMemoryPressure(await ports.readPressure()),
    kill: ({ pid, startId }) => killExactProcess({ pid, startId, ...(ports.killPorts ?? {}) }),
    async 'process-state'({ pid, startId }) {
      const current = await (ports.killPorts?.readStart ?? processStart)(pid);
      return { running: current !== null && current === startId };
    },
    service: body => ports.service(body)
  };
}

/** One whole-model attempt in this process. The stop reason decides what a failure shows, so it is recorded first. */
export async function runSoloLoad({ body, ports, controls }) {
  const model = catalog.find(row => row.id === STAGE1_MODEL_ID);
  const { directory, messages, maxOutputTokens, settings, requiredBytes, pressure, timeoutMs } = body;
  const budgetBytes = model.loadOptions?.runtimeConfig?.shared?.bufferPool?.budget?.maxTotalBytes ?? null;
  const controller = new AbortController();
  let stop = null;
  const halt = reason => { stop ??= reason; controller.abort(Error(`Solo control stopped: ${reason}`)); };
  controls.abort = () => halt('guard');
  const timer = setTimeout(() => halt('timeout'), timeoutMs);
  const poll = pressure ? setInterval(async () => {
    try { if (!(parseMemoryPressure(await ports.readPressure()).avg10 <= pressure.maxAvg10)) halt('memory-pressure'); }
    catch { halt('memory-pressure'); }
  }, pressure.pollMs) : null;
  try {
    await (ports.assertCopy ?? assertCompleteCopy)({ directory, expectedIdentity: model.identity });
    await ports.loadSolo({ model, directory, messages, maxOutputTokens, signal: controller.signal });
    if (stop) throw Error('Solo control stopped');
    return { outcome: 'completed', settings };
  } catch (error) {
    const failure = classifySoloFailure(error, { stop, requiredBytes, budgetBytes });
    return { outcome: 'failed', settings, failure, claimedFailure: claimsMemory(failure) ? 'memory' : null };
  } finally { clearTimeout(timer); clearInterval(poll); controls.abort = null; }
}

async function prepareWitness(config) {
  if (config.stageIndex === null) return config;
  const bytes = Buffer.from(config.fixtureBase64, 'base64');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== config.fixtureSha256) throw Error('The reference fixture changed in transit');
  await fs.mkdir(config.stateDirectory, { recursive: true, mode: 0o700 });
  const fixtureFile = path.join(config.stateDirectory, `reference-${sha256}.json`);
  await fs.writeFile(fixtureFile, bytes, { mode: 0o600 });
  return { ...config, witness: { ...config.witness, fixtureFile, fixtureSha256: sha256,
    receiptFile: path.join(config.stateDirectory, `witness-${config.witness.threadId}.json`) } };
}

export function createSessionOperations(ports) {
  let identity = null, participant = null, witnessFile = null;
  const controls = { abort: null };
  const live = () => { if (!participant) throw Error('The participant is not open'); return participant; };
  return {
    async identity({ file }) {
      identity = await readHostIdentity(file);
      return { participantId: identity.peerId, publicJwk: identity.publicJwk };
    },
    async open(body) {
      if (!identity) throw Error('Identity must be loaded first');
      const config = await prepareWitness(body);
      witnessFile = config.witness?.receiptFile ?? null;
      participant = await ports.openParticipant({ stageIndex: config.stageIndex, identity, config });
      return { assignedLayers: participant.assignedLayers() };
    },
    state: () => live().state(),
    activity: () => live().activity(),
    'assigned-layers': () => ({ assignedLayers: live().assignedLayers() }),
    'arm-gate': body => live().armGate(body),
    'gate-state': body => live().gateState(body),
    progress: () => live().progress(),
    cancel: () => live().cancel(),
    trace: body => live().trace(body),
    generate: body => live().generate(body),
    async witness() { return JSON.parse(await fs.readFile(witnessFile, 'utf8')); },
    solo: body => runSoloLoad({ body, ports, controls }),
    'abort-solo': () => { controls.abort?.(); return { aborted: Boolean(controls.abort) }; },
    async close() { const open = participant; participant = null; await open?.close(); return {}; }
  };
}

const reply = (output, value) => output.write(JSON.stringify(value) + '\n');
const failure = error => ({ error: String(error?.message ?? error), ...(error?.code ? { code: String(error.code) } : {}) });

export async function runHostAgent({ mode, input = process.stdin, output = process.stdout, ports = realHostPorts(), startId = null,
  exit = code => process.exit(code), settleMs = 10000 }) {
  if (mode === '--control') {
    const chunks = [];
    for await (const chunk of input) chunks.push(chunk);
    try {
      const { op, body } = JSON.parse(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8'));
      const operation = createControlOperations(ports)[op];
      if (!operation) throw Error('Unknown host control operation');
      reply(output, { result: await operation(body ?? {}) });
    } catch (error) { reply(output, failure(error)); }
    return;
  }
  if (mode !== '--session') throw Error('Usage: host-agent.js --control | --session');
  const operations = createSessionOperations(ports), running = new Set();
  reply(output, { event: 'agent', pid: process.pid, startId: startId ?? await processStart(process.pid), harnessDigest: await harnessDigest() });
  for await (const line of createInterface({ input })) {
    const task = (async () => {
      let request;
      try {
        request = JSON.parse(line);
        const operation = operations[request.op];
        if (!operation) throw Error('Unknown host session operation');
        reply(output, { id: request.id, result: (await operation(request.body ?? {})) ?? {} });
      } catch (error) { reply(output, { id: request?.id, ...failure(error) }); }
    })();
    running.add(task); task.finally(() => running.delete(task));
  }
  // The operator is gone or finished. Nothing it started on this machine outlives it: a solo load owns its own model
  // and GPU, released only when that load settles, so wait (bounded) for every running operation as well as the close.
  operations['abort-solo']();
  await Promise.race([Promise.allSettled([...running, operations.close()]), new Promise(resolve => setTimeout(resolve, settleMs).unref())]);
  exit(0);
}

const entered = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (entered) await runHostAgent({ mode: process.argv[2] });
