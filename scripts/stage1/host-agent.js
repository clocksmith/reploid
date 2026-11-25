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
import { createReceiptDraft, signReceiptDraft } from '../../packages/reploid/src/artifacts/receipt.js';
import { measureWholeModelReceipt } from '../../packages/reploid/src/artifacts/whole-model-receipt.js';
import { effectiveRequestDigest, normalizeGenerationSettings } from '../../packages/reploid/src/mesh/generation-settings.js';
import { measureDirectoryBytes, measureHeldRanges } from './inventory.js';
import { assertCompleteCopy, killExactProcess, lockDirectory, parseMemoryPressure, processStart, readMemoryPressureText, scanHostWeights, serviceAction,
  withinMemoryLimit } from './host-control.js';
import { claimsMemory, classifySoloFailure } from './solo-failure.js';
import { stageDirectoryOperation } from './build-stage-directory.js';
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

/** The commit an installed release root was made from (`RELEASE_SHA` beside `scripts/`), or null when it has none. */
export async function readReleaseSha(directory = STAGE1_DIRECTORY) {
  const text = await fs.readFile(path.join(directory, '..', '..', 'RELEASE_SHA'), 'utf8').catch(() => '');
  return /^[0-9a-f]{40}$/.test(text.trim()) ? text.trim() : null;
}

