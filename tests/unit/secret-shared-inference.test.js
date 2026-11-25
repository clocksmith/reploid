import { describe, it, expect } from 'vitest';
import { createInference, createSecretSharedExecution, SECRET_SHARED_STATUS } from '../../packages/reploid/src/inference/index.js';
import { SECRET_SHARED_BACKEND } from '../../packages/reploid/src/inference/contract.js';
import { compileExecutionRequirements, compileSecretSharedExecutionRequirements, executionRequirementsFor,
  SECRET_SHARED_PROTOCOL } from '../../packages/reploid/src/chat/execution-policy.js';

const hash = c => 'sha256:' + c.repeat(64);
const model = { id: 'qwen-tiny', identity: hash('a') };
const execution = (overrides = {}) => ({ placement: 'network-allowed', participants: { kind: 'open' }, confidentiality: 'secret-shared-2party',
  allowMetadata: ['model-id', 'timing', 'length'], ...overrides });
const route = (stages = [['peer:a', 'peer:b'], ['peer:c', 'peer:d']]) => ({ id: 'route-1', shape: 'split', selection: 'all',
  backend: SECRET_SHARED_BACKEND, protocol: SECRET_SHARED_PROTOCOL, model: { ...model, adapterIdentities: [] }, planIdentity: hash('p'),
  participants: [...new Set(stages.flat())].sort(),
  secretShared: { stages: stages.map((shares, index) => ({ index, layers: [index * 12, index * 12 + 11], shares })) } });
const unusedPorts = { resolveRoute: async () => { throw Error('not reached'); }, execute: async () => { throw Error('not reached'); } };

function port({ routeValue = route(), outcome = null } = {}) {
  const calls = [];
  return { calls, port: createSecretSharedExecution({
    resolve: async () => ({ route: routeValue, maxCharge: { unit: 'noncash-service-credit', maximum: 32 } }),
    async execute(job) {
      calls.push(job);
      job.onAdmitted({ bindingDigest: hash('b') });
      for (const piece of ['Hel', 'lo']) job.onDelta(piece);
      return outcome ?? { text: 'Hello', stopReason: 'eos', usage: { inputTokens: 5, outputTokens: 2 }, settlement: { reservationId: 'r1' },
        evidence: { freshness: { rounds: 194, distinctShareBDigests: 194, countersStrictlyIncreasing: true } } };
    } }) };
}

