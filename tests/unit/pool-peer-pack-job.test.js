// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { operationFixture, packPeerIdentity } from '../fixtures/peer-pack-operation.js';
import { createPackOperationRegistry } from '../../self/pool/pack-operation-adapters.js';
import { createPackPeerProvider } from '../../self/pool/peer-pack-provider.js';
import { createPackPeerRequester } from '../../self/pool/peer-pack-requester.js';
import { createPackPeerJob, verifyPackPeerJob, signPackPeerMessage, verifyPackPeerMessage, PACK_CANCEL_SCHEMA } from '../../self/pool/peer-pack-job.js';
import { PEER_MESSAGE_TYPES } from '../../self/pool/peer-protocol.js';
import { verifyPackPeerEpisode } from '../../self/pool/peer-pack-episode.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const until = async check => { for (let i = 0; i < 500; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 2)); } throw new Error('condition did not settle'); };

async function setup(name, registry, tweaks = {}) {
  const f = await operationFixture(name, registry);
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
    executor: f.executor, registry, authorize: tweaks.authorize || (() => true), onError: error => errors.push(error.message) });
  const requester = createPackPeerRequester({ identity: requesterIdentity, bus: requesterBus, models: [f.model], registry,
    maxDeliveries: tweaks.maxDeliveries ?? 3, retryMs: 100, onError: error => errors.push(error.message) });
  const limits = { maxInputBytes: 10000, maxOutputBytes: 10000, maxStreamBytes: 200000, maxEvents: 32, maxJobMs: 30000 };
  const advert = await provider.createAdvert({ limits, expiresAt: Date.now() + 30000 });
  const args = { advert, model: f.model, input: f.input, options: f.options, limits: { ...limits, deadlineAt: Date.now() + 30000 },
    consent: { schema: 'reploid.peer.public_operation_consent/v1', publicInput: true, providerIds: [providerIdentity.keyId] },
    comparisonPolicy: f.policy, reference: f.output };
  return { ...f, provider, requester, args, sent, responses, errors, providerIdentity, requesterIdentity,
    requesterBus, providerBus, async close() { requester.close(); await provider.close(); } };
}

describe('signed remote Pack jobs with synthetic model outputs', () => {
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
    const registry = createPackOperationRegistry({ 'audio.test': { version: 1, workload: 'audio-test',
      validateRequest(request) { if (request.input.arbitrary !== true) throw new Error('input'); },
      validateOutput(output) { if (output.value !== 'fifth') throw new Error('output'); },
      compare: (output, reference) => output.value === reference.value } });
    const f = await setup('audio.test', registry);
    try { expect((await f.requester.run(f.args)).assessment.accepted).toBe(true); }
    finally { await f.close(); }
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
      await expect(f.requester.run({ ...f.args, model: { ...f.model, runtimeVersion: 'different' } })).rejects.toThrow('exact model');
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
