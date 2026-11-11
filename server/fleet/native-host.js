#!/usr/bin/env node
import fs from 'node:fs/promises';
import { constants, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { inspectDeviceMemory } from 'doppler-gpu/partitions';
import { getDevice, getKernelCapabilities } from 'doppler-gpu/tooling/device';
import { createSigningIdentity, createPeerIdFromPublicJwk } from '../../packages/reploid/src/artifacts/identity.js';
import { signGenerationTerminal } from '../../packages/reploid/src/artifacts/generation-terminal.js';
import { hashJson } from '../../packages/reploid/src/artifacts/signatures.js';
import { createNativeParticipant, createNativeRtcAdapter, createNativeGpuHost, readNativeRoomTokenFile } from '../native-participant.js';
import { openNativeOwnerControls } from '../native-owner/controls.js';
import custodyPolicy from '../../apps/poolday/config/chat-files.json' with { type: 'json' };
import bootstrap from '../../shared/config/swarm-bootstrap.json' with { type: 'json' };
import { startFleetBrowserBridge } from './browser-bridge.js';
import { startFleetTextApi } from './text-api.js';
import { createFleetClient } from './service.js';
import { createFleetRequester, buildFleetRequestOutcome } from './requester.js';
import { createFleetExecutionAdmission } from './execution-admission.js';
import { assert, text, same } from './contract.js';
import { partitionAdapterIdentities } from '../../packages/reploid/src/mesh/partitions/partition-contract.js';

export async function openComputerIdentity(file) {
  assert(path.isAbsolute(file), 'Absolute computer identity path required');
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  let identity;
  try { identity = JSON.parse(await readOwnFile(file)); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    identity = await createSigningIdentity({ algorithm: 'Ed25519' });
    await fs.writeFile(file, JSON.stringify(identity), { flag: 'wx', mode: 0o600 });
  }
  assert(identity.privateJwk && await createPeerIdFromPublicJwk(identity.publicJwk) === identity.peerId, 'Invalid persistent computer identity');
  return identity;
}

async function readOwnFile(file) {
  assert(path.isAbsolute(file), 'Absolute operator file path required');
  assert(!(await fs.lstat(file)).isSymbolicLink(), 'Operator file cannot be a symbolic link');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    assert(stat.isFile(), 'Operator file must be regular');
    if (process.getuid) assert(stat.uid === process.getuid() && (stat.mode & 0o077) === 0, 'Operator secrets must be owner-only');
    return await handle.readFile('utf8');
  } finally { await handle.close(); }
}

export function activeProviderRequests(state) {
  if (!state) return 0;
  const reservations = state.reservations?.records || state.resident?.reservations?.records || [];
  return Math.max(['executing', 'loading', 'stopping', 'draining'].includes(state.phase) ? 1 : 0,
    state.reservations?.active || 0, state.unsettledOwners || 0, state.queue?.queued || 0,
    reservations.filter(row => row.settledAt === null).length,
    (state.attempts || []).filter(row => row.cleanupSettledAt == null).length,
    state.unknownAttempts?.length || 0);
}

function availableHostBytes() {
  const fallback = os.freemem();
  try {
    if (process.platform === 'darwin') {
      const output = execFileSync('vm_stat', [], { encoding: 'utf8', timeout: 1000 });
      const pageSize = Number(output.match(/page size of (\d+) bytes/i)?.[1] || 0);
      const pages = label => Number(output.match(new RegExp(`${label}:\\s+(\\d+)\\.`))?.[1] || 0);
      if (pageSize > 0) {
        const reclaimable = (pages('Pages free') + pages('File-backed pages')) * pageSize;
        if (Number.isSafeInteger(reclaimable) && reclaimable > fallback) return Math.min(os.totalmem(), reclaimable);
      }
    } else if (process.platform === 'linux') {
      const meminfo = readFileSync('/proc/meminfo', 'utf8');
      const availableKb = Number(meminfo.match(/^MemAvailable:\s+(\d+)\s+kB/m)?.[1] || 0);
      if (availableKb > 0) return Math.min(os.totalmem(), availableKb * 1024);
    }
  } catch {
    // Fall back to os.freemem() when platform virtual-memory counters are unavailable.
  }
  return fallback;
}

export function fleetHardwareSnapshot() {
  const device = getDevice(), memory = inspectDeviceMemory();
  return { platform: process.platform, totalHostBytes: os.totalmem(), freeHostBytes: availableHostBytes(),
    processResidentBytes: process.memoryUsage().rss,
    adapter: device ? getKernelCapabilities().adapterInfo : null,
    maxStorageBufferBindingSize: device?.limits.maxStorageBufferBindingSize ?? null,
    maxBufferSize: device?.limits.maxBufferSize ?? null,
    gpuBuffers: memory && { scope: memory.scope, liveBytes: memory.liveBytes, peakBytes: memory.peakBytes,
      maxBytes: memory.maxBytes, categories: memory.categories } };
}

/** A direct reply proves this requester process is online, not that it contributes GPU capacity. */
export function includeRequesterPresence(computers, state, at) {
  return computers.map(computer => computer.id !== state.computerId ? computer : {
    ...computer, online: true, observedAt: at, requester: true,
    activeRequests: Math.max(computer.online ? computer.activeRequests || 0 : 0, state.activeRequests),
    ...(state.queuedRequests > 0 ? { queuedRequests: state.queuedRequests } : {}),
    preparing: state.preparing,
    ...(!computer.online ? { resident: null, freeHostBytes: state.hardware.freeHostBytes } : {})
  });
}

