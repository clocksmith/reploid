/**
 * The chat host's held Send (FIRST-02): the one record of a Send that waits for a permitted route, as a
 * reploid.send-intent/1 intent, and the selection it was pressed under. It lives in the host, beside thread
 * selection, not in the conversation workspace: an intent creates no thread, attempt or grant, and those are the
 * workspace's records. The conversation controller renders this state and asks it before dispatch; it keeps none of
 * its own.
 *
 * - `select(selection)` records the asking surface's model selection: `auto`, or `pinned` to an exact artifact
 *   (weights identity and adapter identities). A different selection increments `selectionRevision`.
 * - `hold({ threadId })` records a new intent for the current selection, replacing any earlier one. It expires 30 s
 *   after the press, whatever discovery is doing; the expired intent is reported as `expired` until the next hold.
 * - `claim(intentId, { model | artifact, threadId })` is the check right before dispatch: it consumes the intent and
 *   returns null when it may be dispatched now, else the refusal; a refused intent is gone too.
 */
import { createSendIntent, sendIntentArtifact, sendIntentRefusal, validateSendIntent } from '../../../shared/vendor/reploid/chat/send-intent.js';

/** The browser host's parser for an intent record: the shared validator. */
export const readSendIntent = value => validateSendIntent(value);

const selectionKey = selection => selection?.mode === 'pinned'
  ? JSON.stringify(['pinned', selection.artifact?.identity ?? null, selection.artifact?.adapterIdentities ?? []]) : '["auto"]';

export function createSendIntentStore({ now = () => Date.now(), id = () => globalThis.crypto.randomUUID(),
  setTimer = (callback, ms) => { const handle = setTimeout(callback, ms); handle?.unref?.(); return handle; }, clearTimer = handle => clearTimeout(handle) } = {}) {
  const listeners = new Set();
  let selection = Object.freeze({ mode: 'auto' }), selectionRevision = 0, intent = null, expired = null, timer = null, snapshot = null;
  const changed = () => { snapshot = null; for (const listener of [...listeners]) listener(); };
  const stop = () => { if (timer !== null) { clearTimer(timer); timer = null; } };
  // A read that finds the deadline passed records the expiry at once and tells listeners after the reader returns.
  const lapse = () => {
    expired = Object.freeze({ intentId: intent.intentId, threadId: intent.threadId, expiredAt: intent.expiresAt });
    intent = null; snapshot = null;
  };
  const expire = () => {
    timer = null;
    if (!intent) return;
    if (now() < intent.expiresAt) { timer = setTimer(expire, intent.expiresAt - now()); return; }
    lapse(); changed();
  };
  const current = () => {
    if (intent && now() >= intent.expiresAt) { stop(); lapse(); queueMicrotask(changed); }
    return intent;
  };
  const artifactOf = check => check.artifact !== undefined ? check.artifact : sendIntentArtifact(check.model);
  function admits(intentId, check = {}) {
    const held = current();
    if (!held || held.intentId !== intentId) return 'expired';
    return sendIntentRefusal(held, { now: now(), selectionRevision, artifact: artifactOf(check), threadId: check.threadId });
  }
  return Object.freeze({
    state() {
      current();
      return snapshot ??= Object.freeze({ intent, expired, selection, selectionRevision });
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    /** Records the selection; returns its revision. Reporting the same selection again changes nothing. */
    select(next) {
      const normalized = next?.mode === 'pinned'
        ? Object.freeze({ mode: 'pinned', artifact: Object.freeze(sendIntentArtifact(next.artifact) ?? { identity: null, adapterIdentities: [] }) })
        : Object.freeze({ mode: 'auto' });
      if (selectionKey(normalized) !== selectionKey(selection)) { selection = normalized; selectionRevision++; snapshot = null; }
      return selectionRevision;
    },
    /** A new held Send for the current selection; throws when the selection cannot be held (a pin without an exact identity). */
    hold({ threadId = null } = {}) {
      const next = createSendIntent({ intentId: id(), threadId, selection, selectionRevision, createdAt: Math.trunc(now()) });
      stop(); intent = next; expired = null;
      timer = setTimer(expire, next.expiresAt - now());
      changed();
      return next;
    },
    /** Whether `intentId` is the intent held now. */
    holds: intentId => !!intentId && current()?.intentId === intentId,
    /** The refusal the intent would meet if dispatched now, without consuming it; null when it may be. */
    admits,
    claim(intentId, check = {}) {
      const refusal = admits(intentId, check);
      if (intent?.intentId === intentId) { stop(); intent = null; changed(); }
      return refusal;
    },
    /** Drops the held Send, if `intentId` (or any, without one) is held. Nothing was dispatched for it. */
    cancel(intentId = null) {
      if (!intent || (intentId !== null && intent.intentId !== intentId)) return;
      stop(); intent = null; changed();
    },
    close() { stop(); intent = null; listeners.clear(); }
  });
}
