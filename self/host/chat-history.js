/** Bounded requester-owned history over the existing browser storage owner. */
import { openCanonicalWorkspaceHistory } from '../vendor/reploid/chat/index.js';
import { verifyPartitionStageCommit } from '../vendor/reploid/mesh/index.js';
import { createIndexedDbStore } from '../vendor/reploid/adapters/browser.js';

const CANONICAL_VALIDATORS = ['validateResidentAttemptIdentity', 'canonicalGenerationIdentity',
  'validateExecutionPublication', 'validateAdmissionPublication'];
const newWriterEpoch = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');

export async function openChatHistory({ name, maxConversations, maxConversationBytes, openTimeoutMs,
  indexedDB = globalThis.indexedDB }) {
  if (typeof name !== 'string' || !name || name.length > 256
    || !Number.isSafeInteger(maxConversations) || maxConversations < 1
    || !Number.isSafeInteger(maxConversationBytes) || maxConversationBytes < 1
    || !Number.isSafeInteger(maxConversations * maxConversationBytes)) {
    throw new Error('Transactional chat history requires an explicit bounded database.');
  }
  const store = createIndexedDbStore({ databaseName: name, storeName: 'conversations', version: 1,
    openTimeoutMs, indexedDB });
  try { await store.init(); } catch (error) { await store.close(); throw error; }
  let closed = false;
  const pending = new Set();
  const run = (key, operation) => {
    if (typeof key !== 'string' || !key || key.length > 256) throw new Error('Invalid conversation storage key.');
    if (closed) throw new Error('Chat history is closed.');
    const result = operation();
    pending.add(result);
    result.then(() => pending.delete(result), () => pending.delete(result));
    return result;
  };
  return Object.freeze({
    schema: 'reploid.transactional-chat-store/v1',
    read: key => run(key, () => store.get(key)),
    transact: (key, reducer) => run(key, () => store.transactEntry(key, reducer,
      { maxEntries: maxConversations, maxBytes: maxConversationBytes })),
    async close() {
      closed = true;
      await Promise.allSettled([...pending]);
      await store.close();
    },
  });
}

/** Local saved-history verification never renews remote compute/disclosure.
 * The session supplies the separate live-attempt publication authorization.
 * `publication: 'ordered'` admits only ordinary ordered records, which need
 * Doppler's metadataDigest alone; canonical attempts also need its four
 * canonical validators. `expectedWriterEpoch: 'stored'` takes over the epoch
 * saved in this store; the caller must hold the profile's history owner lock.
 * `release` is called once the store has closed or opening failed. */
export async function openCanonicalChatHistory({ name, maxWorkspaceBytes, maxThreads, openTimeoutMs, runtime,
  meshId, participantId, writerEpoch = newWriterEpoch(), expectedWriterEpoch, legacy, authorizeExecution,
  publication = 'canonical', release = () => {}, openStore = openChatHistory, indexedDB = globalThis.indexedDB }) {
  const ordered = publication === 'ordered';
  if (!['canonical', 'ordered'].includes(publication) || typeof authorizeExecution !== 'function' || typeof release !== 'function'
    || typeof runtime?.metadataDigest !== 'function'
    || !ordered && !CANONICAL_VALIDATORS.every(name => typeof runtime[name] === 'function')) {
    release();
    throw Error('Explicit canonical runtime and live publication authorization required.');
  }
  // Ordered history receives only the digest port, so the writer refuses any canonical attempt.
  const doppler = ordered ? Object.freeze({ metadataDigest: runtime.metadataDigest }) : runtime;
  let store, history;
  try {
    store = await openStore({ name, maxConversations: 1, maxConversationBytes: maxWorkspaceBytes, openTimeoutMs, indexedDB });
    const expected = expectedWriterEpoch === 'stored' ? (await store.read('workspace'))?.writerEpoch ?? null : expectedWriterEpoch;
    history = await openCanonicalWorkspaceHistory({ allowWholeModel: ordered, store, key: 'workspace', meshId, participantId, writerEpoch,
      expectedWriterEpoch: expected, legacy, maxWorkspaceBytes, maxThreads,
      publicationOptions: () => ({ doppler,
        authorize: scope => ['writer', 'read', 'replay'].includes(scope.action) || authorizeExecution(scope) === true,
        // Ordinary ordered records carry no stage commitments to authenticate.
        authenticateCommit: ordered ? async () => false : (acknowledgment, stage, attempt, evidence) =>
          verifyPartitionStageCommit({ runtime, acknowledgment, stage, attempt, evidence }) }) });
    let closing;
    return Object.freeze({ ...history, close() {
      return closing ??= (async () => { try { await history.close(); } finally { try { await store.close(); } finally { release(); } } })();
    } });
  } catch (error) {
    try { await history?.close(); } finally { try { await store?.close(); } finally { release(); } }
    throw error;
  }
}

/** One history writer per browser profile, matching the one-connected-tab
 * contract: a second tab is refused instead of fencing the owner's writer.
 * Resolves to a release function, or null when another tab holds it. */
export async function acquireChatHistoryOwner({ name, locks }) {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const acquired = await new Promise((resolve, reject) => {
    locks.request(`reploid:chat-history:${name}`, { ifAvailable: true }, lock => {
      resolve(!!lock);
      return lock ? held : undefined;
    }).catch(reject);
  });
  return acquired ? () => release() : null;
}

/** History of a tab that does not own the profile: it reports the refusal as
 * its storage error and never reads or writes the owner's records. */
export function refusedChatHistory({ meshId, participantId, reason }) {
  const refuse = async () => { throw new Error(reason); };
  return Object.freeze({ mode: 'transactional', writerEpoch: null, legacyDrafts: null, drafts: null,
    load: () => ({ schema: 'reploid.chat-workspace/v1', meshId, participantId, threads: [] }),
    save: refuse, saveDrafts: refuse, assertCurrentWriter: refuse, publication: refuse, project: refuse, async close() {} });
}
