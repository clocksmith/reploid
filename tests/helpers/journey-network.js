/**
 * One in-process network for the whole-request journey: a coordinator, several test-owned providers and a
 * requester that holds no model files. Real: signing identities, the peer generation mesh, the custody
 * exchange that moves model pieces, the generation journal, the fleet credit service over HTTP with its
 * SQLite ledger, provider admission and the requester wrappers. Test-owned: the transport (an in-memory
 * hub that counts bytes and can stop a node or lose a message) and the generator (a fixed answer emitted
 * at each provider's declared rate). Nothing here is GPU inference or a physical network.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createPeerGenerationMesh } from '../../packages/reploid/src/mesh/peer-generation.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { signGenerationTerminal } from '../../packages/reploid/src/artifacts/generation-terminal.js';
import { openNativeGenerationJournal } from '../../server/native-generation-journal.js';
import { createNativeModelFiles } from '../../server/native-model-files.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { startFleetService, createFleetClient } from '../../server/fleet/service.js';
import { createFleetRequester } from '../../server/fleet/requester.js';
import { createFleetExecutionAdmission } from '../../server/fleet/execution-admission.js';
import { createWholeModelRequester } from '../../server/whole-model-requester.js';
import { GENERATION_SETTINGS_CAPABILITY } from '../../packages/reploid/src/mesh/generation-settings.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason); return; }
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  signal?.addEventListener('abort', abort, { once: true });
});
export async function waitFor(check, { timeoutMs = 5000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw Error(`Timed out waiting for ${label}`);
    await sleep(5);
  }
}

export const JOURNEY_ANSWER = ['The', ' request', ' crossed', ' the', ' network', ' and', ' came', ' back', ' whole', ' and', ' in', ' order.'];
const promptTokens = messages => messages.reduce((count, message) => count + String(message.content).split(/\s+/).filter(Boolean).length, 0);

/** A small synthetic checkpoint with the real manifest and verified-piece index shapes. */
export function createJourneyModel({ shards = 2, piecesPerShard = 4, pieceBytes = 16384, maxOutputTokens = 16 } = {}) {
  const files = new Map(), index = [];
  for (let shard = 0; shard < shards; shard++) {
    const pieces = Array.from({ length: piecesPerShard }, (_, piece) => {
      const bytes = Buffer.alloc(pieceBytes);
      for (let at = 0; at < pieceBytes; at += 32) createHash('sha256').update(`journey:${shard}:${piece}:${at}`).digest().copy(bytes, at);
      return bytes;
    });
    const name = `weights-${shard}.bin`;
    files.set(name, Buffer.concat(pieces));
    index.push({ path: name, size: pieceBytes * piecesPerShard,
      pieces: pieces.map((bytes, piece) => ({ offset: piece * pieceBytes, size: pieceBytes, identity: 'sha256:' + sha(bytes) })) });
  }
  const manifest = Buffer.from(JSON.stringify({ modelId: 'journey-model', hashAlgorithm: 'sha256',
    shards: [...files].map(([filename, bytes]) => ({ filename, size: bytes.length, hash: sha(bytes) })) }));
  const pieceIndex = Buffer.from(JSON.stringify({ schema: 'doppler.verified-pieces/v1', manifestIdentity: 'sha256:' + sha(manifest),
    maxPieceBytes: pieceBytes, files: index }));
  files.set('manifest.json', manifest); files.set('pieces.json', pieceIndex);
  const model = { id: 'journey-model', identity: 'sha256:' + sha(manifest), generation: { maxTokens: maxOutputTokens }, source: { files: [
    { path: 'manifest.json', role: 'model-manifest', sizeBytes: manifest.length, hashAlgorithm: 'sha256', hash: sha(manifest) },
    { path: 'pieces.json', role: 'model-piece-index', sizeBytes: pieceIndex.length, hashAlgorithm: 'sha256', hash: sha(pieceIndex) }] } };
  return { model, files, weightBytes: shards * piecesPerShard * pieceBytes, pieceCount: shards * piecesPerShard,
    pieces: index.flatMap(file => file.pieces.map(piece => ({ path: file.path, ...piece }))) };
}

