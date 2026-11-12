/**
 * @fileoverview Export and import of what this browser keeps for its user: conversations (with their
 * messages and attempts as stored) and the per-computer names and blocks. It reads and writes through
 * the chat session and the computer-preferences store, never through storage directly. A file carries
 * no authority: imported conversations get no disclosure grants, and nothing is sent or resumed.
 */
export const LOCAL_DATA_SCHEMA = 'poolday.local-data-export/v1';
export const LOCAL_DATA_VERSION = 1;
export const LOCAL_DATA_NOTE = 'Conversations, local computer names and blocked computers from one browser. '
  + 'This file does not contain private keys, sign-in or relay credentials, remote permissions, or model weights. '
  + 'It is not encrypted: anyone with this file can read the conversations in it.';
export const LOCAL_DATA_RECEIPTS_NOTE = 'This browser keeps no separate receipt store. '
  + 'Execution records are kept inside each conversation attempt and are exported there.';
/** Largest file read for import. Browser history itself is bounded far below this. */
export const LOCAL_DATA_MAX_BYTES = 32 * 1024 * 1024;

const PRIVATE_FIELDS = new Set(['privateJwk', 'privateKey', 'privateKeyJwk', 'secretKey']);
const PRIVATE_JWK_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k'];
/** Stored history is not expected to hold key material. Should a record ever carry some, it is left out. */
function withoutPrivateKeys(value) {
  if (Array.isArray(value)) return value.map(withoutPrivateKeys);
  if (!value || typeof value !== 'object') return value;
  const jwk = typeof value.kty === 'string';
  return Object.fromEntries(Object.entries(value)
    .filter(([name]) => !PRIVATE_FIELDS.has(name) && !(jwk && PRIVATE_JWK_MEMBERS.includes(name)))
    .map(([name, item]) => [name, withoutPrivateKeys(item)]));
}

const plural = (count, one, many = one + 's') => `${count} ${count === 1 ? one : many}`;

export function createLocalData({ chat, computers = null, now = () => new Date() }) {
  if (typeof chat?.exportThreads !== 'function' || typeof chat?.importThreads !== 'function') {
    throw new TypeError('A chat session with conversation export and import is required');
  }
  const read = input => {
    let file = input;
    if (typeof input === 'string') {
      try { file = JSON.parse(input); } catch { throw new Error('This file is not valid JSON.'); }
    }
    if (!file || typeof file !== 'object' || Array.isArray(file) || file.schema !== LOCAL_DATA_SCHEMA) {
      throw new Error('This file is not a Reploid data export.');
    }
    if (file.version !== LOCAL_DATA_VERSION) {
      throw new Error(`This file is export version ${JSON.stringify(file.version)}. This build reads version ${LOCAL_DATA_VERSION} only.`);
    }
    if (!Array.isArray(file.conversations)) throw new Error('This file holds no conversation list.');
    const saved = file.computers ?? {};
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('This file holds invalid computer preferences.');
    return { conversations: file.conversations, computers: { names: saved.names ?? {}, blocked: saved.blocked ?? [] } };
  };
  return Object.freeze({
    /** One JSON-serializable document. Reads only. */
    export() {
      const history = chat.exportThreads(), preferences = computers?.getState();
      return withoutPrivateKeys({
        schema: LOCAL_DATA_SCHEMA, version: LOCAL_DATA_VERSION, exportedAt: now().toISOString(), note: LOCAL_DATA_NOTE,
        history: { meshId: history.meshId, participantId: history.participantId },
        conversations: history.threads,
        computers: { names: { ...(preferences?.names || {}) }, blocked: [...(preferences?.blocked || [])] },
        receipts: { stored: false, note: LOCAL_DATA_RECEIPTS_NOTE }
      });
    },
    /** Validates a file and counts what it would add. Changes nothing; `apply()` performs exactly this plan's import. */
    plan(input) {
      const file = read(input);
      const known = new Set(chat.exportThreads().threads.map(thread => thread.id));
      const ids = file.conversations.map(thread => thread?.id);
      const fresh = [...new Set(ids.filter(id => !known.has(id)))];
      // The workspace is the validator of record; a preview that could not be applied is refused here.
      const checked = chat.importThreads(file.conversations, { dryRun: true });
      const wantsPreferences = Object.keys(file.computers.names).length > 0 || file.computers.blocked.length > 0;
      const preferences = computers ? computers.importPreferences(file.computers, { dryRun: true })
        : { names: 0, namesSkipped: 0, blocked: 0, blockedSkipped: 0 };
      const counts = { conversations: checked.added.length, conversationsSkipped: checked.skipped.length,
        names: preferences.names, namesSkipped: preferences.namesSkipped,
        blocked: preferences.blocked, blockedSkipped: preferences.blockedSkipped,
        preferencesUnavailable: !computers && wantsPreferences };
      const adds = [plural(counts.conversations, 'conversation'), plural(counts.names, 'computer name'), plural(counts.blocked, 'blocked computer')];
      const skipped = [counts.conversationsSkipped ? `${plural(counts.conversationsSkipped, 'conversation')} already here` : '',
        counts.namesSkipped ? `${plural(counts.namesSkipped, 'computer name')} already set here` : '',
        counts.blockedSkipped ? `${plural(counts.blockedSkipped, 'blocked computer')} already blocked` : ''].filter(Boolean);
      const summary = `This file adds ${adds[0]}, ${adds[1]} and ${adds[2]}.`
        + (skipped.length ? ` Skipped, nothing overwritten: ${skipped.join(', ')}.` : '')
        + (counts.preferencesUnavailable ? ' Computer names and blocks cannot be saved in this session and are left out.' : '');
      return Object.freeze({ counts: Object.freeze(counts), summary,
        empty: counts.conversations + counts.names + counts.blocked === 0,
        apply() {
          const conversations = fresh.length ? chat.importThreads(file.conversations) : { added: [], skipped: checked.skipped };
          const saved = computers ? computers.importPreferences(file.computers) : preferences;
          return { conversations: conversations.added.length, conversationsSkipped: conversations.skipped.length,
            names: saved.names, blocked: saved.blocked };
        } });
    }
  });
}
