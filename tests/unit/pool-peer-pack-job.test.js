import { peerAdapterFixture } from '../fixtures/peer-adapter.js';
import { createAdapterRegistry } from '../../self/pool/adapter-registry.js';
import { createAdapterRevocation } from '../../self/pool/adapter-publication.js';
import { createPeerAdapterResolver } from '../../self/pool/peer-adapter-execution.js';
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { operationFixture, operationCapabilities, operationResources, packPeerIdentity } from '../fixtures/peer-pack-operation.js';
import fifthDefinition from '../fixtures/pack-operation-fifth.json' with { type: 'json' };
import poolConfig from '../../self/pool/pool-config.json' with { type: 'json' };
import { createPackOperationRegistry, PACK_OPERATION_IMPLEMENTATIONS } from '../../self/pool/pack-operation-adapters.js';
import { createPackPeerProvider } from '../../self/pool/peer-pack-provider.js';
import { createPackPeerRequester } from '../../self/pool/peer-pack-requester.js';
import { createPackPeerJob, createPackProviderAdvert, verifyPackPeerJob, signPackPeerMessage, verifyPackPeerMessage, PACK_CANCEL_SCHEMA } from '../../self/pool/peer-pack-job.js';
import { PEER_MESSAGE_TYPES } from '../../self/pool/peer-protocol.js';
import { verifyPackPeerEpisode } from '../../self/pool/peer-pack-episode.js';
import { runPeerOperationJob } from '../../self/pool/peer-room.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const until = async check => { for (let i = 0; i < 500; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 2)); } throw new Error('condition did not settle'); };

// Protocol-only double. Native persistence and cross-process claims are tested in Playwright.
function memoryJournal() {
  const records = new Map();
  const key = value => JSON.stringify([value.requesterId, value.jobId, value.attemptId]);
  return {
    async claim(value, owner) {
      const prior = records.get(key(value));
      if (prior && prior.jobHash !== value.jobHash) throw new Error('different signed envelope');
      const record = prior || { ...value, owner, status: 'accepted', updates: [] };
      records.set(key(value), record);
      return { created: !prior, record: structuredClone(record) };
    },
    async markRunning(value, owner) {
      const record = records.get(key(value));
      if (!record || record.owner !== owner || record.status !== 'accepted') throw new Error('invalid writer');
      record.status = 'running';
    },
    async append(value, owner, message) {
      const record = records.get(key(value));
      if (!record || record.owner !== owner || record.updates.at(-1)?.body.status === 'completed') throw new Error('invalid writer');
      if (record.status === 'cancelled' && ['partial', 'completed'].includes(message.body.status)) throw new Error('cancelled');
      record.updates.push(structuredClone(message));
      record.status = message.body.status === 'partial' ? 'running' : message.body.status;
    },
    async cancel(value, owner) {
      const prior = records.get(key(value));
      if (prior?.updates.at(-1)?.body.status === 'completed') return;
      records.set(key(value), { ...value, owner, ...prior, status: 'cancelled', updates: prior?.updates || [] });
    },
    close() {}
  };
}

