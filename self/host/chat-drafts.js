/** Bounded local draft persistence, separate from execution and disclosure. */
export function createChatDrafts({ storage, key, maxThreads, maxCharacters, maxFiles, maxFileBytes, maxInputBytes }) {
  let drafts = {};
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
      const id = threadId || 'new', next = { ...drafts };
      if (value === null) delete next[id]; else next[id] = validate(value);
      if (Object.keys(next).length > maxThreads + 1) throw Error('Draft conversation allowance reached.');
      storage?.setItem?.(key, JSON.stringify(next)); drafts = next;
    }
  });
}
