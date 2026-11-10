#!/usr/bin/env node
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { inspectDeviceMemory } from 'doppler-gpu/partitions';
import { getDevice, getKernelCapabilities } from 'doppler-gpu/tooling/device';
import { createSigningIdentity, createPeerIdFromPublicJwk } from '../../packages/reploid/src/artifacts/identity.js';
import { createNativeParticipant, createNativeRtcAdapter, createNativeGpuHost, readNativeRoomTokenFile } from '../native-participant.js';
import { openNativeOwnerControls } from '../native-owner/controls.js';
import custodyPolicy from '../../apps/poolday/config/chat-files.json' with { type: 'json' };
import bootstrap from '../../shared/config/swarm-bootstrap.json' with { type: 'json' };
import { startFleetBrowserBridge } from './browser-bridge.js';
import { createFleetClient } from './service.js';
import { createFleetRequester } from './requester.js';
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

export function fleetHardwareSnapshot() {
  const device = getDevice(), memory = inspectDeviceMemory();
  return { platform: process.platform, totalHostBytes: os.totalmem(), freeHostBytes: os.freemem(),
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
  const identity = await openComputerIdentity(config.identityFile);
  const [rtcModule, socketModule] = await Promise.all([loadRtc(), loadSocket()]);
  const rtc = createNativeRtcAdapter(rtcModule.default ?? rtcModule), Socket = socketModule.default ?? socketModule.WebSocket;
  class WebSocket extends Socket { constructor(url) { super(url, { origin: config.origin || 'http://localhost:8000' }); } }
  const gpu = createNativeGpuHost(loadGpu), credits = config.serviceUrl ? createFleetClient({ url: config.serviceUrl, identity,
    outboxFile: path.join(path.dirname(config.identityFile), 'service-credit-outbox.json') }) : null;
  const owner = config.ownerPolicyFile ? await openNativeOwnerControls({ file: config.ownerPolicyFile, custody: custodyPolicy,
    readGpuBuffers: async () => (await import('doppler-gpu/partitions')).inspectDeviceMemory() }) : null;
  const roomToken = config.roomTokenFile ? process.getuid ? await readNativeRoomTokenFile(config.roomTokenFile)
    : (await readOwnFile(config.roomTokenFile)).replace(/\r?\n$/, '') : null;
  let participant = null, selected = null, preparing = false, closed = false, lastError = null, preparedAt = null;
  const requests = new Map();
  const state = () => ({ computerId: config.computerId, name: config.name, participantId: identity.peerId,
    selected: selected && { modelId: selected.model.id, modelIdentity: selected.model.identity, mode: selected.mode },
    preparing, activeRequests: requests.size, error: lastError, hardware: fleetHardwareSnapshot(), execution: participant?.getState() ?? null,
    network: participant?.getNetworkState() ?? null });
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
        onChange: () => onChange(state()) });
      selected = entry;
      if (contribute) await participant.contribute(true);
      assert(participant.getState()?.phase !== 'failed', participant.getState()?.error || 'Model preparation failed');
      preparedAt = Date.now(); return state();
    } catch (error) { lastError = error.message; throw error; }
    finally { preparing = false; onChange(state()); }
  }
  async function reconcile() {
    assert(credits && config.observationFile, 'Configured credit service and measured envelopes required for automatic placement');
    await credits.reconcile();
    const observation = JSON.parse(await fs.readFile(config.observationFile, 'utf8'));
    // Generated after the package closure is collected; it cannot hash itself as an input.
    const delivery = await fs.readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'native-delivery.json'));
    observation.softwareIdentity = 'sha256:' + createHash('sha256').update(delivery).digest('hex');
    const activity = participant?.getState();
    const hardware = fleetHardwareSnapshot();
    observation.id = config.computerId; observation.participantId = identity.peerId; observation.observedAt = Date.now();
    observation.preparing = preparing;
    observation.activeRequests = requests.size + activeProviderRequests(activity);
    observation.freeHostBytes = Math.min(observation.freeHostBytes, hardware.freeHostBytes);
    observation.capacityScope = 'owned-gpu-buffer-budget';
    const ownedBudget = Math.min(observation.preferences.maxGpuBytes, owner?.policy.memory?.maxGpuBufferBytes ?? observation.preferences.maxGpuBytes);
    observation.freeGpuBytes = Math.max(0, ownedBudget - (hardware.gpuBuffers?.liveBytes ?? 0));
    if (hardware.maxStorageBufferBindingSize !== null) observation.maxStorageBufferBindingSize = hardware.maxStorageBufferBindingSize;
    observation.resident = selected && (activity?.ready || ['ready', 'executing', 'draining'].includes(activity?.phase)) ? { modelIdentity: selected.model.identity, mode: selected.mode,
      preparedAt, planId: selected.model.partitionPlanId ?? null, stageIndex: selected.ordered?.stage?.index ?? null,
      gpuBytes: hardware.gpuBuffers?.liveBytes ?? 0, hostBytes: 0 } : null;
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
      const promptTokens = Buffer.byteLength(request.messages.map(row => row.content).join('\n'));
      demand.set(key, { id: request.model.id, identity: request.model.identity, queued: (prior?.queued || 0) + 1,
        since: Math.min(prior?.since ?? since, since), promptTokens: Math.max(prior?.promptTokens || 0, promptTokens),
        outputTokens: config.maxOutputTokens, estimate: 'input-utf8-bytes' });
    }
    await credits.call('demand', { id: config.computerId, requests: [...demand.values()] });
  }
  return Object.freeze({ identity, state, select, reconcile,
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
    async balances() { assert(credits, 'Service credits are not configured'); await credits.reconcile(); return credits.call('snapshot', {}); },
    async generate(request, onDelta = () => {}, onRoute = () => {}) {
      assert(participant && !closed && !preparing && !requests.has(request.attemptId), 'Requester unavailable or attempt already active');
      request = structuredClone(request);
      const configured = config.models.find(entry => entry.model.id === request.model.id && entry.model.identity === request.model.identity);
      assert(configured, 'Model is outside owner preferences');
      request.model = { ...structuredClone(configured.model), ...(request.model.partition ? { partition: request.model.partition } : {}) };
      const controller = new AbortController(); requests.set(request.attemptId, { controller, request, since: Date.now() });
      try {
        await publishDemand();
        if (config.followPlacement === true) {
          assert(Number.isSafeInteger(config.capacityWaitMs) && config.capacityWaitMs > 0, 'Explicit capacity wait bound required');
          const end = Date.now() + config.capacityWaitMs;
          for (;;) {
            controller.signal.throwIfAborted();
            const available = (participant.getState().models || []).filter(model => model.id === request.model.id
              && model.identity === request.model.identity && model.availability === 'ready'
              && same(partitionAdapterIdentities(model), partitionAdapterIdentities(request.model)));
            const chosen = request.model.partition ? available.find(model => same(model.partition, request.model.partition))
              : available.find(model => !model.partition) || available.find(model => model.partition);
            if (chosen) { request.model = structuredClone(chosen); break; }
            assert(Date.now() < end, 'No ready capacity within the configured wait');
            await delay(1000, undefined, { signal: controller.signal });
            await publishDemand();
          }
        }
        const controls = { signal: controller.signal, onDelta,
          requestApproval: async disclosure => {
            assert(same(disclosure.input?.messages, request.messages), 'Changed prompt disclosure');
            onRoute(disclosure);
            return true; // Explicit generate command is the local owner's disclosure instruction.
          } };
        const requester = credits ? createFleetRequester({ participant, identity, credits, maxOutputTokens: config.maxOutputTokens }) : participant;
        return await requester.generate(request, controls);
      } finally { requests.delete(request.attemptId); await publishDemand().catch(error => onChange({ warning: error.message })); }
    },
    cancel(attemptId) { requests.get(attemptId)?.controller.abort(new DOMException('Stopped by owner', 'AbortError')); },
    async close() {
      closed = true; for (const { controller } of requests.values()) controller.abort();
      try { await participant?.close(); } finally { await owner?.close(); await gpu.close(); }
    }
  });
}

