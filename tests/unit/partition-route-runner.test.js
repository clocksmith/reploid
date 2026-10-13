import { describe, expect, it } from 'vitest';
import { fixture, another } from '../fixtures/ordered-partition-ports.js';

describe('ordered ordinary route (injected numerical execution)', () => {
  it.each([2, 3, 4, 5, 6, 7, 16])('streams %i stages in order after complete reservation', async count => {
    const f = fixture(count), deltas = [];
    const result = await f.runner.execute({ ...f.request, onDelta: delta => deltas.push(delta) });
    expect(deltas).toEqual(['0', '1', '2']);
    expect(result.content).toBe('012');
    expect(f.calls.slice(0, count).every(row => row[0] === 'reserve')).toBe(true);
    expect(f.calls.filter(row => row[0] === 'execute').map(row => row[1])).toEqual(
      Array.from({ length: 3 }, () => Array.from({ length: count }, (_, i) => i)).flat());
    expect(f.transport.transferActivation).toHaveBeenCalledTimes((count - 1) * 3);
    expect(f.stages.every(stage => stage.closeAttempt.mock.calls.length === 1)).toBe(true);
    expect(f.runner.getState()).toMatchObject({ active: 0, unsettled: 0 });
  });
  it('rejects a missing middle-stage grant before reservation or input disclosure', async () => {
    const f = fixture(); f.request.grants.execution[1] = null;
    await expect(f.runner.execute(f.request)).rejects.toThrow('Grants');
    expect(f.calls).toEqual([]);
  });
  it('rolls back every possibly admitted owner after a lost middle acknowledgment', async () => {
    const f = fixture(4);
    f.stages[2].reserve.mockRejectedValue(new Error('ack lost'));
    await expect(f.runner.execute(f.request)).rejects.toThrow('ack lost');
    expect(f.stages.map(stage => stage.closeAttempt.mock.calls.length)).toEqual([1, 1, 1, 0]);
    expect(f.calls.some(row => row[0] === 'execute')).toBe(false);
  });
  it('keeps unknown cleanup charged until a successful retry, without reclosing healthy owners', async () => {
    const f = fixture(3, 1);
    f.stages[1].closeAttempt.mockRejectedValue(new Error('channel lost'));
    await expect(f.runner.execute(f.request)).rejects.toMatchObject({ code: 'CLEANUP_FAILED' });
    expect(f.runner.getState()).toMatchObject({ active: 0, unsettled: 1 });
    await expect(f.runner.execute(another(f, 'second'))).rejects.toThrow('cleanup unsettled');
    f.stages[1].closeAttempt.mockResolvedValue();
    await f.runner.retryCleanup('attempt');
    expect(f.stages.map(stage => stage.closeAttempt.mock.calls.length)).toEqual([1, 2, 1]);
    expect((await f.runner.execute(another(f, 'third'))).content).toBe('012');
  });
  it.each(['toStage', 'bytes'])('rejects altered middle edge %s before the next stage runs', async field => {
    const f = fixture(4);
    f.transport.transferActivation.mockImplementation(async frame => {
      const copy = structuredClone(frame);
      if (copy.metadata.fromStage === 1) {
        if (field === 'bytes') new Uint8Array(copy.buffer)[0] ^= 1;
        else copy.metadata.toStage = 3;
      }
      return copy;
    });
    await expect(f.runner.execute(f.request)).rejects.toThrow(/activation/);
    expect(f.stages[2].executeStage).not.toHaveBeenCalled();
    expect(f.stages.every(stage => stage.closeAttempt.mock.calls.length === 1)).toBe(true);
  });
  it('rechecks revoked edge authority after its producer completes', async () => {
    const f = fixture(); let revoked = false;
    const run = f.stages[1].executeStage.getMockImplementation();
    f.stages[1].executeStage.mockImplementation(async args => { const result = await run(args); revoked = true; return result; });
    f.authorize.mockImplementation(async () => !revoked);
    await expect(f.runner.execute(f.request)).rejects.toThrow('authorization declined');
    expect(f.stages[2].executeStage).not.toHaveBeenCalled();
  });
  it('rejects a middle stage that attempts to sample a token', async () => {
    const f = fixture(); const run = f.stages[1].executeStage.getMockImplementation();
    f.stages[1].executeStage.mockImplementation(async args => ({ ...await run(args), tokenId: 10 }));
    await expect(f.runner.execute(f.request)).rejects.toThrow('Only final stage');
  });
  it('cancels one conversation at a middle stage while another completes with private state', async () => {
    const f = fixture(5), gate = Promise.withResolvers(), entered = Promise.withResolvers(), abort = new AbortController();
    const run = f.stages[2].executeStage.getMockImplementation();
    f.stages[2].executeStage.mockImplementation(async args => {
      if (args.identity.attemptId === 'attempt') { entered.resolve(); await gate.promise; }
      return run(args);
    });
    const first = f.runner.execute({ ...f.request, signal: abort.signal });
    const rejected = expect(first).rejects.toThrow('cancel first');
    await entered.promise;
    const survivor = f.runner.execute(another(f, 'survivor'));
    abort.abort(new Error('cancel first')); gate.resolve();
    await rejected;
    expect((await survivor).content).toBe('012');
    expect(f.runner.getState()).toMatchObject({ active: 0, unsettled: 0 });
  });
  it('does not let slow output delivery hold the route token lease', async () => {
    const f = fixture(), entered = Promise.withResolvers(), release = Promise.withResolvers();
    const first = f.runner.execute({ ...f.request, onDelta: async () => { entered.resolve(); await release.promise; } });
    await entered.promise;
    expect((await f.runner.execute(another(f, 'survivor'))).content).toBe('012');
    release.resolve(); await first;
  });
  it('interleaves twenty admitted requesters and rejects a twenty-first without disclosing its input', async () => {
    const f = fixture(3, 20), entered = Promise.withResolvers(), release = Promise.withResolvers();
    const run = f.stages[0].executeStage.getMockImplementation();
    f.stages[0].executeStage.mockImplementation(async args => {
      if (args.identity.attemptId === 'request-0' && args.step === 0) { entered.resolve(); await release.promise; }
      return run(args);
    });
    const requests = Array.from({ length: 20 }, (_, index) => ({ ...another(f, `request-${index}`),
      identity: { ...another(f, `request-${index}`).identity, requesterId: `requester-${index}` } }));
    const work = requests.map(request => f.runner.execute(request));
    await entered.promise;
    await expect(f.runner.execute(another(f, 'overflow'))).rejects.toThrow('concurrency budget');
    expect(f.calls.some(row => row[2] === 'overflow')).toBe(false);
    release.resolve();
    const results = await Promise.all(work);
    expect(results.every(result => result.content === '012')).toBe(true);
    expect(new Set(results.map(result => result.execution.identity.requesterId)).size).toBe(20);
    for (const request of requests) {
      expect(f.calls.filter(row => row[0] === 'execute' && row[2] === request.identity.attemptId)).toHaveLength(9);
    }
    expect(f.runner.getState()).toMatchObject({ active: 0, unsettled: 0 });
  });

  it('binds both transfer permissions at middle stages and allows a contributing node to request', async () => {
    const f = fixture(4);
    const result = await f.runner.execute({ ...f.request,
      identity: { ...f.request.identity, requesterId: f.route.stages[2].participantId } });
    expect(result.content).toBe('012');
    for (let stage = 0; stage < 4; stage++) {
      const [request] = f.stages[stage].executeStage.mock.calls[0];
      expect(request.incomingActivationGrant).toEqual(stage ? f.request.grants.activation[stage - 1] : undefined);
      expect(request.outgoingActivationGrant).toEqual(stage < 3 ? f.request.grants.activation[stage] : undefined);
    }
    const output = f.authorize.mock.calls.map(([value]) => value).find(value => value.action === 'mesh.transfer_partition_output');
    expect(output.recipients).toEqual(['node-3', 'node-0', 'node-2']);
  });

});
