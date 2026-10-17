// REP-8 retrieval through the chat request contract and host session. Execution is injected; retrieval uses the
// deterministic fixed-document provider. These are software contract checks, not answer-quality evidence.
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatWorkspace } from '../../packages/reploid/src/chat/workspace.js';
import { createFixedSearchProvider, createLexicalSupportChecker, renderSourceContext } from '../../packages/reploid/src/retrieval/index.js';
import { createChatSession } from '../../self/host/chat-session.js';
import { remotePermissionWording } from '../../self/ui/pool-home/remote-permission.js';
import { orderedPartitionDisclosure } from '../../packages/reploid/src/mesh/partitions/partition-grants.js';
import { createChatTestService } from '../fixtures/chat-service.js';

const sha = text => 'sha256:' + createHash('sha256').update(text).digest('hex');
const DOCUMENTS = [
  { id: 'fixed:eiffel', url: 'https://fixed.example/eiffel', title: 'Eiffel Tower', text: 'The Eiffel Tower in Paris was completed in 1889.' },
  { id: 'fixed:louvre', url: 'https://fixed.example/louvre', title: 'Louvre Museum', text: 'The Louvre in Paris is the most visited art museum in the world.' }
];
const QUESTION = 'When was the Eiffel Tower in Paris completed?';
const ANSWER = 'The Eiffel Tower was completed in 1889 [1]. It is the tallest structure in Paris.';
const model = { id: 'model-a', name: 'Model A', identity: 'sha256:' + 'a'.repeat(64) };
const fixedPorts = () => {
  const provider = createFixedSearchProvider({ documents: DOCUMENTS, now: () => 1760000000000 });
  return { provider, extractor: provider, supportChecker: createLexicalSupportChecker() };
};
const result = (request, content) => ({ threadId: request.threadId, attemptId: request.attemptId, modelId: request.model.id,
  modelIdentity: request.model.identity, adapterIdentities: [], content });
function fixture({ retrieval = fixedPorts(), answer = ANSWER, hold = null } = {}) {
  let data;
  const executed = [], store = { load: () => data, save: value => { data = structuredClone(value); } };
  const execute = vi.fn(async request => { executed.push(structuredClone(request)); await hold?.(); return result(request, answer); });
  const options = { meshId: 'mesh', participantId: 'alice', store, execute, retrieval };
  return { app: createChatWorkspace(options), options, store, executed, execute };
}

