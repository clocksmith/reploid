import { expect, it } from 'vitest';
import { createContributorIdentity } from '../../apps/poolday/host/contributor-identity.js';
import { getIdentityStorageKey } from '../../shared/identity.js';

function fixture() {
  const values = new Map(), held = new Set(), tab = new Map();
  return { values,
    tabStorage: { getItem: key => tab.get(key) ?? null, setItem: (key, value) => tab.set(key, value) },
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    locks: { async request(name, options, callback) {
      if (held.has(name)) return callback(null);
      held.add(name);
      try { return await callback({ name }); } finally { held.delete(name); }
    } }
  };
}
const key = getIdentityStorageKey('work-contributor:v1:0');

it('retains the same key and participant across stop, rebuild and browser restart', async () => {
  const ports = fixture();
  const first = createContributorIdentity(ports);
  const [a, duplicate] = await Promise.all([first.ensure(), first.ensure()]);
  expect(duplicate).toBe(a);
  a.contribution.receiptsServed = 7;
  first.save(a);
  await first.close();
  const next = createContributorIdentity({ ...ports });
  const b = await next.ensure();
  expect(b.peerId).toBe(a.peerId);
  expect(b.publicJwk).toEqual(a.publicJwk);
  expect(b.privateJwk).toEqual(a.privateJwk);
  expect(b.contribution.receiptsServed).toBe(7);
  await next.close();
});

it('gives concurrent copied tabs distinct stable slots and restores each on reload', async () => {
  const ports = fixture(), first = createContributorIdentity(ports);
  const a = await first.ensure();
  const copiedTab = fixture().tabStorage;
  copiedTab.setItem('REPLOID_CONTRIBUTOR_SLOT_V1', '0');
  const otherPorts = { ...ports, tabStorage: copiedTab }, other = createContributorIdentity(otherPorts);
  const b = await other.ensure();
  expect(b.peerId).not.toBe(a.peerId);
  expect(copiedTab.getItem('REPLOID_CONTRIBUTOR_SLOT_V1')).toBe('1');
  await other.close();
  const reloaded = createContributorIdentity(otherPorts);
  expect((await reloaded.ensure()).peerId).toBe(b.peerId);
  await reloaded.close(); await first.close();
  const restart = createContributorIdentity(ports);
  expect((await restart.ensure()).peerId).toBe(a.peerId);
  await restart.close();
});

it('leaves old random session and unscoped legacy identities untouched', async () => {
  const ports = fixture();
  ports.values.set(getIdentityStorageKey('work-swarm:old-random'), 'old-session');
  ports.values.set('REPLOID_SELF_IDENTITY_V1', 'old-self');
  const owner = createContributorIdentity(ports);
  await owner.ensure(); await owner.close();
  expect(ports.values.get(getIdentityStorageKey('work-swarm:old-random'))).toBe('old-session');
  expect(ports.values.get('REPLOID_SELF_IDENTITY_V1')).toBe('old-self');
  expect(ports.values.has('REPLOID_SELF_IDENTITY_V1_MIGRATED_INSTANCE')).toBe(false);
});

it('refuses corruption rather than silently resetting the participant', async () => {
  const ports = fixture(); ports.values.set(key, 'not-json');
  const owner = createContributorIdentity(ports);
  await expect(owner.ensure()).rejects.toThrow('unreadable'); await owner.close();
  expect(ports.values.get(key)).toBe('not-json');
});

it.each(['denied', 'discarded', 'unavailable'])('fails closed when storage is %s', async mode => {
  const ports = fixture();
  if (mode === 'denied') ports.storage.getItem = () => { throw new Error('denied'); };
  if (mode === 'discarded') ports.storage.setItem = () => {};
  if (mode === 'unavailable') ports.storage = null;
  const owner = createContributorIdentity(ports);
  await expect(owner.ensure()).rejects.toThrow(); await owner.close();
  expect(ports.values.has(key)).toBe(false);
});

it('requires Web Locks and does not create an ephemeral fallback', async () => {
  const ports = fixture(), owner = createContributorIdentity({ ...ports, locks: null });
  await expect(owner.ensure()).rejects.toThrow('Web Locks'); await owner.close();
  expect(ports.values.size).toBe(0);
});

it('closing during key creation rejects initialization and releases ownership', async () => {
  const ports = fixture(), owner = createContributorIdentity(ports);
  const result = expect(owner.ensure()).rejects.toThrow('closed');
  await owner.close(); await result;
  await expect(owner.ensure()).rejects.toThrow('closed');
  const next = createContributorIdentity(ports); await next.ensure(); await next.close();
});

it('refuses denied or discarded tab persistence without holding a leaked lease', async () => {
  for (const denied of [true, false]) {
    const ports = fixture();
    const broken = { ...ports, tabStorage: { getItem: () => null, setItem() { if (denied) throw Error('denied'); } } };
    const owner = createContributorIdentity(broken);
    await expect(owner.ensure()).rejects.toThrow(); await owner.close();
    const next = createContributorIdentity(ports); await next.ensure(); await next.close();
  }
});

it('refuses an invalid saved slot rather than abandoning its identity', async () => {
  const ports = fixture(); ports.tabStorage.setItem('REPLOID_CONTRIBUTOR_SLOT_V1', '../wrong');
  const owner = createContributorIdentity(ports);
  await expect(owner.ensure()).rejects.toThrow('invalid'); await owner.close();
  expect(ports.values.size).toBe(0);
});
