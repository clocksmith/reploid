import { afterEach, expect, it, vi } from 'vitest';
import { renderConversationWorkspace, bindConversationWorkspace } from '../../self/ui/pool-home/conversation-workspace.js';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../self/host/chat-session.js';
import { createChatTestService } from '../fixtures/chat-service.js';
const owned = [];
afterEach(async () => { for (const close of owned.splice(0)) await close(); });
const gate = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
async function fixture() {
  const session = createChatSession({ storage: null, service: createChatTestService(), models: [CANONICAL_CHAT_MODELS[1]] });
  await session.prepareLocalModel(CANONICAL_CHAT_MODELS[1].id);
  const root = document.createElement('div'); document.body.append(root); root.innerHTML = renderConversationWorkspace();
  const creation = gate(), admission = gate(), completion = gate();
  Object.defineProperty(completion.promise, 'admitted', { value: admission.promise });
  const send = vi.fn(() => completion.promise), saveDraft = vi.fn(session.saveDraft);
  const dispose = bindConversationWorkspace(root, { ...session, saveDraft, send,
    createThread: async options => { await creation.promise; return session.createThread(options); } });
  owned.push(async () => { dispose(); await session.close(); root.remove(); });
  const input = root.querySelector('[data-composer-input]'), form = root.querySelector('[data-composer-form]');
  input.value = 'Preserve this question'; input.dispatchEvent(new Event('input', { bubbles: true }));
  const submit = () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return { session, root, creation, admission, completion, send, saveDraft, input, submit };
}
it('awaits create and saved admission, then clears drafts while generation remains pending', async () => {
  const f = await fixture(); f.submit(); f.submit(); await Promise.resolve();
  expect(f.send).not.toHaveBeenCalled(); f.creation.resolve();
  await vi.waitFor(() => expect(f.send).toHaveBeenCalledOnce());
  expect(typeof f.send.mock.calls[0][0]).toBe('string');
  expect(f.saveDraft.mock.calls.some(([, value]) => value === null)).toBe(false);
  f.admission.resolve();
  await vi.waitFor(() => expect(f.input.value).toBe(''));
  expect(f.saveDraft.mock.calls.filter(([, value]) => value === null)).toHaveLength(2);
  let settled = false; f.completion.promise.then(() => { settled = true; });
  await Promise.resolve(); expect(settled).toBe(false);
  f.completion.resolve({ status: 'completed' });
});
it('keeps drafts when admission has an unknown write outcome', async () => {
  const f = await fixture(); f.creation.resolve(); f.submit();
  await vi.waitFor(() => expect(f.send).toHaveBeenCalledOnce());
  const failure = Error('Admission receipt unknown'); f.admission.reject(failure); f.completion.reject(failure);
  await vi.waitFor(() => expect(f.root.querySelector('[data-chat-error]').textContent).toContain('Admission receipt unknown'));
  expect(f.saveDraft.mock.calls.some(([, value]) => value === null)).toBe(false);
  expect(f.input.value).toBe('Preserve this question');
});

it('preserves a newer draft edited while metadata admission is pending', async () => {
  const f = await fixture(); f.creation.resolve(); f.submit();
  await vi.waitFor(() => expect(f.send).toHaveBeenCalledOnce());
  f.input.value = 'A newer unsent question'; f.input.dispatchEvent(new Event('input', { bubbles: true }));
  f.admission.resolve(); await new Promise(resolve => setTimeout(resolve, 10));
  expect(f.input.value).toBe('A newer unsent question');
  expect(f.saveDraft.mock.calls.some(([, value]) => value === null)).toBe(false);
  expect(f.send.mock.calls[0][1]).toBe('Preserve this question');
  f.completion.resolve({ status: 'completed' });
});
