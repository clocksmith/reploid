#!/usr/bin/env node
/** Native Node host for the same authenticated partition protocol as the browser.
 * No browser, model arithmetic, placement policy, or whole-request fallback lives here.
 */
export { createChatCompletions } from './chat-completions.js';
export { createResponses } from './responses.js';
export { createMessages } from './messages.js';

import fs from 'node:fs/promises';
import { createNativeModelFiles } from './native-model-files.js';
import { createCustodyKeyCertifier } from '../packages/reploid/src/artifacts/custody-certificate.js';
import { openNativeOwnerControls, nativeOwnerStatus, NO_OWNER_POLICY } from './native-owner/controls.js';
import { openNativeCanonicalEpochs } from './native-canonical-epochs.js';
import { openNativeReleaseCheckpoints } from './native-release-storage.js';
import { installedPackageDirectory, nativeShaderCacheIdentity, openNativeShaderCache } from './native-shader-cache.js';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createAutomaticPartitions, createLegacyGenerationMesh, createPartitionNetwork, createResidentPartition, createSignedResidentFactory, createPartitionStageCommitAuthority, residentPreparationProgress } from '../packages/reploid/src/mesh/index.js';
import { createSwarmTransport, createRoomIntroductionAdmission } from '../packages/reploid/src/transport/index.js';
import { createSigningIdentity, createPeerIdFromPublicJwk } from '../packages/reploid/src/artifacts/identity.js';
import { createAttemptEvidenceSigner } from '../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { resolveConfig } from '../packages/reploid/src/config/index.js';
import models from '../self/config/chat-models.json' with { type: 'json' };
import custodyPolicy from '../self/config/chat-files.json' with { type: 'json' };
import policy from '../self/config/partition-policy.json' with { type: 'json' };
import profile from '../self/config/reploid-library.json' with { type: 'json' };
import bootstrap from '../self/config/swarm-bootstrap.json' with { type: 'json' };
import dopplerPin from '../self/config/doppler-package.json' with { type: 'json' };
import { resolvePartitionGeneration } from '../self/config/partition-generation.js';
import { prepareLocalPackRelease } from '../self/pool/pack-release-policy.js';
import { snapshotWorkPartitionSelection, createWorkPartitionPlan,
  snapshotWorkPartitionStage, workOrderedResidentOptions, snapshotWorkOrderedParticipation, bindWorkOrderedParticipation } from '../self/host/work-partition-plan.js';
import { assertWorkResidentCapsule } from '../self/host/work-partition-capsule.js';
import { createPartitionTokenizerGuard } from '../self/host/work-partition-tokenizer-guard.js';

const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

/** CLI status only. Detailed receipts remain available through getState(); routine
 * notifications must not serialize signed artifact bodies or conversation text. */
export function summarizeNativePartitionState(state) {
  const text = (value, limit = 256) => typeof value === 'string'
    ? value.length > limit ? value.slice(0, limit) + '…' : value : null;
  const scalar = value => typeof value === 'string' ? text(value)
    : typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) ? value : null;
  const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined)
    .map(key => [key, scalar(value[key])]));
  const rows = (values, project) => {
    const entries = Array.isArray(values) ? values : [];
    return { count: entries.length, omitted: Math.max(0, entries.length - 16), records: entries.slice(0, 16).map(project) };
  };
  const placement = Array.isArray(state.placement) ? state.placement : [];
  const acquisition = state.acquisition;
  return { event: 'partition-state', phase: text(state.phase), error: text(state.error, 1024),
    offering: state.offering === true, modelId: text(state.modelId), unsettledOwners: scalar(state.unsettledOwners),
    progress: state.progress ? pick(state.progress, ['stage', 'phase', 'message', 'loaded', 'total', 'progress',
      'status', 'prepared', 'key', 'elapsedMs', 'startedAt', 'maxDurationMs', 'outstanding']) : null,
    placement: placement.slice(0, 16).map(value => text(value)), placementOmitted: Math.max(0, placement.length - 16),
    descriptor: state.descriptor ? { ...pick(state.descriptor, ['schema', 'modelId', 'modelIdentity', 'planId', 'index',
      'participantId', 'ready', 'residentWeightBytes', 'generationDigest', 'canonicalGenerationId']),
      layerRange: Array.isArray(state.descriptor.layerRange) ? state.descriptor.layerRange.slice(0, 2).map(scalar) : null } : null,
    reservations: state.reservations ? { ...pick(state.reservations, ['active', 'availableSlots', 'closed']),
      ...rows(state.reservations.records, record => ({ attemptId: text(record.identity?.attemptId),
        ...pick(record, ['phase', 'failure', 'reservedAt', 'settlingAt', 'settledAt']) })) } : null,
    attempts: rows(state.attempts, record => pick(record, ['attemptId', 'threadId', 'status', 'phase'])),
    acquisition: acquisition ? { openingMode: text(acquisition.openingMode),
      memory: pick(acquisition.memory, ['liveBytes', 'allocatedBytes', 'maxBytes', 'peakBytes', 'allocations', 'rejected', 'lost']),
      preparation: pick(acquisition.preparation, ['openMs', 'acquisitionAndMaterializationMs']) } : null };
}

const events = () => {
  const emitter = new EventEmitter();
  return { emit: (...args) => emitter.emit(...args), on(name, handler) {
    emitter.on(name, handler); return () => emitter.off(name, handler);
  } };
};

/** node-webrtc exposes UINT16_MAX for unspecified SCTP retransmission limits.
 * Normalize that provider representation at the host boundary, not in the
 * shared protocol's reliable-channel requirement. */
export function normalizeNativeDataChannel(channel) {
  for (const key of ['maxRetransmits', 'maxPacketLifeTime']) {
    if (channel[key] === 65535) Object.defineProperty(channel, key, { value: null, configurable: true });
  }
  normalizeNativeDrainEvents(channel);
  return channel;
}

