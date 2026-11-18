import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderConversationWorkspace, bindConversationWorkspace } from '../../apps/poolday/ui/pool-home/conversation-workspace.js';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../apps/poolday/host/chat-session.js';
import { createChatTestService } from '../fixtures/chat-service.js';

vi.mock('../../apps/poolday/config/work-profile.json', async importOriginal => {
  const { default: profile } = await importOriginal();
  return { default: { ...profile, files: { ...profile.files, maxInputs: 2, maxFileBytes: 16, maxInputBytes: 24 } } };
});

let root, session, dispose;
const find = selector => root.querySelector(selector);
const choose = files => {
  const input = find('[data-composer-files]');
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
};
const file = name => ({ name, size: 8, arrayBuffer: vi.fn(async () => new TextEncoder().encode('12345678').buffer) });
const slowFile = name => {
  let resolve, reject;
  const promise = new Promise((done, failed) => { resolve = done; reject = failed; });
  return { ...file(name), arrayBuffer: vi.fn(() => promise), finish: () => resolve(new TextEncoder().encode('12345678').buffer), fail: () => reject(new Error('File read failed')) };
};
beforeEach(() => {
  root = document.createElement('div'); document.body.append(root);
  session = createChatSession({ storage: null, service: createChatTestService(), models: [CANONICAL_CHAT_MODELS[0]] });
  session.setCachedModels([CANONICAL_CHAT_MODELS[0]]);
  session.createThread({ sharingScope: 'local' });
  root.innerHTML = renderConversationWorkspace();
  dispose = bindConversationWorkspace(root, session);
});
afterEach(async () => { dispose(); await session.close(); root.remove(); });

it('admits consecutive file selections against the combined draft, keeping Send blocked until admission settles', async () => {
  const first = slowFile('first.txt'), second = file('second.txt'), overflow = file('overflow.txt');
  choose([first, second]);
  await vi.waitFor(() => expect(first.arrayBuffer).toHaveBeenCalledOnce());
  choose([overflow]);
  expect(find('[data-composer-send]').disabled).toBe(true);
  first.finish();
  await vi.waitFor(() => expect(find('[data-chat-error]').textContent).toContain('Attach up to 2 text files'));
  expect(find('[data-attachments-preview]').textContent).toContain('first.txt');
  expect(find('[data-attachments-preview]').textContent).toContain('second.txt');
  expect(find('[data-attachments-preview]').textContent).not.toContain('overflow.txt');
  expect(overflow.arrayBuffer).not.toHaveBeenCalled();
  expect(find('[data-composer-send]').disabled).toBe(false);
});
it('does not let a previous thread\'s unfinished file read block or modify a new thread', async () => {
  const old = slowFile('old.txt');
  choose([old]);
  await vi.waitFor(() => expect(old.arrayBuffer).toHaveBeenCalledOnce());
  session.createThread({ sharingScope: 'local' });
  choose([file('new.txt')]);
  await vi.waitFor(() => expect(find('[data-attachments-preview]').textContent).toContain('new.txt'));
  expect(find('[data-composer-send]').disabled).toBe(false);
  old.finish();
  await Promise.resolve(); await Promise.resolve();
  expect(find('[data-attachments-preview]').textContent).not.toContain('old.txt');
  expect(find('[data-composer-send]').disabled).toBe(false);
});
it('uses the same configured file limits in help and admission', () => {
  expect(find('[data-attachment-help]').textContent).toContain('Up to 2, 0.015625 KB each, 0.0234375 KB total.');
});

it('continues queued admission after a read fails without leaving Send blocked', async () => {
  const failed = slowFile('failed.txt');
  choose([failed]);
  await vi.waitFor(() => expect(failed.arrayBuffer).toHaveBeenCalledOnce());
  choose([file('valid.txt')]);
  failed.fail();
  await vi.waitFor(() => expect(find('[data-attachments-preview]').textContent).toContain('valid.txt'));
  expect(find('[data-attachments-preview]').textContent).not.toContain('failed.txt');
  expect(find('[data-composer-send]').disabled).toBe(false);
});