async function setup(name, registry, tweaks = {}) {
  const f = await operationFixture(name, registry);
  if (tweaks.adapted) {
    Object.assign(f, await peerAdapterFixture(f.model));
    const adapterRegistry = createAdapterRegistry();
    f.adapterRegistry = adapterRegistry;
    await adapterRegistry.cache({ publication: f.publication, bytes: f.bytes });
    f.adapterResolver = createPeerAdapterResolver({ registry: adapterRegistry, policy: poolConfig.peerJobs.execution.adapters });
  }
  const providerIdentity = await packPeerIdentity(), requesterIdentity = await packPeerIdentity();
  const requestListeners = new Set(), providerListeners = new Set();
  const sent = [], responses = [], errors = [];
  const requesterBus = { subscribe(fn) { requestListeners.add(fn); return () => requestListeners.delete(fn); },
    async send(message) { sent.push(message); if (tweaks.dropRequest?.(message, sent.length)) return;
      for (const fn of providerListeners) fn(structuredClone(message)); } };
  const providerBus = { subscribe(fn) { providerListeners.add(fn); return () => providerListeners.delete(fn); },
    async send(message) { responses.push(message); if (tweaks.dropResponse?.(message, responses.length)) return;
      for (const fn of requestListeners) fn(structuredClone(message)); } };
  const provider = createPackPeerProvider({ identity: providerIdentity, bus: providerBus, models: [f.model],
    executor: f.executor, registry, adapterResolver: f.adapterResolver, journal: tweaks.journal || memoryJournal(), authorize: tweaks.authorize || (() => true), onError: error => errors.push(error.message) });
  const requester = createPackPeerRequester({ identity: requesterIdentity, bus: requesterBus, models: [f.model], registry,
    maxDeliveries: tweaks.maxDeliveries ?? 3, retryMs: 100, onError: error => errors.push(error.message) });
  const limits = { maxInputBytes: 10000, maxOutputBytes: 10000, maxStreamBytes: 200000, maxEvents: 32, maxJobMs: 30000 };
  const capabilities = await operationCapabilities(f.model);
  if (tweaks.adapted) capabilities.adapters = [{ identity: f.entry.identity, availability: 'cached' }];
  const advert = await provider.createAdvert({ limits, capabilities, expiresAt: Date.now() + 30000 });
  const args = { advert, model: f.model, input: f.input, options: f.options, limits: { ...limits, deadlineAt: Date.now() + 30000 },
    consent: { schema: 'reploid.peer.public_operation_consent/v1', publicInput: true, providerIds: [providerIdentity.keyId] },
    comparisonPolicy: f.policy, reference: f.output, resources: operationResources, ...(tweaks.adapted ? { adapterSet: [f.entry] } : {}) };
  return { ...f, provider, requester, args, sent, responses, errors, providerIdentity, requesterIdentity,
    requesterBus, providerBus, async close() { requester.close(); await provider.close(); } };
}