/** wrtc 0.10 exposes bufferedAmount but no threshold or low-water event.
 * Poll only for an active drain waiter; protocol timeouts/cancellation remove
 * that waiter. Providers with the standard contract retain their own events. */
function normalizeNativeDrainEvents(channel) {
  if ('bufferedAmountLowThreshold' in channel || typeof channel.addEventListener !== 'function') return;
  const add = channel.addEventListener.bind(channel), remove = channel.removeEventListener.bind(channel);
  const send = channel.send.bind(channel);
  const waiters = new Map();
  let timer = null, previous = channel.bufferedAmount;
  Object.defineProperty(channel, 'bufferedAmountLowThreshold', { value: 0, writable: true, configurable: true });
  function stopTimer() { clearTimeout(timer); timer = null; }
  function removeWaiter(listener) {
    const entry = waiters.get(listener);
    if (!entry) return;
    waiters.delete(listener);
    remove('bufferedamountlow', entry.wrapper);
    entry.signal?.removeEventListener('abort', entry.abort);
    if (!waiters.size) stopTimer();
  }
  function schedule() {
    if (timer === null && waiters.size && channel.readyState === 'open') timer = setTimeout(poll, 16);
  }
  function poll() {
    timer = null;
    if (!waiters.size) return;
    if (channel.readyState !== 'open') { dispose(); return; }
    const current = channel.bufferedAmount;
    const crossed = previous > channel.bufferedAmountLowThreshold && current <= channel.bufferedAmountLowThreshold;
    previous = current;
    if (crossed) channel.dispatchEvent(new Event('bufferedamountlow'));
    if (current > channel.bufferedAmountLowThreshold) schedule();
  }
  function dispose() { stopTimer(); for (const listener of waiters.keys()) removeWaiter(listener); }
  channel.addEventListener = function(type, listener, options) {
    if (type !== 'bufferedamountlow') return add(type, listener, options);
    if (!listener || waiters.has(listener) || options?.signal?.aborted) return;
    const entry = { signal: options?.signal, abort: () => removeWaiter(listener), wrapper(event) {
      if (options?.once) removeWaiter(listener);
      if (typeof listener === 'function') listener.call(channel, event); else listener.handleEvent(event);
    } };
    waiters.set(listener, entry);
    add(type, entry.wrapper);
    entry.signal?.addEventListener('abort', entry.abort, { once: true });
    previous = channel.bufferedAmount;
    schedule();
  };
  channel.removeEventListener = function(type, listener, options) {
    if (type === 'bufferedamountlow') removeWaiter(listener); else remove(type, listener, options);
  };
  channel.send = function(...args) {
    const result = send(...args);
    if (channel.bufferedAmount > channel.bufferedAmountLowThreshold) { previous = channel.bufferedAmount; schedule(); }
    return result;
  };
  add('close', dispose); add('error', dispose);
}

export function createNativeRtcAdapter(rtc) {
  class RTCPeerConnection extends rtc.RTCPeerConnection {
    constructor(...args) {
      super(...args);
      this.addEventListener('datachannel', event => normalizeNativeDataChannel(event.channel));
    }
    createDataChannel(...args) { return normalizeNativeDataChannel(super.createDataChannel(...args)); }
  }
  return { ...rtc, RTCPeerConnection };
}

/** Read only complete authenticated pieces requested by Doppler's public reader. */
export async function openNativeModelSource({ model, modelDirectory, signal, runtime, files }) {
  if (files) return files.preparePartitionSource(model, { signal });
  const root = await fs.realpath(modelDirectory);
  const read = async (name, offset, size) => {
    signal?.throwIfAborted();
    requireValue(/^[a-zA-Z0-9_.-]+$/.test(name), 'Model file must be a plain filename');
    const filename = await fs.realpath(path.join(root, name));
    requireValue(path.dirname(filename) === root, 'Model file escapes its approved directory');
    const handle = await fs.open(filename, 'r');
    try {
      const stat = await handle.stat();
      requireValue(stat.isFile(), 'Model source must be a regular file');
      if (offset === undefined) return new Uint8Array(await handle.readFile());
      requireValue(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(size) && size > 0
        && offset + size <= stat.size, 'Model piece exceeds its file');
      const bytes = new Uint8Array(size);
      let received = 0;
      while (received < size) {
        signal?.throwIfAborted();
        const result = await handle.read(bytes, received, size - received, offset + received);
        requireValue(result.bytesRead > 0, 'Model piece read was truncated'); received += result.bytesRead;
      }
      signal?.throwIfAborted(); return bytes;
    } finally { await handle.close(); }
  };
  const manifestBytes = await read('manifest.json');
  requireValue(hash(manifestBytes) === model.identity, 'Native manifest differs from the approved catalog');
  const descriptor = model.source.files.find(row => row.role === 'model-piece-index');
  requireValue(descriptor?.hashAlgorithm === 'sha256', 'Native model requires a pinned piece index');
  // Catalog metadata is bundled with the application; the weight directory need
  // not contain a second hand-maintained copy of it.
  const indexBytes = descriptor.url?.startsWith('/config/model-pieces/')
    ? new Uint8Array(await fs.readFile(new URL('../self' + descriptor.url, import.meta.url)))
    : await read(descriptor.path);
  requireValue(hash(indexBytes) === 'sha256:' + descriptor.hash, 'Native piece index differs from the approved catalog');
  return runtime.createVerifiedPieceStorage({ manifestBytes, indexBytes, indexIdentity: 'sha256:' + descriptor.hash,
    signal, acquire: piece => read(piece.path, piece.offset, piece.size) });
}

