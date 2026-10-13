/** Bounded canonical history over the existing browser storage owner. */
import { openCanonicalWorkspaceHistory } from '../vendor/reploid/chat/index.js';
import { verifyPartitionStageCommit } from '../vendor/reploid/mesh/index.js';
import { createIndexedDbStore } from '../vendor/reploid/adapters/browser.js';

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
 * The session supplies the separate live-attempt publication authorization. */
export async function openCanonicalChatHistory({ name, maxWorkspaceBytes, maxThreads, openTimeoutMs, runtime,
  meshId, participantId, writerEpoch, expectedWriterEpoch, legacy, authorizeExecution,
  indexedDB = globalThis.indexedDB }) {
  if (typeof authorizeExecution !== 'function' || !['metadataDigest', 'validateResidentAttemptIdentity',
    'canonicalGenerationIdentity', 'validateExecutionPublication', 'validateAdmissionPublication'].every(name => typeof runtime?.[name] === 'function')) {
    throw Error('Explicit canonical runtime and live publication authorization required.');
  }
  const store = await openChatHistory({ name, maxConversations: 1, maxConversationBytes: maxWorkspaceBytes, openTimeoutMs, indexedDB });
  let history;
  try {
    history = await openCanonicalWorkspaceHistory({ store, key: 'workspace', meshId, participantId, writerEpoch,
      expectedWriterEpoch, legacy, maxWorkspaceBytes, maxThreads,
      publicationOptions: () => ({ doppler: runtime,
        authorize: scope => ['writer', 'read', 'replay'].includes(scope.action) || authorizeExecution(scope) === true,
        authenticateCommit: (acknowledgment, stage, attempt, evidence) =>
          verifyPartitionStageCommit({ runtime, acknowledgment, stage, attempt, evidence }) }) });
    let closing;
    return Object.freeze({ ...history, close() {
      return closing ??= (async () => { try { await history.close(); } finally { await store.close(); } })();
    } });
  } catch (error) {
    try { await history?.close(); } finally { await store.close(); }
    throw error;
  }
}