/** The persistent enrolled identity. It must already exist: enrollment is an operator step, not a side effect. */
export async function readHostIdentity(file, { ownerOnlyModes = Boolean(process.getuid) } = {}) {
  const stat = await fs.lstat(file).catch(() => null);
  // Windows reports no owner-only mode bits (server/fleet/computer-identity.js makes the same exception); the file's
  // access list is the operator's to set there.
  if (!stat?.isFile() || (ownerOnlyModes && (stat.mode & 0o077) !== 0)) throw Object.assign(Error('identity-unavailable: a private identity file is required'), { code: 'identity-unavailable' });
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
    readPressure: () => readMemoryPressureText(),
    service: request => serviceAction(request),
    async openParticipant({ stageIndex, identity, config }) {
      const [{ createNativeGpuHost }, { openStage1Participant }] = await Promise.all([import('../../server/native-gpu-host.js'), import('./stage-participant.js')]);
      const gpu = createNativeGpuHost(() => import('webgpu'));
      const participant = await openStage1Participant({ stageIndex, identity, config, nativeGpu: () => gpu.open() });
      return { ...participant, async close() { try { await participant.close(); } finally { await gpu.close(); } return {}; } };
    },
    /** The earning device: one whole model held open for the earn phase's requests. */
    async openWhole({ model, modelDirectory }) {
      const [{ createNativeGpuHost }, { createNativeWholeModel }] = await Promise.all([import('../../server/native-gpu-host.js'),
        import('../../server/native-whole-model.js')]);
      const gpu = createNativeGpuHost(() => import('webgpu'));
      const whole = createNativeWholeModel({ model, modelDirectory, nativeGpu: () => gpu.open() });
      await whole.contribute(true);
      return { runtime: 'native-whole-model',
        async generate({ messages, settings, signal }) {
          // The resident refuses a generation it cannot cancel; say so here, before the GPU is touched.
          if (!(signal instanceof AbortSignal)) throw TypeError('A whole-model generation needs an AbortSignal');
          const result = await whole.generate(messages, () => {}, { signal, ...(settings ? { settings } : {}) });
          return { ...result, modelIdentity: result.modelIdentity ?? model.identity, adapterIdentities: result.adapterIdentities ?? [] };
        },
        async close() { try { await whole.close(); } finally { await gpu.close(); } } };
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
    /** Which release and harness code this host runs; reads two small files, nothing else. */
    release: async () => ({ releaseSha: await (ports.releaseSha ?? readReleaseSha)(), harnessDigest: await (ports.harnessDigest ?? harnessDigest)() }),
    'lock-directory': body => lockDirectory(body),
    'directory-bytes': ({ directories }) => measureDirectoryBytes(directories),
    'memory-pressure': async () => parseMemoryPressure(await ports.readPressure()),
    kill: ({ pid, startId }) => killExactProcess({ pid, startId, ...(ports.killPorts ?? {}) }),
    async 'process-state'({ pid, startId }) {
      const current = await (ports.killPorts?.readStart ?? processStart)(pid);
      return { running: current !== null && current === startId };
    },
    service: body => ports.service(body),
    /** Builds this host's stage directory from its full copy, or checks an existing one against the pin. */
    'stage-directory': body => (ports.stageDirectory ?? stageDirectoryOperation)(body),
    /** The north-star plan's stage directory (edges-plan.js): ranges derived here from this host's own pinned files. */
    'edges-stage-directory': async body => (ports.edgesStageDirectory ?? (await import('./edges-plan.js')).edgesStageDirectory)(body)
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
    try { if (!withinMemoryLimit(parseMemoryPressure(await ports.readPressure()), pressure)) halt('memory-pressure'); }
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
  // The requester has no witness; neither has a middle stage of the north-star plan (`witness: null`).
  if (config.stageIndex === null || config.witness === null) return config;
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
  let identity = null, participant = null, witnessFile = null, whole = null;
  const controls = { abort: null };
  /** Each earn request in flight, by request ID: a close, the end of input or the operator's abort cancels it. */
  const serving = new Map();
  const abortServing = (requestId, reason) => {
    let aborted = 0;
    for (const [id, controller] of serving) {
      if (requestId !== null && id !== requestId) continue;
      if (!controller.signal.aborted) { controller.abort(reason); aborted += 1; }
    }
    return aborted;
  };
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
    diagnose: () => live().diagnose(),
    activity: () => live().activity(),
    'assigned-layers': () => ({ assignedLayers: live().assignedLayers() }),
    'arm-gate': body => live().armGate(body),
    'gate-state': body => live().gateState(body),
    progress: () => live().progress(),
    cancel: () => live().cancel(),
    disconnect: () => live().disconnect(),
    trace: body => live().trace(body),
    generate: body => live().generate(body),
    'generate-edges': body => live().generateEdges(body),
    visibility: body => live().visibility(body),
    async witness() { return JSON.parse(await fs.readFile(witnessFile, 'utf8')); },
    'settlement-records': body => live().settlementRecords(body),
    'accept-terms': body => live().acceptTerms(body),
    loaded: () => live().loaded(),
    solo: body => runSoloLoad({ body, ports, controls }),
    'abort-solo': () => { controls.abort?.(); return { aborted: Boolean(controls.abort) }; },
    /** The earning device opens a small catalog whole model; never the split model, never a partition. */
    async 'open-whole'({ modelId, modelDirectory }) {
      if (!identity) throw Error('Identity must be loaded first');
      const model = catalog.find(row => row.id === modelId && !row.partitionPlanId && row.id !== STAGE1_MODEL_ID);
      if (!model) throw Error('The earning model must be a whole-model catalog entry');
      whole = { model, served: await ports.openWhole({ model, modelDirectory }) };
      return { modelId: model.id, modelIdentity: model.identity, runtime: whole.served.runtime };
    },
    /**
     * One whole-model answer for `consumer`, measured and signed by this device; the buyer countersigns it. The
     * generation runs under this request's own signal: `abort-whole`, `close`, the end of input or `timeoutMs` stops it.
     */
    async 'serve-whole'({ requestId, consumer, messages, settings, timeoutMs = null }) {
      if (!whole) throw Error('No whole model is open');
      if (typeof requestId !== 'string' || !requestId || serving.has(requestId)) throw Error('An earn request needs a new request ID');
      if (timeoutMs !== null && (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)) throw Error('An earn request timeout must be a positive integer');
      const canonical = normalizeGenerationSettings(settings);
      const controller = new AbortController();
      serving.set(requestId, controller);
      const timer = timeoutMs === null ? null : setTimeout(() => controller.abort(Error('Earn request timed out on the host')), timeoutMs);
      let output;
      try {
        output = await whole.served.generate({ messages, settings: canonical, signal: controller.signal });
        controller.signal.throwIfAborted();
      } finally { clearTimeout(timer); serving.delete(requestId); }
      const bound = canonical ? { settingsDigest: await effectiveRequestDigest({ modelIdentity: whole.model.identity, adapterIdentities: [], messages, settings: canonical }) }
        : undefined;
      const measured = await measureWholeModelReceipt(messages, output, bound);
      if (!measured) throw Error('The whole-model answer has no measured completion');
      const receipt = await signReceiptDraft(await createReceiptDraft({ ...measured, provider: identity.peerId, consumer,
        model: whole.model.id, jobHash: `request:${requestId}` }), identity);
      return { content: output.content, receipt, runtime: whole.served.runtime };
    },
    /** Cancels one earn request, or every one when no ID is given. */
    'abort-whole': ({ requestId = null } = {}) => ({ aborted: abortServing(requestId, Error('Earn request stopped')) }),
    async close() {
      abortServing(null, Error('Closing'));
      const open = participant, served = whole?.served;
      participant = null; whole = null;
      await Promise.all([open?.close(), served?.close()]);
      return {};
    }
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
  operations['abort-whole']();
  await Promise.race([Promise.allSettled([...running, operations.close()]), new Promise(resolve => setTimeout(resolve, settleMs).unref())]);
  exit(0);
}

const entered = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (entered) await runHostAgent({ mode: process.argv[2] });
