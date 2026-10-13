/** Bounded local draft persistence, separate from execution and disclosure. */
export function createChatDrafts({ storage, key, maxThreads, maxCharacters, maxFiles, maxFileBytes, maxInputBytes, persist = null }) {
  if (persist !== null && typeof persist !== 'function') throw Error('Invalid draft persistence port.');
  let drafts = {}, tail = Promise.resolve(), failure = null, closed = false;
  try { const value = JSON.parse(storage?.getItem?.(key) || '{}'); if (value && typeof value === 'object' && !Array.isArray(value)) drafts = value; } catch { /* Unreadable draft storage is never executed. */ }
  const validate = value => {
    if (!value || typeof value.text !== 'string' || value.text.length > maxCharacters || !Array.isArray(value.files) || value.files.length > maxFiles) throw Error('Draft exceeds its allowance.');
    let total = 0;
    for (const file of value.files) {
      if (!file || typeof file.name !== 'string' || typeof file.text !== 'string') throw Error('Invalid draft attachment.');
      const bytes = new TextEncoder().encode(file.text).byteLength; total += bytes;
      if (bytes > maxFileBytes) throw Error('Draft attachment exceeds its allowance.');
    }
    if (total > maxInputBytes) throw Error('Draft attachments exceed their allowance.');
    return structuredClone(value);
  };
  return Object.freeze({
    get(threadId) {
      try { return validate(drafts[threadId || 'new']); }
      catch { return { text: '', files: [] }; }
    },
    save(threadId, value) {
      if (closed) throw Error('Draft storage is closed.');
      if (failure) throw Error('Draft storage outcome is unknown; reopen history.');
      const id = threadId || 'new', captured = value === null ? null : validate(value);
      const save = asyncMode => {
        if (failure) throw Error('Draft storage outcome is unknown; reopen history.');
        const next = { ...drafts };
        if (captured === null) delete next[id]; else Object.defineProperty(next, id, { value: captured, enumerable: true, configurable: true, writable: true });
        if (Object.keys(next).length > maxThreads + 1) throw Error('Draft conversation allowance reached.');
        const raw = JSON.stringify(next);
        if (asyncMode) return Promise.resolve(persist(raw)).then(() => { drafts = next; });
        storage?.setItem?.(key, raw); drafts = next;
      };
      if (!persist) return save(false);
      const operation = tail.then(() => save(true));
      tail = operation.catch(error => { failure = error; });
      return operation;
    },
    async close() {
      closed = true; await tail;
      if (failure) throw failure;
    }
  });
}