/** The standalone host owns the Node provider and the only device in this
 * process. Final close follows resident settlement; stopping contribution alone
 * keeps the provider reusable. No private Doppler imports are needed. */
export function createNativeGpuHost(loadProvider) {
  let opening = null, closing = null, restore = null, retirement = null, stopped = false;
  let ownedDevice = null, lost = null, queueSettled = false, queueRejected = false, lossResolved = false, poolDestroyed = false, deviceDestroyed = false;
  const retire = () => retirement ||= (async () => {
    await opening?.catch(() => {});
    if (!restore) return;
    const { getDevice, destroyBufferPool } = await import('doppler-gpu/tooling');
    ownedDevice ||= getDevice();
    if (!ownedDevice) return;
    // Capture this device's loss completion before destruction can clear the runtime handle.
    if (!lost) {
      requireValue(typeof ownedDevice.lost?.then === 'function', 'Native device loss settlement promise is unavailable');
      lost = Promise.resolve(ownedDevice.lost).then(value => { lossResolved = true; return { value }; }, error => ({ error }));
    }
    if (!queueSettled) {
      // The first queue failure remains observable. An explicit retry may settle
      // an actually lost device even if its queue barrier permanently rejects.
      if (queueRejected && lossResolved) queueSettled = true;
      else {
        try { await ownedDevice.queue.onSubmittedWorkDone(); queueSettled = true; }
        catch (error) { queueRejected = true; throw error; }
      }
    }
    if (!poolDestroyed) { destroyBufferPool(ownedDevice); poolDestroyed = true; }
    if (!deviceDestroyed) { ownedDevice.destroy(); deviceDestroyed = true; }
    const completion = await lost;
    if ('error' in completion) throw completion.error;
  })().catch(error => { retirement = null; throw error; });
  return Object.freeze({
    open() {
      if (stopped) throw new Error('Native GPU host is closing');
      if (!opening) opening = (async () => {
        requireValue(!globalThis.navigator?.gpu, 'Native GPU host cannot replace a borrowed provider');
        const provider = await loadProvider();
        const saved = new Map(Object.keys(provider.globals).concat('navigator')
          .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
        restore = () => { for (const [key, descriptor] of saved) {
          if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
        } };
        try {
          Object.assign(globalThis, provider.globals);
          Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu: provider.create(['backend=vulkan']) } });
        } catch (error) { restore(); restore = null; throw error; }
      })().catch(error => { opening = null; throw error; });
      return opening;
    },
    close() {
      if (closing) return closing;
      stopped = true;
      let timer;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Native GPU ownership settlement exceeded 10000ms; provider retained')), 10000);
      });
      // No forced GC or sleep: navigator.gpu keeps the Dawn instance reachable
      // through queue completion, pool/device destruction and the exact lost promise.
      closing = Promise.race([retire(), deadline]).then(() => {
        restore?.(); restore = null;
      }).catch(error => { closing = null; throw error; }).finally(() => clearTimeout(timer));
      return closing;
    }
  });
}

