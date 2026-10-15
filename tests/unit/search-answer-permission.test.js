// REP-8 per-answer search permission (approved wording, DR-3): the v3 permission record, what a search-backed
// answer may disclose (only the current question and retrieved passages, only to the listed contributors), the
// host session and the conversation view. Search runs over fixed documents and execution is injected; no search
// service, page fetch or inference is involved.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatWorkspace } from '../../packages/reploid/src/chat/workspace.js';
import { REMOTE_PERMISSION_SCHEMA, createRemotePermission, remotePermissionCovers, validateRemotePermission } from '../../packages/reploid/src/chat/remote-permission.js';
import { SEARCH_RECIPIENTS_CHANGED, createSearchPermission, searchPermissionWording, validateSearchPermission } from '../../packages/reploid/src/chat/search-permission.js';
import { createFixedSearchProvider, renderSourceContext } from '../../packages/reploid/src/retrieval/index.js';
import { orderedPartitionDisclosure } from '../../packages/reploid/src/mesh/partitions/partition-grants.js';
import { createChatSession, SEARCH_ROUTE } from '../../self/host/chat-session.js';
import { createServerSearch } from '../../self/host/server-search.js';
import { renderConversationWorkspace, bindConversationWorkspace } from '../../self/ui/pool-home/conversation-workspace.js';
import { remotePermissionWording } from '../../self/ui/pool-home/remote-permission.js';
import { createChatTestService } from '../fixtures/chat-service.js';

const APPROVED = 'Allow Reploid to send this search query to Brave and share retrieved passages with the listed execution contributors for this answer. Your files and unrelated conversation history are excluded.';
const peer = c => 'peer:' + c.repeat(24), digest = c => 'sha256:' + c.repeat(64);
const REQUESTER = peer('d'), STAGES = [peer('0'), peer('1'), peer('2')];
const DOCUMENTS = [{ id: 'fixed:eiffel', url: 'https://fixed.example/eiffel', title: 'Eiffel Tower', text: 'The Eiffel Tower in Paris was completed in 1889.' }];
const QUESTION = 'When was the Eiffel Tower completed?';
const ANSWER = 'It was completed in 1889 [1].';
const route = { schema: 'reploid.partition-route/v1', modelId: 'ordered', modelIdentity: digest('a'), planId: digest('b'),
  activation: { schema: 'doppler.activation-tensor/v1', dtype: 'f32', hiddenSize: 8, precision: 'f32', components: 1, elementStrideBytes: 4 },
  stages: STAGES.map((participantId, index) => ({ index, participantId, transportId: `transport-${index}`, residentId: `resident-${index}`, executionId: `execution-${index}` })) };
const model = { id: 'ordered', name: 'Ordered model', identity: route.modelIdentity, provider: 'doppler', availability: 'ready', adapters: [],
  selectionId: 'ordered/partition/' + route.planId, partition: { schema: 'reploid.partition-selection/v2', planId: route.planId, coordinatorId: STAGES[0], route } };
const wording = () => searchPermissionWording('brave');
const searchPorts = (searchProvider = 'brave') => {
  const fixed = createFixedSearchProvider({ documents: DOCUMENTS, now: () => 1760000000000 });
  return { provider: { ...fixed, searchProvider }, extractor: fixed, permission: 'search-answer' };
};
/** Injected ordered execution: records what reaches the route only after the workspace approves the disclosure. */
function orderedRoute() {
  const disclosed = [];
  return { disclosed, getModels: () => [structuredClone(model)], subscribe: () => () => {},
    async generate(request, controls) {
      const { threadId, attemptId } = request;
      const identity = { schema: 'reploid.partition-attempt/v2', route, requesterId: REQUESTER, threadId, attemptId, placementGeneration: 0 };
      const disclosure = orderedPartitionDisclosure(identity);
      const approved = await controls.requestApproval({ id: 'preview-' + attemptId, threadId, attemptId, operation: 'generate-partition',
        peerId: STAGES[0], recipientIdentity: STAGES[0], ...structuredClone(model.partition), modelId: model.id, modelIdentity: model.identity,
        adapterIdentities: [], disclosure, expiresAt: Date.now() + 60000,
        input: { messages: structuredClone(request.messages), recipients: [...new Set([...disclosure.tokenRecipients, ...disclosure.outputRecipients])] } });
      if (approved !== true) throw Error('Ordered disclosure declined or expired');
      disclosed.push(structuredClone(request.messages));
      controls.onState({ threadId, attemptId, status: 'executing', execution: { placement: 'ordered-layer-partition', identity } });
      controls.onDelta({ threadId, attemptId, sequence: 0, text: ANSWER });
      return { threadId, attemptId, modelId: model.id, modelIdentity: model.identity, adapterIdentities: [], content: ANSWER,
        execution: { schema: 'reploid.mesh.partition-summary/v2', identity, stopReason: 'eos-token' } };
    } };
}
const memory = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) }; };
const cleanups = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); document.body.replaceChildren(); });

