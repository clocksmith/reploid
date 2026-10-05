import { describe, it, expect, vi } from 'vitest';
import { createDopplerOperationProvider, createDopplerProvider } from '../../packages/reploid/src/adapters/doppler.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';

const contract = { modelId: 'model', capsuleId: 'capsule', semanticRoot: `sha256:${'1'.repeat(64)}`,
  selectedTargetPlanDigest: `sha256:${'2'.repeat(64)}` };
const config = resolveConfig({ overrides: { models: { providerId: 'doppler', contract } } });
const request = () => ({ schema: 'doppler.capsule-operation-request/v1', operation: { name: 'scoreChoices', version: 1 },
  input: { prompt: 'Choose:', choices: [{ id: 'a', label: ' A' }, { id: 'b', label: ' B' }] }, options: { maxSeqLen: 16 },
  assignment: null, limits: { maxInputBytes: 4096, maxOutputBytes: 4096, deadlineAt: Date.now() + 60000 } });
const output = { schema: 'doppler.choice-scores/v1', interpretation: 'next-token-logits', calibration: null,
  choices: [{ id: 'a', label: ' A', tokenId: 1, logit: 3 }, { id: 'b', label: ' B', tokenId: 2, logit: 2 }],
  selectedId: 'a', promptTokenCount: 1 };
const runtime = { DOPPLER_VERSION: 'test', validateChoiceScoringResult: vi.fn((input, value) => {
  if (value.selectedId !== 'a') throw new Error('Doppler rejected selection');
  return value;
}) };
const identity = { capsuleId: contract.capsuleId, semanticRoot: contract.semanticRoot, envelopeDigest: `sha256:${'3'.repeat(64)}` };
const artifacts = [{ artifactId: 'model', hash: `sha256:${'4'.repeat(64)}` }];
async function eventFor(request, changes = {}) {
  const requestHash = await hashDopplerEvidence(request);
  const payload = { schema: 'doppler.capsule-operation-receipt/v1', capsule: identity, modelId: contract.modelId,
    targetPlanDigest: contract.selectedTargetPlanDigest, runtimeVersion: runtime.DOPPLER_VERSION, artifactReceipts: artifacts,
    operation: request.operation, requestHash, assignmentHash: null,
    inputHash: await hashDopplerEvidence({ input: request.input, options: request.options }),
    outputHash: await hashDopplerEvidence(output), ...changes };
  const receipt = { ...payload, receiptDigest: await hashDopplerEvidence(payload) };
  const event = { schema: 'doppler.capsule-operation-event/v1', operation: request.operation, requestHash, assignmentHash: null,
    eventIndex: 0, previousEventDigest: null, status: 'completed', output, receipt };
  return { ...event, eventDigest: await hashDopplerEvidence(event) };
}
const sessionFor = execute => ({ ...contract, capsuleIdentity: identity, verification: { artifactReceipts: artifacts },
  executeOperation: execute ?? (async function* (request) { yield await eventFor(request); }), close: vi.fn(async () => {}) });

describe('public Doppler operation provider', () => {
  it('chat closure also waits for submitted generation to settle before releasing an owned session', async () => {
    let begin, release;
    const began = new Promise(resolve => { begin = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const session = { ...sessionFor(), async generateText() { begin(); await gate; return { text: 'late output' }; } };
    const provider = createDopplerProvider({ config, session, ownership: 'owned',
      toGenerationRequest: () => ({ prompt: 'hello' }) });
    const pending = provider.generate([{ role: 'user', content: 'hello' }]);
    const failed = expect(pending).rejects.toThrow(/closed/);
    await began;
    const closing = provider.close();
    expect(provider.close()).toBe(closing);
    expect(session.close).not.toHaveBeenCalled();
    release(); await failed; await closing;
    expect(session.close).toHaveBeenCalledOnce();
  });
  it('returns verified typed output and delegates decision validation to Doppler', async () => {
    const session = sessionFor();
    const provider = createDopplerOperationProvider({ config, session, ownership: 'borrowed', runtime });
    const result = await provider.execute(request());
    expect(result.output).toEqual(output);
    expect(result.evidence.receipt.operation.name).toBe('scoreChoices');
    expect(runtime.validateChoiceScoringResult).toHaveBeenCalled();
    await provider.close();
    expect(session.close).not.toHaveBeenCalled();
  });
  it('rejects corrupt delivery and wrong execution identity', async () => {
    for (const changed of [{ modelId: 'another-model' }, { capsule: { ...identity, envelopeDigest: 'changed' } },
      { artifactReceipts: [] }]) {
      const provider = createDopplerOperationProvider({ config, ownership: 'borrowed', runtime,
        session: sessionFor(async function* (request) { yield await eventFor(request, changed); }) });
      await expect(provider.execute(request())).rejects.toThrow(/identity mismatch/);
      await provider.close();
    }
    const provider = createDopplerOperationProvider({ config, ownership: 'borrowed', runtime,
      session: sessionFor(async function* (request) { const event = await eventFor(request); event.output = { ...output, selectedId: 'b' }; yield event; }) });
    await expect(provider.execute(request())).rejects.toThrow(/digest mismatch/);
    await provider.close();
  });
  it('snapshots input and rejects unsupported runtimes before execution', async () => {
    let observed;
    const execute = vi.fn(async function* (request) { observed = request; yield await eventFor(request); });
    const provider = createDopplerOperationProvider({ config, session: sessionFor(execute), ownership: 'borrowed', runtime });
    const input = request();
    const pending = provider.execute(input);
    input.input.prompt = 'mutated'; input.input.choices[0].label = 'mutated';
    await pending;
    expect(observed.input.prompt).toBe('Choose:');
    expect(observed.input.choices[0].label).toBe(' A');
    await provider.close();
    execute.mockClear();
    const unsupported = createDopplerOperationProvider({ config, session: sessionFor(execute), ownership: 'borrowed',
      runtime: { DOPPLER_VERSION: 'old' } });
    await expect(unsupported.execute(request())).rejects.toThrow(/no choice-scoring contract/);
    expect(execute).not.toHaveBeenCalled();
    await unsupported.close();
  });
  it('settles active work before closing an owned session and closes once', async () => {
    let begin, release;
    const began = new Promise(resolve => { begin = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const session = sessionFor(async function* (request, { signal }) {
      begin(); await gate; signal.throwIfAborted(); yield await eventFor(request);
    });
    const provider = createDopplerOperationProvider({ config, session, ownership: 'owned', runtime });
    const pending = provider.execute(request());
    const failed = expect(pending).rejects.toThrow(/closed/);
    await began;
    const closing = provider.close();
    expect(provider.close()).toBe(closing);
    expect(session.close).not.toHaveBeenCalled();
    release(); await failed; await closing;
    expect(session.close).toHaveBeenCalledOnce();
    await expect(provider.execute(request())).rejects.toThrow(/closed/);
  });
});