export async function runFleetNativeCommands({ host, config, input = process.stdin, signals = process }) {
  const pending = new Set(); let lines = null;
  let timer = null, browserBridge = null;
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
    if (config.browserBridge) browserBridge = await startFleetBrowserBridge({ host, ...config.browserBridge,
      token: (await readOwnFile(config.browserBridge.tokenFile)).trim() });
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
          else throw Error('Unknown native fleet command');
          console.log(JSON.stringify({ id: command.id, result }));
        } catch (error) { console.log(JSON.stringify({ id: command?.id, error: error.message })); }
      })();
      pending.add(operation); operation.finally(() => pending.delete(operation));
    }
  } finally {
    if (config.daemon === true && !stopped) await daemonStopped;
    signals.removeListener('SIGTERM', stop); signals.removeListener('SIGINT', stop);
    clearInterval(timer); await browserBridge?.close(); await host.close(); await Promise.allSettled(pending);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
  const host = await openFleetNativeHost({ configuration: config, onChange: value => process.stderr.write(JSON.stringify({ event: 'fleet-state', ...value }) + '\n') });
  console.log(JSON.stringify({ ready: true, computerId: config.computerId, participantId: host.identity.peerId, publicJwk: host.identity.publicJwk }));
  await runFleetNativeCommands({ host, config });
}
