import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openConversation } from '../fixtures/conversation-view.js';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../apps/poolday/host/chat-session.js';
import { createChatTestService } from '../fixtures/chat-service.js';

vi.mock('../../apps/poolday/config/work-profile.json', async importOriginal => {
  const { default: profile } = await importOriginal();
  return { default: { ...profile, files: { ...profile.files, maxInputs: 2, maxFileBytes: 16, maxInputBytes: 24 } } };
});

let session, view;
// The composer's file picker hands its selection to the controller.
const choose = files => view.controller.attach(files);
const attached = () => view.composer().files.map(item => item.name).join(' ');
const sendDisabled = () => view.composer().send.disabled;
const file = name => ({ name, size: 8, arrayBuffer: vi.fn(async () => new TextEncoder().encode('12345678').buffer) });
const slowFile = name => {
  let resolve, reject;
  const promise = new Promise((done, failed) => { resolve = done; reject = failed; });
  return { ...file(name), arrayBuffer: vi.fn(() => promise), finish: () => resolve(new TextEncoder().encode('12345678').buffer), fail: () => reject(new Error('File read failed')) };
};
beforeEach(() => {
  session = createChatSession({ storage: null, service: createChatTestService(), models: [CANONICAL_CHAT_MODELS[0]] });
  session.setCachedModels([CANONICAL_CHAT_MODELS[0]]);
  session.createThread({ sharingScope: 'local' });
  view = openConversation(session);
});
afterEach(async () => { view.dispose(); await session.close(); });

it('admits consecutive file selections against the combined draft, keeping Send blocked until admission settles', async () => {
  const first = slowFile('first.txt'), second = file('second.txt'), overflow = file('overflow.txt');
  choose([first, second]);
  await vi.waitFor(() => expect(first.arrayBuffer).toHaveBeenCalledOnce());
  choose([overflow]);
  expect(sendDisabled()).toBe(true);
  first.finish();
  await vi.waitFor(() => expect(view.composer().error).toContain('Attach up to 2 text files'));
  expect(attached()).toContain('first.txt');
  expect(attached()).toContain('second.txt');
  expect(attached()).not.toContain('overflow.txt');
  expect(overflow.arrayBuffer).not.toHaveBeenCalled();
  expect(sendDisabled()).toBe(false);
});
it('does not let a previous thread\'s unfinished file read block or modify a new thread', async () => {
  const old = slowFile('old.txt');
  choose([old]);
  await vi.waitFor(() => expect(old.arrayBuffer).toHaveBeenCalledOnce());
  session.createThread({ sharingScope: 'local' });
  choose([file('new.txt')]);
  await vi.waitFor(() => expect(attached()).toContain('new.txt'));
  expect(sendDisabled()).toBe(false);
  old.finish();
  await Promise.resolve(); await Promise.resolve();
  expect(attached()).not.toContain('old.txt');
  expect(sendDisabled()).toBe(false);
});
it('uses the same configured file limits in help and admission', () => {
  expect(view.composer().attachmentHelpText).toContain('Up to 2, 0.015625 KB each, 0.0234375 KB total.');
});

it('continues queued admission after a read fails without leaving Send blocked', async () => {
  const failed = slowFile('failed.txt');
  choose([failed]);
  await vi.waitFor(() => expect(failed.arrayBuffer).toHaveBeenCalledOnce());
  choose([file('valid.txt')]);
  failed.fail();
  await vi.waitFor(() => expect(attached()).toContain('valid.txt'));
  expect(attached()).not.toContain('failed.txt');
  expect(sendDisabled()).toBe(false);
});
