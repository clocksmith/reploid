import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTrainingSession } from '../../packages/reploid/src/training/session.js';
import policy from '../../self/config/lora-training.json';
const samples = [{ inputIds: [100, 200], targetIds: [200, 300], supervisedTokenCount: 2 }];
const adapter = { id: 'tested', name: 'Tested', version: '0.0.1' };
const cleanups = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(session => session.close())); });
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function fixture(overrides = {}) {
  const weights = new Uint8Array([1, 2, 3]).buffer;
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', weights))].map(b => b.toString(16).padStart(2, '0')).join('');
  let received, allowed;
  const executor = { close: vi.fn(async () => {}), request: vi.fn(async (action, input) => {
    switch (action) {
      case 'prepare': return { baseManifestHash: policy.baseManifestHash, assignment: { participantId: input.participantId, sampleHash: 'sample', supervisedTokenCount: 2 } };
      case 'step': return { loss: 1 };
      case 'round': return { ...input, roundHash: 'round', baseManifestHash: policy.baseManifestHash };
      case 'contribute': return { participantId: input.participantId, roundHash: input.round.roundHash };
      case 'apply': return { loss: 0.5, stepCount: 1 };
      case 'export': return { manifest: { ...adapter, checksum: hash }, json: '{}', weights, weightsSha256: hash };
      default: throw Error(action);
    }
  }) };
  const remote = { participantId: 'remote', request: vi.fn(async (action, _jobId, input) => action === 'describe'
    ? { baseManifestHash: policy.baseManifestHash, assignment: { participantId: 'remote', sampleHash: 'remote-sample', supervisedTokenCount: 1 } }
    : { participantId: 'remote', roundHash: input.round.roundHash }) };
  const network = { connect: vi.fn(async () => remote), close: vi.fn(async () => {}) };
  const openExecutor = vi.fn(async () => executor);
  const session = createTrainingSession({ policy, participantId: async () => 'local', openExecutor,
    openNetwork: ports => { received = ports.receive; allowed = ports.allowed; return network; },
    connectPeer: async () => remote, ...overrides });
  cleanups.push(session);
  return { session, executor, remote, openExecutor, receive: input => received(input), allowed: id => allowed(id) };
}
const input = { samples, adapter, consent: true };
describe('authorized LoRA orchestration', () => {
  it('rejects missing consent and malformed samples before GPU preparation', async () => {
    const f = await fixture();
    await expect(f.session.run({ ...input, consent: false })).rejects.toThrow('Approve');
    await expect(f.session.run({ ...input, samples: [{ ...samples[0], supervisedTokenCount: 1 }] })).rejects.toThrow('supervised');
    expect(f.openExecutor).not.toHaveBeenCalled();
  });
  it('exports checked local weights without activation and retains them across consumers', async () => {
    const f = await fixture();
    const result = await f.session.run(input);
    expect(result).toMatchObject({ evaluated: false, activated: false });
    expect(f.executor.request.mock.calls.map(row => row[0])).toEqual(['prepare', 'step', 'export']);
    expect(f.executor.close).toHaveBeenCalledOnce();
    const retained = f.session.getCandidate(); new Uint8Array(retained.weights)[0] = 255;
    expect(new Uint8Array(f.session.getCandidate().weights)[0]).toBe(1);
  });
  it('collects all gradients then applies exactly one shared optimizer step', async () => {
    const f = await fixture();
    const result = await f.session.run({ ...input, peers: ['remote-wire'] });
    const calls = f.executor.request.mock.calls;
    expect(calls.map(row => row[0])).toEqual(['prepare', 'round', 'contribute', 'apply', 'export']);
    expect(calls.find(row => row[0] === 'apply')[1].contributions.map(row => row.participantId)).toEqual(['local', 'remote']);
    expect(result.metrics).toEqual([{ loss: 0.5, stepCount: 1 }]);
  });
  it('never updates or exports when a selected contributor disappears', async () => {
    const f = await fixture();
    f.remote.request.mockImplementation(async action => {
      if (action === 'describe') return { baseManifestHash: policy.baseManifestHash, assignment: { participantId: 'remote', sampleHash: 's', supervisedTokenCount: 1 } };
      throw Error('disconnected');
    });
    await expect(f.session.run({ ...input, peers: ['remote-wire'] })).rejects.toThrow('disconnected');
    expect(f.executor.request.mock.calls.map(row => row[0])).not.toContain('apply');
    expect(f.session.getCandidate()).toBeNull();
  });
  it('keeps Stop pending until the current GPU action settles, without exporting late results', async () => {
    const f = await fixture(), executing = gate(), settled = gate();
    const original = f.executor.request.getMockImplementation();
    f.executor.request.mockImplementation(async (action, data) => {
      if (action === 'step') { executing.resolve(); await settled.promise; return { loss: 1 }; }
      return original(action, data);
    });
    const run = f.session.run(input); const failed = expect(run).rejects.toThrow('stopped');
    await executing.promise; const stopping = f.session.stop();
    expect(f.session.getState().phase).toBe('stopping');
    expect(f.executor.close).not.toHaveBeenCalled();
    settled.resolve(); await failed; await stopping;
    expect(f.executor.request.mock.calls.map(row => row[0])).not.toContain('export');
    expect(f.executor.close).toHaveBeenCalledOnce();
  });
  it('binds opt-in to the coordinator and rejects changed samples and replayed contributions', async () => {
    const f = await fixture();
    await f.session.contribute({ sample: samples[0], coordinator: 'remote-wire', consent: true });
    const request = { action: 'describe', jobId: 'job', body: {}, remoteParticipantId: 'remote', signal: new AbortController().signal };
    await expect(f.receive({ ...request, remoteParticipantId: 'stranger' })).rejects.toThrow('authorized');
    const { assignment } = await f.receive(request);
    const round = { jobId: 'job', baseManifestHash: policy.baseManifestHash, roundHash: 'r', assignments: [assignment] };
    await expect(f.receive({ ...request, action: 'contribute', body: { round: { ...round, assignments: [{ ...assignment, sampleHash: 'changed' }] } } })).rejects.toThrow('sample');
    await f.receive({ ...request, action: 'contribute', body: { round } });
    expect(f.allowed('remote')).toBe(true); // response authorization remains valid until Stop/expiry
    await expect(f.receive({ ...request, action: 'contribute', body: { round } })).rejects.toThrow('already used');
  });
  it('refuses corrupted adapter bytes and concurrent starts', async () => {
    const f = await fixture(), waiting = gate();
    const original = f.executor.request.getMockImplementation();
    f.executor.request.mockImplementation(async (action, data) => {
      const value = await original(action, data);
      if (action === 'export') { await waiting.promise; value.weights = new Uint8Array([9]).buffer; }
      return value;
    });
    const run = f.session.run(input); const failed = expect(run).rejects.toThrow('checksum');
    await expect(f.session.run(input)).rejects.toThrow('Stop');
    waiting.resolve(); await failed;
  });
});
