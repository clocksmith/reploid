// @vitest-environment node
// The Send intent of FIRST-02 (docs/critical-user-journeys.md): one versioned record, reploid.send-intent/1, for every
// surface that can ask. The compatibility fixtures run through each surface's own parser: the browser host's held Send
// (apps/poolday/host/send-intents.js), `reploid ask --send-intent` (server/native-node-ask.js) and the HTTP text API's
// `reploid.sendIntent` (server/text-request-options.js). The host's store bounds a held Send at 30 s from the press,
// whatever discovery does, and refuses dispatch to another artifact or after the selection changed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import compatibility from '../fixtures/send-intent/compatibility.json' with { type: 'json' };
import { SEND_INTENT_SCHEMA, SEND_INTENT_TTL_MS, validateSendIntent } from '../../packages/reploid/src/chat/send-intent.js';
import { createSendIntentStore, readSendIntent } from '../../apps/poolday/host/send-intents.js';
import { askMesh, parseAskSendIntent } from '../../server/native-node-ask.js';
import { nativeCommand } from '../../server/native-node-commands.js';
import { parseExecutionExtension, sendIntentFailure } from '../../server/text-request-options.js';
import { createChatSession } from '../../apps/poolday/host/chat-session.js';

afterEach(() => { vi.useRealTimers(); });
const A = 'sha256:' + 'a'.repeat(64), B = 'sha256:' + 'b'.repeat(64);
const pinA = { mode: 'pinned', artifact: { identity: A, adapterIdentities: [] } };

describe('one schema, one validator, every surface', () => {
  const surfaces = {
    'browser host': raw => readSendIntent(raw),
    'native ask': raw => parseAskSendIntent(JSON.stringify(raw)),
    'HTTP text API': raw => parseExecutionExtension({ sendIntent: raw }).sendIntent
  };
  it.each(compatibility.cases.map(item => [item.name, item]))('%s', (_name, { valid, intent }) => {
    expect(compatibility.schema).toBe(SEND_INTENT_SCHEMA);
    for (const [surface, parse] of Object.entries(surfaces)) {
      if (valid) expect(parse(structuredClone(intent)), surface).toEqual(validateSendIntent(structuredClone(intent)));
      else expect(() => parse(structuredClone(intent)), surface).toThrow(/send intent/i);
    }
  });
  it('reads --send-intent on ask without passing it to the participant process', () => {
    const intent = compatibility.cases[0].intent;
    const command = nativeCommand(['ask', 'hello', '--send-intent', JSON.stringify(intent)]);
    expect(command.sendIntent).toEqual(validateSendIntent(intent));
    expect(command.args).not.toContain('--send-intent');
    expect(() => nativeCommand(['ask', 'hello', '--send-intent', '{"schema":"reploid.send-intent/1"}'])).toThrow(/send intent/i);
  });
});

