import { createPartitionDataChannel } from '../../transport/partition-data-channel.js';
import { createPartitionPeer } from './partition-peer.js';
import { createPartitionEntry } from './partition-entry.js';
import { createPartitionChat } from './partition-chat.js';
import { createPartitionGrantAuthority } from './partition-grants.js';
import { canonicalPartitionJson, assertPartition as assert } from './partition-contract.js';

/** Automatic placement over authenticated discovery. Only the supplied host
 * loader may open Doppler, and only after local contribution approval. */
export function createAutomaticPartitions({ identity, meshId, models, policy, peers, createNetwork,
  loadProgram, onChange = () => {} }) {
  const config = structuredClone(policy), catalog = structuredClone(models);
  assert(identity?.peerId && typeof peers === 'function' && typeof createNetwork === 'function'
    && typeof loadProgram === 'function' && Number.isSafeInteger(config.pollMs) && config.pollMs > 0,
  'Automatic partitions require identity, discovery, loader and explicit policy');
  const listeners = new Set(), connections = new Map(), admissions = new Map();
  const lifetime = new AbortController();
  let offer = null, program = null, execution = null, chat = null, executionPeer = null, preparing = null;
  let contributionController = null;
  let phase = 'idle', error = null, progress = null, placement = null, closed = false, ticking = null;
  const authority = createPartitionGrantAuthority({ identity, meshId,
    maxGrants: config.limits.maxAttempts, maxTtlMs: config.grantMs });
  const fresh = peer => peer.description && Date.now() - peer.describedAt < config.inputLimits.descriptorTtlMs;
  const getModels = () => [...connections.values()].filter(fresh).flatMap(peer => peer.description.models || []);
  const getState = () => ({ phase, error, progress: structuredClone(progress), offering: !!offer, modelId: offer?.id || null,
    placement: structuredClone(placement), descriptor: program?.resident.getState().descriptor || null,
    acquisition: program?.getReceipt?.() || null, models: getModels() });
  const notify = () => { onChange(getState()); for (const listener of listeners) listener(getModels()); };
  const service = {
    getModels: () => chat?.getModels() || [],
    async refresh(options) { await tick(); return chat?.refresh(options); },
    generate: (request, controls) => {
      assert(chat && offer && !closed, 'Partition input owner unavailable');
      return chat.generate(request, controls);
    }
  };
  const entries = createNetwork({ label: 'reploid-partitions-input',
    maxPeers: config.maxPeers, timeoutMs: config.connectTimeoutMs,
    createEndpoint: ({ channel, remoteParticipantId }) => createPartitionEntry({ channel,
      localParticipantId: identity.peerId, remoteParticipantId, service,
      limits: config.inputChannel, inputLimits: config.inputLimits,
      async authorize(input, { action }) {
        if (['send', 'accept'].includes(action)) {
          const admitted = admissions.get(input.attemptId);
          return !!admitted && canonicalPartitionJson(admitted) === canonicalPartitionJson(input);
        }
        return !!offer && program?.resident.index === 0 && !!chat
          && input.requesterId === remoteParticipantId && input.participantA === identity.peerId
          && input.participantB === placement?.[1] && input.modelIdentity === offer.identity
          && input.planId === program.planId;
      }
    }) });
  const controls = createNetwork({ label: 'reploid-partitions-control',
    maxPeers: config.maxPeers, timeoutMs: config.connectTimeoutMs,
    createEndpoint: ({ channel, remoteParticipantId }) => {
      const endpoint = createPartitionDataChannel({ channel, localParticipantId: identity.peerId,
        remoteParticipantId, limits: config.controlChannel,
        authorize: async ({ metadata, byteLength }) => metadata.operation === 'describe' && byteLength === 0,
        async serve() {
          return { participantId: identity.peerId, offer: offer && { id: offer.id, identity: offer.identity },
            phase, placement, index: program?.resident.index ?? placement?.indexOf(identity.peerId) ?? null,
            planId: program?.planId ?? null,
            models: chat?.getModels() || [] };
        } });
      const peer = { endpoint, participantId: remoteParticipantId, description: null, describedAt: 0, channel, close: () => endpoint.close() };
      channel.addEventListener('close', () => {
        for (const [id, value] of connections) if (value === peer) connections.delete(id);
        notify();
      }, { once: true });
      return peer;
    },
    onPeer(transportId, peer) { connections.set(transportId, peer); }
  });
  async function retire() {
    await chat?.close(); chat = null; executionPeer = null;
    await execution?.close(); execution = null;
    await program?.resident.close(); program = null; placement = null;
  }
  async function reconcile() {
    if (!offer || preparing || closed || phase === 'failed') return;
    const compatible = [...connections.values()].filter(peer => fresh(peer) && peer.description.phase !== 'failed'
      && peer.description?.offer?.id === offer.id
      && peer.description.offer.identity === offer.identity);
    const candidates = [{ id: identity.peerId, index: program?.resident.index ?? null },
      ...compatible.map(peer => ({ id: peer.participantId, index: peer.description.index }))].sort((a, b) => a.id.localeCompare(b.id));
    const ids = candidates.map(peer => peer.id);
    // An existing A stays the input owner. Later arrivals prepare B coverage
    // without replacing a healthy participant or moving active generation state.
    const retainedA = placement && ids.includes(placement[0])
      && candidates.find(peer => peer.id === placement[0])?.index === 0 ? placement[0] : null;
    const a = retainedA || candidates.find(peer => peer.index === 0)?.id
      || candidates.find(peer => peer.index === null)?.id || ids[0];
    const b = identity.peerId !== a ? identity.peerId
      : placement?.[0] === a && ids.includes(placement[1]) ? placement[1]
        : candidates.find(peer => peer.id !== a && peer.index === 1)?.id || ids.find(id => id !== a);
    const selected = b ? [a, b] : [];
    if (selected.length !== 2) {
      await chat?.close(); chat = null; executionPeer = null;
      phase = 'waiting'; progress = { message: 'Waiting for another contributor' }; notify(); return;
    }
    if (placement && canonicalPartitionJson(placement) !== canonicalPartitionJson(selected)) {
      await chat?.close(); chat = null; executionPeer = null;
      if (program && program.resident.index !== selected.indexOf(identity.peerId)) await retire();
    }
    placement = selected;
    if (!program) {
      placement = selected; phase = 'loading'; error = null; notify();
      const selectedOffer = offer;
      preparing = loadProgram(selectedOffer, selected.indexOf(identity.peerId), {
        signal: AbortSignal.any([lifetime.signal, contributionController.signal]), participantId: identity.peerId,
        onProgress: value => { error = null; progress = value; notify(); }
      });
      try {
        program = await preparing;
        if (closed || offer !== selectedOffer) { await retire(); return; }
        execution = createNetwork({ label: 'reploid-partitions', maxPeers: config.maxPeers,
          timeoutMs: config.connectTimeoutMs,
          createEndpoint: ({ channel, remoteParticipantId }) => createPartitionPeer({ channel,
            localParticipantId: identity.peerId, remoteParticipantId, runtime: program.runtime,
            modelIdentity: program.model.identity, plan: program.plan, planId: program.planId, authority,
            contributor: program.resident.index === 1 ? program.resident : null, limits: config.executionChannel,
            receiverLimits: config.receiver, descriptorTtlMs: config.inputLimits.descriptorTtlMs }) });
        phase = 'ready'; progress = null; notify();
      } catch (cause) { phase = 'failed'; error = cause.message; notify(); throw cause; }
      finally { preparing = null; }
    }
    if (program && phase === 'waiting') { phase = 'ready'; progress = null; notify(); }
    // A restarted contributor may return between discovery polls. Its identity
    // and placement stay the same, but the old execution channel is retired.
    if (chat && executionPeer.getState().receipt.closed) {
      await chat.close(); chat = null; executionPeer = null;
    }
    if (program?.resident.index === 0 && !chat) {
      const next = [...connections.entries()].find(([, peer]) => peer.participantId === placement[1]
        && peer.description?.phase === 'ready' && peer.description.index === 1
        && peer.description.planId === program.planId);
      if (!next) return;
      const remote = await execution.connect(next[0]);
      executionPeer = remote;
      chat = createPartitionChat({ runtime: program.runtime, local: program.resident, remote,
        authority, model: program.model, plan: program.plan, planId: program.planId,
        limits: config.limits, grantTtlMs: config.grantMs,
        authorizeRequester: async () => !!offer && !closed });
      await chat.refresh({ signal: lifetime.signal }); notify();
    }
  }
  async function tick() {
    if (closed) return;
    if (ticking) return ticking;
    ticking = (async () => {
      const discovered = peers().slice(0, config.maxPeers);
      for (const peer of discovered) {
        if (connections.has(peer.id)) continue;
        // One deterministic opener prevents simultaneous duplicate RTC channels.
        if (peer.localTransportId < peer.id) {
          try { await controls.connect(peer.id); } catch { /* Next bounded poll may reconnect. */ }
        }
      }
      await Promise.allSettled([...connections.values()].map(async peer => {
        try {
          const description = await peer.endpoint.request({ operation: 'describe' }, new Uint8Array(), { signal: lifetime.signal });
          assert(description.participantId === peer.participantId && Array.isArray(description.models)
            && description.models.length <= catalog.length, 'Partition capability identity or inventory mismatch');
          peer.description = description; peer.describedAt = Date.now();
        } catch (cause) { peer.description = null; throw cause; }
      }));
      notify(); await reconcile();
    })();
    try { await ticking; } catch (cause) { if (!closed) { error = cause.message; notify(); } }
    finally { ticking = null; }
  }
  const timer = setInterval(tick, config.pollMs);
  return Object.freeze({ getState, getModels,
    subscribe(listener) { listeners.add(listener); listener(getModels()); return () => listeners.delete(listener); },
    async contribute(modelId, approved) {
      assert(approved === true && !closed, 'Approve partition computation before contributing');
      assert(!offer, 'Stop existing partition contribution first');
      offer = catalog.find(model => model.id === modelId);
      assert(offer, 'No pinned partition model for this contribution');
      contributionController = new AbortController();
      phase = 'waiting'; error = null; progress = { message: 'Waiting for another contributor' }; notify(); await tick();
    },
    async stop() { offer = null; contributionController?.abort(new Error('Partition contribution stopped')); await preparing?.catch(() => {}); await retire(); phase = 'idle'; error = null; notify(); },
    async generate(request, controls) {
      const selected = [...connections.entries()].find(([, peer]) => fresh(peer) && peer.description.models?.some(model =>
        model.id === request.model.id && model.identity === request.model.identity && model.availability === 'ready'));
      assert(selected, 'No prepared cooperative partition path is available');
      const entry = await entries.connect(selected[0]);
      const refreshed = await entry.refresh({ signal: controls.signal });
      const model = refreshed.descriptor.models.find(model => model.id === request.model.id
        && model.identity === request.model.identity && model.availability === 'ready');
      assert(refreshed.ready && model, 'No prepared cooperative partition path is available');
      const approved = await controls.requestApproval({ id: crypto.randomUUID(), threadId: request.threadId,
        attemptId: request.attemptId, operation: 'generate-partition',
        peerId: model.partition.participantA, recipientIdentity: model.partition.participantA,
        ...model.partition, modelId: model.id, modelIdentity: model.identity,
        disclosure: 'partition-activations-and-tokens', adapterIdentities: [], expiresAt: Date.now() + config.grantMs,
        input: { messages: structuredClone(request.messages), recipients: [model.partition.participantA, model.partition.participantB] } });
      assert(approved === true, 'Partition input disclosure declined'); controls.signal.throwIfAborted();
      const input = { schema: 'reploid.partition-input/v1', operation: 'generate', meshId,
        requesterId: identity.peerId, ...model.partition, modelId: model.id, modelIdentity: model.identity,
        threadId: request.threadId, attemptId: request.attemptId, placementGeneration: 0,
        messages: structuredClone(request.messages) };
      admissions.set(request.attemptId, input);
      let sequence = 0;
      controls.onState({ threadId: request.threadId, attemptId: request.attemptId, status: 'executing',
        execution: { placement: 'two-device-layer-partition', ...model.partition } });
      try {
        const result = await entry.generate(input, { signal: controls.signal,
          onDelta: text => controls.onDelta({ threadId: request.threadId, attemptId: request.attemptId, sequence: sequence++, text }) });
        return { ...result, threadId: request.threadId, attemptId: request.attemptId,
          modelId: model.id, modelIdentity: model.identity, adapterIdentities: [] };
      } finally { admissions.delete(request.attemptId); }
    },
    async close() {
      if (closed) return; closed = true; clearInterval(timer); lifetime.abort(new Error('Partition mesh closed'));
      await Promise.allSettled([entries.close(), controls.close(), ticking]);
      await retire(); authority.close(); listeners.clear(); connections.clear(); admissions.clear();
    }
  });
}
