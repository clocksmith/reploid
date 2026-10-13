import { describe, expect, it, vi } from 'vitest';
import { fixture } from '../fixtures/ordered-partition-ports.js';

// Real ordinary-route orchestration with injected numerical ports, not canonical
// publication, GPU execution, or a physical multi-device qualification.
describe('ordered route mutation boundaries', () => {
  it('snapshots the complete caller request before asynchronous plan hashing', async () => {
    const f = fixture(), original = structuredClone(f.request);
    const entered = Promise.withResolvers(), release = Promise.withResolvers();
    f.runtime.hashLayerPartitionPlan.mockImplementationOnce(async () => {
      entered.resolve(); await release.promise; return original.identity.route.planId;
    });
    const execution = f.runner.execute(f.request);
    await entered.promise;
    try {
      f.request.identity.requesterId = 'other-requester';
      f.request.identity.threadId = 'other-thread';
      f.request.identity.attemptId = 'other-attempt';
      f.request.identity.route.stages[1].residentId = 'other-resident';
      f.request.tokenIds.splice(0, 2, 99);
      f.request.generation.maxTokens = 4;
      f.request.grants.execution[0].id = 'other-execution';
      f.request.grants.tokenContext[1].id = 'other-context';
      f.request.grants.activation[0].id = 'other-activation';
      f.request.grants.output.id = 'other-output';
    } finally { release.resolve(); }
    const result = await execution;
    expect(result.content).toBe('012');
    expect(result.execution.identity).toEqual(original.identity);
    for (const stage of f.stages) {
      expect(stage.executeStage.mock.calls[0][0].inputTokenIds).toEqual(original.tokenIds);
      expect(stage.executeStage.mock.calls[0][0].generation).toEqual(original.generation);
    }
    expect(f.runtime.hashPartitionGeneration).toHaveBeenCalledWith(original.generation);
    const digest = f.runtime.hashPartitionGeneration.mock.results[0].value;
    for (const [request] of f.authorize.mock.calls) {
      expect(request.identity).toEqual(original.identity);
      expect(request.generationDigest).toBe(digest);
      const grant = request.action === 'mesh.execute_partition_stage' ? original.grants.execution[request.partitionIndex]
        : request.action === 'mesh.transfer_token_context' ? original.grants.tokenContext[request.partitionIndex]
          : request.action === 'mesh.transfer_intermediate_activation' ? original.grants.activation[request.fromStage]
            : original.grants.output;
      expect(request.grant).toEqual(grant);
    }
    expect(f.runner.getState()).toMatchObject({ active: 0, unsettled: 0 });
  });

  it('retains admitted port identities and original bound methods after caller replacement', async () => {
    const f = fixture(), route = structuredClone(f.route);
    const originals = f.stages.map(stage => ({ port: stage, reserve: stage.reserve,
      executeStage: stage.executeStage, closeAttempt: stage.closeAttempt }));
    const replacement = vi.fn(() => { throw new Error('Replaced port must not execute'); });
    for (const stage of f.stages) {
      stage.id = 'changed-' + stage.id;
      stage.transportId = 'changed-' + stage.transportId;
      stage.residentId = 'changed-' + stage.residentId;
      stage.executionId = 'changed-' + stage.executionId;
      stage.reserve = replacement; stage.executeStage = replacement; stage.closeAttempt = replacement;
    }
    // The caller may also mutate the container, independently of its entries.
    f.stages.reverse();
    const result = await f.runner.execute(f.request);
    expect(result.content).toBe('012');
    expect(replacement).not.toHaveBeenCalled();
    for (const original of originals) {
      expect(original.reserve).toHaveBeenCalledTimes(1);
      expect(original.executeStage).toHaveBeenCalledTimes(3);
      expect(original.closeAttempt).toHaveBeenCalledTimes(1);
      for (const method of [original.reserve, original.executeStage, original.closeAttempt]) {
        expect(method.mock.contexts.every(context => context === original.port)).toBe(true);
      }
    }
    for (const [frame] of f.transport.transferActivation.mock.calls) {
      const edge = frame.metadata;
      expect(edge.from).toBe(route.stages[edge.fromStage].participantId);
      expect(edge.to).toBe(route.stages[edge.toStage].participantId);
      expect(edge.identity.route).toEqual(route);
    }
    expect(result.execution.settlement.cleanup.every(row => row.status === 'settled')).toBe(true);
  });

  it('does not expose writable nested route or grant authority to authorization callbacks', async () => {
    const f = fixture(), original = structuredClone(f.request.identity);
    f.authorize.mockImplementation(async request => {
      expect(Reflect.set(request.identity, 'requesterId', 'other')).toBe(false);
      expect(Reflect.set(request.identity.route.stages[1], 'residentId', 'other')).toBe(false);
      expect(Reflect.set(request.grant, 'id', 'other')).toBe(false);
      return true;
    });
    const result = await f.runner.execute(f.request);
    expect(result.execution.identity).toEqual(original);
    expect(result.content).toBe('012');
  });
});
