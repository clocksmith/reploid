/** Synthetic vectors, actual signed jobs and native IndexedDB. No model qualification. */
import { openIndependentUnitJournal, createIndependentUnitCoordinator } from 'reploid/jobs';
import { operationFixture, operationCapabilities, operationResources, packPeerIdentity } from './peer-pack-operation.js';
import { createPackPeerProvider } from '../../self/pool/peer-pack-provider.js';
import { createPackPeerRequester } from '../../self/pool/peer-pack-requester.js';
import { createPackPeerJob, packPeerModel } from '../../self/pool/peer-pack-job.js';
import { createPackOperationRegistry } from '../../self/pool/pack-operation-adapters.js';
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';

export const storagePolicy = { maxRecords: 8, maxBytes: 2000000, maxUnits: 16, maxAttemptsPerUnit: 4,
  retentionMs: 60000, maxFutureMs: 180000, storageTimeoutMs: 5000 };
const vector = text => ({ embedding: [text.length, text.charCodeAt(0)] });
const saveIdentity = async identity => ({ ...identity, privateKey: await crypto.subtle.exportKey('jwk', identity.privateKey) });
const loadIdentity = async value => ({ ...value, privateKey: await crypto.subtle.importKey('jwk', value.privateKey,
  { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']) });

export async function start(saved = null) {
  const requesterIdentity = saved ? await loadIdentity(saved.requester) : await packPeerIdentity();
  const identities = saved ? await Promise.all(saved.providers.map(loadIdentity)) : await Promise.all([packPeerIdentity(), packPeerIdentity()]);
  const errors = [], gates = new Map(), clients = new Set();
  let selected = 0, allowed = true, drop = 0, observed = 0;
  const providers = [];
  const journal = await openIndependentUnitJournal({ requesterId: requesterIdentity.keyId, name: 'independent-test', policy: storagePolicy });
  for (const identity of identities) {
    const fixture = await operationFixture('embed');
    fixture.before(async request => {
      const gate = gates.get(request.input.texts[0]);
      if (gate) { gate.started(); await gate.wait; }
      fixture.output.embeddings = request.input.texts.map(vector);
    });
    const listeners = new Set();
    const provider = createPackPeerProvider({ identity, models: [fixture.model], executor: fixture.executor,
      journalName: 'independent-provider-test', authorize: () => true, onError: error => errors.push(error.message),
      bus: { subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, async send(message) {
        observed++;
        if (drop > 0) { drop--; return; }
        for (const client of clients) client(message);
      } } });
    providers.push({ fixture, provider, listeners, identity });
  }
  const model = packPeerModel(providers[0].fixture.model);
  const application = { schema: 'test.approved-embedding-application/v1', independentInputs: true };
  const coordinators = [];
  function coordinator() {
    const value = createIndependentUnitCoordinator({ requesterId: requesterIdentity.keyId, journal,
      limits: { maxUnits: 16, maxInputBytes: 100000, maxConcurrentUnits: 2 },
      operation: createPackOperationRegistry().embed,
      validateApplication(candidate, binding) {
        if (candidate.schema !== application.schema || candidate.independentInputs !== true
          || binding.model.modelId !== model.modelId) throw new Error('application not independently approved');
      },
      authorize: () => allowed, hashEvidence: hashDopplerEvidence,
      async prepareJob({ model: selectedModel, input, options, comparisonPolicy, jobId, attemptNumber, expiresAt }) {
        const target = providers[selected];
        const limits = { maxInputBytes: 10000, maxOutputBytes: 10000, maxStreamBytes: 200000, maxEvents: 32, maxJobMs: 180000 };
        const advert = await target.provider.createAdvert({ limits, capabilities: await operationCapabilities(target.fixture.model), expiresAt });
        return createPackPeerJob({ identity: requesterIdentity, advert, model: selectedModel, input, options,
          comparisonPolicy, jobId, attemptNumber, resources: operationResources,
          limits: { ...limits, deadlineAt: expiresAt },
          consent: { schema: 'reploid.peer.public_operation_consent/v1', publicInput: true, providerIds: [target.identity.keyId] } });
      },
      async runPrepared(input) {
        const requester = createPackPeerRequester({ identity: requesterIdentity, models: [providers[0].fixture.model],
          maxDeliveries: 3, retryMs: 100, onError: error => errors.push(error.message),
          bus: { subscribe(fn) { clients.add(fn); return () => clients.delete(fn); }, async send(message) {
            const target = providers.find(provider => provider.identity.keyId === message.toPeerId);
            for (const fn of target.listeners) fn(structuredClone(message));
          } } });
        try { return await requester.runPrepared(input); } finally { requester.close(); }
      }
    });
    coordinators.push(value); return value;
  }
  const current = coordinator();
  return {
    current, coordinator, journal, errors,
    async seed() { return { requester: await saveIdentity(requesterIdentity), providers: await Promise.all(identities.map(saveIdentity)) }; },
    async create(parentId = 'batch', texts = ['a', 'bbb', 'cc']) {
      const reference = { embeddings: texts.map(vector) };
      return current.create({ parentId, application, model, input: { texts, application: {} }, options: {},
        reference, comparisonPolicy: { schema: 'poolday.operation-comparison/v1', operation: { name: 'embed', version: 1 },
          referenceDigest: await hashDopplerEvidence(reference), rule: 'numerical-tolerance', absoluteTolerance: 0.001, relativeTolerance: 0 },
        unitSize: 1, expiresAt: Date.now() + 120000 });
    },
    select(index) { selected = index; },
    allow(value) { allowed = value; },
    dropResponses(count) { drop = count; },
    calls() { return providers.map(provider => provider.fixture.calls()); },
    observed() { return observed; },
    hold(text) {
      let release, started;
      const wait = new Promise(resolve => { release = resolve; });
      const ready = new Promise(resolve => { started = resolve; });
      gates.set(text, { wait, started });
      return { ready, release() { gates.delete(text); release(); } };
    },
    async close() {
      for (const value of coordinators) value.close();
      for (const gate of gates.values()) gate.started();
      await Promise.all(providers.map(provider => provider.provider.close()));
      journal.close();
    }
  };
}
