// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { createRecoveryMesh } from '../helpers/generation-recovery-mesh.js';
import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';

// Conversation output belongs to the connection the request was admitted on. Real requester and provider
// meshes; the transport is test-owned so that the connection can change at an exact moment.
const cleanup = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

const modelIdentity = 'sha256:' + 'a'.repeat(64);
const named = f => createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: [f.identities[1].peerId] } });
const ask = (f, onUpdate, ms = 600) => f.requesterMesh.generate(f.messages, onUpdate, { modelId: 'model', modelIdentity, privacy: named(f), signal: AbortSignal.timeout(ms) });
const fromProvider = (f, type) => f.wire.filter(row => row.i === 1 && row.type === type);
const settled = () => new Promise(resolve => setTimeout(resolve, 30));

it('the control: output on the admitted connection reaches the requester', async () => {
  const seen = [];
  const f = await createRecoveryMesh(cleanup, { execute: async (_messages, onChunk) => {
    onChunk('MARKER-CONTROL');
    return f.response;
  } });
  await expect(ask(f, chunk => seen.push(chunk), 5000)).resolves.toMatchObject({ content: 'actual answer' });
  expect(seen).toEqual(['MARKER-CONTROL']);
  expect(fromProvider(f, 'reploid:generation-result')).toHaveLength(1);
});

it('a provider sends no output after the admitted connection changes', async () => {
  const f = await createRecoveryMesh(cleanup, { execute: async (_messages, onChunk) => {
    onChunk('MARKER-BEFORE');
    f.changeChannelScope();
    onChunk('MARKER-AFTER');
    return { ...f.response, content: 'MARKER-RESULT' };
  } });
  await expect(ask(f)).rejects.toThrow();
  await settled();
  const sent = JSON.stringify(f.wire.filter(row => row.i === 1));
  expect(sent).toContain('MARKER-BEFORE');
  expect(sent).not.toContain('MARKER-AFTER');
  expect(sent).not.toContain('MARKER-RESULT');
  expect(fromProvider(f, 'reploid:generation-result')).toEqual([]);
});

it('a provider error is not sent on a connection other than the admitted one', async () => {
  const f = await createRecoveryMesh(cleanup, { execute: async () => {
    f.changeChannelScope();
    throw new Error('MARKER-ERROR');
  } });
  await expect(ask(f)).rejects.toThrow();
  await settled();
  expect(JSON.stringify(f.wire.filter(row => row.i === 1))).not.toContain('MARKER-ERROR');
});

it.each([
  ['an update', 'reploid:generation-update'],
  ['a result', 'reploid:generation-result'],
  ['an error', 'reploid:generation-error'],
])('a requester ignores %s that arrives after the admitted connection changed', async (_label, type) => {
  const seen = [];
  let flipped = false;
  const f = await createRecoveryMesh(cleanup, {
    execute: async (_messages, onChunk) => {
      if (type === 'reploid:generation-error') throw new Error('MARKER-FRAME');
      if (type === 'reploid:generation-update') onChunk('MARKER-FRAME');
      return { ...f.response, content: 'MARKER-FRAME' };
    },
    // The frame was sent on the admitted connection; by the time it is delivered the connection is another one.
    intercept(frame, _payload, sender) {
      if (sender === 1 && frame === type && !flipped) { flipped = true; f.changeChannelScope(); }
    },
  });
  const outcome = await ask(f, chunk => seen.push(chunk)).then(value => ({ value }), error => ({ error }));
  await settled();
  expect(flipped).toBe(true);
  expect(seen).toEqual([]);
  expect(outcome.value).toBeUndefined();
  expect(String(outcome.error?.message)).not.toContain('MARKER-FRAME');
});

it('a requester does not send the prompt when the admission arrives on another connection', async () => {
  let flipped = false;
  const f = await createRecoveryMesh(cleanup, {
    intercept(frame, _payload, sender) {
      if (sender === 1 && frame === 'reploid:generation-admitted' && !flipped) { flipped = true; f.changeChannelScope(); }
    },
  });
  await expect(ask(f)).rejects.toThrow();
  await settled();
  expect(flipped).toBe(true);
  expect(f.wire.filter(row => row.type === 'reploid:generation-request')).toEqual([]);
  expect(JSON.stringify(f.wire)).not.toContain('original prompt');
});
