/**
 * A Send that waits for a route (FIRST-02, docs/critical-user-journeys.md), as one versioned record every surface that
 * can ask reads the same way: the browser host's held Send, `reploid ask --send-intent` and the HTTP text API's
 * `reploid.sendIntent`. It is an intent, not an attempt: holding one creates no thread, attempt, grant or disclosure.
 *
 * - `selection` is `auto` (the asking surface may choose any permitted model when a route is ready) or `pinned` to one
 *   exact artifact: the model's weights identity and its adapters' identities, never a display name or selection id.
 * - `selectionRevision` is the asking surface's selection counter when Send was pressed. The owner of the selection
 *   increments it whenever the selection changes; an intent whose revision no longer matches is not dispatched.
 * - `expiresAt` is always `createdAt` + 30 s, whatever discovery is doing. After it nothing is dispatched for the
 *   intent; the asker sends again.
 *
 * The record is checked again right before dispatch (sendIntentRefusal); a refusal dispatches nothing.
 */

export const SEND_INTENT_SCHEMA = 'reploid.send-intent/1';
/** How long a Send waits for a permitted route, from the press. */
export const SEND_INTENT_TTL_MS = 30000;
/** Why a held intent may not be dispatched. */
export const SEND_INTENT_REFUSALS = Object.freeze(['expired', 'selection-changed', 'artifact-mismatch', 'thread-changed']);

const KEYS = ['schema', 'intentId', 'threadId', 'selection', 'selectionRevision', 'createdAt', 'expiresAt'];
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/u.test(value);
const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
const exactKeys = (value, keys) => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const invalid = message => Object.assign(new Error(`Invalid send intent: ${message}`), { code: 'SEND_INTENT_INVALID' });
const deepFreeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
};

/**
 * The exact artifact a model record names: its weights identity and its adapters' identities, in order. Reads a
 * catalog or thread model (`identity`, `adapters[].identity`), an artifact (`identity`, `adapterIdentities`) or an
 * execution record (`modelIdentity`, `adapterIdentities`). Null when no weights identity is named.
 */
export function sendIntentArtifact(model) {
  const identity = model?.identity ?? model?.modelIdentity;
  if (!digest(identity)) return null;
  let adapters = [];
  if (Array.isArray(model.adapterIdentities)) adapters = model.adapterIdentities;
  else if (Array.isArray(model.adapters)) adapters = model.adapters.map(adapter => adapter?.identity);
  return adapters.every(digest) ? { identity, adapterIdentities: [...adapters] } : null;
}

const sameArtifact = (a, b) => !!a && !!b && a.identity === b.identity
  && a.adapterIdentities.length === b.adapterIdentities.length && a.adapterIdentities.every((item, index) => item === b.adapterIdentities[index]);

function readSelection(selection) {
  if (exactKeys(selection, ['mode']) && selection.mode === 'auto') return { mode: 'auto' };
  if (!exactKeys(selection, ['mode', 'artifact']) || selection.mode !== 'pinned') throw invalid('selection is auto or pinned to an artifact');
  const { artifact } = selection;
  if (!exactKeys(artifact, ['identity', 'adapterIdentities']) || !digest(artifact.identity)
    || !Array.isArray(artifact.adapterIdentities) || artifact.adapterIdentities.length > 8 || !artifact.adapterIdentities.every(digest)) {
    throw invalid('a pin names a sha256 weights identity and sha256 adapter identities');
  }
  return { mode: 'pinned', artifact: { identity: artifact.identity, adapterIdentities: [...artifact.adapterIdentities] } };
}

/** The one validator: a frozen copy of a well-formed intent, or a SEND_INTENT_INVALID error. */
export function validateSendIntent(value) {
  if (!exactKeys(value, KEYS)) throw invalid(`fields are ${KEYS.join(', ')}`);
  if (value.schema !== SEND_INTENT_SCHEMA) throw invalid(`schema is ${SEND_INTENT_SCHEMA}`);
  if (!id(value.intentId)) throw invalid('intentId');
  if (value.threadId !== null && !id(value.threadId)) throw invalid('threadId is null for a new conversation or its id');
  if (!Number.isSafeInteger(value.selectionRevision) || value.selectionRevision < 0) throw invalid('selectionRevision');
  if (!Number.isSafeInteger(value.createdAt) || value.createdAt < 0) throw invalid('createdAt');
  if (value.expiresAt !== value.createdAt + SEND_INTENT_TTL_MS) throw invalid(`expiresAt is createdAt + ${SEND_INTENT_TTL_MS} ms`);
  return deepFreeze({ schema: SEND_INTENT_SCHEMA, intentId: value.intentId, threadId: value.threadId, selection: readSelection(value.selection),
    selectionRevision: value.selectionRevision, createdAt: value.createdAt, expiresAt: value.expiresAt });
}

/** A new intent at `createdAt` (ms), expiring 30 s later. */
export function createSendIntent({ intentId, threadId = null, selection = { mode: 'auto' }, selectionRevision = 0, createdAt }) {
  return validateSendIntent({ schema: SEND_INTENT_SCHEMA, intentId, threadId, selection, selectionRevision,
    createdAt, expiresAt: Number.isSafeInteger(createdAt) ? createdAt + SEND_INTENT_TTL_MS : null });
}

/** Whether `artifact` is one the intent's selection permits: any under auto, only the pinned one under a pin. */
export const sendIntentPermits = (intent, artifact) => intent.selection.mode === 'auto' ? true : sameArtifact(intent.selection.artifact, artifact);

/**
 * The check right before dispatch: null when the intent may be dispatched now to `artifact` in `threadId`, else the
 * refusal (SEND_INTENT_REFUSALS). `selectionRevision` is the selection owner's current revision; `threadId`, when
 * given, is the conversation the dispatch would use (a new one may be created only for an intent naming none).
 */
export function sendIntentRefusal(intent, { now, selectionRevision, artifact, threadId } = {}) {
  if (!Number.isFinite(now) || now >= intent.expiresAt) return 'expired';
  if (selectionRevision !== intent.selectionRevision) return 'selection-changed';
  if (!sendIntentPermits(intent, artifact)) return 'artifact-mismatch';
  if (threadId !== undefined && intent.threadId !== null && threadId !== intent.threadId) return 'thread-changed';
  return null;
}