describe('the browser host owns the held Send', () => {
  it('expires a held Send 30 s after the press, independent of discovery, and keeps nothing dispatchable', () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const store = createSendIntentStore({ id: () => 'intent-x' });
    const seen = vi.fn();
    store.subscribe(seen);
    const intent = store.hold({ threadId: null });
    expect(intent).toMatchObject({ schema: SEND_INTENT_SCHEMA, intentId: 'intent-x', threadId: null, selection: { mode: 'auto' },
      selectionRevision: 0, createdAt: 1_000_000, expiresAt: 1_000_000 + SEND_INTENT_TTL_MS });
    // The 8 s discovery wait passes: nothing about the hold changes.
    vi.advanceTimersByTime(8000);
    expect(store.state().intent?.intentId).toBe('intent-x');
    vi.advanceTimersByTime(SEND_INTENT_TTL_MS - 8000 - 1);
    expect(store.state().intent?.intentId).toBe('intent-x');
    vi.advanceTimersByTime(1);
    expect(store.state()).toMatchObject({ intent: null, expired: { intentId: 'intent-x' } });
    expect(seen).toHaveBeenCalled();
    expect(store.claim('intent-x', { artifact: { identity: A, adapterIdentities: [] }, threadId: null })).toBe('expired');
  });

  it('never dispatches a pin to another artifact, even under the same model name and id', () => {
    const store = createSendIntentStore({ id: () => 'intent-pin' });
    store.select(pinA);
    store.hold({ threadId: null });
    const sameName = { id: 'small', name: 'Small', identity: B, adapters: [] };
    expect(store.admits('intent-pin', { artifact: { identity: B, adapterIdentities: [] } })).toBe('artifact-mismatch');
    expect(store.claim('intent-pin', { model: sameName, threadId: null })).toBe('artifact-mismatch');
    expect(store.state().intent).toBeNull();
  });

  it('refuses dispatch when the selection changed between Send and route-ready', () => {
    const store = createSendIntentStore({ id: () => 'intent-sel' });
    store.hold({ threadId: 'thread-1' });
    store.select(pinA);
    expect(store.state().selectionRevision).toBe(1);
    expect(store.claim('intent-sel', { model: { identity: A }, threadId: 'thread-1' })).toBe('selection-changed');
    // The same selection reported again is not a change.
    const again = createSendIntentStore({ id: () => 'intent-same' });
    again.select(pinA); again.hold({ threadId: null }); again.select(structuredClone(pinA));
    expect(again.claim('intent-same', { model: { identity: A }, threadId: null })).toBeNull();
  });

  it('is the chat session\'s own store', () => {
    const session = createChatSession({ storage: null });
    expect(typeof session.sendIntents.hold).toBe('function');
    return session.close();
  });
});

describe('native ask honours an intent', () => {
  const small = { id: 'small', identity: A, name: 'Small' };
  it('waits for a route no longer than the intent and sends nothing after it expires', async () => {
    const intent = validateSendIntent({ ...compatibility.cases[0].intent, createdAt: Date.now() - SEND_INTENT_TTL_MS + 300,
      expiresAt: Date.now() + 300 });
    const generate = vi.fn();
    const started = Date.now();
    await expect(askMesh({ roomId: 'team', getState: () => ({ models: [] }), generate }, small, 'hi',
      { signal: new AbortController().signal, report: vi.fn(), sendIntent: intent, discoveryMs: 45000 })).rejects.toThrow('No ready provider');
    expect(Date.now() - started).toBeLessThan(5000);
    expect(generate).not.toHaveBeenCalled();
  });
  it('asks only the pinned artifact, never a model of the same name with other weights', async () => {
    const intent = validateSendIntent({ ...compatibility.cases[1].intent, threadId: null, selectionRevision: 0,
      createdAt: Date.now(), expiresAt: Date.now() + SEND_INTENT_TTL_MS });
    const generate = vi.fn();
    const other = { ...small, identity: B, availability: 'ready' };
    await expect(askMesh({ roomId: 'team', getState: () => ({ models: [other] }), generate }, small, 'hi',
      { signal: new AbortController().signal, report: vi.fn(), sendIntent: intent, anyModel: true, discoveryMs: 300, settleMs: 0 }))
      .rejects.toThrow('No ready provider');
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('the HTTP text API honours an intent', () => {
  const intent = (change = {}) => validateSendIntent({ ...compatibility.cases[1].intent, ...change });
  const now = compatibility.cases[1].intent.createdAt + 1000;
  it('refuses an expired intent, another artifact or another conversation before execution', () => {
    expect(sendIntentFailure(intent(), { model: { identity: A }, conversationId: 'thread-7', now })).toBeNull();
    expect(sendIntentFailure(intent(), { model: { identity: A }, conversationId: 'thread-7', now: now + SEND_INTENT_TTL_MS }))
      .toMatchObject({ status: 408 });
    expect(sendIntentFailure(intent(), { model: { identity: B }, conversationId: 'thread-7', now })).toMatchObject({ status: 409 });
    expect(sendIntentFailure(intent(), { model: { identity: A }, conversationId: 'thread-8', now })).toMatchObject({ status: 400 });
  });
});
