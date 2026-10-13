import { expect, it, vi } from 'vitest';
import { createSignedResidentFactory } from '../../packages/reploid/src/mesh/partitions/signed-resident-factory.js';
const methods = ['admitCanonicalPrompt', 'executeCanonicalGroup0', 'executeCanonicalGroup1', 'commitCanonicalTransition'];
async function fixture({ missing = false } = {}) {
  let binding, permitted = true;
  const raw = Object.fromEntries(methods.map(name => [name, vi.fn(async value => value)]));
  raw.getCanonicalGeneration = () => ({ generationId: 'fixture' });
  if (missing) delete raw.commitCanonicalTransition;
  const session = { residentPartition: raw, verification: {}, close: vi.fn(async () => {}) };
  const settled = vi.fn();
  createSignedResidentFactory({ canonical: true, createFactory: options => { binding = options; },
    openCapsule: async () => session, model: {}, artifactStore: {}, release: { options: {}, assertCurrent: async () => {
      if (!permitted) throw Error('release revoked');
    } }, assertSession: async () => {}, closeSources: async () => {}, trackSession: () => settled });
  return { raw, session, settled, revoke() { permitted = false; }, open: () => binding.openCapsule({}, {}) };
}
it.each(methods)('checks current signed release before and after %s', async method => {
  const f = await fixture(), opened = await f.open(), value = { identity: { attemptId: 'a' } };
  expect(await opened.residentPartition[method](value)).toBe(value);
  f.raw[method].mockImplementationOnce(async () => { f.revoke(); return { unpublishable: true }; });
  await expect(opened.residentPartition[method](value)).rejects.toThrow('release revoked');
  await expect(opened.residentPartition[method](value)).rejects.toThrow('release revoked');
  expect(f.raw[method]).toHaveBeenCalledTimes(2);
  await opened.residentPartition.close(); expect(f.session.close).toHaveBeenCalledOnce(); expect(f.settled).toHaveBeenCalledOnce();
});
it('rejects unsupported canonical signed capability and settles the opened owner', async () => {
  const f = await fixture({ missing: true });
  await expect(f.open()).rejects.toThrow('canonical execution methods');
  expect(f.session.close).toHaveBeenCalledOnce(); expect(f.settled).toHaveBeenCalledOnce();
});