describe('retrieval-backed chat requests', () => {
  it('sends the numbered sources with the question, verifies citations and keeps provenance across reload', async () => {
    const { app, options, store, executed } = fixture();
    const thread = app.createThread({ model });
    const attempt = await app.send(thread, QUESTION, { retrieval: { limits: { maxResults: 2 } } });
    expect(attempt.status).toBe('completed');
    expect(attempt.request.retrieval).toEqual({ query: QUESTION,
      limits: { maxResults: 2, maxSourceCharacters: 1200, maxContextCharacters: 6000, timeoutMs: 10000 } });
    const record = attempt.retrieval;
    expect(record).toMatchObject({ outcome: 'retrieved', query: QUESTION, error: null });
    expect(record.sources.map(source => [source.number, source.sourceId, source.contentHash]))
      .toEqual([[1, 'fixed:eiffel', sha(DOCUMENTS[0].text)], [2, 'fixed:louvre', sha(DOCUMENTS[1].text)]]);

    // Executors receive the sources inside the question, never the opt-in itself; the thread keeps the typed text.
    const context = renderSourceContext(record.sources);
    expect(executed).toHaveLength(1); expect(executed[0]).not.toHaveProperty('retrieval');
    expect(executed[0].messages).toEqual([{ role: 'user', content: `${context}\n\nQuestion: ${QUESTION}` }]);
    expect(sha(context)).toBe(record.context.digest);
    expect(app.getState().threads[0].messages[0]).toMatchObject({ role: 'user', content: QUESTION });

    expect(record.verification.claims.map(claim => [claim.text, claim.citations.map(citation => [citation.sourceId, citation.support.verdict])]))
      .toEqual([['The Eiffel Tower was completed in 1889.', [['fixed:eiffel', 'supported']]], ['It is the tallest structure in Paris.', []]]);
    expect(record.verification.flags).toEqual([{ kind: 'uncited-claim', claim: 1 }]);

    // Reload: provenance, the disclosed context's digest and verification come back unchanged, with or without a provider.
    const saved = structuredClone(store.load()); await app.close();
    for (const retrieval of [fixedPorts(), null]) {
      const restored = createChatWorkspace({ ...options, retrieval, store: { load: () => structuredClone(saved), save() {} } });
      const again = restored.getState().threads[0].attempts[0].retrieval;
      expect(again).toEqual(record);
      expect(sha(renderSourceContext(again.sources))).toBe(again.context.digest);
      await restored.close();
    }
    // A follow-up without retrieval does not resend the earlier sources.
    const follow = fixture();
    const second = follow.app.createThread({ model });
    await follow.app.send(second, QUESTION, { retrieval: {} }); await follow.app.send(second, 'Thanks');
    expect(follow.executed[1].messages).toEqual([{ role: 'user', content: QUESTION }, { role: 'assistant', content: ANSWER },
      { role: 'user', content: 'Thanks' }]);
    expect(follow.app.getState().threads[0].attempts[1]).not.toHaveProperty('retrieval');
    await follow.app.close();
  });

  it('fails the attempt explicitly when retrieval fails, invents no source and dispatches nothing', async () => {
    const throwing = { id: 'test.provider', version: '1', search: async () => { throw new Error('HTTP 503'); } };
    for (const [retrieval, code, error] of [
      [{ provider: throwing }, 'provider-error', 'Could not retrieve sources: the search provider failed.'],
      [fixedPorts(), 'no-results', 'Could not retrieve sources: the search returned no results.']]) {
      const { app, execute } = fixture({ retrieval });
      const thread = app.createThread({ model });
      const attempt = await app.send(thread, code === 'no-results' ? 'zebra quasar nebula' : QUESTION, { retrieval: {} });
      expect(attempt).toMatchObject({ status: 'failed', error, authorization: null });
      expect(attempt.retrieval).toMatchObject({ outcome: code === 'no-results' ? 'empty' : 'failed', error: { code },
        sources: [], context: null, verification: null });
      expect(execute).not.toHaveBeenCalled();
      expect(app.getState().threads[0].messages[1]).toMatchObject({ role: 'assistant', content: '', status: 'failed' });
      await app.close();
    }
  });

  it('streams retrieval stages before execution and dispatches only the pages completed within the deadline', async () => {
    const fixed = createFixedSearchProvider({ documents: DOCUMENTS, now: () => 1760000000000 });
    let release;
    const { app, execute, executed } = fixture({ retrieval: { provider: fixed, extractor: { id: 'partial', version: '1',
      async extract(input) {
        const value = await fixed.extract(input);
        return input.source.sourceId === 'fixed:eiffel' ? value : new Promise(resolve => { release = () => resolve(value); });
      } } } });
    const seen = []; const unsubscribe = app.subscribe(state => {
      const attempt = state.threads[0]?.attempts[0];
      if (attempt?.retrieval?.outcome === 'pending' && attempt.retrieval.progress) seen.push(structuredClone(attempt.retrieval.progress));
    });
    const thread = app.createThread({ model });
    const pending = app.send(thread, QUESTION, { retrieval: { limits: { timeoutMs: 100 } } });
    await vi.waitFor(() => expect(seen.some(progress => progress.stage === 'extraction' && progress.available === 1)).toBe(true), { interval: 5 });
    expect(execute).not.toHaveBeenCalled();
    const done = await pending;
    expect(done).toMatchObject({ status: 'completed', retrieval: { outcome: 'retrieved', partial: true } });
    expect(seen[0].stage).toBe('search');
    expect(done.retrieval.sources.map(source => source.sourceId)).toEqual(['fixed:eiffel']);
    expect(executed).toHaveLength(1); expect(executed[0].messages[0].content).not.toContain('Louvre');
    const retained = structuredClone(app.getState()); release();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(app.getState()).toEqual(retained);
    unsubscribe(); await app.close();
  });

  it('marks a retrieval pending at reload as interrupted, and a stop during retrieval cancels only that attempt', async () => {
    const hanging = { id: 'test.provider', version: '1', search: (query, limits, signal) => new Promise((_, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })) };
    const { app, options, store, execute } = fixture({ retrieval: { provider: hanging } });
    const thread = app.createThread({ model });
    const pending = app.send(thread, QUESTION, { retrieval: {} });
    await vi.waitFor(() => expect(store.load().threads[0].attempts[0].retrieval.outcome).toBe('pending'));
    const restored = createChatWorkspace({ ...options, store: { load: () => structuredClone(store.load()), save() {} } });
    expect(restored.getState().threads[0].attempts[0]).toMatchObject({ status: 'interrupted',
      retrieval: { outcome: 'interrupted', error: { code: 'interrupted' }, sources: [] } });
    await restored.close();

    await app.cancel(thread);
    expect(await pending).toMatchObject({ status: 'cancelled', retrieval: { outcome: 'cancelled', sources: [] } });
    expect(execute).not.toHaveBeenCalled();
    await app.close();
  });

  it('retries with a fresh retrieval in a new attempt and refuses retrieval without configured ports', async () => {
    let fail = true;
    const provider = createFixedSearchProvider({ documents: DOCUMENTS, now: () => 1760000000000 });
    const flaky = { id: provider.id, version: provider.version, search: (...input) => fail ? Promise.reject(new Error('down')) : provider.search(...input) };
    const { app } = fixture({ retrieval: { provider: flaky } });
    const thread = app.createThread({ model });
    const first = await app.send(thread, QUESTION, { retrieval: {} });
    expect(first.retrieval.outcome).toBe('failed');
    fail = false;
    const second = await app.retry(thread, first.id);
    expect(second).toMatchObject({ status: 'completed', retryOf: first.id, retrieval: { outcome: 'retrieved' } });
    expect(app.getState().threads[0].attempts.map(attempt => attempt.retrieval.outcome)).toEqual(['failed', 'retrieved']);
    await app.close();

    const plain = fixture({ retrieval: null }), other = plain.app.createThread({ model });
    expect(() => plain.app.send(other, QUESTION, { retrieval: {} })).toThrow('Retrieval is not configured');
    expect(plain.app.getState().threads[0].messages).toEqual([]);
    await plain.app.close();
    const limited = fixture(), bounded = limited.app.createThread({ model });
    expect(() => limited.app.send(bounded, QUESTION, { retrieval: { limits: { maxResults: 99 } } })).toThrow('maxResults is outside the policy limit');
    expect(limited.app.getState().threads[0].messages).toEqual([]);
    await limited.app.close();
  });
});