describe('signed remote Pack jobs with synthetic model outputs', () => {
  it('rejects adapter revocation during execution and before durable replay', async () => {
    const f = await setup('generate', undefined, { adapted: true });
    try {
      const completed = await f.requester.run(f.args);
      const prior = f.responses.length;
      await f.adapterRegistry.revoke(f.entry.identity, await createAdapterRevocation({ publication: f.publication,
        privateKey: f.publisher.privateKey, reason: 'test withdrawal' }));
      await f.requesterBus.send(completed.job);
      await until(() => f.errors.some(error => error.includes('revoked')));
      expect(f.responses).toHaveLength(prior);
      expect(f.calls()).toBe(1);
    } finally { await f.close(); }
    const active = await setup('generate', undefined, { adapted: true });
    try {
      active.before(async () => active.adapterRegistry.revoke(active.entry.identity,
        await createAdapterRevocation({ publication: active.publication, privateKey: active.publisher.privateKey, reason: 'active test withdrawal' })));
      await expect(active.requester.run(active.args)).rejects.toThrow();
      expect(active.responses.some(message => message.body.status === 'completed')).toBe(false);
      expect(active.calls()).toBe(1);
    } finally { await active.close(); }
  });
  it('executes an exact adapter and replays its durable result without reactivation', async () => {
    let dropped = false;
    const f = await setup('generate', undefined, { adapted: true, dropResponse(message) {
      if (!dropped && message.body.status === 'completed') { dropped = true; return true; }
      return false;
    } });
    try {
      const result = await f.requester.run(f.args);
      expect(result.execution.receipt.adapterReceipts[0].identity).toBe(f.entry.identity);
      expect(f.calls()).toBe(1);
      expect(f.sent.filter(message => message.body.schema === 'reploid.peer.pack_job/v4')).toHaveLength(2);
      expect((await verifyPackPeerEpisode({ job: result.job, updates: result.updates,
        acceptance: result.acceptance, reference: f.output, models: [f.model] })).accepted).toBe(true);
    } finally { await f.close(); }
  });

  it('accepts ordinary generation without a reference and retains its weaker claim', async () => {
    const f = await setup('generate');
    try {
      const result = await f.requester.run({ ...f.args, acceptanceMode: 'execution', comparisonPolicy: null, reference: null });
      expect(result.assessment).toMatchObject({ accepted: true, claim: 'execution-identity-only' });
      expect((await verifyPackPeerEpisode({ job: result.job, updates: result.updates,
        acceptance: result.acceptance, reference: null, models: [f.model] })).assessment.claim).toBe('execution-identity-only');
      await expect(f.requester.run({ ...f.args, acceptanceMode: 'execution', comparisonPolicy: null })).rejects.toThrow('reference answer');
    } finally { await f.close(); }
    const numeric = await setup('embed');
    try {
      await expect(numeric.requester.run({ ...numeric.args, acceptanceMode: 'execution', comparisonPolicy: null, reference: null })).rejects.toThrow('not allowed');
      expect(numeric.calls()).toBe(0);
    } finally { await numeric.close(); }
  });

  it('does not calculate when durable admission fails', async () => {
    const f = await setup('embed', undefined, { journal: { async claim() { throw new Error('injected storage failure'); }, close() {} } });
    try {
      const { reference, ...args } = f.args;
      await f.requesterBus.send(await createPackPeerJob({ ...args, identity: f.requesterIdentity }));
      await until(() => f.provider.getState().queued === 0);
      expect(f.calls()).toBe(0);
      expect(f.responses).toEqual([]);
      expect(f.errors).toContain('injected storage failure');
    } finally { await f.close(); }
  });

  for (const name of ['generate', 'embed', 'rerank', 'encodeSequence']) it(`executes and accepts ${name} over the common peer clients`, async () => {
    const f = await setup(name);
    try {
      const partials = [];
      const result = await f.requester.run({ ...f.args, onPartial: event => partials.push(event) });
      expect(result.execution.output).toEqual(f.output);
      expect(result.assessment.accepted).toBe(true);
      expect(partials).toHaveLength(1);
      expect(f.calls()).toBe(1);
      expect(result.execution.request.assignment.providerId).toBe(f.providerIdentity.keyId);
      await expect(verifyPackPeerMessage(result.acceptance, { type: PEER_MESSAGE_TYPES.ACCEPTANCE,
        recipient: f.providerIdentity.keyId, sender: f.requesterIdentity.keyId })).resolves.toMatchObject({ body: { assessment: { accepted: true } } });
      const episode = { ...result, reference: f.output, models: [f.model] };
      await expect(verifyPackPeerEpisode(episode)).resolves.toMatchObject({ accepted: true });
      await expect(verifyPackPeerEpisode({ ...episode, updates: result.updates.slice(0, 1) })).rejects.toThrow('completion');
    } finally { await f.close(); }
  });

  it('adds a fifth operation with one adapter and unchanged networking', async () => {
    const registry = createPackOperationRegistry({ definitions: { ...poolConfig.operations, ...fifthDefinition }, implementations: { ...PACK_OPERATION_IMPLEMENTATIONS, 'audio.test.v1': { contractVersion: 1,
      validateRequest(request) { if (request.input.arbitrary !== true) throw new Error('input'); },
      validateOutput(output) { if (output.value !== 'fifth') throw new Error('output'); },
      compare: (output, reference) => output.value === reference.value } } });
    const f = await setup('audio.test', registry);
    try { expect((await f.requester.run(f.args)).assessment.accepted).toBe(true); }
    finally { await f.close(); }
  });

  it('executes the chosen resident provider and verifies the frozen candidate plan', async () => {
    const f = await setup('rerank');
    try {
      const other = await packPeerIdentity(), capabilities = await operationCapabilities(f.model);
      capabilities.models[0].availability = 'fetchable';
      const { deadlineAt, ...limits } = f.args.limits;
      const advert = await createPackProviderAdvert({ identity: other, models: [f.model], capabilities, limits, expiresAt: deadlineAt });
      const result = await f.requester.run({ ...f.args, adverts: [advert, f.args.advert],
        consent: { ...f.args.consent, providerIds: [other.keyId, f.providerIdentity.keyId] } });
      expect(result.job.body.schema).toBe('reploid.peer.pack_job/v4');
      expect(result.job.body.intent.planning.plan.orderedProviderIds).toEqual([f.providerIdentity.keyId, other.keyId]);
      expect(f.calls()).toBe(1);
      await expect(verifyPackPeerEpisode({ ...result, reference: f.output, models: [f.model] })).resolves.toMatchObject({ accepted: true });
      const body = structuredClone(result.job.body);
      body.intent.planning.plan.selectedProviderId = other.keyId;
      const altered = await signPackPeerMessage({ identity: f.requesterIdentity, type: result.job.type,
        recipient: result.job.toPeerId, body, expiresAt: Date.parse(result.job.expiresAt) });
      await expect(verifyPackPeerJob(altered, { providerId: f.providerIdentity.keyId, models: [f.model] })).rejects.toThrow('deterministic provider plan');
    } finally { await f.close(); }
  });

  it('plans before connecting and delivers that exact job through the shared room owner', async () => {
    const f = await setup('generate'); let prepared, connected = null, closes = 0;
    try {
      const result = await runPeerOperationJob({
        requesterClient: {
          async createPeerOperationJob(options) { prepared = await createPackPeerJob({ ...options, identity: f.requesterIdentity }); return prepared; },
          createPeerPackRequester: () => f.requester
        }, request: f.args, providerAdverts: [f.args.advert],
        async connectTransport({ providerId, assignment }) { connected = { providerId, assignment };
          return { bus: f.requesterBus, close() { closes++; } }; }
      });
      expect(connected.providerId).toBe(f.providerIdentity.keyId);
      expect(connected.assignment).toEqual(prepared.body.assignment);
      expect(result.job).toEqual(prepared); expect(f.sent[0]).toEqual(prepared);
      expect(closes).toBe(1); expect(f.calls()).toBe(1);
    } finally { await f.close(); }
  });

  it('closes a late transport after cancellation without sending the prepared job', async () => {
    const f = await setup('embed'), gate = deferred(), controller = new AbortController();
    let connecting = false, closes = 0;
    try {
      const pending = runPeerOperationJob({
        requesterClient: { createPeerOperationJob: options => createPackPeerJob({ ...options, identity: f.requesterIdentity }),
          createPeerPackRequester: () => f.requester }, request: f.args, providerAdverts: [f.args.advert], signal: controller.signal,
        async connectTransport() { connecting = true; await gate.promise; return { bus: f.requesterBus, close() { closes++; } }; }
      });
      const rejected = expect(pending).rejects.toThrow('cancelled connection');
      await until(() => connecting); controller.abort(new Error('cancelled connection')); await rejected;
      gate.resolve(); await until(() => closes === 1);
      expect(f.sent).toEqual([]); expect(f.calls()).toBe(0);
    } finally { gate.resolve(); await f.close(); }
  });

  it('binds numbered attempts and archives the policy used before configuration changes', async () => {
    const f = await setup('embed');
    try {
      const result = await f.requester.run({ ...f.args, attemptNumber: 2 });
      expect(result.job.body.intent.attemptNumber).toBe(2);
      expect(result.execution.request.assignment.attemptNumber).toBe(2);
      expect(result.job.body.intent.adapterSet).toEqual([]);
      const definitions = structuredClone(poolConfig.operations);
      definitions.embed.maximumLimits.maxJobMs -= 1;
      const registry = createPackOperationRegistry({ definitions });
      await expect(verifyPackPeerJob(result.job, { providerId: f.providerIdentity.keyId, models: [f.model], registry }))
        .rejects.toThrow('policy differs');
      await expect(verifyPackPeerEpisode({ ...result, reference: f.output, models: [f.model], registry }))
        .resolves.toMatchObject({ accepted: true });
      await expect(f.requester.run({ ...f.args, attemptNumber: 0 })).rejects.toThrow('attempt number');
      expect(f.calls()).toBe(1);
    } finally { await f.close(); }
  });

  it('retries a lost request and replays lost responses without calculating twice', async () => {
    for (const tweaks of [{ dropRequest: (_m, index) => index === 1 }, { dropResponse: (_m, index) => index <= 2 }]) {
      const f = await setup('embed', undefined, tweaks);
      try {
        const result = await f.requester.run(f.args);
        expect(result.accounting.deliveries).toBe(2);
        expect(f.calls()).toBe(1);
        expect(f.sent[0].messageHash).toBe(f.sent[1].messageHash);
      } finally { await f.close(); }
    }
  });

  it('rejects absent consent, unpinned models, wrong recipients and altered signed assignments before execution', async () => {
    const f = await setup('embed');
    try {
      await expect(f.requester.run({ ...f.args, consent: null })).rejects.toThrow('consent');
      await expect(f.requester.run({ ...f.args, model: { ...f.model, runtimeVersion: 'different' } })).rejects.toThrow('model-unavailable');
      const { reference, ...args } = f.args;
      const job = await createPackPeerJob({ ...args, identity: f.requesterIdentity });
      for (const mutate of [
        body => { body.request.input.texts = ['substitution']; },
        body => { body.assignment.assignmentAttemptId = 'replay'; },
        body => { body.request.limits.maxOutputBytes++; },
        body => { body.intent.consent.providerIds = []; },
        body => { body.intent.model.runtimeVersion = 'changed'; }
      ]) {
        const body = structuredClone(job.body); mutate(body);
        const tampered = await signPackPeerMessage({ identity: f.requesterIdentity, type: job.type,
          recipient: f.providerIdentity.keyId, body, expiresAt: Date.parse(job.expiresAt) });
        await expect(verifyPackPeerJob(tampered, { providerId: f.providerIdentity.keyId, models: [f.model] })).rejects.toThrow();
      }
      await expect(verifyPackPeerJob(job, { providerId: f.requesterIdentity.keyId, models: [f.model] })).rejects.toThrow('scope');
      expect(f.calls()).toBe(0);
    } finally { await f.close(); }
  });

  it('rejects late results and holds a cancelled execution slot until iterator cleanup settles', async () => {
    const gate = deferred();
    const f = await setup('embed');
    f.before(() => gate.promise);
    try {
      const result = f.requester.run(f.args);
      const rejected = expect(result).rejects.toThrow('cancelled');
      await until(() => f.calls() === 1);
      f.requester.cancel(); await rejected;
      await until(() => f.provider.getState().draining);
      expect(f.provider.getState().active).toBe(true);
      await expect(f.requester.run(f.args)).rejects.toThrow('busy');
      expect(f.calls()).toBe(1);
      gate.resolve();
      await until(() => !f.provider.getState().active);
      expect(f.responses.some(message => message.body.status === 'completed')).toBe(false);
      expect((await f.requester.run(f.args)).assessment.accepted).toBe(true);
    } finally { gate.resolve(); await f.close(); }
  });

  it('records cancellation arriving before its job and never starts that delayed job', async () => {
    const f = await setup('embed');
    try {
      const { reference, ...args } = f.args;
      const job = await createPackPeerJob({ ...args, identity: f.requesterIdentity });
      const cancel = await signPackPeerMessage({ identity: f.requesterIdentity, type: PEER_MESSAGE_TYPES.HEARTBEAT,
        recipient: f.providerIdentity.keyId, expiresAt: Date.parse(job.expiresAt), body: { schema: PACK_CANCEL_SCHEMA, jobHash: job.messageHash,
          jobId: job.body.intent.jobId, attemptId: job.body.intent.attemptId } });
      await f.requesterBus.send(cancel); await f.requesterBus.send(job);
      await until(() => f.provider.getState().queued === 0);
      expect(f.calls()).toBe(0);
    } finally { await f.close(); }
  });

  it('does not execute a completed attempt again under a freshly signed envelope', async () => {
    const f = await setup('embed');
    try {
      const result = await f.requester.run(f.args);
      const duplicate = await signPackPeerMessage({ identity: f.requesterIdentity, type: result.job.type,
        recipient: result.job.toPeerId, body: result.job.body, expiresAt: Date.parse(result.job.expiresAt) });
      expect(duplicate.messageHash).not.toBe(result.job.messageHash);
      await f.requesterBus.send(duplicate);
      await until(() => f.provider.getState().queued === 0);
      expect(f.calls()).toBe(1);
      expect(f.errors.some(error => error.includes('different signed envelope'))).toBe(true);
    } finally { await f.close(); }
  });

  it('closes promptly during an uncooperative admission callback and never starts that job later', async () => {
    const gate = deferred();
    const f = await setup('embed', undefined, { authorize: () => gate.promise });
    try {
      const pending = f.requester.run(f.args);
      const cancelled = expect(pending).rejects.toThrow('closed');
      await until(() => f.provider.getState().queued > 0);
      f.requester.close();
      await f.provider.close();
      await cancelled;
      gate.resolve(true);
      expect(f.calls()).toBe(0);
    } finally { gate.resolve(true); await f.close(); }
  });

  it('enforces deadline, event, byte and admission limits without accepting a partial answer', async () => {
    for (const mode of ['deadline', 'event', 'bytes', 'admission']) {
      let authorized = true;
      const f = await setup('embed', undefined, { authorize: () => authorized, maxDeliveries: 1 });
      const gate = deferred();
      try {
        let args = f.args;
        if (mode === 'deadline') { f.before(() => gate.promise); args = { ...args, limits: { ...args.limits, deadlineAt: Date.now() + 150 } }; }
        if (mode === 'event') args = { ...args, limits: { ...args.limits, maxEvents: 1 } };
        if (mode === 'bytes') args = { ...args, limits: { ...args.limits, maxStreamBytes: 1 } };
        if (mode !== 'deadline') args = { ...args, limits: { ...args.limits, deadlineAt: Date.now() + 250 } };
        if (mode === 'admission') f.before(async () => { authorized = false; });
        await expect(f.requester.run(args)).rejects.toThrow();
        expect(f.responses.some(message => message.body.status === 'completed')).toBe(false);
      } finally { gate.resolve(); await f.close(); }
    }
  });
});