describe('permission records, schema v3', () => {
  it('a search grant records the exact approved wording it was shown, and no other text is accepted', () => {
    expect(wording()).toEqual({ id: 'reploid.search-answer-permission', version: '2026-10-15', text: APPROVED });
    expect(searchPermissionWording('searxng')).toBeNull();
    const grant = createSearchPermission({ id: 'g1', networkId: 'mesh', threadId: 't1', searchProvider: 'brave', query: 'q', recipients: STAGES,
      wording: wording(), grantedAt: 1 });
    expect(grant).toEqual({ schema: 'reploid.remote-permission/v3', kind: 'search-answer', id: 'g1', networkId: 'mesh', threadId: 't1',
      searchProvider: 'brave', query: 'q', recipients: STAGES, wording: { id: 'reploid.search-answer-permission', version: '2026-10-15', text: APPROVED },
      grantedAt: 1, revokedAt: null });
    for (const text of [APPROVED.replace('Brave', 'brave'), APPROVED + ' ', APPROVED.slice(0, -1)]) {
      expect(() => createSearchPermission({ ...grant, wording: { ...wording(), text } })).toThrow('not the approved text');
    }
    expect(() => createSearchPermission({ ...grant, searchProvider: 'searxng' })).toThrow('not the approved text');
    expect(() => validateSearchPermission({ ...grant, recipients: [STAGES[0], STAGES[0]] })).toThrow('Invalid search permission');
  });

  it('remote-contributor grants record their shown wording; v2 records without it no longer cover anything', () => {
    const need = { networkId: 'mesh', sharingScope: 'mesh', disclosure: 'public', modelId: 'm', modelIdentity: digest('a'), adapterIdentities: [] };
    expect(() => createRemotePermission({ id: 'p', need, grantedAt: 1 })).toThrow('Invalid remote contributor permission');
    const shown = remotePermissionWording(need), permission = createRemotePermission({ id: 'p', need, wording: shown, grantedAt: 1 });
    expect(permission).toMatchObject({ schema: REMOTE_PERMISSION_SCHEMA, kind: 'remote-contributors', wording: shown });
    expect(shown.text.split('\n\n')[0]).toBe("Answer with contributors' computers?");
    expect(remotePermissionCovers(permission, need)).toBe(true);
    const { kind, wording: _shown, ...v2 } = permission;
    expect(() => validateRemotePermission({ ...v2, schema: 'reploid.remote-permission/v2' })).toThrow('Invalid remote contributor permission');
    expect(remotePermissionCovers({ ...v2, schema: 'reploid.remote-permission/v2' }, need)).toBe(false);
  });
});

