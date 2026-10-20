import { afterEach, expect, it, vi } from 'vitest';
import { createChatSession } from '../../self/host/chat-session.js';
const ports = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../../self/host/product-session.js', () => ({ createProductSession: ports.create }));
import { initPoolHome } from '../../self/ui/pool-home/index.js';
const owners = [];
afterEach(async () => { for (const close of owners.splice(0)) await close(); ports.create.mockReset(); });
function fixture() {
  const mount = document.createElement('div'); document.body.append(mount);
  const chat = createChatSession({ storage: null, models: [] });
  const host = { chat, swarm: { getInviteUrl: () => null }, evolution: { list: async () => [] },
    close: vi.fn(() => chat.close()), connectOperations() {}, pause() {}, resume() {} };
  owners.push(async () => { await host.close(); mount.remove(); });
  return { mount, host };
}
it('awaits configured canonical history before binding the actual shell', async () => {
  const { mount, host } = fixture(); let resolve;
  ports.create.mockReturnValue(new Promise(done => { resolve = done; }));
  const canonical = { meshId: 'mesh', participantId: 'requester' };
  const opening = initPoolHome(mount, { canonical });
  expect(mount.querySelector('[data-composer-form]')).toBeNull();
  expect(ports.create.mock.calls[0][0].canonical).toBe(canonical);
  resolve(host); const dispose = await opening;
  expect(mount.querySelector('[data-composer-form]')).not.toBeNull(); dispose();
});
it('closes an obsolete opening after a newer route initialization without binding it', async () => {
  const old = fixture(), next = fixture(); let resolve;
  ports.create.mockReturnValueOnce(new Promise(done => { resolve = done; })).mockReturnValueOnce(next.host);
  const opening = initPoolHome(old.mount, { canonical: {} });
  const dispose = initPoolHome(next.mount);
  expect(typeof dispose).toBe('function');
  resolve(old.host); await opening;
  expect(old.host.close).toHaveBeenCalledOnce();
  expect(old.mount.querySelector('[data-composer-form]')).toBeNull();
  expect(next.mount.querySelector('[data-composer-form]')).not.toBeNull(); dispose();
});
it('pagehide retires pending opening and reports a failed admission without binding', async () => {
  const { mount } = fixture(); let reject;
  ports.create.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  const opening = initPoolHome(mount, { canonical: {} });
  window.dispatchEvent(new Event('pagehide'));
  reject(Error('history writer unavailable'));
  await expect(opening).rejects.toThrow('history writer unavailable');
  expect(mount.querySelector('[data-composer-form]')).toBeNull();
});

it('a startup deadline retires the opening and closes a late host without replacing the failure view', async () => {
  const { mount, host } = fixture(); let resolve;
  ports.create.mockReturnValue(new Promise(done => { resolve = done; }));
  const controller = new AbortController();
  const opening = initPoolHome(mount, { canonical: {}, signal: controller.signal });
  controller.abort(Error('startup timed out'));
  mount.textContent = 'Reploid could not load';
  resolve(host); await opening;
  expect(host.close).toHaveBeenCalledOnce();
  expect(mount.textContent).toBe('Reploid could not load');
  expect(mount.querySelector('[data-composer-form]')).toBeNull();
});
