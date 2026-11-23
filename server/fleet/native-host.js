#!/usr/bin/env node
import fs from 'node:fs/promises';
import { constants, readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { inspectDeviceMemory } from 'dopplerx/partitions';
import { getDevice, getKernelCapabilities } from 'dopplerx/tooling/device';
import { createExecutionPolicy, requestExecutionPolicy, assertAvailableExecutionPolicy, plaintextExecutionRoute, bindExecutionRoute, sameExecutionBinding } from '../../packages/reploid/src/chat/execution-policy.js';
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
import { createStageHistory } from './stage-history.js';
import { openStageOwner } from './stage-owner.js';
import { createFleetExecutionAdmission } from './execution-admission.js';
import { openStageTokenWitness } from './stage-token-witness.js';
import { createFairLaneScheduler } from './fair-lane-scheduler.js';
export { createFairLaneScheduler } from './fair-lane-scheduler.js';
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

export async function readOwnFile(file) {
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

/** One process owns one GPU host. Model changes drain the old resident before preparing another. */
export async function openFleetNativeHost({ configuration, loadRtc = () => import('@roamhq/wrtc'), loadSocket = () => import('ws'),
  loadGpu = () => import('webgpu'), onChange = () => {} }) {
  const config = structuredClone(configuration);
  assert(config.schema === 'reploid.fleet-native/v1' && text(config.computerId) && text(config.name)
    && Array.isArray(config.models) && config.models.length > 0
    && config.models.every(row => ['partition', 'whole-model'].includes(row.mode)), 'Explicit fleet native configuration required');
  assert(text(config.roomId) && config.roomId !== bootstrap.publicRoomId && config.roomTokenFile,
    'Operator fleet models require an explicit private room');
  assert(config.hostCandidatesOnly === undefined || typeof config.hostCandidatesOnly === 'boolean',
    'hostCandidatesOnly must be a boolean');
  assert(config.cacheDirectory === undefined || path.isAbsolute(config.cacheDirectory), 'Absolute piece cache directory required');
  assert(config.maxCacheBytes === undefined || (config.cacheDirectory && Number.isSafeInteger(config.maxCacheBytes) && config.maxCacheBytes > 0),
    'maxCacheBytes requires a piece cache directory and a positive integer byte count');
  const identity = await openComputerIdentity(config.identityFile);
  const tokenWitness = config.localTokenWitness ? await openStageTokenWitness(config.localTokenWitness,
    { roomId: config.roomId, participantId: identity.peerId }) : null;
  const [rtcModule, socketModule] = await Promise.all([loadRtc(), loadSocket()]);
  const rtc = createNativeRtcAdapter(rtcModule.default ?? rtcModule), Socket = socketModule.default ?? socketModule.WebSocket;
  class WebSocket extends Socket { constructor(url) { super(url, { origin: config.origin || 'http://localhost:8000' }); } }
  const serviceCa = config.serviceCaFile ? (assert(path.isAbsolute(config.serviceCaFile), 'Absolute service CA certificate path required'),
    await fs.readFile(config.serviceCaFile)) : null;
  const gpu = createNativeGpuHost(loadGpu), credits = config.serviceUrl ? createFleetClient({ url: config.serviceUrl, identity, ca: serviceCa,
    outboxFile: path.join(path.dirname(config.identityFile), 'service-credit-outbox.json') }) : null;
  const owner = config.ownerPolicyFile ? await openNativeOwnerControls({ file: config.ownerPolicyFile, custody: custodyPolicy,
    readGpuBuffers: async () => (await import('dopplerx/partitions')).inspectDeviceMemory() }) : null;
  const roomToken = config.roomTokenFile ? process.getuid ? await readNativeRoomTokenFile(config.roomTokenFile)
    : (await readOwnFile(config.roomTokenFile)).replace(/\r?\n$/, '') : null;
  let participant = null, selected = null, preparing = false, closed = false, lastError = null, preparedAt = null;
  // Opt-in: the coordinator's measured order over whole-model providers, refreshed before each credited request.
  const providerRanking = { order: [], estimates: [] };
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
  const stageHistory = createStageHistory({ credits, participantId: identity.peerId,
    notify: () => { if (!closed) onChange(state()); }, pollMs: config.pollMs ?? 5000 });
  const executionState = () => stageHistory.view(participant?.getState() ?? null);
  const state = () => ({ computerId: config.computerId, name: config.name, participantId: identity.peerId,
    selected: selected && { modelId: selected.model.id, modelIdentity: selected.model.identity, mode: selected.mode },
    preparing, activeRequests: requests.size, queuedRequests: laneScheduler.queuedCount(), error: lastError, hardware: fleetHardwareSnapshot(),
    execution: executionState(), network: participant?.getNetworkState() ?? null });

  const stageOwner = credits && config.models.some(entry => entry.mode === 'partition' && entry.ordered?.stage)
    ? await openStageOwner({ file: config.identityFile + '.stage-owner.sqlite', participantId: identity.peerId,
      roomId: config.roomId, serviceUrl: config.serviceUrl }) : null;
  let startupProviderCleaned = false;
  async function reconcileCredits() {
    if (!credits) return [];
    const results = stageOwner ? await stageOwner.recover(credits) : [];
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
    await stageHistory.refresh(participant?.getState());
    for (const row of reconciled) {
      if (!results.some(prior => prior.id === row.id)) results.push(row);
    }
    return results;
  }
  await reconcileCredits().catch(() => {});

  async function select(index, contribute) {
    assert(!closed && !preparing && requests.size === 0, 'Computer is busy or closing');
    const entry = config.models[index]; assert(entry, 'Model is outside owner preferences');
    if (credits && participant?.getState()?.unknownAttempts?.length) {
      preparing = true;
      try { await stageHistory.refresh(participant.getState()); }
      finally { preparing = false; }
      assert(!closed && requests.size === 0, 'Computer is busy or closing');
    }
    const activity = executionState();
    assert(activeProviderRequests(activity) === 0, 'Active provider cannot move');
    preparing = true; lastError = null;
    try {
      if (participant) await participant.close();
      participant = null; selected = null;
      // With a piece cache, a whole-model directory that lacks its manifest is completed from authorized peers
      // before loading; the fill verifies every piece and file against the model's pinned identities.
      const fillable = Boolean(config.cacheDirectory) && entry.mode === 'whole-model' && entry.fillFromPeers === true;
      const manifestIdentity = async () => 'sha256:' + createHash('sha256')
        .update(await fs.readFile(path.join(entry.directory, 'manifest.json'))).digest('hex');
      const present = await fs.access(path.join(entry.directory, 'manifest.json')).then(() => true, () => false);
      if (present || !fillable) assert(await manifestIdentity() === entry.model.identity, 'Owner-selected model manifest changed');
      participant = await createNativeParticipant({ model: entry.model, modelDirectory: entry.directory, identity, rtc, WebSocket,
        signalingUrl: config.signalingUrl, roomId: config.roomId, roomToken, nativeGpu: () => gpu.open(),
        ...(config.hostCandidatesOnly ? { getRtcConfig: () => ({ iceServers: [], iceTransportPolicy: 'all' }) } : {}),
        cacheDirectory: config.cacheDirectory ?? null, maxCacheBytes: config.maxCacheBytes,
        owner, executionMode: entry.mode, ordered: entry.ordered ?? null,
        ...(tokenWitness && entry.ordered ? { localStageWitness: tokenWitness } : {}),
        rankProviders: () => config.rankProviders === true && providerRanking.order.length ? providerRanking.order : null,
        onModelFill: progress => onChange({ modelFill: progress }),
        executionAdmission: credits ? createFleetExecutionAdmission({ credits, model: entry.model, stageOwner: entry.ordered?.stage ? stageOwner : null }) : null,
        generationJournalFile: path.join(path.dirname(config.identityFile), 'generation.sqlite'),
        logger: { info() {}, log() {}, debug() {}, warn: (...args) => onChange({ warning: args.join(' ') }), error: (...args) => onChange({ error: args.join(' ') }) },
        onChange: () => { drainRequesterQueue(); onChange(state()); } });
      selected = entry;
      if (contribute) await participant.contribute(true);
      assert(participant.getState()?.phase !== 'failed', participant.getState()?.error || 'Model preparation failed');
      if (contribute && fillable && !present) assert(await manifestIdentity() === entry.model.identity, 'Filled model manifest differs from the selected model');
      // Supplying this model's pieces to other computers in the room is a separate owner choice.
      if (contribute && config.cacheDirectory && entry.mode === 'whole-model' && entry.shareModelFiles === true) await participant.shareFiles(true);
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
    const activity = executionState();
    const hardware = fleetHardwareSnapshot();
    observation.id = config.computerId; observation.participantId = identity.peerId; observation.observedAt = Date.now();
    observation.preparing = preparing;
    observation.activeRequests = requests.size + activeProviderRequests(activity);
    // Requester work and unsettled receipts are ownership, not compute queue occupancy.
    observation.deviceQueue = selected?.mode === 'whole-model' && activity?.deviceQueue
      ? structuredClone(activity.deviceQueue) : null;
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
    partitionOutputLimit(model) {
      const entry = config.models.find(entry => entry.mode === 'partition' && entry.model.id === model.id && entry.model.identity === model.identity
        && (!entry.model.partitionPlanId || entry.model.partitionPlanId === model.partition?.planId));
      return Math.min(config.maxOutputTokens, entry?.model.generation?.maxTokens ?? config.maxOutputTokens);
    },
    getState: () => participant?.getState() ?? { models: [] },
    getNetworkState: () => participant?.getNetworkState() ?? { peers: [] },
    verifyProviders: signal => participant.verifyProviders(signal),
    generate: (request, controls) => {
      assert(participant && !closed && !preparing, 'Requester unavailable');
      return participant.generate(request, controls);
    },
    recoverGeneration: (request, reference, controls) => {
      assert(participant && !closed && !preparing, 'Requester unavailable');
      return participant.recoverGeneration(request, reference, controls);
    },
    /** After an answer: the same provider's signed score of a target, bound to that answer's receipt. */
    scoreTarget: request => {
      assert(participant && !closed && !preparing, 'Requester unavailable');
      return participant.scoreTarget(request);
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
    // A fenced partition is recovered entirely from the durable coordinator and signed stages.
    // Only recovery that actually contacts a provider needs a live mesh participant.
    async recoverAccountedGeneration(input, controls, recoverExecution) {
      assert(!closed && !preparing, 'Requester unavailable');
      assert(credits, 'Service credits are not configured');
      const requester = createFleetRequester(requesterPorts({ participant: textParticipant }));
      return requester.recover(input, controls, recoverExecution);
    },
    async recover(input, signal = AbortSignal.timeout(30000)) {
      assert(!closed && !preparing, 'Requester unavailable');
      assert(credits, 'Service credits are not configured');
      const requester = createFleetRequester(requesterPorts({ participant: textParticipant }));
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
          contextLength: model.contextLength, generation: model.generation, availability: status,
          executionRoutes: routes.flatMap(selected => {
            if (selected.partition?.schema === 'reploid.partition-selection/v2') {
              const selection = { id: model.id, identity: model.identity, partition: selected.partition };
              return [{ selection, route: plaintextExecutionRoute({ model: selection }, {
                recipients: [...new Set([identity.peerId, ...selected.partition.route.stages.map(stage => stage.participantId)])],
                route: selected.partition.route }) }];
            }
            return Object.values(selected.verifiedProviderIdentities || {}).map(providerIdentity => ({
              selection: { id: model.id, identity: model.identity }, route: plaintextExecutionRoute({ model }, {
                recipients: [...new Set([identity.peerId, providerIdentity])],
                route: { schema: 'reploid.paired-whole-route/v1', requester: identity.peerId, providerIdentity } }) }));
          }) };
      });
      return { schema: 'reploid.fleet-browser/v1', privacyProtocol: 'reploid.paired-route/v3', poolIdentity, requester: { id: config.computerId, name: config.name, participantId: identity.peerId },
        models, computers: includeRequesterPresence(network.computers, state(), network.at), at: network.at };
    },
    async receipt(id) { assert(credits, 'Service credits are not configured'); return credits.call('request', { id }); },
    async balances() { assert(credits, 'Service credits are not configured'); await reconcileCredits(); return credits.call('snapshot', {}); },
    async statement() { assert(credits, 'Service credits are not configured'); await reconcileCredits(); return credits.call('statementMine', {}); },
    async generate(request, onDelta = () => {}, onRoute = () => {}, onAdmission = () => {}) {
      assert(participant && !closed && !preparing && !requests.has(request.attemptId), 'Requester unavailable or attempt already active');
      request = structuredClone(request);
      request.privacy = assertAvailableExecutionPolicy(requestExecutionPolicy(request));
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
            allowPartitionFallback: request.privacyBinding ? false : true,
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
            const workers = [...new Set(disclosure.route
              ? disclosure.route.stages.map(stage => stage.participantId) : [disclosure.recipientIdentity])];
            const enrolled = new Set((await credits.call('computers', {})).computers.flatMap(row => row.participantIds || []));
            assert(workers.length > 0 && workers.every(id => enrolled.has(id)), 'Execution worker is not enrolled; nothing was sent');
            const recipients = [...new Set([...(request.privacyBinding ? [identity.peerId] : []), ...workers])];
            const route = plaintextExecutionRoute(request, { recipients, route: disclosure.route
              ?? { schema: 'reploid.paired-whole-route/v1', requester: identity.peerId, providerIdentity: disclosure.recipientIdentity } });
            const checked = await bindExecutionRoute(request, route);
            if (request.privacyBinding) {
              assert(sameExecutionBinding(checked, request.privacyBinding), 'Paired execution route changed; no prompt was sent to the replacement');
            }
            controller.signal.throwIfAborted();
            slot?.markDisclosed?.([disclosure?.providerId, typeof disclosure?.recipientIdentity === 'string' ? disclosure.recipientIdentity : null].filter(Boolean));
            onRoute(disclosure);
            return true; // Explicit generate command is the local owner's disclosure instruction.
          } };
        let placement = null;
        if (credits && config.rankProviders === true && !request.model.partition) {
          try {
            await participant.verifyProviders(controller.signal);
            // The input size is a UTF-8 byte estimate, as for published demand; it is not a token count.
            const ranked = await credits.call('rank', { id: request.model.id, identity: request.model.identity,
              promptTokens: Math.max(1, Math.ceil(Buffer.byteLength(request.messages.map(row => row.content).join('\n')) / 4)),
              outputTokens: Math.min(config.maxOutputTokens, request.model.generation?.maxTokens ?? config.maxOutputTokens) });
            providerRanking.order = ranked.providers.flatMap(row => row.participantIds);
            providerRanking.estimates = ranked.providers.map(row => ({ computerId: row.computerId, estimatedMs: row.estimatedMs, busy: row.busy }));
          } catch (error) {
            controller.signal.throwIfAborted();
            providerRanking.order = []; providerRanking.estimates = [];
            onChange({ warning: 'Provider ranking unavailable; using the default order: ' + error.message });
          }
          controls.onRoute = chosen => { placement = { ...(chosen.placement ?? {}), estimates: structuredClone(providerRanking.estimates) }; };
        }
        const requester = credits ? createFleetRequester(requesterPorts({ participant })) : participant;
        let result = await requester.generate(request, controls);
        if (placement) result = { ...result, execution: { ...result.execution, placement } };
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
      await stageOwner?.close();
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
          else if (command.op === 'statement') result = await host.statement();
          // `events: true` also reports the route as soon as it is approved, for callers that must act mid-answer.
          else if (command.op === 'generate') {
            // Stdin is the owner-command boundary. It supplies an explicit policy for its own
            // request, never for missing or stale browser/mesh requests.
            const request = structuredClone(command.request);
            if (!Object.hasOwn(request, 'privacy')) {
              const enrolled = await host.enrolledRecipients();
              const pins = config.textApi?.allowedRecipients;
              const ids = [...enrolled].filter(id => !pins || pins.includes(id)).sort();
              request.privacy = createExecutionPolicy({ placement: 'network-allowed',
                recipients: { kind: 'named', ids } });
            }
            result = await host.generate(request,
              delta => console.log(JSON.stringify({ id: command.id, delta })),
              command.events !== true ? undefined : route => console.log(JSON.stringify({ id: command.id, event: 'route',
                // `admission` is present when the prompt waits for the named recipient's decision.
                route: { requestId: route.requestId, providerId: route.providerId, recipientIdentity: route.recipientIdentity ?? null,
                  ...(route.admission ? { admission: route.admission } : {}) } })));
          } else if (command.op === 'cancel') result = host.cancel(command.attemptId) ?? { cancelled: true };
          else if (command.op === 'outcome') result = await host.inspectOutcome(command.targetId);
          else if (command.op === 'recover') result = await host.recover(command.input);
          else throw Error('Unknown native fleet command');
          console.log(JSON.stringify({ id: command.id, result }));
        } catch (error) {
          console.log(JSON.stringify({ id: command?.id, error: error.message,
            ...(command?.events === true ? { outcome: error.disconnect ?? null, serviceCredit: error.serviceCredit ?? null } : {}) }));
        }
      })();
      pending.add(operation); operation.finally(() => pending.delete(operation));
    }
    if (config.daemon === true && !stopped) await daemonStopped;
  } finally {
    signals.removeListener('SIGTERM', stop); signals.removeListener('SIGINT', stop);
    clearInterval(timer); await textApi?.close(); await browserBridge?.close(); await host.close(); await Promise.allSettled(pending);
  }
}

// npm starts a package command through a symbolic link, so real paths are compared.
const entered = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (entered) {
  const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
  const host = await openFleetNativeHost({ configuration: config, onChange: value => process.stderr.write(JSON.stringify({ event: 'fleet-state', ...value }) + '\n') });
  console.log(JSON.stringify({ ready: true, computerId: config.computerId, participantId: host.identity.peerId, publicJwk: host.identity.publicJwk }));
  await runFleetNativeCommands({ host, config });
}
