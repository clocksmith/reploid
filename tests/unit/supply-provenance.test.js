// Answer-level supply provenance: classification from execution and route records, fail-closed refusal of hosted
// or unrecognized executors in a conversation, retry lineage, retrieval supply and persistence across reload.
// Execution is injected; these are software contract checks, not physical execution evidence.
import { describe, expect, it } from 'vitest';
import { createChatWorkspace } from '../../packages/reploid/src/chat/workspace.js';
import { answerProvenance, classifyExecutionSupply, executionRefusal, HOSTED_EXECUTION_REFUSED, UNRECOGNIZED_EXECUTION_REFUSED }
  from '../../packages/reploid/src/chat/supply-provenance.js';
import { createFixedSearchProvider } from '../../packages/reploid/src/retrieval/index.js';

const model = { id: 'model-a', name: 'Model A', identity: 'sha256:' + 'a'.repeat(64) };
const peer = 'peer:' + 'b'.repeat(24), other = 'peer:' + 'c'.repeat(24), me = 'peer:' + 'd'.repeat(24);
const LOCAL = { provider: 'doppler', placement: 'local-webgpu' };
const PEER = { provider: 'peer', placement: 'peer-whole-request', peerId: peer };
const HOSTED = { provider: 'hosted', placement: 'hosted-api', hostedProvider: 'example-hosted' };
const ordered = (participants, requesterId = me) => ({ schema: 'reploid.mesh.partition-summary/v2', identity: {
  schema: 'reploid.partition-attempt/v2', threadId: 't', attemptId: 'a', requesterId, placementGeneration: 0,
  route: { schema: 'reploid.partition-route/v1', modelId: model.id, modelIdentity: model.identity, planId: 'plan',
    stages: participants.map((participantId, index) => ({ index, participantId })) } } });
const result = (request, content, execution) => ({ threadId: request.threadId, attemptId: request.attemptId, modelId: request.model.id,
  modelIdentity: request.model.identity, adapterIdentities: [], content, ...(execution ? { execution } : {}) });
function fixture(execute, extra = {}) {
  let data;
  const store = { load: () => data, save: value => { data = structuredClone(value); } };
  const options = { meshId: 'mesh', participantId: 'alice', requesterIdentity: () => me, store, execute, ...extra };
  return { app: createChatWorkspace(options), options, store };
}

describe('execution supply classification', () => {
  it('classifies this device, mesh peers and partition stages from their records', () => {
    expect(classifyExecutionSupply(LOCAL, { localIds: [me] })).toMatchObject({ supply: 'local', placement: 'local-webgpu',
      participants: [{ participantId: me, supply: 'local', role: 'whole-request' }] });
    expect(classifyExecutionSupply(PEER, { localIds: [me] })).toMatchObject({ supply: 'mesh', classes: ['mesh'],
      participants: [{ participantId: peer, supply: 'mesh', role: 'whole-request', stage: null }] });
    expect(classifyExecutionSupply(ordered([peer, other]))).toMatchObject({ supply: 'mesh', placement: 'ordered-layer-partition',
      participants: [{ participantId: peer, stage: 0, role: 'stage' }, { participantId: other, stage: 1 }] });
    expect(classifyExecutionSupply({ placement: 'two-device-layer-partition', participantA: peer, participantB: other }))
      .toMatchObject({ supply: 'mesh', participants: [{ stage: 0, supply: 'mesh' }, { stage: 1, supply: 'mesh' }] });
    expect(classifyExecutionSupply(null)).toEqual({ supply: 'none', classes: [], placement: null, participants: [] });
  });

  it('marks a route with a stage on this device as mixed, using the route record\'s own requester binding', () => {
    const route = classifyExecutionSupply(ordered([me, peer, other]));
    expect(route).toMatchObject({ supply: 'mixed', classes: ['local', 'mesh'] });
    expect(route.participants.map(row => row.supply)).toEqual(['local', 'mesh', 'mesh']);
    expect(classifyExecutionSupply({ placement: 'two-device-layer-partition', participantA: me, participantB: peer, requesterId: me }))
      .toMatchObject({ supply: 'mixed', classes: ['local', 'mesh'] });
  });

  it('represents a hosted executor and never counts an unrecognized one as mesh', () => {
    expect(classifyExecutionSupply(HOSTED)).toMatchObject({ supply: 'hosted', classes: ['hosted'], placement: 'hosted-api',
      participants: [{ participantId: null, provider: 'example-hosted', supply: 'hosted' }] });
    for (const [record, reason] of [[{ provider: 'hosted', placement: 'hosted-api' }, 'incomplete-hosted-record'],
      [{ provider: 'openai', placement: 'peer-whole-request', peerId: peer }, 'unrecognized-provider'],
      [{ provider: 'peer', placement: 'peer-whole-request' }, 'incomplete-peer-record'],
      [{ placement: 'ordered-layer-partition' }, 'invalid-route-record'],
      [{ provider: 'doppler', placement: 'cloud-gpu' }, 'unrecognized-placement'], ['text', 'invalid-record']]) {
      const classified = classifyExecutionSupply(record);
      expect(classified).toMatchObject({ supply: 'unknown', classes: [], participants: [], reason });
      expect(executionRefusal(classified)).toBe(UNRECOGNIZED_EXECUTION_REFUSED);
    }
    expect(executionRefusal(classifyExecutionSupply(HOSTED))).toBe(HOSTED_EXECUTION_REFUSED);
    // A record that names no executor reports nothing: unknown, not refused, never mesh.
    const unreported = classifyExecutionSupply({ stopReason: 'eos-token' });
    expect(unreported).toMatchObject({ supply: 'unknown', reason: 'executor-not-reported' });
    expect(executionRefusal(unreported)).toBeNull();
  });
});