/** Fair round-robin admission scheduler across conversation lanes, including fast-path dispatches. */
export function createFairLaneScheduler({
  enabled = true,
  capacityWaitMs = 30000,
  canDrain = () => true,
  findRoute,
  freeSlots,
  onPoll = () => {}
}) {
  const queuedEntries = new Map(), laneBuckets = new Map(), laneLastDispatched = new Map();
  const activeProvidersByAttempt = new Map();
  let startingDispatches = 0, dispatchSequence = 0, queuePollTimer = null, closed = false;

  function recordLaneDispatch(lane) {
    laneLastDispatched.set(lane, ++dispatchSequence);
    if (laneLastDispatched.size > 256) {
      for (const key of laneLastDispatched.keys()) {
        if (!laneBuckets.has(key)) {
          laneLastDispatched.delete(key);
          if (laneLastDispatched.size <= 192) break;
        }
      }
    }
  }

  function computeFairOrder() {
    const copies = new Map();
    const virtualLast = new Map();
    let virtualSeq = dispatchSequence;
    for (const [lane, items] of laneBuckets.entries()) {
      if (items?.length) {
        copies.set(lane, [...items]);
        virtualLast.set(lane, laneLastDispatched.get(lane) ?? 0);
      }
    }
    const order = [];
    while (copies.size > 0) {
      let bestLane = null, bestSeq = Infinity, bestQueuedAt = Infinity;
      for (const [lane, items] of copies.entries()) {
        const seq = virtualLast.get(lane) ?? 0, queuedAt = items[0].queuedAt;
        if (seq < bestSeq || (seq === bestSeq && queuedAt < bestQueuedAt)) {
          bestLane = lane; bestSeq = seq; bestQueuedAt = queuedAt;
        }
      }
      if (bestLane === null) break;
      const items = copies.get(bestLane);
      order.push(items.shift());
      virtualLast.set(bestLane, ++virtualSeq);
      if (items.length === 0) copies.delete(bestLane);
    }
    return order;
  }

  function notifyQueuePositions() {
    const ordered = computeFairOrder();
    const total = ordered.length;
    ordered.forEach((entry, index) => {
      const position = index + 1;
      if (entry.lastPosition !== position || entry.lastTotal !== total) {
        entry.lastPosition = position;
        entry.lastTotal = total;
        entry.onAdmission?.({ status: 'queued', queuePosition: position, queuedCount: total, queuedAt: entry.queuedAt });
      }
    });
  }

  function removeQueuedEntry(entry) {
    queuedEntries.delete(entry.attemptId);
    clearTimeout(entry.timer);
    entry.signal?.removeEventListener('abort', entry.onAbort);
    const items = laneBuckets.get(entry.lane);
    if (items) {
      const index = items.indexOf(entry);
      if (index >= 0) items.splice(index, 1);
      if (!items.length) laneBuckets.delete(entry.lane);
    }
    if (queuedEntries.size === 0 && queuePollTimer) {
      clearInterval(queuePollTimer);
      queuePollTimer = null;
    }
  }

  function drain() {
    if (closed || !canDrain() || !queuedEntries.size) return;
    let progressed = true;
    while (progressed && laneBuckets.size > 0) {
      progressed = false;
      const candidates = [...laneBuckets.entries()]
        .filter(([, items]) => items?.length > 0)
        .sort(([laneA, itemsA], [laneB, itemsB]) => {
          const seqDiff = (laneLastDispatched.get(laneA) ?? 0) - (laneLastDispatched.get(laneB) ?? 0);
          return seqDiff !== 0 ? seqDiff : itemsA[0].queuedAt - itemsB[0].queuedAt;
        });
      for (const [lane, items] of candidates) {
        const entry = items[0];
        const chosen = findRoute(entry.requestedModel, entry.allowPartitionFallback);
        if (chosen && freeSlots(chosen, activeProvidersByAttempt, startingDispatches) > 0) {
          items.shift();
          if (items.length === 0) laneBuckets.delete(lane);
          queuedEntries.delete(entry.attemptId);
          clearTimeout(entry.timer);
          entry.signal?.removeEventListener('abort', entry.onAbort);
          recordLaneDispatch(lane);
          startingDispatches += 1;
          entry.resolve({ chosen, queuedMs: Math.max(0, Date.now() - entry.queuedAt), releaseStarting: true });
          progressed = true;
          break;
        }
      }
    }
    if (queuedEntries.size === 0 && queuePollTimer) {
      clearInterval(queuePollTimer);
      queuePollTimer = null;
    }
    notifyQueuePositions();
  }

  async function acquire({ attemptId, threadId, requestedModel, allowPartitionFallback = false, signal, onAdmission }) {
    signal.throwIfAborted();
    if (!enabled) {
      const immediate = findRoute(requestedModel, allowPartitionFallback);
      return { chosen: immediate, queuedMs: 0, markDisclosed() {}, release() {} };
    }
    assert(Number.isSafeInteger(capacityWaitMs) && capacityWaitMs > 0, 'Explicit capacity wait bound required');
    const lane = typeof threadId === 'string' && threadId ? threadId : attemptId;
    if (queuedEntries.size === 0) {
      const immediate = findRoute(requestedModel, allowPartitionFallback);
      if (immediate && freeSlots(immediate, activeProvidersByAttempt, startingDispatches) > 0) {
        recordLaneDispatch(lane);
        startingDispatches += 1;
        let startingHeld = true;
        return {
          chosen: immediate,
          queuedMs: 0,
          markDisclosed(providerKey) {
            if (providerKey) activeProvidersByAttempt.set(attemptId, providerKey);
            if (startingHeld) { startingHeld = false; startingDispatches = Math.max(0, startingDispatches - 1); }
            drain();
          },
          release() {
            activeProvidersByAttempt.delete(attemptId);
            if (startingHeld) { startingHeld = false; startingDispatches = Math.max(0, startingDispatches - 1); }
            drain();
          }
        };
      }
    }
    const queuedAt = Date.now();
    const acquired = await new Promise((resolve, reject) => {
      const entry = {
        attemptId, lane, requestedModel, allowPartitionFallback, signal, onAdmission, queuedAt,
        lastPosition: 0, lastTotal: 0, resolve, reject,
        timer: setTimeout(() => {
          removeQueuedEntry(entry);
          notifyQueuePositions();
          reject(Error('No ready capacity within the configured wait'));
        }, capacityWaitMs),
        onAbort: () => {
          removeQueuedEntry(entry);
          notifyQueuePositions();
          reject(signal.reason || new DOMException('Aborted', 'AbortError'));
        }
      };
      signal.addEventListener('abort', entry.onAbort, { once: true });
      let items = laneBuckets.get(lane);
      if (!items) { items = []; laneBuckets.set(lane, items); }
      items.push(entry);
      queuedEntries.set(attemptId, entry);
      if (!queuePollTimer) {
        queuePollTimer = setInterval(() => {
          void Promise.resolve(onPoll()).catch(() => {});
          drain();
        }, 500);
        queuePollTimer.unref?.();
      }
      notifyQueuePositions();
      drain();
    });
    let startingHeld = acquired.releaseStarting === true;
    onAdmission?.({ status: 'admitted', queuedMs: acquired.queuedMs });
    return {
      chosen: acquired.chosen,
      queuedMs: acquired.queuedMs,
      markDisclosed(providerKey) {
        if (providerKey) activeProvidersByAttempt.set(attemptId, providerKey);
        if (startingHeld) { startingHeld = false; startingDispatches = Math.max(0, startingDispatches - 1); }
        drain();
      },
      release() {
        activeProvidersByAttempt.delete(attemptId);
        if (startingHeld) { startingHeld = false; startingDispatches = Math.max(0, startingDispatches - 1); }
        drain();
      }
    };
  }

  return Object.freeze({
    acquire,
    drain,
    queuedCount: () => queuedEntries.size,
    close() {
      closed = true;
      if (queuePollTimer) { clearInterval(queuePollTimer); queuePollTimer = null; }
    }
  });
}

