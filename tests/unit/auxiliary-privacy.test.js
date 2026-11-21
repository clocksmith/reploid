import { expect, it, vi } from 'vitest';
import { createChatWorkspace } from '../../packages/reploid/src/chat/workspace.js';
import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';
import { createFixedSearchProvider, createLexicalSupportChecker } from '../../packages/reploid/src/retrieval/index.js';
import { guardRetrievalPort } from '../../packages/reploid/src/retrieval/disclosure-ports.js';

const model = { id: 'fixture', name: 'Fixture', identity: 'sha256:' + 'a'.repeat(64) };
function fixture(privacy, disclosures, { undeclared = false } = {}) {
  const provider = createFixedSearchProvider({ documents: [{ id: 'fixed', title: 'Fixture', url: 'https://fixture.test', text: 'The fixture answer is seven.' }] });
  const checker = createLexicalSupportChecker();
  const search = vi.fn(provider.search), extract = vi.fn(provider.extract), check = vi.fn(checker.check), execute = vi.fn(async input => ({
    threadId: input.threadId, attemptId: input.attemptId, modelId: model.id, modelIdentity: model.identity, adapterIdentities: [], content: 'The fixture answer is seven [1].' }));
  const ports = { provider: { ...provider, search }, extractor: { ...provider, extract }, supportChecker: { ...checker, check } };
  if (undeclared) delete ports.provider.describeDisclosure;
  if (disclosures) ports.disclosures = Object.fromEntries(['search', 'extract', 'check'].map(operation => {
    const port = operation === 'check' ? checker : provider;
    return [operation, { schema: 'reploid.auxiliary-path/v1', id: port.id, version: port.version, hops: disclosures(operation) }];
  }));
  const app = createChatWorkspace({ meshId: 'mesh', participantId: 'local', store: { load() {}, save() {} }, execute, retrieval: ports });
  const thread = app.createThread({ model, privacy });
  return { app, thread, search, extract, check, execute };
}

it('checks leakage before a search receives the query, rather than waiting for inference routing', async () => {
  const f = fixture(createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] }, leakage: ['model-id', 'length', 'timing'] }), () => [{ recipient: 'search-service', placement: 'remote', disclosure: 'plaintext' }]);
  const result = await f.app.send(f.thread, 'private fixture query', { retrieval: {} });
  expect(result.status).toBe('failed'); expect(f.search).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
  await f.app.close();
});
it('runs declared local retrieval and checking under a local-only request', async () => {
  const f = fixture(createExecutionPolicy(), () => []);
  const result = await f.app.send(f.thread, 'fixture answer', { retrieval: {} });
  expect(result.status).toBe('completed'); expect(f.search).toHaveBeenCalledOnce(); expect(f.extract).toHaveBeenCalledOnce(); expect(f.check).toHaveBeenCalled();
  expect(result.auxiliaryBindings.map(binding => binding.path.operation).sort()).toEqual(['check', 'extract', 'search']);
  expect(result.auxiliaryBindings.every(binding => binding.path.complete && binding.path.hops.length === 0)).toBe(true);
  await f.app.close();
});
it('checks each extraction recipient before passing query or source text to it', async () => {
  const allowed = 'allowed-search', blocked = 'blocked-extractor';
  const f = fixture(createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: [allowed] } }), operation => [{
    recipient: operation === 'extract' ? blocked : allowed, placement: 'remote', disclosure: 'plaintext' }]);
  const result = await f.app.send(f.thread, 'fixture answer', { retrieval: {} });
  expect(result.status).toBe('failed'); expect(f.search).toHaveBeenCalledOnce(); expect(f.extract).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
  await f.app.close();
});
it('rechecks revocation and identity after asynchronous authorization before any data port runs', async () => {
  const gate = Promise.withResolvers(), controller = new AbortController();
  const port = { id: 'service', version: '1', search: vi.fn() };
  const guarded = guardRetrievalPort(port, 'search', () => gate.promise, controller.signal);
  const pending = guarded.search('secret'); controller.abort(); gate.resolve(true);
  await expect(pending).rejects.toThrow(); expect(port.search).not.toHaveBeenCalled();
  const next = Promise.withResolvers();
  const changed = guardRetrievalPort(port, 'search', () => next.promise, new AbortController().signal);
  const queued = changed.search('secret'); port.id = 'replacement'; next.resolve(true);
  await expect(queued).rejects.toThrow('changed'); expect(port.search).not.toHaveBeenCalled();
});

it('requires a complete host-installed auxiliary path even when plaintext execution has been authorized', async () => {
  const f = fixture(createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } }), null, { undeclared: true });
  const result = await f.app.send(f.thread, 'private fixture query', { retrieval: {} });
  expect(result.status).toBe('failed'); expect(f.search).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
  await f.app.close();
});