describe('search-backed answers in the workspace', () => {
  function workspace({ execute } = {}) {
    let data; const executed = [];
    const app = createChatWorkspace({ meshId: 'mesh', participantId: 'alice', store: { load: () => data, save: value => { data = structuredClone(value); } },
      retrieval: { routes: { [SEARCH_ROUTE]: searchPorts(), default: { provider: createFixedSearchProvider({ documents: DOCUMENTS }) } } },
      execute: execute || (async request => { executed.push(structuredClone(request)); return { threadId: request.threadId, attemptId: request.attemptId,
        modelId: request.model.id, modelIdentity: request.model.identity, adapterIdentities: [], content: ANSWER }; }) });
    cleanups.push(() => app.close());
    return { app, executed };
  }
  const grant = (threadId, overrides = {}) => createSearchPermission({ id: crypto.randomUUID(), networkId: 'mesh', threadId, searchProvider: 'brave',
    query: QUESTION, recipients: [], wording: wording(), grantedAt: Date.now(), ...overrides });

  it('sends only the current question and retrieved passages: no history, context prompt, purpose or other turns', async () => {
    const { app, executed } = workspace();
    const thread = app.createThread({ model: { id: 'm', name: 'M', identity: digest('a') }, purpose: 'Private purpose',
      systemContext: { content: 'Private app context', metadata: { enabled: true } } });
    await app.send(thread, 'My earlier private question');
    const attempt = await app.send(thread, QUESTION, { retrieval: { route: SEARCH_ROUTE }, searchPermission: grant(thread) });
    expect(attempt).toMatchObject({ status: 'completed', searchPermission: { kind: 'search-answer', wording: { text: APPROVED } } });
    const sent = executed.at(-1);
    expect(sent.messages).toEqual([{ role: 'user', content: `${renderSourceContext(attempt.retrieval.sources)}\n\nQuestion: ${QUESTION}` }]);
    expect(JSON.stringify(sent)).not.toMatch(/Private|earlier private/);
    // The default route and ordinary sends keep their existing behavior.
    await app.send(thread, 'Thanks');
    expect(executed.at(-1).messages.map(message => message.content)).toContain('My earlier private question');
  });

  it('refuses a search answer without a covering, unused grant for this thread, network, query and service', async () => {
    const { app, executed } = workspace();
    const thread = app.createThread({ model: { id: 'm', name: 'M', identity: digest('a') } }), search = { route: SEARCH_ROUTE };
    expect(() => app.send(thread, QUESTION, { retrieval: search })).toThrow('need the per-answer search permission');
    for (const [overrides, message] of [[{ threadId: 'other' }, 'does not cover'], [{ query: 'other' }, 'does not cover'],
      [{ networkId: 'other-room' }, 'does not cover']]) expect(() => app.send(thread, QUESTION, { retrieval: search, searchPermission: grant(thread, overrides) })).toThrow(message);
    expect(() => app.send(thread, QUESTION, { searchPermission: grant(thread) })).toThrow('takes no search permission');
    const once = grant(thread);
    await app.send(thread, QUESTION, { retrieval: search, searchPermission: once });
    expect(() => app.send(thread, QUESTION, { retrieval: search, searchPermission: once })).toThrow('allows one answer');
    expect(executed).toHaveLength(1);
    expect(app.getState().threads[0].messages.filter(message => message.role === 'user')).toHaveLength(1);
  });

  it('shares passages only with listed contributors; a changed route sends nothing and a retry needs a new grant', async () => {
    const partitions = orderedRoute();
    const app = createChatWorkspace({ meshId: 'mesh', participantId: REQUESTER, store: { load: () => null, save() {} },
      retrieval: { routes: { [SEARCH_ROUTE]: searchPorts() } }, execute: (request, controls) => partitions.generate(request, controls) });
    cleanups.push(() => app.close());
    const thread = app.createThread({ model, permissions: { sharingScope: 'mesh' } });
    const failed = await app.send(thread, QUESTION, { retrieval: { route: SEARCH_ROUTE }, searchPermission: grant(thread, { recipients: STAGES.slice(0, 2) }) });
    expect(failed).toMatchObject({ status: 'failed', error: SEARCH_RECIPIENTS_CHANGED, retrieval: { outcome: 'retrieved' } });
    expect(partitions.disclosed).toEqual([]);
    expect(() => app.retry(thread, failed.id)).toThrow('need the per-answer search permission');
    const retried = await app.retry(thread, failed.id, { searchPermission: grant(thread, { recipients: STAGES }), authorizeDisclosure: () => true });
    expect(retried).toMatchObject({ status: 'completed', retryOf: failed.id, searchPermission: { recipients: STAGES } });
    expect(partitions.disclosed).toHaveLength(1);
    expect(partitions.disclosed[0]).toHaveLength(1);
  });

  it('on one contributor\'s computer, passes when the verified recipient is the listed peer and sends nothing otherwise', async () => {
    // Discovery lists swarm peer IDs; the swarm peer ID is the signing identity, so a verified recipient matches it.
    const single = { id: 'single', name: 'Single', identity: digest('c'), adapters: [] }, PROVIDER = peer('5'), disclosed = [];
    const app = createChatWorkspace({ meshId: 'mesh', participantId: REQUESTER, store: { load: () => null, save() {} },
      retrieval: { routes: { [SEARCH_ROUTE]: searchPorts() } },
      async execute(request, controls) {
        const { threadId, attemptId } = request;
        const approved = await controls.requestApproval({ id: 'preview-' + attemptId, threadId, attemptId, operation: 'generate',
          disclosure: 'public', peerId: PROVIDER, recipientIdentity: PROVIDER, modelId: single.id, modelIdentity: single.identity,
          adapterIdentities: [], expiresAt: Date.now() + 60000 });
        if (approved !== true) throw Error('Disclosure declined or expired');
        disclosed.push(structuredClone(request.messages));
        return { threadId, attemptId, modelId: single.id, modelIdentity: single.identity, adapterIdentities: [], content: ANSWER };
      } });
    cleanups.push(() => app.close());
    const thread = app.createThread({ model: single, permissions: { sharingScope: 'mesh' } }), search = { route: SEARCH_ROUTE };
    const failed = await app.send(thread, QUESTION, { retrieval: search, searchPermission: grant(thread, { recipients: [peer('6')] }),
      authorizeDisclosure: () => true });
    expect(failed).toMatchObject({ status: 'failed', error: SEARCH_RECIPIENTS_CHANGED });
    expect(disclosed).toEqual([]);
    const sent = await app.send(thread, QUESTION, { retrieval: search, searchPermission: grant(thread, { recipients: [PROVIDER] }),
      authorizeDisclosure: () => true });
    expect(sent).toMatchObject({ status: 'completed', searchPermission: { recipients: [PROVIDER] } });
    expect(disclosed).toHaveLength(1);
  });
});