/** One process owns one GPU host. Model changes drain the old resident before preparing another. */
export async function openFleetNativeHost({ configuration, loadRtc = () => import('@roamhq/wrtc'), loadSocket = () => import('ws'),
  loadGpu = () => import('webgpu'), onChange = () => {} }) {
  const config = structuredClone(configuration);
  assert(config.schema === 'reploid.fleet-native/v1' && text(config.computerId) && text(config.name)
    && Array.isArray(config.models) && config.models.length > 0
    && config.models.every(row => ['partition', 'whole-model'].includes(row.mode)), 'Explicit fleet native configuration required');
  assert(text(config.roomId) && config.roomId !== bootstrap.publicRoomId && config.roomTokenFile,
    'Operator fleet models require an explicit private room');
  const identity = await openComputerIdentity(config.identityFile);
  const [rtcModule, socketModule] = await Promise.all([loadRtc(), loadSocket()]);
  const rtc = createNativeRtcAdapter(rtcModule.default ?? rtcModule), Socket = socketModule.default ?? socketModule.WebSocket;
  class WebSocket extends Socket { constructor(url) { super(url, { origin: config.origin || 'http://localhost:8000' }); } }
  const serviceCa = config.serviceCaFile ? (assert(path.isAbsolute(config.serviceCaFile), 'Absolute service CA certificate path required'),
    await fs.readFile(config.serviceCaFile)) : null;
  const gpu = createNativeGpuHost(loadGpu), credits = config.serviceUrl ? createFleetClient({ url: config.serviceUrl, identity, ca: serviceCa,
    outboxFile: path.join(path.dirname(config.identityFile), 'service-credit-outbox.json') }) : null;
  const owner = config.ownerPolicyFile ? await openNativeOwnerControls({ file: config.ownerPolicyFile, custody: custodyPolicy,
    readGpuBuffers: async () => (await import('doppler-gpu/partitions')).inspectDeviceMemory() }) : null;
  const roomToken = config.roomTokenFile ? process.getuid ? await readNativeRoomTokenFile(config.roomTokenFile)
    : (await readOwnFile(config.roomTokenFile)).replace(/\r?\n$/, '') : null;
  let participant = null, selected = null, preparing = false, closed = false, lastError = null, preparedAt = null;
  const requests = new Map(), outcomesByAttempt = new Map(), outcomesByReservation = new Map();

  function recordOutcome(outcome) {
    if (!outcome) return outcome;
    if (outcome.attemptId) {
      outcomesByAttempt.delete(outcome.attemptId);
      outcomesByAttempt.set(outcome.attemptId, outcome);
      while (outcomesByAttempt.size > 128) outcomesByAttempt.delete(outcomesByAttempt.keys().next().value);
    }
    if (outcome.reservationId) {
      outcomesByReservation.delete(outcome.reservationId);
      outcomesByReservation.set(outcome.reservationId, outcome);
      while (outcomesByReservation.size > 128) outcomesByReservation.delete(outcomesByReservation.keys().next().value);
    }
    return outcome;
  }
  const lookupOutcome = id => outcomesByReservation.get(id) ?? outcomesByAttempt.get(id) ?? null;
  const resolveProviderId = (_reservationId, binding) => {
    const target = binding?.providers?.[0]?.participantId;
    if (!target) return null;
    const peers = participant?.getNetworkState()?.peers || [];
    return peers.find(peer => peer.participantId === target)?.peerId ?? null;
  };

  function findMatchingRoute(requested, allowPartitionFallback = false) {
    const available = (participant?.getState()?.models || []).filter(model => model.id === requested.id
      && model.identity === requested.identity
      && (requested.partition ? model.availability === 'ready' : ['ready', 'busy'].includes(model.availability))
      && same(partitionAdapterIdentities(model), partitionAdapterIdentities(requested)));
    return requested.partition ? available.find(model => same(model.partition, requested.partition))
      : available.find(model => !model.partition) || (allowPartitionFallback ? available.find(model => model.partition && model.availability === 'ready') : null);
  }

  function freeDispatchSlots(chosen, activeProvidersByAttempt, startingDispatches) {
    if (!chosen) return 0;
    const busyKeys = new Set();
    for (const value of activeProvidersByAttempt.values()) {
      for (const key of Array.isArray(value) ? value : [value]) {
        if (typeof key === 'string' && key) busyKeys.add(key);
      }
    }
    if (chosen.partition) {
      return chosen.availability === 'ready' && busyKeys.size === 0 && startingDispatches === 0 ? 1 : 0;
    }
    const peers = participant?.getNetworkState()?.peers || [];
    const matching = peers.filter(peer => peer.readiness === 'ready' && peer.model === chosen.id
      && (!chosen.identity || peer.modelIdentity === chosen.identity));
    if (matching.length > 0) {
      const seenParticipants = new Set();
      const freePeers = matching.reduce((sum, peer) => {
        const participantKey = peer.participantId || peer.peerId;
        if (busyKeys.has(peer.peerId) || (participantKey && (busyKeys.has(participantKey) || seenParticipants.has(participantKey)))) return sum;
        if (participantKey) seenParticipants.add(participantKey);
        const slots = Number.isSafeInteger(peer.availableSlots) && peer.availableSlots > 0 ? peer.availableSlots : 0;
        return sum + slots;
      }, 0);
      return Math.max(0, freePeers - startingDispatches);
    }
    return chosen.availability === 'ready' && busyKeys.size === 0 && startingDispatches === 0 ? 1 : 0;
  }

  const laneScheduler = createFairLaneScheduler({
    enabled: config.followPlacement === true,
    capacityWaitMs: config.capacityWaitMs,
    canDrain: () => !closed && !preparing,
    findRoute: findMatchingRoute,
    freeSlots: freeDispatchSlots,
    onPoll: () => publishDemand()
  });
  const acquireDispatchSlot = options => laneScheduler.acquire(options);
  const drainRequesterQueue = () => laneScheduler.drain();
  const state = () => ({ computerId: config.computerId, name: config.name, participantId: identity.peerId,
    selected: selected && { modelId: selected.model.id, modelIdentity: selected.model.identity, mode: selected.mode },
    preparing, activeRequests: requests.size, queuedRequests: laneScheduler.queuedCount(), error: lastError, hardware: fleetHardwareSnapshot(),
    execution: participant?.getState() ?? null, network: participant?.getNetworkState() ?? null });

  let startupProviderCleaned = false;
  async function reconcileCredits() {
    if (!credits) return [];
    const results = [];
    if (!startupProviderCleaned && !participant && !preparing) {
      try {
        const orphaned = await credits.call('providerOpenMine', {});
        for (const row of orphaned) {
          if (row.binding?.providers?.[0]?.participantId !== identity.peerId) continue;
          const terminal = await signGenerationTerminal({
            requestId: row.binding.executionId,
            provider: identity.peerId,
            consumer: row.binding.consumer,
            model: row.binding.model.id,
            modelIdentity: row.binding.model.identity,
            adapterIdentities: row.binding.model.adapterIdentities || [],
            inputDigest: row.binding.inputDigest
          }, 'failed', identity);
          results.push(await credits.collect(row.id, { terminal }));
        }
        startupProviderCleaned = true;
      } catch {
        // Retry startup provider orphan cleanup on the next pre-mesh reconcile if service was unreachable.
      }
    }
    const reconciled = await credits.reconcile(requests.size === 0 ? { activeIds: [] } : {});
    for (const row of reconciled) {
      if (!results.some(prior => prior.id === row.id)) results.push(row);
    }
    return results;
  }
  await reconcileCredits().catch(() => {});

  async function select(index, contribute) {
    assert(!closed && !preparing && requests.size === 0, 'Computer is busy or closing');
    const entry = config.models[index]; assert(entry, 'Model is outside owner preferences');
    const activity = participant?.getState();
    assert(activeProviderRequests(activity) === 0, 'Active provider cannot move');
    preparing = true; lastError = null;
    try {
      if (participant) await participant.close();
      participant = null; selected = null;
      const bytes = await fs.readFile(path.join(entry.directory, 'manifest.json'));
      assert('sha256:' + createHash('sha256').update(bytes).digest('hex') === entry.model.identity, 'Owner-selected model manifest changed');
      participant = await createNativeParticipant({ model: entry.model, modelDirectory: entry.directory, identity, rtc, WebSocket,
        signalingUrl: config.signalingUrl, roomId: config.roomId, roomToken, nativeGpu: () => gpu.open(),
        cacheDirectory: null, owner, executionMode: entry.mode, ordered: entry.ordered ?? null,
        executionAdmission: credits ? createFleetExecutionAdmission({ credits, model: entry.model }) : null,
        generationJournalFile: path.join(path.dirname(config.identityFile), 'generation.sqlite'),
        logger: { info() {}, log() {}, debug() {}, warn: (...args) => onChange({ warning: args.join(' ') }), error: (...args) => onChange({ error: args.join(' ') }) },
        onChange: () => { drainRequesterQueue(); onChange(state()); } });
      selected = entry;
      if (contribute) await participant.contribute(true);
      assert(participant.getState()?.phase !== 'failed', participant.getState()?.error || 'Model preparation failed');
      preparedAt = Date.now(); return state();
    } catch (error) { lastError = error.message; throw error; }
    finally { preparing = false; drainRequesterQueue(); onChange(state()); }
  }
  async function reconcile() {
    assert(credits && config.observationFile, 'Configured credit service and measured envelopes required for automatic placement');
    await reconcileCredits();
    const observation = JSON.parse(await fs.readFile(config.observationFile, 'utf8'));
    // Generated after the package closure is collected; it cannot hash itself as an input.
    const delivery = await fs.readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'native-delivery.json'));
    observation.softwareIdentity = 'sha256:' + createHash('sha256').update(delivery).digest('hex');
    const activity = participant?.getState();
    const hardware = fleetHardwareSnapshot();
    observation.id = config.computerId; observation.participantId = identity.peerId; observation.observedAt = Date.now();
    observation.preparing = preparing;
    observation.activeRequests = requests.size + activeProviderRequests(activity);
    const residentActive = Boolean(selected && (activity?.ready || ['ready', 'executing', 'draining'].includes(activity?.phase)));
    const residentHostBytes = residentActive ? (hardware.processResidentBytes ?? 0) : 0;
    const ownedHostBudget = Math.min(observation.preferences.maxHostBytes,
      owner?.policy.memory?.maxProcessResidentBytes ?? observation.preferences.maxHostBytes);
    observation.freeHostBytes = Math.max(0, Math.min(hardware.freeHostBytes, ownedHostBudget - residentHostBytes));
    observation.capacityScope = 'owned-gpu-buffer-budget';
    const ownedBudget = Math.min(observation.preferences.maxGpuBytes, owner?.policy.memory?.maxGpuBufferBytes ?? observation.preferences.maxGpuBytes);
    observation.freeGpuBytes = Math.max(0, ownedBudget - (hardware.gpuBuffers?.liveBytes ?? 0));
    if (hardware.maxStorageBufferBindingSize !== null) observation.maxStorageBufferBindingSize = hardware.maxStorageBufferBindingSize;
    const contextCache = activity?.contextCache ?? null;
    observation.resident = residentActive ? {
      modelIdentity: selected.model.identity, mode: selected.mode,
      preparedAt, planId: selected.model.partitionPlanId ?? null, stageIndex: selected.ordered?.stage?.index ?? null,
      gpuBytes: hardware.gpuBuffers?.liveBytes ?? 0,
      peakGpuBytes: hardware.gpuBuffers?.peakBytes ?? 0,
      hostBytes: residentHostBytes,
      ...(contextCache ? { cachedContexts: contextCache.entries, contextCacheBytes: contextCache.allocatedBytes } : {})
    } : null;
    await credits.call('observe', observation);
    const plan = await credits.call('plan', {}), decision = plan.decisions.find(row => row.computerId === config.computerId);
    if (decision?.action === 'stop' && observation.activeRequests === 0 && participant) {
      await participant.stop();
    }
    if (decision?.action === 'prepare' && observation.activeRequests === 0) {
      const index = config.models.findIndex(entry => entry.model.id === decision.modelId && entry.model.identity === decision.modelIdentity
        && entry.mode === decision.mode && (entry.model.partitionPlanId ?? null) === decision.planId
        && (entry.ordered?.stage?.index ?? null) === decision.stageIndex);
      assert(index >= 0, 'Plan does not match an owner-approved runtime configuration');
      await select(index, true);
    }
    return plan;
  }
  async function publishDemand() {
    if (!credits || config.followPlacement !== true) return;
    const demand = new Map();
    for (const { request, since } of requests.values()) {
      const key = request.model.id + request.model.identity, prior = demand.get(key);
      // This is a scheduling estimate, never a token meter or a credit charge.
      const promptTokens = Math.max(1, Math.ceil(Buffer.byteLength(request.messages.map(row => row.content).join('\n')) / 4));
      demand.set(key, { id: request.model.id, identity: request.model.identity, queued: (prior?.queued || 0) + 1,
        since: Math.min(prior?.since ?? since, since), promptTokens: Math.max(prior?.promptTokens || 0, promptTokens),
        outputTokens: config.maxOutputTokens, estimate: 'input-utf8-bytes-div4' });
    }
    await credits.call('demand', { id: config.computerId, requests: [...demand.values()] });
  }
  const textParticipant = Object.freeze({
    roomId: config.roomId,
    executionClass: 'private-pool',
    getState: () => participant?.getState() ?? { models: [] },
    generate: (request, controls) => {
      assert(participant && !closed && !preparing, 'Requester unavailable');
      return participant.generate(request, controls);
    },
    recoverGeneration: (request, reference, controls) => {
      assert(participant && !closed && !preparing, 'Requester unavailable');
      return participant.recoverGeneration(request, reference, controls);
    }
  });
  const requesterPorts = extra => ({
    identity, credits, maxOutputTokens: config.maxOutputTokens,
    onOutcome: recordOutcome, lookupOutcome, resolveProviderId, ...extra
  });
  async function recordPreDispatchFailure(request, error) {
    const recordedAt = Date.now();
    const outcome = recordOutcome(buildFleetRequestOutcome({
      attemptId: request.attemptId ?? null,
      threadId: request.threadId ?? null,
      mode: request.model?.partition ? 'partition' : 'whole-model',
      model: request.model,
      inputDigest: await hashJson(request.messages),
      phase: 'queued',
      dispatched: false,
      acknowledged: { deltaCount: 0, outputCharacters: 0, acknowledgedOutputTokens: 0 },
      settlement: { status: 'cancelled_queued', charge: 0, outputTokens: 0, settledAt: recordedAt },
      maximum: 0,
      recordedAt
    }));
    if (error && typeof error === 'object' && !error.disconnect) error.disconnect = outcome;
    return outcome;
  }
  return Object.freeze({ identity, state, select, reconcile, reconcileCredits, textParticipant,
    outcome: id => lookupOutcome(id),
    async inspectOutcome(id) {
      const prior = lookupOutcome(id);
      const reservationId = prior?.reservationId ?? (typeof id === 'string' && id.startsWith('service:') ? id : null);
      if (!reservationId || !credits) return prior;
      let row;
      try { row = await credits.call('request', { id: reservationId }); }
      catch { return prior; }
      if (!row) return prior;
      const dispatched = row.state !== 'reserved' && row.state !== 'abandoned';
      const settlement = row.state === 'settled' ? row.outcome
        : row.state === 'abandoned' ? { status: 'abandoned', charge: 0, outputTokens: 0, settledAt: row.binding.createdAt }
        : { id: reservationId, status: 'pending' };
      const settledCompleted = row.state === 'settled' && !['cancelled', 'failed'].includes(row.outcome?.status);
      return recordOutcome(buildFleetRequestOutcome({
        attemptId: prior?.attemptId ?? null,
        threadId: prior?.threadId ?? null,
        reservationId,
        executionId: row.binding.executionId,
        mode: row.binding.mode,
        model: row.binding.model,
        providerId: prior?.providerId ?? null,
        providerIdentity: row.binding.providers[0]?.participantId ?? null,
        inputDigest: row.binding.inputDigest,
        phase: dispatched ? 'in-flight' : 'queued',
        dispatched,
        acknowledged: {
          deltaCount: prior?.acknowledged?.deltaCount ?? 0,
          outputCharacters: prior?.acknowledged?.outputCharacters ?? 0,
          acknowledgedOutputTokens: settledCompleted ? (row.outcome.outputTokens ?? 0) : (prior?.acknowledged?.acknowledgedOutputTokens ?? 0)
        },
        settlement,
        maximum: dispatched ? row.binding.maximum : 0,
        recordedAt: Date.now()
      }));
    },
    allowsModel: model => config.models.some(entry => entry.model.id === model?.id && entry.model.identity === model?.identity),
    async enrolledRecipients() {
      assert(credits, 'Service credits are not configured');
      const network = await credits.call('computers', {});
      return new Set((network.computers || []).flatMap(row => row.participantIds || []));
    },
    async runAccountedGeneration(request, controls, execute) {
      assert(participant && !closed && !preparing && !requests.has(request.attemptId), 'Requester unavailable or attempt already active');
      assert(credits, 'Service credits are not configured');
      assert(Number.isSafeInteger(config.maxOutputTokens) && config.maxOutputTokens > 0, 'Explicit fleet output limit required');
      if (request.generationRequest && request.generationRequest.maxOutputTokens > config.maxOutputTokens) {
        throw Object.assign(Error('max_output_tokens exceeds fleet credit policy'), { status: 400, param: 'max_output_tokens' });
      }
      const controller = new AbortController();
      const abort = () => controller.abort(controls.signal.reason);
      controls.signal.addEventListener('abort', abort, { once: true });
      if (controls.signal.aborted) abort();
      requests.set(request.attemptId, { controller, request, since: Date.now() });
      let slot = null;
      try {
        await publishDemand();
        try {
          slot = await acquireDispatchSlot({
            attemptId: request.attemptId,
            threadId: request.threadId,
            requestedModel: request.model,
            allowPartitionFallback: false,
            signal: controller.signal
          });
        } catch (error) {
          await recordPreDispatchFailure(request, error);
          throw error;
        }
        const wrappedControls = {
          ...controls,
          signal: controller.signal,
          requestApproval: async disclosure => {
            slot?.markDisclosed?.([disclosure?.providerId, typeof disclosure?.recipientIdentity === 'string' ? disclosure.recipientIdentity : null].filter(Boolean));
            return controls.requestApproval(disclosure);
          }
        };
        const requester = createFleetRequester(requesterPorts({
          participant: { generate: execute, recoverGeneration: textParticipant.recoverGeneration }
        }));
        const result = await requester.generate(request, wrappedControls);
        return {
          ...result,
          execution: {
            ...result.execution,
            ...(slot.queuedMs > 0 ? { admission: { ...(result.execution?.admission || {}), queuedMs: slot.queuedMs } } : {}),
            serviceCredit: result.serviceCredit
          }
        };
      } finally {
        slot?.release?.();
        controls.signal.removeEventListener('abort', abort);
        requests.delete(request.attemptId);
        await publishDemand().catch(error => onChange({ warning: error.message }));
      }
    },
    async recoverAccountedGeneration(input, controls, recoverExecution) {
      assert(participant && !closed && !preparing, 'Requester unavailable');
      assert(credits, 'Service credits are not configured');
      const requester = createFleetRequester(requesterPorts({ participant: textParticipant }));
      return requester.recover(input, controls, recoverExecution);
    },
    async recover(input, signal = AbortSignal.timeout(30000)) {
      assert(participant && !closed && !preparing, 'Requester unavailable');
      assert(credits, 'Service credits are not configured');
      const requester = createFleetRequester(requesterPorts({ participant }));
      return requester.recover(input, { signal });
    },
    async browserState() {
      assert(credits, 'Service credits are not configured');
      const network = await credits.call('computers', {});
      const poolIdentity = 'sha256:' + createHash('sha256').update(JSON.stringify(network.computers.map(row =>
        [row.id, row.participantIds]))).digest('hex');
      const available = participant?.getState()?.models || [];
      const models = [...new Map(config.models.map(entry => [entry.model.id + entry.model.identity, entry.model])).values()].map(model => {
        const routes = available.filter(row => row.id === model.id && row.identity === model.identity && !row.adapters?.length);
        const status = routes.some(row => row.availability === 'ready') ? 'ready'
          : routes.some(row => row.availability === 'busy') ? 'busy' : routes.some(row => ['loading', 'preparing'].includes(row.availability)) ? 'loading' : 'unavailable';
        return { id: model.id, identity: model.identity, name: model.name || model.id, provider: 'doppler',
          contextLength: model.contextLength, generation: model.generation, availability: status };
      });
      return { schema: 'reploid.fleet-browser/v1', poolIdentity, requester: { id: config.computerId, name: config.name, participantId: identity.peerId },
        models, computers: includeRequesterPresence(network.computers, state(), network.at), at: network.at };
    },
    async receipt(id) { assert(credits, 'Service credits are not configured'); return credits.call('request', { id }); },
    async balances() { assert(credits, 'Service credits are not configured'); await reconcileCredits(); return credits.call('snapshot', {}); },
    async generate(request, onDelta = () => {}, onRoute = () => {}, onAdmission = () => {}) {
      assert(participant && !closed && !preparing && !requests.has(request.attemptId), 'Requester unavailable or attempt already active');
      request = structuredClone(request);
      const configured = config.models.find(entry => entry.model.id === request.model.id && entry.model.identity === request.model.identity);
      assert(configured, 'Model is outside owner preferences');
      request.model = { ...structuredClone(configured.model), ...(request.model.partition ? { partition: request.model.partition } : {}) };
      const controller = new AbortController(); requests.set(request.attemptId, { controller, request, since: Date.now() });
      let slot = null;
      try {
        await publishDemand();
        try {
          slot = await acquireDispatchSlot({
            attemptId: request.attemptId,
            threadId: request.threadId,
            requestedModel: request.model,
            allowPartitionFallback: true,
            signal: controller.signal,
            onAdmission
          });
          if (slot.chosen) request.model = structuredClone(slot.chosen);
        } catch (error) {
          await recordPreDispatchFailure(request, error);
          throw error;
        }
        const controls = { signal: controller.signal, onDelta,
          requestApproval: async disclosure => {
            assert(same(disclosure.input?.messages, request.messages), 'Changed prompt disclosure');
            slot?.markDisclosed?.([disclosure?.providerId, typeof disclosure?.recipientIdentity === 'string' ? disclosure.recipientIdentity : null].filter(Boolean));
            onRoute(disclosure);
            return true; // Explicit generate command is the local owner's disclosure instruction.
          } };
        const requester = credits ? createFleetRequester(requesterPorts({ participant })) : participant;
        const result = await requester.generate(request, controls);
        return slot.queuedMs > 0
          ? { ...result, execution: { ...result.execution, admission: { ...(result.execution?.admission || {}), queuedMs: slot.queuedMs } } }
          : result;
      } finally {
        slot?.release?.();
        requests.delete(request.attemptId);
        await publishDemand().catch(error => onChange({ warning: error.message }));
      }
    },
    cancel(attemptId) { requests.get(attemptId)?.controller.abort(new DOMException('Stopped by owner', 'AbortError')); },
    async close() {
      closed = true;
      laneScheduler.close();
      for (const { controller } of requests.values()) controller.abort();
      try { await participant?.close(); } finally { await owner?.close(); await gpu.close(); }
    }
  });
}

