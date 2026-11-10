// @vitest-environment node
import { expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPeerGenerationMesh } from '../../packages/reploid/src/mesh/peer-generation.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { openNativeGenerationJournal } from '../../server/native-generation-journal.js';

export async function createRecoveryMesh(cleanup, { execute, settle = async () => true, identities: suppliedIdentities,
  modelId = 'model', modelIdentity = 'sha256:' + 'a'.repeat(64), messages = [{ role: 'user', content: 'original prompt' }],
  authorize = async () => true, onGenerationTerminal, result } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'generation-recovery-'));
  cleanup.push(() => fs.rm(directory, { recursive: true, force: true }));
  const identities = suppliedIdentities || await Promise.all(['ECDSA', 'Ed25519'].map(algorithm => createSigningIdentity({ algorithm })));
  const handlers = [new Map(), new Map()], channels = ['connection-0', 'connection-1'], wire = [], errors = [], meshes = [];
  let dropResults = false, journal, reference, executions = 0, tamper = false;
  const response = result || { model: modelId, modelIdentity, adapterIdentities: [], content: 'actual answer',
    completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 7, generatedTokenCount: 3, stopReason: 'eos-token' } };
  const deliver = (i, type, payload) => {
    payload = structuredClone(payload); wire.push({ i, type, payload });
    if (dropResults && type === 'reploid:generation-result') return true;
    if (tamper && type === 'reploid:generation-recovery' && payload.outcome?.payload?.response) payload.outcome.payload.response.content = 'forged';
    queueMicrotask(() => Promise.resolve(handlers[1-i].get(type)?.(channels[i], payload)).catch(error => errors.push(error)));
    return true;
  };
  async function open(i) {
    if (i) journal = await openNativeGenerationJournal({ file: path.join(directory, 'journal.sqlite'), maxResults: 2, maxResultBytes: 65536 });
    const listeners = new Map(), events = {
      on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return () => listeners.get(name).delete(fn); },
      emit(name, value) { for (const fn of listeners.get(name) || []) fn(value); }
    };
    meshes[i] = createPeerGenerationMesh({ config: resolveConfig({ overrides: { mesh: { enabled: true, executeJobs: true, roomId: 'recovery' } } }), ports: {
      instanceId: 'instance-' + i, modelConfig: i ? { id: modelId } : null,
      getExecutionState: () => ({ phase: i ? 'ready' : 'idle', modelIdentity, adapterIdentities: [] }),
      authorize: async input => { if (input.action === 'mesh.dispatch') reference = { requestId: input.requestId, providerId: input.peerId,
        providerIdentity: input.recipientIdentity, modelId: input.modelId, modelIdentity, adapterIdentities: [] }; return authorize(input); },
      events, eventBus: events, utils: { generateId: () => crypto.randomUUID() },
      identity: { ensure: async () => identities[i], sync: async () => {}, save: async () => {} },
      generationJournal: i ? journal : null, settleGeneration: settle, onGenerationTerminal,
      generate: async (...args) => { executions++; return execute ? execute(...args) : response; },
      createTransport: () => ({ init: async () => true, disconnect() {}, _getPeerId: () => channels[i],
        getPeerBinding: () => ({ local: 'cert-' + channels[i], remote: 'cert-' + channels[1-i] }),
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
    async restartProvider() { await meshes[1].close(); journal.close(); channels[1] += '-restarted'; handlers[1].clear(); await open(1); reference.providerId = channels[1]; },
    run: signal => meshes[0].generate(messages, null, { signal, modelId, modelIdentity, requestContext: { recoverable: true } }),
    recover: () => meshes[0].recoverGeneration(reference, messages),
    async replay(changes = {}) {
      const original = wire.find(item => item.type === 'reploid:generation-request').payload;
      await handlers[1].get('reploid:generation-request')(channels[0], { ...original, provider: channels[1], ...changes });
    }
  };
}