const peer = c => 'peer:' + c.repeat(24), digest = c => 'sha256:' + c.repeat(64);
const REQUESTER = peer('d'), STAGES = [peer('0'), peer('1'), peer('2')];
const route = { schema: 'reploid.partition-route/v1', modelId: 'ordered', modelIdentity: digest('a'), planId: digest('b'),
  activation: { schema: 'doppler.activation-tensor/v1', dtype: 'f32', hiddenSize: 8, precision: 'f32', components: 1, elementStrideBytes: 4 },
  stages: STAGES.map((participantId, index) => ({ index, participantId, transportId: `transport-${index}`, residentId: `resident-${index}`, executionId: `execution-${index}` })) };
const ordered = { id: 'ordered', name: 'Ordered model', identity: route.modelIdentity, provider: 'doppler', availability: 'ready', adapters: [],
  selectionId: 'ordered/partition/' + route.planId, partition: { schema: 'reploid.partition-selection/v2', planId: route.planId, coordinatorId: STAGES[0], route } };
/** Injected ordered execution: the workspace authorizes first; only then is the disclosure recorded. */
function orderedRoute() {
  const disclosed = [];
  return { disclosed, getModels: () => [structuredClone(ordered)], subscribe: () => () => {},
    async generate(request, controls) {
      const { threadId, attemptId } = request;
      const identity = { schema: 'reploid.partition-attempt/v2', route, requesterId: REQUESTER, threadId, attemptId, placementGeneration: 0 };
      const disclosure = orderedPartitionDisclosure(identity);
      const approved = await controls.requestApproval({ id: 'preview-' + attemptId, threadId, attemptId, operation: 'generate-partition',
        peerId: STAGES[0], recipientIdentity: STAGES[0], ...structuredClone(ordered.partition), modelId: ordered.id,
        modelIdentity: ordered.identity, adapterIdentities: [], disclosure, expiresAt: Date.now() + 60000,
        input: { messages: structuredClone(request.messages), recipients: [...new Set([...disclosure.tokenRecipients, ...disclosure.outputRecipients])] } });
      if (approved !== true) throw Error('Ordered disclosure declined or expired');
      disclosed.push(structuredClone(request.messages));
      controls.onState({ threadId, attemptId, status: 'executing', execution: { placement: 'ordered-layer-partition', identity } });
      controls.onDelta({ threadId, attemptId, sequence: 0, text: ANSWER });
      return { threadId, attemptId, modelId: ordered.id, modelIdentity: ordered.identity, adapterIdentities: [], content: ANSWER,
        execution: { schema: 'reploid.mesh.partition-summary/v2', identity, stopReason: 'eos-token' } };
    } };
}
const memory = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) }; };
const sessions = [];
afterEach(async () => { for (const session of sessions.splice(0)) await session.close(); });