describe('secret-shared-2party is off by default and never readable', () => {
  it('refuses the value without both the port and the unreviewed flag, before anything is sent', async () => {
    expect(() => compileExecutionRequirements(execution())).toThrow(expect.objectContaining({ code: 'CONFIDENTIAL_EXECUTION_UNAVAILABLE' }));
    const { port: ss } = port();
    for (const options of [{}, { secretSharedExecution: ss }, { unreviewedSecretSharedExecution: true }]) {
      const inference = createInference({ ...unusedPorts, ...options });
      await expect(inference.prepare({ model, execution: execution() })).rejects.toMatchObject({ code: 'CONFIDENTIAL_EXECUTION_UNAVAILABLE' });
    }
    expect(SECRET_SHARED_STATUS.available).toBe(false);
  });

  it('compiles to its own collusion model and never stands for requester-only', () => {
    const policy = compileSecretSharedExecutionRequirements(execution());
    expect(policy).toMatchObject({ computation: 'cryptographic', collusion: 'non-colluding-share-pairs', protocol: SECRET_SHARED_PROTOCOL });
    expect(policy.leakage).not.toContain('plaintext');
    expect(executionRequirementsFor(policy).confidentiality).toBe('secret-shared-2party');
    expect(() => compileSecretSharedExecutionRequirements(execution({ placement: 'local-only', participants: { kind: 'none' } })))
      .toThrow(expect.objectContaining({ code: 'EXECUTION_ROUTE_UNAVAILABLE' }));
  });

  it('refuses a route where one operator holds both shares of a stage', async () => {
    const { port: ss } = port({ routeValue: route([['peer:a', 'peer:a']]) });
    const inference = createInference({ ...unusedPorts, secretSharedExecution: ss, unreviewedSecretSharedExecution: true });
    await expect(inference.prepare({ model, execution: execution() })).rejects.toMatchObject({ code: 'EXECUTION_ROUTE_UNAVAILABLE' });
  });

  it('states the non-collusion assumption and keeps "nobody can read it" a target', async () => {
    const { port: ss } = port();
    const inference = createInference({ ...unusedPorts, secretSharedExecution: ss, unreviewedSecretSharedExecution: true });
    const plan = await inference.prepare({ model, generation: { maxOutputTokens: 8 }, execution: execution() });
    expect(plan.disclosures.contentReadableBy).toMatchObject({ requesterDevice: true, participants: [], target: true });
    expect(plan.disclosures.executorsReadContent).toBe(false);
    expect(plan.disclosures.sharesHeldBy).toEqual([{ stage: 0, layers: [0, 11], shareA: 'peer:a', shareB: 'peer:b' },
      { stage: 1, layers: [12, 23], shareA: 'peer:c', shareB: 'peer:d' }]);
    expect(plan.disclosures.statement).toMatch(/do not collude/);
    expect(plan.disclosures.statement).toMatch(/"Nobody can read it" remains a target/);
    expect(plan.disclosures.collusion.ifBroken[0].together).toEqual(['peer:a', 'peer:b']);
  });

  it('a requester-only or readable request never runs on a secret-shared route', async () => {
    const { port: ss } = port();
    const inference = createInference({ resolveRoute: async () => ({ ...route(), backend: SECRET_SHARED_BACKEND }), execute: async () => ({}),
      secretSharedExecution: ss, unreviewedSecretSharedExecution: true });
    await expect(inference.prepare({ model, execution: execution({ confidentiality: 'requester-only' }) }))
      .rejects.toMatchObject({ code: 'CONFIDENTIAL_EXECUTION_UNAVAILABLE' });
    await expect(inference.prepare({ model, execution: execution({ confidentiality: 'executor-readable' }) })).rejects.toThrow();
  });

  it('streams, admits the pinned route and writes secret-shared evidence into the receipt', async () => {
    const { port: ss, calls } = port();
    const inference = createInference({ ...unusedPorts, secretSharedExecution: ss, unreviewedSecretSharedExecution: true });
    const plan = await inference.prepare({ model, generation: { maxOutputTokens: 8 }, execution: execution() });
    const run = await inference.run({ planId: plan.id, requestId: 'q1', input: { messages: [{ role: 'user', content: 'hi' }] } });
    const result = await run.result;
    expect(result).toMatchObject({ status: 'completed', output: { text: 'Hello', stopReason: 'eos' }, settlement: { reservationId: 'r1' } });
    expect(calls[0].messages).toEqual([{ role: 'user', content: 'hi' }]);
    const evidence = result.executionReceipt.evidence.confidentiality;
    expect(evidence).toMatchObject({ mode: 'secret-shared-2party', assumption: 'non-colluding-share-pairs' });
    expect(evidence.verified.map(row => row.claim)).toEqual(['share-recipients', 'fresh-shares-every-round']);
    expect(evidence.notVerified).toContain('non-collusion');
    expect(result.executionReceipt.route.secretShared.stages).toHaveLength(2);
  });

  it('a stopped answer is cancelled with its partial text; text that differs from the stream is unverified', async () => {
    const stopped = port({ outcome: { text: 'Hello', stopReason: 'requester-stop', usage: { inputTokens: 5, outputTokens: 2 } } });
    let inference = createInference({ ...unusedPorts, secretSharedExecution: stopped.port, unreviewedSecretSharedExecution: true });
    let plan = await inference.prepare({ model, execution: execution() });
    expect(await (await inference.run({ planId: plan.id, requestId: 'q2', input: { messages: [{ role: 'user', content: 'hi' }] } })).result)
      .toMatchObject({ status: 'cancelled', output: { text: 'Hello', finishReason: 'stop' } });
    const forged = port({ outcome: { text: 'Goodbye', stopReason: 'eos' } });
    inference = createInference({ ...unusedPorts, secretSharedExecution: forged.port, unreviewedSecretSharedExecution: true });
    plan = await inference.prepare({ model, execution: execution() });
    expect(await (await inference.run({ planId: plan.id, requestId: 'q3', input: { messages: [{ role: 'user', content: 'hi' }] } })).result)
      .toMatchObject({ status: 'failed', output: null, error: { code: 'RESULT_UNVERIFIED' } });
  });
});