/** In-memory transport shared by every node: counted, and able to stop a node or lose chosen messages. */
function createHub() {
  const nodes = new Map(), traffic = [], rules = new Set();
  const live = id => nodes.get(id)?.alive === true;
  const connected = id => [...nodes.keys()].filter(other => other !== id && live(other) && live(id));
  function deliver(from, to, type, payload) {
    if (!live(from) || !live(to)) return false;
    payload = structuredClone(payload);
    const entry = { from, to, type, bytes: Buffer.byteLength(JSON.stringify(payload) ?? ''), at: Date.now() };
    for (const rule of rules) if (rule(entry, payload)) { traffic.push({ ...entry, lost: true }); return true; }
    traffic.push(entry);
    queueMicrotask(() => {
      const target = nodes.get(to);
      if (!live(from) || !target?.alive) return;
      for (const handler of target.handlers.get(type) || []) {
        Promise.resolve().then(() => handler(from, payload)).catch(error => target.errors.push(error));
      }
    });
    return true;
  }
  function channelPair(from, to, label) {
    const pair = [new EventTarget(), new EventTarget()], owners = [from, to];
    pair.forEach((channel, side) => Object.assign(channel, { label, ordered: true, maxRetransmits: null, maxPacketLifeTime: null,
      readyState: 'open', bufferedAmount: 0,
      send(data) {
        const bytes = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength ?? 0;
        traffic.push({ from: owners[side], to: owners[1 - side], type: 'data-channel:' + label, bytes, at: Date.now() });
        queueMicrotask(() => {
          if (pair[1 - side].readyState === 'open') pair[1 - side].dispatchEvent(new MessageEvent('message', { data: structuredClone(data) }));
        });
      },
      close() {
        if (channel.readyState === 'closed') return;
        channel.readyState = 'closed'; channel.dispatchEvent(new Event('close'));
        queueMicrotask(() => pair[1 - side].close());
      } }));
    for (const owner of owners) nodes.get(owner)?.channels.add(pair[owners.indexOf(owner)]);
    return pair;
  }
  return {
    traffic, errors: () => [...nodes.values()].flatMap(node => node.errors),
    join(id, bus) {
      if (nodes.has(id)) throw Error('Duplicate node ' + id);
      const node = { id, alive: true, handlers: new Map(), channelHandlers: new Map(), channels: new Set(), errors: [], bus };
      nodes.set(id, node);
      for (const other of nodes.values()) if (other !== node && other.alive) other.bus.emit('swarm:peer-joined', { peerId: id });
      return {
        init: async () => true, disconnect() {}, getPeerId: () => id, getTransportType: () => 'in-memory-test-hub',
        getConnectionState: () => connected(id).length ? 'connected' : 'disconnected',
        getConnectedPeers: () => connected(id).map(peer => ({ id: peer })),
        getPeerStates: () => connected(id).map(peer => ({ id: peer, phase: 'connected', channelState: 'open', iceState: 'connected' })),
        getPeerBinding: remote => live(remote) ? { local: 'cert-' + id, remote: 'cert-' + remote } : null,
        onMessage(type, handler) {
          if (!node.handlers.has(type)) node.handlers.set(type, new Set());
          node.handlers.get(type).add(handler);
          return () => node.handlers.get(type)?.delete(handler);
        },
        sendToPeer: (peer, type, payload) => deliver(id, peer, type, payload),
        broadcast(type, payload) { for (const peer of connected(id)) deliver(id, peer, type, payload); return true; },
        onDataChannel(label, handler) { node.channelHandlers.set(label, handler); return () => node.channelHandlers.delete(label); },
        openDataChannel(peer, label) {
          const [near, far] = channelPair(id, peer, label), accept = nodes.get(peer)?.channelHandlers.get(label);
          if (live(peer) && accept) accept(id, far); else queueMicrotask(() => near.close());
          return near;
        }
      };
    },
    /** The node stops at once: nothing more is sent or received, and its peers see the connection drop. */
    stop(id) {
      const node = nodes.get(id);
      if (!node?.alive) return;
      node.alive = false;
      for (const channel of node.channels) channel.close();
      for (const other of nodes.values()) if (other.alive) other.bus.emit('swarm:peer-disconnected', { peerId: id });
    },
    forget(id) { nodes.delete(id); },
    /** Loses matching messages in transit. The sender still believes it sent them. */
    lose(rule) { rules.add(rule); return () => rules.delete(rule); },
    mark: () => traffic.length,
    summarize(since = 0, until = traffic.length) {
      const byType = {}, byPair = {};
      let bytes = 0, messages = 0, lost = 0;
      for (const entry of traffic.slice(since, until)) {
        bytes += entry.bytes; messages += 1; if (entry.lost) lost += 1;
        byType[entry.type] = (byType[entry.type] ?? 0) + entry.bytes;
        const pair = `${entry.from}->${entry.to}`; byPair[pair] = (byPair[pair] ?? 0) + entry.bytes;
      }
      return { bytes, messages, lost, byType, byPair };
    }
  };
}

