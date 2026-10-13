import { expect, it, vi } from 'vitest';
import { createSignedResidentFactory } from '../../packages/reploid/src/mesh/partitions/signed-resident-factory.js';

async function fixture({ ordered = true } = {}) {
  let binding, permitted = true;
  const releaseCheck = vi.fn(async () => { if (!permitted) throw new Error('release revoked'); });
  const raw = { tokenize: vi.fn(async value => value), executeGroup0: vi.fn(async value => value),
    executeGroup1: vi.fn(async value => value), closeAttempt: vi.fn(async () => {}) };
  if (ordered) raw.executeStage = vi.fn(async value => value);
  const session = { residentPartition: raw, verification: {}, close: vi.fn(async () => {}) };
  const settled = vi.fn(), closeSources = vi.fn(async () => {});
  createSignedResidentFactory({ createFactory: options => { binding = options; },
    openCapsule: async () => session, model: {}, artifactStore: {},
    release: { options: {}, assertCurrent: releaseCheck }, assertSession: async () => {},
    closeSources, trackSession: () => settled });
  return { raw, session, settled, closeSources, releaseCheck, revoke() { permitted = false; },
    open: () => binding.openCapsule({}, {}) };
}

it('checks the signed release before ordered dispatch and after execution, withholding revoked output', async () => {
  const f = await fixture(), opened = await f.open();
  const request = { identity: { attemptId: 'a', stages: [{ index: 0 }, { index: 1 }, { index: 2 }] },
    signal: new AbortController().signal };
  expect(await opened.residentPartition.executeStage(request)).toBe(request);
  expect(f.releaseCheck).toHaveBeenCalledTimes(3); // admission, before, after
  f.raw.executeStage.mockImplementationOnce(async value => {
    expect(value.signal).toBe(request.signal);
    f.revoke(); return { output: 'must not publish' };
  });
  await expect(opened.residentPartition.executeStage(request)).rejects.toThrow('release revoked');
  await expect(opened.residentPartition.executeStage(request)).rejects.toThrow('release revoked');
  expect(f.raw.executeStage).toHaveBeenCalledTimes(2);
  await opened.residentPartition.closeAttempt({ identity: request.identity });
  expect(f.raw.closeAttempt).toHaveBeenCalledOnce(); // settlement is allowed despite revocation
  await opened.residentPartition.close();
  expect(f.session.close).toHaveBeenCalledOnce();
  expect(f.settled).toHaveBeenCalledOnce();
  expect(f.closeSources).toHaveBeenCalledOnce();
});

it('retains both ordered execution and release failures, including caller cancellation', async () => {
  const f = await fixture(), opened = await f.open();
  const controller = new AbortController(), cancelled = new Error('attempt cancelled');
  f.raw.executeStage.mockImplementationOnce(async request => {
    expect(request.signal).toBe(controller.signal);
    controller.abort(cancelled);
    f.revoke();
    request.signal.throwIfAborted();
  });
  await expect(opened.residentPartition.executeStage({ signal: controller.signal })).rejects.toSatisfy(error =>
    error instanceof AggregateError && error.errors[0] === cancelled && error.errors[1].message === 'release revoked');
  await opened.residentPartition.close();
});

it('does not advertise ordered execution absent from an older signed runtime', async () => {
  const f = await fixture({ ordered: false }), opened = await f.open();
  expect(opened.residentPartition.executeStage).toBeUndefined();
  expect(await opened.residentPartition.executeGroup0({ step: 0 })).toEqual({ step: 0 });
  f.revoke();
  await expect(opened.residentPartition.executeGroup1({ step: 0 })).rejects.toThrow('release revoked');
  expect(f.raw.executeGroup1).not.toHaveBeenCalled();
  await opened.residentPartition.close();
});

it('retains an unsettled signed session for explicit cleanup retry after ordered revocation', async () => {
  const f = await fixture(), opened = await f.open();
  f.revoke();
  f.session.close.mockRejectedValueOnce(new Error('runtime cleanup unknown'));
  await expect(opened.residentPartition.close()).rejects.toThrow('Signed resident cleanup failed');
  expect(f.settled).not.toHaveBeenCalled();
  await expect(opened.residentPartition.executeStage({})).rejects.toThrow('release revoked');
  expect(f.raw.executeStage).not.toHaveBeenCalled();
  await opened.residentPartition.close();
  expect(f.session.close).toHaveBeenCalledTimes(2);
  expect(f.settled).toHaveBeenCalledOnce();
});
