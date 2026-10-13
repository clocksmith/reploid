import { describe, it, expect, vi } from 'vitest';
import { createResidentPartition } from '../../packages/reploid/src/mesh/partitions/resident-partition.js';
const sha = 'sha256:' + 'a'.repeat(64);
function fixture(index = 1) {
  const plan = { schema: 'doppler.layer-partition-contract/v3', modelId: 'm', stageCount: 3,
    partitions: [0,1,2].map(index => ({ index, layerRange: [index * 2, index * 2 + 1] })) };
  const activation = { schema: 'doppler.activation-tensor/v1', dtype: 'f32', precision: 'f32', components: 1, elementStrideBytes: 4, hiddenSize: 8 };
  const stages = [0,1,2].map(index => ({ index, participantId: 'p'+index, transportId: 't'+index, residentId: 'r'+index, executionId: 'e'+index }));
  const model = { id: 'm', identity: sha, generation: { maxTokens: 3 } };
  const identity = { schema: 'reploid.partition-attempt/v2', threadId: 'thread', attemptId: 'attempt', requesterId: 'requester', placementGeneration: 0,
    route: { schema: 'reploid.partition-route/v1', modelId: 'm', modelIdentity: sha, planId: sha, stages, activation } };
  const descriptor = { schema: 'doppler.resident-partition/v2', ready: true, modelId: 'm', modelIdentity: sha,
    planId: sha, index, stageCount: 3, layerRange: plan.partitions[index].layerRange, residentWeightBytes: 64, generationDigest: sha };
  const mapped = input => { expect(input.schema).toBe('doppler.resident-partition-attempt/v2'); expect(input.stages).toEqual(stages); };
  const session = { getDescriptor: () => descriptor, getRecoveryCapabilities: () => ({ schema: 'doppler.resident-recovery/v1',
    inputReplay: false, checkpointExport: false, checkpointImport: false }),
    tokenize: vi.fn(async ({ identity }) => { mapped(identity); return { tokenIds: [1] }; }),
    executeStage: vi.fn(async request => { mapped(request.identity); return { identity: request.identity,
      partitionIndex: index, step: request.step, tokenPosition: request.tokenPosition }; }),
    closeAttempt: vi.fn(async ({ identity }) => mapped(identity)), close: vi.fn(async () => {}) };
  const runtime = { openResidentPartition: vi.fn(async () => session) };
  const orderedRuntime = { hashLayerPartitionPlan: () => sha, hashPartitionGeneration: () => sha, getPartitionActivationContract: () => activation };
  const resident = createResidentPartition({ runtime, model, plan, planId: sha, index, participantId: 'p'+index,
    limits: { maxAttempts: 20, maxConcurrentAttempts: 3 }, ordered: { runtime: orderedRuntime, stage: stages[index] } });
  const request = { identity, partitionIndex: index, step: 0, tokenPosition: 0 };
  return { resident, session, runtime, identity, request, descriptor };
}
describe('ordered resident facade', () => {
  it.each([0,1,2])('maps stage%i execution and cleanup through the same provider identity while reservations remain application-owned', async index => {
    const f = fixture(index); await f.resident.prepare({ approved: true });
    expect(f.resident.getState().ready).toBe(true);
    expect(await f.resident.reserve(f.request)).toMatchObject({ identity: f.identity, partitionIndex: index, status: 'reserved' });
    if (index === 0) await f.resident.tokenize({ identity: f.identity, messages: [] });
    expect((await f.resident.executeStage(f.request)).identity).toEqual(f.identity);
    await f.resident.closeAttempt({ identity: f.identity });
    expect(f.resident.getState().reservations.active).toBe(0);
    await f.resident.close(); expect(f.session.close).toHaveBeenCalledTimes(1);
  });
  it('maps invoke failure cleanup without disposing shared weights or an unrelated attempt', async () => {
    const f = fixture(); await f.resident.prepare({ approved: true });
    const survivor = { ...f.identity, attemptId: 'survivor' }; await f.resident.reserve({ ...f.request, identity: survivor });
    f.session.executeStage.mockRejectedValueOnce(Error('injected compute failure'));
    await expect(f.resident.executeStage(f.request)).rejects.toThrow('injected compute failure');
    expect(f.session.closeAttempt).toHaveBeenCalledTimes(1); expect(f.session.close).not.toHaveBeenCalled();
    expect(f.resident.getState().reservations.active).toBe(1);
    expect((await f.resident.executeStage({ ...f.request, identity: survivor })).identity).toEqual(survivor);
    await f.resident.close();
  });
  it('retains failed cleanup capacity until explicit retry and rejects a stale resident identity', async () => {
    const f = fixture(); await f.resident.prepare({ approved: true }); await f.resident.reserve(f.request);
    f.session.closeAttempt.mockRejectedValueOnce(Error('unsettled'));
    await expect(f.resident.closeAttempt({ identity: f.identity })).rejects.toMatchObject({ code: 'CLEANUP_FAILED' });
    expect(f.resident.getState().reservations.active).toBe(1);
    const changed = structuredClone(f.identity); changed.route.stages[1].residentId = 'stale';
    await expect(f.resident.closeAttempt({ identity: changed })).rejects.toThrow('allocation');
    await f.resident.closeAttempt({ identity: f.identity }); expect(f.resident.getState().reservations.active).toBe(0);
    await f.resident.close();
  });
  it('never advertises Ready when the opened provider lacks executeStage or changes its descriptor', async () => {
    for (const defect of ['method', 'descriptor']) {
      const f = fixture();
      if (defect === 'method') delete f.session.executeStage; else f.descriptor.stageCount = 2;
      await expect(f.resident.prepare({ approved: true })).rejects.toThrow();
      expect(f.resident.getState().ready).toBe(false); expect(f.session.close).toHaveBeenCalledTimes(1);
    }
  });
});

it('a caller mutation cannot charge failure to a different live attempt', async () => {
  const f = fixture(); await f.resident.prepare({ approved: true });
  const survivor = { ...f.identity, attemptId: 'survivor' }; await f.resident.reserve({ ...f.request, identity: survivor });
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  f.session.executeStage.mockImplementationOnce(async () => { entered.resolve(); await release.promise; throw Error('original failure'); });
  const pending = f.resident.executeStage(f.request); await entered.promise;
  f.request.identity.attemptId = 'survivor'; release.resolve();
  await expect(pending).rejects.toThrow('original failure');
  const records = f.resident.getState().reservations.records;
  expect(records.find(row => row.identity.attemptId === 'survivor').failure).toBeNull();
  expect(records.find(row => row.identity.attemptId === 'attempt')).toMatchObject({ failure: 'original failure', phase: 'failed' });
  expect(f.session.closeAttempt.mock.calls[0][0].identity.attemptId).toBe('attempt');
  await f.resident.close();
});