function events() {
  const listeners = new Map();
  return {
    on(name, handler) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(handler);
      return () => listeners.get(name)?.delete(handler);
    },
    emit(name, value) { for (const handler of [...(listeners.get(name) || [])]) handler(value); }
  };
}

/**
 * providers: [{ name, tokensPerSecond, holdsModel, appliesOutputLimit }] in connection-id order. The requester never has model files.
 */
export async function createJourneyNetwork({ providers, modelOptions = {}, maxOutputTokens = 16 }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'network-journey-')), cleanup = [];
  const fixture = createJourneyModel({ ...modelOptions, maxOutputTokens }), { model } = fixture;
  const hub = createHub(), software = 'sha256:' + sha('journey-test-provider/1');
  const requesterIdentity = await createSigningIdentity({ algorithm: 'Ed25519' });
  const seats = await Promise.all(providers.map(async spec => ({ ...spec, identity: await createSigningIdentity({ algorithm: 'Ed25519' }),
    computerId: 'computer-' + spec.name, directory: path.join(root, spec.name, 'model'), cacheDirectory: path.join(root, spec.name, 'cache'),
    journalFile: path.join(root, spec.name, 'generation.sqlite'), generation: 0, executions: 0, tokensEmitted: 0, cleanups: [], ready: false })));
  // The ledger's clock can be moved forward so a claim window can pass without waiting for it.
  const ledgerClock = { aheadMs: 0 };
  const credits = await openFleetCredits({ file: path.join(root, 'credits.sqlite'), now: () => Date.now() + ledgerClock.aheadMs,
    computers: [{ id: 'computer-requester', name: 'Requester', ownerId: 'owner-requester',
      providers: [{ participantId: requesterIdentity.peerId, publicJwk: requesterIdentity.publicJwk }] },
    ...seats.map(seat => ({ id: seat.computerId, name: seat.name, ownerId: 'owner-' + seat.name,
      providers: [{ participantId: seat.identity.peerId, publicJwk: seat.identity.publicJwk }] }))],
    policy: { schema: 'reploid.service-credit-policy/v1', version: 'journey/1', unit: 'noncash-service-credit',
      creditsPerOutputToken: 1, maxDebt: 1000, maxOutputTokens, maxPendingPerComputer: 3,
      maxClockSkewMs: 10000, maxRequestMs: 60000, allowSameOwner: false, wholeModelTerminalCharge: 0,
      wholeModelUnclaimedReleaseMs: 30000 } });
  const service = await startFleetService({ credits, models: [model],
    placementPolicy: { maxMeasurementAgeMs: 60000, maxObservationAgeMs: 10000, minResidencyMs: 1, maxRouteCandidates: 100, queuedRequestsPerReplica: 2 } });
  cleanup.push(async () => { await service.close(); credits.close(); });

  async function writeModel(directory) {
    await fs.mkdir(directory, { recursive: true });
    for (const [name, bytes] of fixture.files) await fs.writeFile(path.join(directory, name), bytes);
  }
  async function verifyDirectory(directory) {
    const manifest = JSON.parse(fixture.files.get('manifest.json'));
    try {
      if ('sha256:' + sha(await fs.readFile(path.join(directory, 'manifest.json'))) !== model.identity) return false;
      for (const shard of manifest.shards) if (sha(await fs.readFile(path.join(directory, shard.filename))) !== shard.hash) return false;
      return true;
    } catch { return false; }
  }
  const config = () => resolveConfig({ overrides: { mesh: { enabled: true, executeJobs: true, roomId: 'network-journey' } } });

  /** Opens (or reopens after a stop) one provider process: transport, custody, journal, admission and mesh. */
  async function openProvider(seat) {
    seat.generation += 1;
    const id = seat.generation === 1 ? seat.name : `${seat.name}-restart-${seat.generation - 1}`;
    const bus = events(), run = { id, stopped: false, abort: new AbortController() };
    const transport = hub.join(id, bus), client = createFleetClient({ url: service.url, identity: seat.identity });
    const admission = createFleetExecutionAdmission({ credits: client, model });
    await fs.mkdir(seat.directory, { recursive: true }); await fs.mkdir(seat.cacheDirectory, { recursive: true });
    const files = await createNativeModelFiles({ transport, modelDirectory: seat.directory, cacheDirectory: seat.cacheDirectory });
    const journal = await openNativeGenerationJournal({ file: seat.journalFile, maxResults: 8, maxResultBytes: 65536 });
    // What the native runtime does on start: an execution admitted before the stop is closed with signed
    // failure evidence, and only then is its credit hold released.
    const reconciled = [];
    for (const binding of await journal.unfinished()) {
      if (binding?.provider !== seat.identity.peerId) continue;
      const terminal = await signGenerationTerminal(binding, 'failed', seat.identity);
      await journal.finish(binding, { type: 'reploid:generation-error',
        payload: { requestId: binding.requestId, error: 'Provider restarted after unfinished execution', terminal } });
      const settled = await admission.terminal(terminal);
      seat.cleanups.push({ requestId: binding.requestId, how: 'restart-reconciliation', at: Date.now() });
      reconciled.push({ requestId: binding.requestId, settlement: settled });
    }
    let mesh;
    mesh = createPeerGenerationMesh({ config: config(), ports: {
      instanceId: 'journey:' + id, modelConfig: model, events: bus, eventBus: bus, utils: { generateId: () => randomUUID() },
      getExecutionState: () => ({ phase: seat.ready && !run.stopped ? 'ready' : 'idle', modelIdentity: model.identity, adapterIdentities: [] }),
      identity: { ensure: async () => seat.identity, sync: async () => {}, save: async () => {} },
      generationJournal: journal,
      // A stopped process confirms nothing, so it signs nothing.
      settleGeneration: async () => {
        if (run.stopped) return false;
        seat.cleanups.push({ how: 'confirmed-while-running', at: Date.now() });
        return true;
      },
      onGenerationTerminal: terminal => admission.terminal(terminal),
      onReceipt: receipt => admission.receipt(receipt),
      admitsBeforeDisclosure: true,
      authorize: async input => !run.stopped && (input.action === 'mesh.connect'
        || input.action === 'mesh.admit' && seat.ready
          && await admission.preadmit({ request: input.request, consumer: await mesh.verifyPeerIdentity(input.peerId) }) !== undefined
        || input.action === 'mesh.execute' && seat.ready
          && await admission.whole({ request: input.request, consumer: await mesh.verifyPeerIdentity(input.peerId) })),
      generate: async (messages, update, controls) => {
        seat.executions += 1;
        const signal = AbortSignal.any([controls.signal, run.abort.signal]);
        const tokens = JOURNEY_ANSWER.slice(0, controls.settings?.maxOutputTokens ?? JOURNEY_ANSWER.length);
        for (const token of tokens) {
          await sleep(1000 / seat.tokensPerSecond, signal);
          seat.tokensEmitted += 1; update(token);
        }
        return { model: model.id, modelIdentity: model.identity, adapterIdentities: [], content: tokens.join(''),
          completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: promptTokens(messages),
            generatedTokenCount: tokens.length, stopReason: tokens.length < JOURNEY_ANSWER.length ? 'max-tokens' : 'eos-token' } };
      },
      ...(seat.appliesOutputLimit ? { getGenerationSettingsCapability: () => ({ ...GENERATION_SETTINGS_CAPABILITY, maxOutputTokens: true }) } : {}),
      createTransport: () => transport
    } });
    await mesh.connect();
    Object.assign(run, { mesh, files, journal, client, bus });
    seat.run = run;
    return reconciled;
  }
  async function observe(seat) {
    const at = Date.now();
    await seat.run.client.call('observe', { id: seat.computerId, participantId: seat.identity.peerId, observedAt: at, activeRequests: 0,
      softwareIdentity: software, freeGpuBytes: 1 << 30, freeHostBytes: 1 << 30, maxStorageBufferBindingSize: 1 << 28,
      resident: { modelIdentity: model.identity, mode: 'whole-model', preparedAt: at - 5000, gpuBytes: fixture.weightBytes, hostBytes: fixture.weightBytes },
      preferences: { enabled: true, models: [{ id: model.id, identity: model.identity }], maxGpuBytes: 1 << 30, maxHostBytes: 1 << 30 },
      // The rate is declared by the test provider and is the rate its generator really runs at.
      measurements: [{ modelIdentity: model.identity, mode: 'whole-model', stageIndex: null, planId: null, softwareIdentity: software,
        qualified: true, receipt: 'test-provider-declared-rate', observedAt: at - 1, maxPromptTokens: 256, maxOutputTokens,
        prefillTokensPerSecond: seat.tokensPerSecond * 8, decodeTokensPerSecond: seat.tokensPerSecond, loadMs: 100,
        requiredGpuBytes: fixture.weightBytes, requiredHostBytes: fixture.weightBytes, largestBindingBytes: fixture.weightBytes }] });
  }
  async function becomeReady(seat) {
    if (!await verifyDirectory(seat.directory)) throw Error(`${seat.name} does not hold a verified model`);
    await seat.run.files.share(model, true);
    seat.ready = true; seat.run.mesh.refreshAdvertisement();
    await observe(seat);
  }

  // Requester: no model directory, no custody host, no generator.
  const requesterBus = events(), requesterTransport = hub.join('requester', requesterBus);
  const requesterClient = createFleetClient({ url: service.url, identity: requesterIdentity });
  const ranking = { enabled: false, order: [], source: null };
  let whole;
  const requesterMesh = createPeerGenerationMesh({ config: config(), ports: {
    instanceId: 'journey:requester', modelConfig: null, events: requesterBus, eventBus: requesterBus, utils: { generateId: () => randomUUID() },
    getExecutionState: () => ({ phase: 'idle', modelIdentity: null, adapterIdentities: [] }),
    identity: { ensure: async () => requesterIdentity, sync: async () => {}, save: async () => {} },
    generationJournal: null,
    authorize: async input => input.action === 'mesh.connect' || input.action === 'mesh.dispatch' && await whole.authorize(input) === true,
    generate: async () => { throw Error('The requester holds no model'); },
    rankProviders: candidates => ranking.enabled
      ? ranking.order.filter(identity => candidates.some(candidate => candidate.verifiedIdentity === identity)) : null,
    createTransport: () => requesterTransport
  } });
  await requesterMesh.connect();
  whole = createWholeModelRequester({ mesh: requesterMesh, models: [model] });
  const outcomes = [];
  const requester = createFleetRequester({ participant: { generate: whole.generate, recoverGeneration: whole.recover },
    identity: requesterIdentity, credits: requesterClient, maxOutputTokens,
    onOutcome: outcome => outcomes.push(outcome), lookupOutcome: id => outcomes.findLast(outcome => outcome.reservationId === id) ?? null });

  for (const seat of seats) {
    if (seat.holdsModel) await writeModel(seat.directory);
    await openProvider(seat);
    if (seat.holdsModel) await becomeReady(seat);
  }
  const seatOf = value => seats.find(seat => [seat.name, seat.run?.id, seat.identity.peerId, seat.computerId].includes(value)) ?? null;
  const readyPeers = () => (requesterMesh.getSwarmSnapshot().peers || []).filter(peer => peer.readiness === 'ready' && peer.role === 'provider');
  const expectReady = count => waitFor(() => readyPeers().length === count, { label: `${count} ready providers` });
  await expectReady(seats.filter(seat => seat.ready).length);
  cleanup.push(async () => {
    await Promise.allSettled([requesterMesh.close(), ...seats.map(seat => seat.run?.mesh.close())]);
    await Promise.allSettled(seats.map(seat => seat.run?.files.close()));
    for (const seat of seats) try { seat.run?.journal.close(); } catch { /* already closed by a stop */ }
  });

  return {
    model, fixture, hub, credits, requester, requesterClient, requesterIdentity, requesterMesh, whole, outcomes, seats, seatOf, ranking,
    readyPeers, expectReady, observe, verifyDirectory, promptTokens,
    /** Moves the ledger's clock past the request deadline and the claim window. Nothing may settle afterwards. */
    passClaimWindow() { ledgerClock.aheadMs += credits.policy.maxRequestMs + credits.policy.wholeModelUnclaimedReleaseMs; return ledgerClock.aheadMs; },
    /** A provider that lacks the model completes its directory from peers, verifies it and only then offers service. */
    async fill(name) {
      const seat = seatOf(name), progress = [], mark = hub.mark(), started = Date.now();
      const result = await seat.run.files.fillWholeModel(model, { onProgress: event => progress.push(structuredClone(event)) });
      const elapsedMs = Date.now() - started, verified = await verifyDirectory(seat.directory);
      await becomeReady(seat);
      return { result, progress, elapsedMs, verified, traffic: hub.summarize(mark) };
    },
    /** The requester proves each ready provider's identity, then asks the coordinator for its measured order. */
    async rank(messages, enabled) {
      ranking.enabled = enabled; ranking.order = []; ranking.source = null;
      if (!enabled) return null;
      for (const peer of readyPeers()) await requesterMesh.verifyPeerIdentity(peer.peerId);
      const ranked = await requesterClient.call('rank', { id: model.id, identity: model.identity,
        promptTokens: promptTokens(messages), outputTokens: JOURNEY_ANSWER.length });
      ranking.order = ranked.providers.flatMap(row => row.participantIds); ranking.source = ranked;
      return ranked;
    },
    /** Stops a provider process without any orderly shutdown. */
    async stop(name) {
      const seat = seatOf(name), run = seat.run, at = Date.now();
      run.stopped = true; hub.stop(run.id);
      run.abort.abort(Error('Provider process stopped'));
      // Dispose of the dead process's handles. None of this is visible to the network.
      await run.mesh.close().catch(() => {}); await run.files.close().catch(() => {});
      run.journal.close();
      return at;
    },
    async restart(name) {
      const seat = seatOf(name), reconciled = await openProvider(seat);
      await becomeReady(seat);
      return { connectionId: seat.run.id, reconciled };
    },
    async close() {
      for (const step of cleanup.reverse()) await step();
      await fs.rm(root, { recursive: true, force: true });
    }
  };
}