export async function runFleetNativeCommands({ host, config, input = process.stdin, signals = process }) {
  const pending = new Set(); let lines = null;
  let timer = null, browserBridge = null, textApi = null;
  if (config.auto === true) {
    assert(Number.isSafeInteger(config.pollMs) && config.pollMs >= 1000, 'Explicit bounded placement interval required');
    let busy = false;
    timer = setInterval(async () => {
      if (busy) return; busy = true;
      try { await host.reconcile(); } catch (error) { process.stderr.write(JSON.stringify({ event: 'fleet-error', error: error.message }) + '\n'); }
      finally { busy = false; }
    }, config.pollMs);
  }
  let stopped = false, endDaemon;
  const daemonStopped = new Promise(resolve => { endDaemon = resolve; });
  const stop = () => { stopped = true; lines?.close(); endDaemon(); };
  signals.once('SIGTERM', stop); signals.once('SIGINT', stop);
  try {
    if (Number.isSafeInteger(config.initialModel)) await host.select(config.initialModel, config.initialContribution === true);
    if (typeof host.reconcileCredits === 'function') {
      await host.reconcileCredits().catch(error => process.stderr.write(JSON.stringify({ event: 'fleet-error', error: error.message }) + '\n'));
    }
    const browserBridgeToken = config.browserBridge ? (await readOwnFile(config.browserBridge.tokenFile)).trim() : null;
    if (config.browserBridge) browserBridge = await startFleetBrowserBridge({ host, ...config.browserBridge,
      token: browserBridgeToken });
    if (config.textApi) {
      const tls = config.textApi.tls ? (assert(path.isAbsolute(config.textApi.tls.certFile), 'Absolute TLS certificate path required'),
        { key: await readOwnFile(config.textApi.tls.keyFile), cert: await fs.readFile(config.textApi.tls.certFile) }) : null;
      const mountedBridge = config.browserBridge ? {
        origins: config.browserBridge.origins,
        token: browserBridgeToken,
        basePath: config.browserBridge.tunnelPath ?? '/bridge',
        ...(config.browserBridge.maxBodyBytes !== undefined ? { maxBodyBytes: config.browserBridge.maxBodyBytes } : {}),
        ...(config.browserBridge.maxConcurrent !== undefined ? { maxConcurrent: config.browserBridge.maxConcurrent } : {})
      } : null;
      textApi = await startFleetTextApi({ host, ...config.textApi, tls,
        ...(mountedBridge ? { browserBridge: mountedBridge } : {}),
        token: (await readOwnFile(config.textApi.tokenFile)).trim() });
    }
    // Readline begins consuming immediately: create it only when its iterator can
    // subscribe, after asynchronous model/bridge setup, or EOF can be lost.
    if (!stopped) lines = createInterface({ input });
    for await (const line of lines || []) {
      const operation = (async () => {
        let command;
        try {
          command = JSON.parse(line);
          let result;
          if (command.op === 'select') result = await host.select(command.index, command.contribute === true);
          else if (command.op === 'state') result = host.state();
          else if (command.op === 'reconcile') result = await host.reconcile();
          else if (command.op === 'balances') result = await host.balances();
          else if (command.op === 'generate') result = await host.generate(command.request,
            delta => console.log(JSON.stringify({ id: command.id, delta })));
          else if (command.op === 'cancel') result = host.cancel(command.attemptId) ?? { cancelled: true };
          else if (command.op === 'outcome') result = await host.inspectOutcome(command.targetId);
          else if (command.op === 'recover') result = await host.recover(command.input);
          else throw Error('Unknown native fleet command');
          console.log(JSON.stringify({ id: command.id, result }));
        } catch (error) { console.log(JSON.stringify({ id: command?.id, error: error.message })); }
      })();
      pending.add(operation); operation.finally(() => pending.delete(operation));
    }
    if (config.daemon === true && !stopped) await daemonStopped;
  } finally {
    signals.removeListener('SIGTERM', stop); signals.removeListener('SIGINT', stop);
    clearInterval(timer); await textApi?.close(); await browserBridge?.close(); await host.close(); await Promise.allSettled(pending);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
  const host = await openFleetNativeHost({ configuration: config, onChange: value => process.stderr.write(JSON.stringify({ event: 'fleet-state', ...value }) + '\n') });
  console.log(JSON.stringify({ ready: true, computerId: config.computerId, participantId: host.identity.peerId, publicJwk: host.identity.publicJwk }));
  await runFleetNativeCommands({ host, config });
}
