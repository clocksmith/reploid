// @vitest-environment node
import { expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPeerGenerationMesh } from '../../packages/reploid/src/mesh/peer-generation.js';
import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { openNativeGenerationJournal } from '../../server/native-generation-journal.js';

export async function createRecoveryMesh(cleanup, { execute, settle = async () => true, identities: suppliedIdentities,
  modelId = 'model', modelIdentity = 'sha256:' + 'a'.repeat(64), messages = [{ role: 'user', content: 'original prompt' }],
  authorize = async () => true, onGenerationTerminal, result, ports = () => ({}), intercept = null,
  // `drop(type, payload, senderIndex)` true loses that frame on the link; `wire` still records it was sent.
  drop = () => false,
  // False models a provider host that predates admission: it does not advertise it and is never asked.
  admitsBeforeDisclosure = true,
  // Mesh settings for mesh `i` (0 requester, 1 provider), merged over the fixture's own.
  meshConfig = () => ({}) } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'generation-recovery-'));
  cleanup.push(() => fs.rm(directory, { recursive: true, force: true }));
  const identities = suppliedIdentities || await Promise.all(['ECDSA', 'Ed25519'].map(algorithm => createSigningIdentity({ algorithm })));
  const handlers = [new Map(), new Map()], channels = ['connection-0', 'connection-1'], wire = [], errors = [], meshes = [];
  let dropResults = false, journal, reference, executions = 0, tamper = false, channelEpoch = 0;
  const response = result || { model: modelId, modelIdentity, adapterIdentities: [], content: 'actual answer',
    completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 7, generatedTokenCount: 3, stopReason: 'eos-token' } };
  const deliver = (i, type, payload) => {
    payload = structuredClone(payload); wire.push({ i, type, payload });
    if (dropResults && type === 'reploid:generation-result') return true;
    if (drop(type, payload, i)) return true;
    // `intercept(type, payload, senderIndex)` may alter what is delivered; `wire` keeps what was sent.
    // It may return a promise (for example to sign a forged receipt): delivery then waits for it.
    let altering;
    if (intercept) { payload = structuredClone(payload); altering = intercept(type, payload, i); }
    if (tamper && type === 'reploid:generation-recovery' && payload.outcome?.payload?.response) payload.outcome.payload.response.content = 'forged';
    queueMicrotask(async () => {
      try { if (altering) await altering; await handlers[1-i].get(type)?.(channels[i], payload); } catch (error) { errors.push(error); }
    });
    return true;
  };
  async function open(i) {
    if (i) journal = await openNativeGenerationJournal({ file: path.join(directory, 'journal.sqlite'), maxResults: 2, maxResultBytes: 65536 });
    const listeners = new Map(), events = {
      on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return () => listeners.get(name).delete(fn); },
      emit(name, value) { for (const fn of listeners.get(name) || []) fn(value); }
    };
    meshes[i] = createPeerGenerationMesh({ config: resolveConfig({ overrides: { mesh: { enabled: true, executeJobs: true, roomId: 'recovery', ...meshConfig(i) } } }), ports: {
      instanceId: 'instance-' + i, modelConfig: i ? { id: modelId } : null, admitsBeforeDisclosure,
      getExecutionState: () => ({ phase: i ? 'ready' : 'idle', modelIdentity, adapterIdentities: [] }),
      authorize: async input => { if (input.action === 'mesh.dispatch') reference = { requestId: input.requestId, providerId: input.peerId,
        providerIdentity: input.recipientIdentity, modelId: input.modelId, modelIdentity, adapterIdentities: [] }; return authorize(input); },
      events, eventBus: events, utils: { generateId: () => crypto.randomUUID() },
      identity: { ensure: async () => identities[i], sync: async () => {}, save: async () => {} },
      generationJournal: i ? journal : null, settleGeneration: settle, onGenerationTerminal,
      // Extra host ports for mesh `i` (0 requester, 1 provider), for example a settings capability.
      ...ports(i),
      generate: async (...args) => { executions++; return execute ? execute(...args) : response; },
      createTransport: () => ({ init: async () => true, disconnect() {}, getPeerId: () => channels[i],
        getPeerStates: () => [{ id: channels[1-i], attemptId: 'attempt-' + channels[1-i], phase: 'connected',
          transport: 'webrtc', channelState: 'open' }],
        getPeerBinding: () => ({ local: 'cert-' + channels[i] + ':' + channelEpoch, remote: 'cert-' + channels[1-i] + ':' + channelEpoch }),
        onMessage: (type, fn) => handlers[i].set(type, fn), broadcast: (type, payload) => deliver(i, type, payload),
        sendToPeer: (_peer, type, payload) => deliver(i, type, payload) })
    } });
    await meshes[i].connect();
  }
  await open(0); await open(1); meshes[1].refreshAdvertisement();
  cleanup.push(async () => { await Promise.all(meshes.map(mesh => mesh.close())); journal?.close(); });
  await vi.waitFor(() => expect(meshes[0].getSwarmSnapshot().peers.some(peer => peer.readiness === 'ready')).toBe(true));
  return { requesterMesh: meshes[0], wire, errors, identities, messages, response, get reference() { return reference; }, get executions() { return executions; },
    drop: () => { dropResults = true; }, tamper: () => { tamper = true; },
    // Mesh `i` (0 requester, 1 provider) broadcasts its current advertisement again.
    readvertise: (i = 1) => meshes[i].refreshAdvertisement(),
    changeChannelScope() { channelEpoch++; },
    async restartProvider() { await meshes[1].close(); journal.close(); channels[1] += '-restarted'; handlers[1].clear(); await open(1); reference.providerId = channels[1]; },
    run: (signal, settings) => meshes[0].generate(messages, null, { signal, modelId, modelIdentity, privacy: createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } }), requestContext: { recoverable: true }, ...(settings ? { settings } : {}) }),
    recover: settings => meshes[0].recoverGeneration(reference, messages, undefined, settings ? { settings } : undefined),
    async replay(changes = {}, omit = []) {
      const original = wire.find(item => item.type === 'reploid:generation-request').payload;
      const replayed = { ...original, provider: channels[1], ...changes };
      for (const key of omit) delete replayed[key];
      await handlers[1].get('reploid:generation-request')(channels[0], replayed);
    }
  };
}

