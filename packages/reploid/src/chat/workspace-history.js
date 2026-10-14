import { createConversationPublication } from './workspace-publication.js';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const copy = value => structuredClone(value);
const epoch = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const schema = 'reploid.canonical-workspace-history/v1';

/** One transactional workspace writer. Legacy bytes are imported once and kept
 * verbatim; published text lives only in authenticated publication records.
 * An attempt's `publicationMode: 'canonical'` marks requester-published output,
 * canonical two-stage or ordinary ordered; the persisted value is not renamed. */
export async function openCanonicalWorkspaceHistory({ store, key, meshId, participantId, writerEpoch,
  expectedWriterEpoch, legacy, maxWorkspaceBytes, maxThreads, publicationOptions }) {
  assert(store?.schema === 'reploid.transactional-chat-store/v1' && typeof store.transact === 'function'
    && typeof store.read === 'function', 'Transactional workspace store required');
  assert(typeof key === 'string' && key && typeof meshId === 'string' && meshId
    && typeof participantId === 'string' && participantId && epoch(writerEpoch)
    && (expectedWriterEpoch === null || epoch(expectedWriterEpoch)), 'Explicit workspace writer identity required');
  assert(Number.isSafeInteger(maxWorkspaceBytes) && maxWorkspaceBytes > 0 && Number.isSafeInteger(maxThreads)
    && maxThreads > 0 && typeof publicationOptions === 'function', 'Bounded workspace publication ports required');
  const bounded = value => {
    const text = JSON.stringify(value);
    assert(typeof text === 'string' && new TextEncoder().encode(text).length <= maxWorkspaceBytes, 'Workspace storage allowance exhausted');
    return JSON.parse(text);
  };
  const validWorkspace = value => {
    assert(value?.schema === 'reploid.chat-workspace/v1' && value.meshId === meshId && value.participantId === participantId
      && Array.isArray(value.threads) && value.threads.length <= maxThreads
      && new Set(value.threads.map(thread => thread.id)).size === value.threads.length,
    'Canonical workspace identity or thread bounds mismatch');
    for (const thread of value.threads) assert(typeof thread.id === 'string' && thread.id && thread.id.length <= 256
      && Array.isArray(thread.messages) && Array.isArray(thread.attempts), 'Invalid canonical conversation metadata');
    return value;
  };
  const imported = bounded(legacy);
  assert(imported && ['workspace', 'drafts'].every(name => imported[name] === null || typeof imported[name] === 'string'),
    'Legacy migration requires exact original storage bytes');
  const initialWorkspace = imported.workspace === null
    ? { schema: 'reploid.chat-workspace/v1', meshId, participantId, threads: [] } : validWorkspace(JSON.parse(imported.workspace));
  const historyAt = (state, id) => Object.hasOwn(state.publications, id) ? state.publications[id] : null;
  const check = value => {
    assert(value?.schema === schema && value.meshId === meshId && value.participantId === participantId
      && epoch(value.writerEpoch) && value.publications && typeof value.publications === 'object'
      && !Array.isArray(value.publications) && Object.keys(value.publications).length <= maxThreads, 'Invalid transactional workspace');
    validWorkspace(value.workspace); return value;
  };
  await store.transact(key, prior => {
    if (prior == null) assert(initialWorkspace.threads.every(thread => thread.attempts.every(attempt => attempt.publicationMode !== 'canonical')),
      'Legacy import cannot assert canonical publication without verified records');
    const state = prior == null ? { schema, meshId, participantId, writerEpoch: null,
      legacy: imported, drafts: imported.drafts, workspace: initialWorkspace, publications: {} } : check(prior);
    assert(state.writerEpoch === expectedWriterEpoch && state.writerEpoch !== writerEpoch, 'Workspace writer takeover raced or reused an epoch');
    state.writerEpoch = writerEpoch;
    return { state: bounded(state), result: null };
  });
  let closed = false, failure = null;
  const pending = new Set(), owners = new Map(), rejections = new WeakSet();
  const current = () => { assert(!closed, 'Workspace history is closed'); assert(!failure, 'Workspace history outcome is unknown; reopen and reconcile'); };
  const owned = value => { const state = check(value); assert(state.writerEpoch === writerEpoch, 'Stale workspace writer'); return state; };
  // A reducer that throws aborts its transaction before any write: a known
  // rejection (for example cancellation revoking publication). Only storage
  // failures leave an unknown outcome that fences every later operation.
  const run = operation => {
    current();
    const promise = Promise.resolve().then(() => { current(); return operation(); }); pending.add(promise);
    promise.then(() => pending.delete(promise), error => { pending.delete(promise); if (!rejections.has(error)) failure = error; });
    return promise;
  };
  const read = () => run(async () => owned(await store.read(key)));
  const transact = reducer => run(() => store.transact(key, value => {
    try {
      current(); const state = owned(value), result = reducer(state);
      return { state: bounded(state), result: copy(result) };
    } catch (error) { if (error && typeof error === 'object') rejections.add(error); throw error; }
  }));
  const find = (state, threadId) => {
    const thread = state.workspace.threads.find(item => item.id === threadId);
    assert(thread, 'Canonical conversation has not been durably admitted'); return thread;
  };
  const publication = threadId => {
    current();
    if (!owners.has(threadId)) {
      const opening = (async () => {
        const state = await read(); find(state, threadId);
        const port = { schema: 'reploid.transactional-chat-store/v1',
          read: async id => { assert(id === threadId, 'Publication conversation mismatch'); return copy(historyAt(await read(), id)); },
          transact: (id, reducer) => {
            assert(id === threadId, 'Publication conversation mismatch');
            return transact(root => {
              const thread = find(root, id), reduced = reducer(copy(historyAt(root, id)));
              for (const attempt of reduced.state.attempts) assert(thread.attempts.some(row => row.id === attempt.identity.attemptId
                && row.publicationMode === 'canonical'), 'Publication attempt has no durable workspace admission');
              Object.defineProperty(root.publications, id, { value: reduced.state, enumerable: true, configurable: true, writable: true }); return reduced.result;
            });
          } };
        const options = publicationOptions(threadId);
        const owner = createConversationPublication({ ...options, conversationId: threadId, writerEpoch, store: port,
          requireCommitEvidence: true });
        await owner.claimWriter(historyAt(state, threadId)?.writerEpoch ?? null);
        return owner;
      })();
      owners.set(threadId, opening);
    }
    return owners.get(threadId);
  };
  const recordsFor = async (threadId, attemptId) => {
    const owner = await publication(threadId), history = await owner.reconcile();
    const records = history.records.filter(record => record.publication.attemptId === attemptId);
    // The transaction adapter above and this final read both check the current
    // workspace epoch; a superseded writer cannot publish a stale projection.
    const currentState = await read();
    assert(historyAt(currentState, threadId)?.head === history.head, 'Publication head changed during verified projection');
    return records;
  };
  const hydrate = async () => {
    const state = await read(), result = copy(state.workspace);
    for (const thread of result.threads) {
      for (const attempt of thread.attempts.filter(row => row.publicationMode === 'canonical')) {
        const message = thread.messages.find(row => row.id === attempt.responseId);
        assert(message && message.content === '', 'Canonical metadata cannot contain authoritative output text');
        const records = await recordsFor(thread.id, attempt.id);
        message.content = records.map(record => record.publication.delta?.text ?? '').join('');
        message.publicationDigests = records.map(record => record.publication.publicationDigest);
      }
    }
    await read(); return result;
  };
  const loaded = await hydrate(), retained = await read(), retainedLegacy = copy(retained.legacy);
  return Object.freeze({
    mode: 'transactional', writerEpoch,
    load: () => copy(loaded),
    legacyDrafts: retainedLegacy.drafts,
    drafts: Object.hasOwn(retained, 'drafts') ? retained.drafts : retainedLegacy.drafts,
    async saveDrafts(raw) {
      assert(typeof raw === 'string', 'Serialized drafts required');
      const value = JSON.parse(raw);
      assert(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length <= maxThreads + 1, 'Draft conversation allowance reached');
      return transact(state => { state.drafts = raw; return null; });
    },
    assertCurrentWriter: async () => { await read(); },
    publication,
    async save(input) {
      const snapshot = bounded(input); validWorkspace(snapshot);
      for (const thread of snapshot.threads) for (const attempt of thread.attempts.filter(row => row.publicationMode === 'canonical')) {
        const message = thread.messages.find(row => row.id === attempt.responseId);
        assert(message, 'Canonical attempt response missing');
        message.content = ''; delete message.publicationDigests;
      }
      return transact(state => {
        for (const previous of state.workspace.threads) for (const attempt of previous.attempts.filter(row => row.publicationMode === 'canonical')) {
          const next = snapshot.threads.find(thread => thread.id === previous.id)?.attempts.find(row => row.id === attempt.id);
          assert(next?.publicationMode === 'canonical' && next.responseId === attempt.responseId, 'Canonical publication reference cannot be removed or downgraded');
        }
        const old = state.legacy.workspace === null ? { threads: [] } : JSON.parse(state.legacy.workspace);
        for (const thread of snapshot.threads) {
          const importedThread = old.threads.find(row => row.id === thread.id);
          for (const attempt of thread.attempts) assert(attempt.publicationMode === 'canonical'
            || importedThread?.attempts.some(row => row.id === attempt.id), 'New attempts require canonical publication');
          for (const message of thread.messages.filter(row => row.role === 'assistant')) {
            if (thread.attempts.some(attempt => attempt.publicationMode === 'canonical' && attempt.responseId === message.id)) continue;
            assert(importedThread?.messages.some(row => row.id === message.id && row.role === 'assistant' && row.content === message.content),
              'Legacy assistant text is an immutable imported reference');
          }
        }
        state.workspace = snapshot; return null;
      });
    },
    async project(threadId, attemptId, supplied) {
      current();
      const digest = supplied?.receipt?.receiptDigest;
      const records = await recordsFor(threadId, attemptId);
      assert(records.some(record => record.receipt.receiptDigest === digest
        && record.publication.publicationDigest === supplied.publication?.publicationDigest), 'Projection lacks its saved publication');
      return { threadId, attemptId, content: records.map(record => record.publication.delta?.text ?? '').join(''),
        publicationDigests: records.map(record => record.publication.publicationDigest),
        terminal: records.at(-1)?.publication.schema === 'doppler.admission-publication/v1'
          || records.at(-1)?.publication.successor?.terminal === true };
    },
    async close() { closed = true; await Promise.allSettled([...pending]); },
  });
}