export async function openNativePartition({ model: selected, modelDirectory, nativeGpu, index, signal, participantId,
  files, releaseDirectory, registerCleanup, canonical = null, ordered = null, device = null, attemptBytes, onProgress = () => {},
  gpuBufferBytes = policy.maxGpuBufferBytes, evidenceSigner = null, shaderCache = null }) {
  selected = snapshotWorkPartitionSelection(selected);
  const stageBinding = snapshotWorkPartitionStage(selected, index, participantId, ordered, canonical);
  if (selected.capsule !== undefined) requireValue(files && selected.packOpenOptions && selected.executablePack && releaseDirectory,
    'Signed native resident requires release policy, checkpoint directory and pinned artifact source');
  const configured = { ...selected, generation: resolvePartitionGeneration(selected) };
  const runtime = await import('doppler-gpu/partitions');
  const orderedOptions = workOrderedResidentOptions(runtime, stageBinding);
  if (canonical) {
    requireValue(typeof runtime.canonicalGenerationIdentity === 'function' && selected.canonicalGeneration
      && canonical.identity?.peerId === participantId && canonical.participantEpoch === canonical.epochs?.participantEpoch,
    'Canonical native contribution requires declared generation, provider capability and durable epochs');
    canonical.epochs.assertCurrent();
  }
  await nativeGpu(); signal.throwIfAborted();
  await runtime.configureDeviceMemoryBudget({ maxBytes: gpuBufferBytes });
  const source = await openNativeModelSource({ model: selected, modelDirectory, signal, runtime, files });
  let resident, release = null, capsuleVerification = null, sourceSettled = false, releaseSettled = false, residentSettled = false, commitAuthority = null;
  const ownerId = canonical ? crypto.randomUUID().replaceAll('-', '') : null;
  let ownershipRecorded = false;
  const sessions = new Set();
  const trackSession = session => { sessions.add(session); return () => sessions.delete(session); };
  const closeSources = async failures => {
    if (!sourceSettled) {
      try { await source.storage.close(); sourceSettled = true; } catch (error) { failures.push(error); }
    }
    if (release && !releaseSettled) {
      try { await release.close(); releaseSettled = true; } catch (error) { failures.push(error); }
    }
  };
  let cleaning = null;
  const cleanupOwner = { close() {
    return cleaning ||= (async () => {
      const failures = []; commitAuthority?.close();
      if (!residentSettled) {
        try { await resident?.close(); residentSettled = true; } catch (error) { failures.push(error); }
      }
      for (const session of sessions) {
        try { await session.close(); sessions.delete(session); } catch (error) { failures.push(error); }
      }
      await closeSources(failures);
      if (failures.length === 1) throw failures[0];
      if (failures.length) throw new AggregateError(failures, 'Native preparation cleanup failed');
      if (ownershipRecorded) { canonical.epochs.settle(ownerId); ownershipRecorded = false; }
      releaseCleanup?.();
    })().catch(error => { cleaning = null; throw error; });
  } };
  const releaseCleanup = registerCleanup?.(cleanupOwner);
  const tokenizer = createPartitionTokenizerGuard(source.storage);
  const onLoadProgress = event => { const progress = residentPreparationProgress(event); if (progress) onProgress(progress); };
  try {
    signal.throwIfAborted();
    const manifest = source.manifest;
    const plan = createWorkPartitionPlan(runtime, manifest, selected, index);
    const planId = runtime.hashLayerPartitionPlan(plan);
    let canonicalOptions = {};
    if (canonical) {
      canonical.epochs.assertCurrent();
      const generation = runtime.canonicalGenerationIdentity(selected.canonicalGeneration.policy,
        selected.canonicalGeneration.executionIdentity, plan.vocabSize);
      const stage = { participantId, participantEpoch: canonical.participantEpoch,
        deviceEpoch: crypto.randomUUID().replaceAll('-', ''), residentId: crypto.randomUUID(), partitionIndex: index,
        executionId: generation.executionIdentity };
      stage.stageId = runtime.metadataDigest('reploid.partition-resident-stage/v1', { modelIdentity: selected.identity, planId, ...stage });
      commitAuthority = createPartitionStageCommitAuthority({ runtime, identity: canonical.identity, stage });
      canonicalOptions = { canonicalGeneration: selected.canonicalGeneration, canonicalRuntime: runtime,
        canonicalCommitAuthority: { getStage: () => { canonical.epochs.assertCurrent(); return commitAuthority.getStage(); },
          async sign(request) { canonical.epochs.assertCurrent(); const result = await commitAuthority.sign(request); canonical.epochs.assertCurrent(); return result; },
          close: () => commitAuthority.close() } };
    }
    let factory;
    if (selected.capsule !== undefined) {
      requireValue(source.artifactStore, 'Signed native resident requires a pinned artifact source');
      release = await prepareLocalPackRelease({ model: configured,
        openCheckpoints: () => openNativeReleaseCheckpoints({ directory: releaseDirectory }) });
      const { openCapsule } = await import('doppler-gpu/host');
      factory = createSignedResidentFactory({ createFactory: runtime.createResidentPartitionFactory,
        openCapsule, model: configured, artifactStore: source.artifactStore, release,
        assertSession: assertWorkResidentCapsule, closeSources, trackSession, canonical: !!canonical,
        onVerification: value => { capsuleVerification = value; }, onLoadProgress });
    } else factory = runtime.createManifestResidentPartitionFactory({ manifest, manifestIdentity: selected.identity, onLoadProgress,
      runtimeConfig: { shared: { bufferPool: policy.bufferPool, debug: { profiler: { enabled: policy.profileGpu } } },
        inference: { session: { kvcache: { maxSeqLen: configured.generation.maxSeqLen },
          prefillChunkLayers: policy.prefillChunkLayers, prefillTokenChunkSize: policy.prefillTokenChunkSize } } },
      createStorage: async () => tokenizer.storage });
    resident = createResidentPartition({ runtime: factory, model: configured, plan, planId, index, participantId,
      limits: policy.limits, ...canonicalOptions, ...orderedOptions, ...(device ? { device, attemptBytes } : {}),
      // Ordered stages sign receipts for charged attempts with this host's participant identity.
      ...(orderedOptions.ordered && evidenceSigner?.participantId === participantId ? { evidence: evidenceSigner } : {}) });
    onProgress({ stage: 'opening', message: 'Opening native assigned partition' });
    if (canonical) { canonical.epochs.begin(ownerId); ownershipRecorded = true; }
    const prepared = await resident.prepare({ approved: true, signal });
    tokenizer.assertAvailable();
    // A complete preparation lets the process seal its shader cache; the outcome is reported, never thrown.
    shaderCache?.seal({ ...prepared?.descriptor?.pipelinePreparation, planId, index, modelIdentity: selected.identity });
    return { runtime, model: configured, plan, planId, resident: canonical ? Object.freeze(Object.fromEntries(
      Object.entries(resident).map(([name, value]) => [name, typeof value !== 'function' ? value : name === 'close'
        ? () => cleanupOwner.close() : name === 'closeAttempt' ? (...args) => value(...args) : (...args) => {
          canonical.epochs.assertCurrent(); const result = value(...args);
          if (result?.then) return result.then(output => { canonical.epochs.assertCurrent(); return output; });
          canonical.epochs.assertCurrent(); return result;
        }]))) : resident,
      getReceipt: () => ({ ...(selected.capsule === undefined ? source.getReceipt() : { sourceAcquisition: source.getReceipt() }),
        host: 'node', openingMode: selected.capsule === undefined ? 'pinned-manifest' : 'signed-capsule',
        capsuleVerification, memory: runtime.inspectDeviceMemory() }) };
  } catch (error) {
    const openingError = tokenizer.explain(error);
    const failures = [openingError];
    try { await cleanupOwner.close(); } catch (cleanup) { failures.push(cleanup); }
    if (failures.length > 1) throw new AggregateError(failures, 'Native opening and cleanup failed');
    throw openingError;
  }
}

/** `owner` is the optional owner gate from openNativeOwnerControls. It defers or reduces
 * new contribution, stage attempts and piece supply; it never cancels admitted work.
 * The persistent identity certifies the per-process custody key at startup and on
 * renewal; `onCustodyCertificate` observes each certificate (public, no secrets).
 * `earning` (self/host/earning/contribution.js over an explicitly configured client)
 * claims this host's settled stage shares and supplied deliveries and submits the
 * evidence of deliveries it acquired; it needs the owner policy and is off by default.
 * Claim failures are reported to the logger and never stop contribution. */
