import { describe, it, expect } from 'vitest';
import { createInference, createSecretSharedExecution, SECRET_SHARED_STATUS } from '../../packages/reploid/src/inference/index.js';
import { SECRET_SHARED_BACKEND } from '../../packages/reploid/src/inference/contract.js';
import { compileExecutionRequirements, compileSecretSharedExecutionRequirements, executionRequirementsFor,
  SECRET_SHARED_PROTOCOL } from '../../packages/reploid/src/chat/execution-policy.js';

const hash = c => 'sha256:' + c.repeat(64);
const model = { id: 'qwen-tiny', identity: hash('a') };
const execution = (overrides = {}) => ({ protection: 'secret-sharing', route: 'auto', participants: { kind: 'open' },
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

describe('secret-sharing is off by default and never plaintext', () => {
  it('refuses the value without both the port and the unreviewed flag, before anything is sent', async () => {
    expect(() => compileExecutionRequirements(execution())).toThrow(expect.objectContaining({ code: 'CONFIDENTIAL_EXECUTION_UNAVAILABLE' }));
    const { port: ss } = port();
    for (const options of [{}, { secretSharedExecution: ss }, { unreviewedSecretSharedExecution: true }]) {
      const inference = createInference({ ...unusedPorts, ...options });
      await expect(inference.prepare({ model, execution: execution() })).rejects.toMatchObject({ code: 'CONFIDENTIAL_EXECUTION_UNAVAILABLE' });
    }
    expect(SECRET_SHARED_STATUS.available).toBe(false);
  });

  it('compiles to its own collusion model and never stands for homomorphic', () => {
    const policy = compileSecretSharedExecutionRequirements(execution());
    expect(policy).toMatchObject({ computation: 'cryptographic', collusion: 'non-colluding-share-pairs', protocol: SECRET_SHARED_PROTOCOL });
    expect(policy.leakage).not.toContain('plaintext');
    expect(executionRequirementsFor(policy).protection).toBe('secret-sharing');
    // Secret sharing takes split or auto only: no local, whole-model or requester-held-edges route.
    for (const route of ['local', 'remote', 'split-local-edges']) {
      expect(() => compileSecretSharedExecutionRequirements(execution({ route }))).toThrow(expect.objectContaining({ code: 'EXECUTION_REQUEST_INVALID',
        message: expect.stringContaining('takes route split, auto') }));
    }
    expect(compileSecretSharedExecutionRequirements(execution({ route: 'split' })).protocol).toBe(SECRET_SHARED_PROTOCOL);
  });

  it('refuses a route where one operator holds both shares of a stage', async () => {
    const { port: ss } = port({ routeValue: route([['peer:a', 'peer:a']]) });
    const inference = createInference({ ...unusedPorts, secretSharedExecution: ss, unreviewedSecretSharedExecution: true });
    await expect(inference.prepare({ model, execution: execution() })).rejects.toMatchObject({ code: 'EXECUTION_ROUTE_UNAVAILABLE' });
  });

  it('states the non-collusion assumption, names every share holder and pins the protocol in the plan', async () => {
    const { port: ss } = port();
    const inference = createInference({ ...unusedPorts, secretSharedExecution: ss, unreviewedSecretSharedExecution: true });
    const plan = await inference.prepare({ model, generation: { maxOutputTokens: 8 }, execution: execution() });
    expect(plan).toMatchObject({ protection: 'secret-sharing', routeKind: 'split', maxCharge: { kind: 'capped', unit: 'noncash-service-credit', maximum: 32 },
      route: { protocol: SECRET_SHARED_PROTOCOL, participants: ['peer:a', 'peer:b', 'peer:c', 'peer:d'] } });
    // Two share holders of the same stage, if they collude: a conditional reader, testable as data.
    const pair = { role: 'share-holder', ids: ['peer:a', 'peer:b', 'peer:c', 'peer:d'], when: { collusion: { sameStage: true, count: 2 } },
      stages: [{ stage: 0, layers: [0, 11], ids: ['peer:a', 'peer:b'] }, { stage: 1, layers: [12, 23], ids: ['peer:c', 'peer:d'] }] };
    for (const section of ['prompt', 'intermediate', 'answer']) {
      expect(plan.disclosure[section]).toMatchObject({ readers: [{ role: 'requester-device' }, pair], verified: false });
      expect(plan.disclosure[section].assumptions).toContain('share-holders-do-not-collude');
    }
    expect(plan.disclosure.intermediate.assumptions).toContain('requester-recombines-intermediates');
    // A device that holds one share is still a participant.
    expect(plan.disclosure.metadata.readers[1]).toEqual({ role: 'share-holder', selection: 'all', ids: ['peer:a', 'peer:b', 'peer:c', 'peer:d'] });
    expect(plan.disclosure.review).toEqual({ state: 'not-reviewed' });
    expect(plan.disclosure.extensions.secretSharing.sharesHeldBy).toEqual([{ stage: 0, layers: [0, 11], shareA: 'peer:a', shareB: 'peer:b' },
      { stage: 1, layers: [12, 23], shareA: 'peer:c', shareB: 'peer:d' }]);
  });

  it('a homomorphic or plaintext request never runs on a secret-shared route', async () => {
    const { port: ss } = port();
    const inference = createInference({ resolveRoute: async () => ({ ...route(), backend: SECRET_SHARED_BACKEND }), execute: async () => ({}),
      secretSharedExecution: ss, unreviewedSecretSharedExecution: true });
    await expect(inference.prepare({ model, execution: execution({ protection: 'homomorphic' }) }))
      .rejects.toMatchObject({ code: 'CONFIDENTIAL_EXECUTION_UNAVAILABLE' });
    await expect(inference.prepare({ model, execution: execution({ protection: 'plaintext' }) })).rejects.toThrow();
  });

  it('streams, admits the pinned route and writes secret-shared evidence into the receipt', async () => {
    const { port: ss, calls } = port();
    const inference = createInference({ ...unusedPorts, secretSharedExecution: ss, unreviewedSecretSharedExecution: true });
    const plan = await inference.prepare({ model, generation: { maxOutputTokens: 8 }, execution: execution() });
    const run = await inference.run({ planId: plan.id, requestId: 'q1', input: { messages: [{ role: 'user', content: 'hi' }] } });
    const result = await run.result;
    expect(result).toMatchObject({ status: 'completed', output: { text: 'Hello', stopReason: 'eos' }, settlement: { reservationId: 'r1' } });
    expect(calls[0].messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(result.executionReceipt).toMatchObject({ schema: 'reploid.execution-receipt/v2', protection: 'secret-sharing' });
    const evidence = result.executionReceipt.evidence.privacy;
    expect(evidence).toMatchObject({ protection: 'secret-sharing', routeKind: 'split', extensions: { secretSharing: { collusion: 'non-colluding-share-pairs' } } });
    expect(evidence.checks.map(row => row.claim)).toEqual(['share-recipients', 'fresh-shares-every-round']);
    expect(evidence.notVerified).toContain('non-collusion');
    // Credits are their own record, never evidence of privacy.
    expect(result.executionReceipt.evidence.credits).toMatchObject({ record: { kind: 'service-credit', reservationId: 'r1' }, checkedHere: false,
      notVerified: expect.arrayContaining(['confidentiality-from-billing']) });
    expect(result.executionReceipt.route.extensions.secretSharing.stages).toHaveLength(2);
    expect(result.executionReceipt.issuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
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