describe('conversation provenance', () => {
  it('records mesh provenance for a completed peer answer and keeps it across reload', async () => {
    const { app, options, store } = fixture(async request => result(request, 'Peer answer', PEER));
    const thread = app.createThread({ model });
    const attempt = await app.send(thread, 'Question');
    expect(attempt.status).toBe('completed');
    expect(attempt.provenance).toMatchObject({ schema: 'reploid.answer-provenance/v1', attemptId: attempt.id, supply: 'mesh',
      classes: ['mesh'], execution: { supply: 'mesh', placement: 'peer-whole-request' }, earlierAttempts: [], retrieval: { supply: 'none' } });
    const saved = structuredClone(store.load());
    expect(saved.threads[0].attempts[0].provenance).toEqual(attempt.provenance);
    await app.close();
    const restored = createChatWorkspace({ ...options, store: { load: () => saved, save() {} } });
    expect(restored.getState().threads[0].attempts[0].provenance).toEqual(attempt.provenance);
    await restored.close();
  });

  it('derives provenance on reload for histories saved before it existed, and for interrupted attempts', async () => {
    const { app, options, store } = fixture(async request => result(request, 'Local answer', LOCAL));
    const thread = app.createThread({ model });
    await app.send(thread, 'Question'); await app.close();
    const saved = structuredClone(store.load());
    delete saved.threads[0].attempts[0].provenance;
    saved.threads[0].attempts.push({ ...saved.threads[0].attempts[0], id: 'running', responseId: 'running-response', status: 'executing',
      execution: ordered([peer, other]), finishedAt: null });
    const restored = createChatWorkspace({ ...options, store: { load: () => saved, save() {} } });
    const [first, second] = restored.getState().threads[0].attempts;
    expect(first.provenance).toMatchObject({ supply: 'local', execution: { participants: [{ participantId: me, supply: 'local' }] } });
    expect(second).toMatchObject({ status: 'interrupted', provenance: { supply: 'mesh', execution: { placement: 'ordered-layer-partition' } } });
    await restored.close();
  });

  it('labels an answer retried across classes as mixed while each attempt keeps its own supply', async () => {
    let calls = 0;
    const { app } = fixture(async (request, controls) => {
      if (calls++ === 0) {
        controls.onState({ threadId: request.threadId, attemptId: request.attemptId, status: 'loading', execution: LOCAL });
        throw new Error('Local memory exhausted');
      }
      return result(request, 'Peer answer', PEER);
    });
    const thread = app.createThread({ model });
    const failed = await app.send(thread, 'Question');
    expect(failed).toMatchObject({ status: 'failed', provenance: { supply: 'local', execution: { supply: 'local' } } });
    const retried = await app.retry(thread, failed.id);
    expect(retried.provenance).toMatchObject({ supply: 'mixed', classes: ['local', 'mesh'], execution: { supply: 'mesh' },
      earlierAttempts: [{ attemptId: failed.id, status: 'failed', supply: 'local', classes: ['local'] }] });
    await app.close();
  });

  it('fails closed on a hosted executor, before output when it reports its state and at completion otherwise', async () => {
    const early = fixture(async (request, controls) => {
      controls.onState({ threadId: request.threadId, attemptId: request.attemptId, status: 'executing', execution: HOSTED });
      controls.signal.throwIfAborted();
      controls.onDelta({ threadId: request.threadId, attemptId: request.attemptId, sequence: 0, text: 'Hosted text' });
      return result(request, 'Hosted text', HOSTED);
    });
    const thread = early.app.createThread({ model });
    const refused = await early.app.send(thread, 'Question');
    expect(refused).toMatchObject({ status: 'failed', error: HOSTED_EXECUTION_REFUSED,
      provenance: { supply: 'hosted', execution: { supply: 'hosted', placement: 'hosted-api' } } });
    expect(early.app.getState().threads[0].messages.at(-1)).toMatchObject({ status: 'failed', content: '' });
    await early.app.close();

    const late = fixture(async request => result(request, 'Hosted text', HOSTED));
    const lateThread = late.app.createThread({ model });
    expect(await late.app.send(lateThread, 'Question')).toMatchObject({ status: 'failed', error: HOSTED_EXECUTION_REFUSED,
      provenance: { supply: 'hosted' } });
    expect(late.app.getState().threads[0].messages.at(-1).content).toBe('');
    await late.app.close();
  });

  it('fails closed on an unrecognized executor and labels an unreported one unknown, never mesh', async () => {
    const strange = fixture(async request => result(request, 'Text', { provider: 'openai', placement: 'chat-completions' }));
    const thread = strange.app.createThread({ model });
    expect(await strange.app.send(thread, 'Question')).toMatchObject({ status: 'failed', error: UNRECOGNIZED_EXECUTION_REFUSED,
      provenance: { supply: 'unknown', execution: { reason: 'unrecognized-provider' } } });
    await strange.app.close();

    const unreported = fixture(async request => result(request, 'Text'));
    const second = unreported.app.createThread({ model });
    expect(await unreported.app.send(second, 'Question')).toMatchObject({ status: 'completed',
      provenance: { supply: 'unknown', classes: [], execution: { reason: 'executor-not-reported' } } });
    await unreported.app.close();
  });

  it('records retrieval supply separately from execution supply', async () => {
    const documents = [{ id: 'fixed:a', url: 'https://fixed.example/a', title: 'A', text: 'Alpha is the first letter.' }];
    const base = createFixedSearchProvider({ documents, now: () => 1760000000000 });
    const provider = { id: base.id, version: base.version, search: base.search, supply: 'server' };
    const { app } = fixture(async request => result(request, 'Alpha [1]', PEER), { retrieval: { provider, extractor: base } });
    const thread = app.createThread({ model });
    const attempt = await app.send(thread, 'What is alpha?', { retrieval: {} });
    expect(attempt.retrieval.provider).toEqual({ id: 'reploid.fixed-documents', version: '1', supply: 'server' });
    expect(attempt.provenance).toMatchObject({ supply: 'mesh', retrieval: { supply: 'server', provider: 'reploid.fixed-documents',
      route: null, outcome: 'retrieved' } });
    // A record from a provider that declared nothing is of unknown retrieval supply.
    const legacy = { ...attempt, retrieval: { ...attempt.retrieval, provider: { id: 'old', version: '1' } }, provenance: undefined };
    expect(answerProvenance({ attempts: [legacy], messages: [] }, legacy).retrieval.supply).toBe('unknown');
    await app.close();
  });
});