export async function createNativeParticipant({ model, modelDirectory, identity, rtc, WebSocket,
  signalingUrl, roomId, roomToken, nativeGpu, cacheDirectory, canonical = null, ordered = null, onFileChange = () => {}, onChange = () => {}, logger = console,
  owner: ownerGate = null, onCustodyCertificate = () => {}, earning = null, shaderCache = null }) {
  requireValue(earning === null || ownerGate && typeof earning.observe === 'function', 'Native earning requires the owner policy and an earning contribution port');
  if (ordered !== null) model = structuredClone(model);
  ordered = snapshotWorkOrderedParticipation(ordered, canonical, [model]);
  requireValue(identity?.privateJwk && await createPeerIdFromPublicJwk(identity.publicJwk) === identity.peerId,
    'Native participant requires its own valid signing identity');
  const evidenceSigner = createAttemptEvidenceSigner({ identity });
  requireValue(typeof rtc?.RTCPeerConnection === 'function' && typeof WebSocket === 'function', 'Native WebRTC and WebSocket required');
  requireValue(model && modelDirectory && typeof nativeGpu === 'function', 'Explicit native model, directory and GPU provider required');
  let canonicalRuntime = null, epochs = null;
  if (canonical !== null) {
    requireValue(canonical && typeof canonical.epochDirectory === 'string' && model.canonicalGeneration,
      'Canonical native participation requires explicit durable epochs and declared model generation');
    canonicalRuntime = await import('doppler-gpu/partitions');
    for (const name of ['canonicalGenerationIdentity', 'metadataDigest', 'tokenDigest', 'validateResidentAttemptIdentity',
      'residentAttemptDigest', 'residentPublicationDecisionDigest', 'validateExecutionPublication', 'validateAdmissionPublication']) {
      requireValue(typeof canonicalRuntime[name] === 'function', 'Installed Doppler lacks canonical capability: ' + name);
    }
  }
  const endpoint = new URL(signalingUrl);
  endpoint.searchParams.set('scope', roomId === bootstrap.publicRoomId ? 'public' : 'private');
  endpoint.searchParams.set('roomId', roomId);
  const config = resolveConfig({ profile: profile.profile, overrides: {
    mesh: { enabled: true, executeJobs: false, roomId },
    webrtc: { signalingUrl: endpoint.href, broadcastRoomId: roomId, transportOrder: ['webrtc'] }
  } });
  const eventBus = events(), bridge = events(), utils = { logger, generateId: () => crypto.randomUUID() };
  const admission = roomId === bootstrap.publicRoomId ? null : createRoomIntroductionAdmission({ roomId, token: roomToken });
  let transport, partitions, files, closePromise, closed = false, gpuPromise;
  const networks = new Set();
  const mesh = createLegacyGenerationMesh({ config, ports: {
    instanceId: 'node:' + identity.peerId, modelConfig: null, utils, eventBus, events: bridge,
    identity: { ensure: async () => identity, save: async () => {}, sync: async () => {},
      rotate: async () => { throw new Error('Stop the native participant before rotating its identity'); } },
    authorize: async request => !closed && request.action === 'mesh.connect',
    generate: async () => { throw new Error('Native whole-request fallback is disabled'); },
    createTransport: () => transport = createSwarmTransport({ config, Utils: utils, EventBus: eventBus,
      WebSocket, RTCPeerConnection: rtc.RTCPeerConnection, RTCSessionDescription: rtc.RTCSessionDescription,
      RTCIceCandidate: rtc.RTCIceCandidate,
      getSessionId: () => identity.peerId, getRoomCredentials: () => ({ roomId, token: roomToken }),
      introductions: { getIdentity: () => identity, ...(admission ? { createAdmission: admission.create } : {}),
        authorize: async request => !closed && request.roomId === roomId && request.action !== 'forward'
          && (!admission || (!request.contact && !request.from) || await admission.verify(request.contact || request.from)) }
    })
  } });
  // Claims read this host's own records only; they never change admission or settlement.
  const observeEarning = () => {
    if (!earning) return;
    earning.observe({ admissions: partitions?.getState().reservations?.records ?? [], deliveries: files?.getDeliveryEvidence() ?? [] })
      .catch(error => logger.warn('Earning claims deferred', error?.code || error?.message));
  };
  const settledOwners = new Set();
  const closeOwner = async owner => {
    if (!owner || settledOwners.has(owner)) return;
    await owner.close(); settledOwners.add(owner);
  };
  // Contribution or file supply waiting for owner admission owns nothing yet; stopping only ends the wait.
  const ownerWaits = { contribute: null, share: null };
  // Resolves false when stop or close ended the wait, like stopping an unfinished preparation.
  const ownerAdmission = async kind => {
    const controller = new AbortController(); ownerWaits[kind]?.abort(new Error('Superseded owner admission wait'));
    ownerWaits[kind] = controller;
    try { await ownerGate.waitForAdmission({ kind: kind === 'share' ? 'file supply' : 'contribution', signal: controller.signal }); }
    catch (error) { if (controller.signal.aborted) return false; throw error; }
    finally { if (ownerWaits[kind] === controller) ownerWaits[kind] = null; }
    return !closed;
  };
  const endOwnerWait = (kind, reason) => ownerWaits[kind]?.abort(new Error(reason));
  const close = () => closePromise ||= (async () => {
    closed = true;
    endOwnerWait('contribute', 'Native participant closed'); endOwnerWait('share', 'Native participant closed');
    const results = await Promise.allSettled([partitions, ...networks]
      .map(owner => Promise.resolve().then(() => closeOwner(owner))));
    // Sources and the mesh outlive resident cancellation/opening settlement.
    for (const owner of [files, mesh]) {
      results.push(...await Promise.allSettled([Promise.resolve().then(() => closeOwner(owner))]));
    }
    // Resident cleanup still needs its epoch journal on explicit retry. A failed
    // transport close does not revoke that ownership or clear its durable debt.
    if (!partitions || settledOwners.has(partitions)) {
      results.push(...await Promise.allSettled([Promise.resolve().then(() => closeOwner(epochs))]));
    }
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) throw new AggregateError(failures, 'Native contribution did not settle cleanly');
  })().catch(error => { closePromise = null; throw error; });
  try {
    if (canonical) epochs = await openNativeCanonicalEpochs({ directory: canonical.epochDirectory, participantId: identity.peerId, meshId: roomId });
    await mesh.connect();
    if (cacheDirectory) {
      files = await createNativeModelFiles({ transport, modelDirectory, cacheDirectory, onChange: onFileChange, owner: ownerGate,
        certifyCustodyKey: createCustodyKeyCertifier({ identity, onIssue: onCustodyCertificate }).certify });
      await files.custodyCertificate();
    }
    partitions = createAutomaticPartitions({ identity, meshId: roomId, models: [model], ...bindWorkOrderedParticipation(ordered, identity.peerId, ordered ? transport._getPeerId() : null, policy),
      canonical: epochs ? { runtime: canonicalRuntime, participantEpoch: epochs.participantEpoch, coordinatorEpoch: epochs.coordinatorEpoch } : null,
      peers: () => transport.getConnectedPeers().map(peer => ({ ...peer, localTransportId: transport._getPeerId() })),
      createNetwork(options) {
        const network = createPartitionNetwork({ ...options, transport,
          verifyPeer: async (peerId, signal) => {
            try { return await mesh.verifyPeerIdentity(peerId, signal); }
            catch (error) { logger.warn('Native participant identity verification failed', peerId, error.message); throw error; }
          } });
        networks.add(network); return network;
      },
      loadProgram: async (selected, index, controls) => {
        const program = await openNativePartition({ model: selected, index, modelDirectory,
          releaseDirectory: cacheDirectory && path.join(path.dirname(cacheDirectory), 'release-checkpoints'),
          nativeGpu: () => gpuPromise ||= nativeGpu().catch(error => { gpuPromise = null; throw error; }), files, ...controls, evidenceSigner, shaderCache,
          ...(epochs ? { canonical: { ...controls.canonical, epochs } } : {}),
          ...(ownerGate ? { gpuBufferBytes: ownerGate.gpuBufferBytes(policy.maxGpuBufferBytes) } : {}) });
        return ownerGate ? { ...program, resident: ownerGate.gateResident(program.resident) } : program;
      }, onChange: earning ? state => { onChange(state); observeEarning(); } : onChange
    });
    return Object.freeze({ identity: identity.peerId, getState: () => partitions.getState(),
      generate(request, controls) {
        requireValue(!closed && !canonical, 'Native ordinary requester is unavailable');
        requireValue(typeof controls?.requestApproval === 'function', 'Explicit requester disclosure authorization required');
        return partitions.generate(request, controls);
      },
      contribute: ownerGate ? async approved => {
        if (approved === true && !await ownerAdmission('contribute')) return;
        return partitions.contribute(model.id, approved);
      } : approved => partitions.contribute(model.id, approved),
      stop: ownerGate ? () => { endOwnerWait('contribute', 'Native contribution stopped'); return partitions.stop(); } : () => partitions.stop(), close,
      getNetworkState: () => mesh.getSwarmSnapshot(), getFileState: options => files?.getState(options) || null,
      shareFiles: ownerGate ? async approved => {
        requireValue(files, 'Native cache directory required');
        if (approved === true && !await ownerAdmission('share')) return null;
        return files.share(model, approved);
      } : approved => { requireValue(files, 'Native cache directory required'); return files.share(model, approved); },
      stopSharing: ownerGate ? () => { endOwnerWait('share', 'Native file contribution stopped'); return files?.stopSupply(); } : () => files?.stopSupply(),
      announceFiles: () => { files?.announce(); observeEarning(); }, getOwnerState: () => ownerGate ? ownerGate.summary() : NO_OWNER_POLICY,
      getCustodyCertificate: async () => files ? files.custodyCertificate() : null });
  } catch (error) { try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Native startup and cleanup failed'); } throw error; }
}