describe('host session and conversation view', () => {
  function open({ retrieval = { routes: { [SEARCH_ROUTE]: searchPorts() } } } = {}) {
    const partitions = orderedRoute();
    const session = createChatSession({ storage: memory(), service: createChatTestService(), partitions, retrieval, requesterIdentity: () => REQUESTER });
    cleanups.push(() => session.close());
    return { session, partitions };
  }
  const grantContributors = async session => {
    const need = session.remotePermissionNeeded({ model, sharingScope: 'mesh' });
    await session.grantRemotePermission(need, { wording: remotePermissionWording(need) });
  };

  it('lists the route contributors, records the shown wording, and keeps files out of search answers', async () => {
    const { session, partitions } = open();
    await grantContributors(session);
    const request = session.searchPermissionRequest({ model, sharingScope: 'mesh' });
    expect(request).toEqual({ searchProvider: 'brave', wording: wording(), recipients: STAGES });
    const thread = session.createThread({ model });
    expect(() => session.send(thread, QUESTION, [{ name: 'notes.txt', text: 'My private notes' }], { search: request }))
      .toThrow("Search-backed answers don't include files");
    const done = await session.send(thread, QUESTION, [], { search: request });
    expect(done).toMatchObject({ status: 'completed', request: { retrieval: { route: SEARCH_ROUTE, query: QUESTION } },
      searchPermission: { schema: 'reploid.remote-permission/v3', kind: 'search-answer', query: QUESTION, recipients: STAGES,
        wording: { text: APPROVED } }, authorization: { kind: 'permission', recipients: STAGES } });
    expect(partitions.disclosed[0].at(-1).content).not.toContain('My private notes');
    // The remote-contributor permission and the search grant stay separate records.
    expect(session.getState().remotePermissions.map(permission => permission.kind)).toEqual(['remote-contributors']);
    const unapproved = open({ retrieval: { routes: { [SEARCH_ROUTE]: searchPorts('searxng') } } });
    expect(() => unapproved.session.searchPermissionRequest({ model })).toThrow('Search is not available');
  });

  it('asks with the exact text and contributors each time; Don\'t search sends nothing; Allow sends the answer', async () => {
    const { session, partitions } = open();
    await grantContributors(session);
    const search = { provider: {}, extractor: {}, available: () => true, state: () => ({ state: 'ready' }), subscribe: listener => { listener(); return () => {}; }, refresh() {} };
    const root = document.createElement('div'); root.innerHTML = renderConversationWorkspace(); document.body.append(root);
    const dispose = bindConversationWorkspace(root, session, { search }); cleanups.push(async () => dispose());
    const find = selector => root.querySelector(selector), dialog = find('[data-search-permission]');
    const submit = text => { find('[data-composer-input]').value = text; find('[data-composer-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); };
    expect(find('[data-search-toggle]').hidden).toBe(false);
    find('[data-search-toggle]').click();
    submit(QUESTION);
    await vi.waitFor(() => expect(dialog.open).toBe(true));
    expect(find('[data-search-permission-text]').textContent).toBe(APPROVED);
    expect([...find('[data-search-permission-recipients]').children].map(item => item.textContent)).toHaveLength(3);
    find('[data-search-permission-decline]').click();
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(session.getState().threads).toEqual([]); expect(partitions.disclosed).toEqual([]);
    expect(find('[data-composer-input]').value).toBe(QUESTION);

    submit(QUESTION);
    await vi.waitFor(() => expect(dialog.open).toBe(true));
    find('[data-search-permission-allow]').click();
    await vi.waitFor(() => expect(session.getState().threads[0]?.attempts.at(-1)?.status).toBe('completed'));
    expect(session.getState().threads[0].attempts[0].searchPermission.wording.text).toBe(APPROVED);
    expect(find('[data-search-toggle]').getAttribute('aria-pressed')).toBe('false');
    // The answer's [1] marker links to its numbered source.
    const marker = find('.chat-message-row.is-assistant [data-source-reference]');
    expect(marker.textContent).toBe('[1]');
    expect(find(marker.getAttribute('href')).textContent).toContain('[1] Eiffel Tower');
  });
});

describe('server search port', () => {
  it('sends the query to the server route for Brave only and keeps passage offsets from the server', async () => {
    const calls = [];
    const fetch = vi.fn(async (url, init) => {
      calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
      const reply = url.endsWith('/status') ? { schema: 'reploid.server-search-status/v1', enabled: true, provider: 'brave' }
        : url.endsWith('/search') ? { schema: 'reploid.server-search-results/v1', provider: { kind: 'brave', id: 'reploid.server-search/brave', version: '1' },
          results: [{ sourceId: 'web-0123456789abcdef', url: 'https://example.org/a', title: 'A', excerpt: 'tower', retrievedAt: 5, contentHash: digest('c'), fetchToken: 'token.9' }],
          usage: { provider: 'brave', requests: 1, billable: true, costMicroUsd: 5000, rateLimit: null } }
        : { schema: 'reploid.server-passage/v1', url: 'https://example.org/a', text: 'tower text', retrievedAt: 6, contentHash: digest('d'),
          document: { url: 'https://example.org/a', status: 200, contentType: 'text/html', bytes: 900, byteSha256: digest('e'), characters: 40, sha256: digest('d'), start: 10, end: 20 } };
      return { ok: true, status: 200, json: async () => reply };
    });
    const search = createServerSearch({ fetch });
    expect(await search.refresh()).toMatchObject({ state: 'ready', provider: 'brave' });
    const found = await search.provider.search('tower', { maxResults: 3 }, null);
    expect(calls[1]).toEqual({ url: '/api/retrieval/search', body: { query: 'tower', count: 3, expectProvider: 'brave' } });
    expect(found.usage).toEqual({ provider: 'brave', requests: 1, costMicroUsd: 5000 });
    const passage = await search.extractor.extract({ source: found.results[0], query: 'tower', limits: { maxSourceCharacters: 1200 }, signal: null });
    expect(calls[2].body).toEqual({ url: 'https://example.org/a', fetchToken: 'token.9', query: 'tower', maxCharacters: 1200 });
    expect(passage).toMatchObject({ sourceId: 'web-0123456789abcdef', text: 'tower text', document: { start: 10, end: 20, sha256: digest('d') } });
    const elsewhere = createServerSearch({ fetch: async () => ({ ok: true, json: async () => ({ enabled: true, provider: 'searxng' }) }) });
    expect(await elsewhere.refresh()).toMatchObject({ state: 'unavailable', provider: 'searxng' });
  });
});