describe('host retrieval plumbing and disclosure', () => {
  it('retrieved sources leave the device only under the one-time remote permission, with the typed text as the query', async () => {
    const partitions = orderedRoute();
    const session = createChatSession({ storage: memory(), service: createChatTestService(), partitions, retrieval: fixedPorts(),
      requesterIdentity: () => REQUESTER });
    sessions.push(session);
    session.setRemoteAnswersEnabled(false);
    const thread = session.createThread({ model: ordered });
    const completion = session.send(thread, QUESTION, [{ name: 'notes.txt', text: 'My private notes about Paris.' }], { retrieval: {} });
    const attempt = () => session.getState().threads[0].attempts.at(-1);
    await vi.waitFor(() => expect(attempt().status).toBe('approval'));
    // Retrieval ran here and its provenance is saved; nothing, sources included, has been sent.
    expect(attempt().retrieval).toMatchObject({ outcome: 'retrieved', query: QUESTION });
    expect(partitions.disclosed).toEqual([]);

    const need = session.remotePermissionNeeded({ model: ordered, sharingScope: 'mesh' });
    const permission = await session.grantRemotePermission(need, { wording: remotePermissionWording(need) });
    const done = await completion;
    expect(done).toMatchObject({ status: 'completed', authorization: { kind: 'permission', permissionId: permission.id, recipients: STAGES } });
    expect(partitions.disclosed).toHaveLength(1);
    const sent = partitions.disclosed[0].at(-1).content;
    expect(sent.startsWith(renderSourceContext(done.retrieval.sources))).toBe(true);
    expect(sent).toContain('[1] Eiffel Tower\nhttps://fixed.example/eiffel');
    expect(sent).toContain('My private notes about Paris.');
    expect(done.retrieval.verification.summary).toMatchObject({ claims: 2, citedClaims: 1, supported: 1 });

    expect(() => createChatSession({ storage: memory(), service: createChatTestService(), retrieval: { provider: {} } }))
      .toThrow('Retrieval requires a search provider');
  });
});