/** Attempt provider cleanup even when participant settlement reports failure. */
export function createNativeShutdown(participant, gpuHost) {
  let closing;
  return () => closing ||= (async () => {
    const failures = [];
    try { await participant.close(); } catch (error) { failures.push(error); }
    try { await gpuHost.close(); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Native host cleanup failed');
  })();
}

/** Reads the private room capability once from an operator file. The path must be absolute and
 * name a regular file owned by the current user with mode 0600. The final path component is
 * opened without following a symbolic link and the open descriptor is checked before it is read.
 * One trailing newline (LF or CRLF) is removed; the token is otherwise unchanged. */
export async function readNativeRoomTokenFile(file, { uid = process.getuid?.() } = {}) {
  requireValue(typeof file === 'string' && path.isAbsolute(file), '--room-token-file requires an absolute path');
  requireValue(Number.isSafeInteger(uid), '--room-token-file requires a POSIX host that reports the current user id');
  let handle;
  try { handle = await fs.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (error) {
    const reason = error.code === 'ENOENT' ? 'does not exist'
      : error.code === 'ELOOP' ? 'is a symbolic link, not a regular file' : `cannot be opened (${error.code || error.message})`;
    throw new Error(`--room-token-file ${reason}: ${file}`);
  }
  try {
    const stat = await handle.stat();
    requireValue(stat.isFile(), `--room-token-file must be a regular file: ${file}`);
    requireValue(stat.uid === uid, `--room-token-file must be owned by the current user (uid ${uid}), not uid ${stat.uid}: ${file}`);
    const mode = stat.mode & 0o7777;
    requireValue(mode === 0o600, `--room-token-file must have mode 0600 (owner read/write only), not ${mode.toString(8).padStart(4, '0')}: ${file}`);
    const token = (await handle.readFile('utf8')).replace(/\r?\n$/, '');
    requireValue(token.length > 0, `--room-token-file is empty: ${file}`);
    return token;
  } finally { await handle.close(); }
}

/** One source for the room capability. The value then follows the same path as --room-token
 * (createRoomIntroductionAdmission and the signaling join), so it is validated identically.
 * --room-token remains for compatibility; it exposes the token in process arguments. */
export async function resolveNativeRoomToken(values, { warn = message => console.error(message), uid } = {}) {
  const inline = values['room-token'], file = values['room-token-file'];
  requireValue(inline === undefined || file === undefined, 'Choose either --room-token or --room-token-file, not both');
  if (file !== undefined) return readNativeRoomTokenFile(file, { uid });
  if (inline !== undefined) warn('Warning: --room-token exposes the room token in process arguments; use --room-token-file');
  return inline;
}

async function main() {
  const { values } = parseArgs({ options: Object.fromEntries(['model', 'model-directory', 'identity-file', 'rtc-module',
    'ws-module', 'gpu-module', 'ordered-config', 'signaling-url', 'room', 'room-token', 'room-token-file', 'origin', 'cache-directory',
    'owner-policy', 'shader-cache-root', 'earning-config'].map(key => [key, { type: 'string' }]).concat([
      ['help', { type: 'boolean', default: false }], ['canonical', { type: 'boolean', default: false }], ['share-files', { type: 'boolean', default: false }], ['contribute', { type: 'boolean', default: false }], ['connect-only', { type: 'boolean', default: false }]])) });
  if (values.help) {
    console.log(`Reploid native participant (Node 22.13 or newer)
Usage: reploid-participant --connect-only|--share-files|--contribute
  --model <catalog id> --model-directory <read-only weights directory>
  --identity-file <private state/identity.json>
  --rtc-module @roamhq/wrtc --ws-module ws [--gpu-module webgpu]
  [--cache-directory <verified piece cache>] [--signaling-url <ws(s) URL>]
  [--room <namespace>] [--room-token-file <absolute path>] [--origin <allowed origin>]
  [--ordered-config <absolute JSON path>] (explicit stage assignment and ordered limits)
  [--canonical] (requires explicit catalog generation and a capable installed runtime)
  [--owner-policy <absolute JSON path>] (owner schedule, memory, rate, power, temperature and foreground limits)
  [--earning-config <absolute JSON path>] (reploid.native-earning/v1: earning service, sign-in and stage-share offers; needs --owner-policy)
  [--shader-cache-root <absolute directory>] (sealed Mesa shader cache; default: shader-cache beside the identity file)

--room-token-file reads the private room token once at startup from a regular
file owned by this user with mode 0600; one trailing newline is removed.
--room-token <join marker> still works but exposes the token in process
arguments and prints a warning; it cannot be combined with --room-token-file.

File sharing and compute are separate explicit choices; both may be enabled.
Compute requires --gpu-module. Missing assigned pieces use authenticated peers.
SIGINT/SIGTERM stop admission, settle work and release owned resources.
On Linux, --contribute compiles GPU pipelines into a private Mesa shader cache that is
sealed only after a complete stage preparation and reused only for the same runtime,
provider, driver and program; MESA_SHADER_CACHE_DIR must not be set by the caller.
Native GPU execution is qualified on Linux/Vulkan only; --help opens no provider.`);
    return;
  }
  requireValue(values.contribute || values['share-files'] || values['connect-only'], 'Choose --contribute, --share-files or --connect-only explicitly');
  if (values.contribute) requireValue(values['gpu-module'], '--gpu-module is required for compute');
  for (const name of ['model', 'model-directory', 'identity-file', 'rtc-module', 'ws-module']) requireValue(values[name], '--' + name + ' is required');
  // Before identity, module or connection side effects; read once.
  const roomToken = await resolveNativeRoomToken(values);
  let logNetwork = () => {};
  const owner = values['owner-policy'] === undefined ? null : await openNativeOwnerControls({ file: values['owner-policy'],
    custody: custodyPolicy, onChange: () => logNetwork(),
    // Doppler's application GPU buffer accounting; null until compute opens a device.
    readGpuBuffers: values.contribute ? async () => (await import('doppler-gpu/partitions')).inspectDeviceMemory() : null });
  let ordered = null;
  if (values['ordered-config']) {
    requireValue(!values.canonical && path.isAbsolute(values['ordered-config']), 'Ordered config requires an absolute file path and ordinary execution');
    ordered = JSON.parse(await fs.readFile(values['ordered-config'], 'utf8'));
    requireValue(ordered && typeof ordered === 'object', 'Ordered config requires an explicit configuration object');
    snapshotWorkOrderedParticipation(ordered, null, models);
  }
  const identityFile = path.resolve(values['identity-file']);
  const model = models.find(row => row.id === values.model); requireValue(model, 'Model is absent from the application catalog');
  const moduleSpecifier = value => {
    requireValue(path.isAbsolute(value) || ['@roamhq/wrtc', 'ws', 'webgpu'].includes(value),
      'Native modules require an operator-selected absolute local path or supported package name');
    return path.isAbsolute(value) ? pathToFileURL(value).href : value;
  };
  requireValue(values['shader-cache-root'] === undefined || values.contribute, '--shader-cache-root requires --contribute');
  // Bound before any native module loads, so MESA_SHADER_CACHE_DIR is set before the Vulkan driver initializes.
  let shaderCache = null;
  if (values.contribute && (process.platform === 'linux' || values['shader-cache-root'] !== undefined)) {
    const gpuModule = values['gpu-module'];
    const { key, identity: cacheIdentity } = await nativeShaderCacheIdentity({
      runtime: { directory: await installedPackageDirectory(fileURLToPath(import.meta.resolve('doppler-gpu/partitions')), 'doppler-gpu'),
        archiveIntegrity: dopplerPin.integrity },
      provider: { module: gpuModule, directory: await installedPackageDirectory(fileURLToPath(import.meta.resolve(moduleSpecifier(gpuModule))),
        path.isAbsolute(gpuModule) ? null : gpuModule) },
      program: { model, policy, stage: Number.isSafeInteger(ordered?.stage?.index) ? ordered.stage.index : null, canonical: values.canonical } });
    shaderCache = await openNativeShaderCache({ root: values['shader-cache-root'] ?? path.join(path.dirname(identityFile), 'shader-cache'),
      key, identity: cacheIdentity, onEvent: event => console.log(JSON.stringify({ event: 'shader-cache', ...event })) });
  }
  let identity;
  try { identity = JSON.parse(await fs.readFile(identityFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error;
    identity = await createSigningIdentity({ algorithm: 'Ed25519' });
    await fs.mkdir(path.dirname(identityFile), { recursive: true, mode: 0o700 });
    await fs.writeFile(identityFile, JSON.stringify(identity), { flag: 'wx', mode: 0o600 }); }
  const importModule = value => { moduleSpecifier(value); return import(path.isAbsolute(value) ? pathToFileURL(value).href : value); };
  const [rtcModule, wsModule] = await Promise.all([importModule(values['rtc-module']), importModule(values['ws-module'])]);
  const rtc = createNativeRtcAdapter(rtcModule.default || rtcModule);
  const Socket = wsModule.default || wsModule.WebSocket;
  class HostWebSocket extends Socket { constructor(url) { super(url, { origin: values.origin || 'http://localhost:8000' }); } }
  const gpuHost = createNativeGpuHost(() => importModule(values['gpu-module']));
  // Optional earning: signs this host in, registers its identity as a native device, records the owner policy
  // and claims settled stage shares under service-authored offers (native-earning.js); state lives beside the identity.
  if (values['earning-config']) requireValue(owner, '--earning-config requires --owner-policy');
  const earning = values['earning-config'] ? await import('./native-earning.js').then(async native => native.openNativeEarning({
    settings: await native.readNativeEarningFile(values['earning-config']), identity, ownerAuthorization: { policy: owner.policy, digest: owner.digest },
    storage: native.createNativeEarningStorage(path.join(path.dirname(identityFile), 'earning-state.json')) }))
    .catch(async error => { owner?.close(); await shaderCache?.close(); throw error; }) : null;
  const participant = await createNativeParticipant({ model, modelDirectory: values['model-directory'], identity, rtc,
    WebSocket: HostWebSocket, signalingUrl: values['signaling-url'] || bootstrap.signalingUrl,
    roomId: values.room || bootstrap.publicRoomId, roomToken: roomToken || bootstrap.publicJoinMarker,
    cacheDirectory: values['cache-directory'] || path.join(path.dirname(identityFile), 'model-cache'),
    ordered, canonical: values.canonical ? { epochDirectory: path.join(path.dirname(identityFile), 'canonical-epochs',
      createHash('sha256').update(values.room || bootstrap.publicRoomId).digest('hex')) } : null,
    nativeGpu: () => gpuHost.open(), owner, shaderCache, earning,
    onCustodyCertificate: certificate => console.log(JSON.stringify({ event: 'custody-certificate', certificate })),
    onChange: state => {
      console.log(JSON.stringify({ ...summarizeNativePartitionState(state), owner: nativeOwnerStatus(owner) }));
      // A prepared stage is offered for before any route admits it.
      if (earning && state.descriptor?.planId) earning.ensureOffer(state.descriptor).catch(error => console.error('Earning offer deferred:', error.code || error.message));
    } })
    .catch(async error => { owner?.close(); await shaderCache?.close(); throw error; });
  logNetwork = () => console.log(JSON.stringify({ event: 'network', ...participant.getNetworkState(),
    files: participant.getFileState({ includeReceipts: false }), owner: participant.getOwnerState() }));
  // Polling also renews the custody certificate before it expires.
  const timer = setInterval(() => { participant.announceFiles(); logNetwork();
    participant.getCustodyCertificate().catch(error => console.error('Custody certificate renewal failed:', error.message)); }, policy.pollMs);
  const shutdown = createNativeShutdown(participant, gpuHost);
  const stop = () => { clearInterval(timer); logNetwork = () => {}; return shutdown().finally(async () => { owner?.close(); await shaderCache?.close(); }); };
  const completion = new Promise((resolve, reject) => {
    const signalStop = () => stop().then(resolve, reject);
    process.once('SIGINT', signalStop); process.once('SIGTERM', signalStop);
  });
  console.log(JSON.stringify({ event: 'native-initialized', participantId: identity.peerId, modelId: model.id,
    owner: owner ? owner.declaration() : NO_OWNER_POLICY, shaderCache: shaderCache ? shaderCache.status()
      : values.contribute ? { status: 'not-applicable', platform: process.platform } : null }));
  try {
    await Promise.all([completion, (async () => {
      if (values['share-files']) await participant.shareFiles(true);
      if (values.contribute) await participant.contribute(true);
    })()]);
  } catch (error) {
    try { await stop(); }
    catch (cleanup) { if (cleanup !== error) throw new AggregateError([error, cleanup], 'Native preparation and cleanup failed'); }
    throw error;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
