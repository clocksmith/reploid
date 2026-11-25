// @vitest-environment node
/**
 * `confidentiality: "attested-execution"` through `reploid/inference` with synthetic evidence: off by default,
 * distinct from requester-only, verified before disclosure, and answered with the same result and receipt shape as
 * ordinary answers (model identity and a charge in Reploid credits).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createInference, ATTESTED_EXECUTION_STATUS, createAttestedExecution } from '../../packages/reploid/src/inference/index.js';
import { compileExecutionRequirements, executionRequirementsFor } from '../../packages/reploid/src/chat/execution-policy.js';
import { serveAttestedSession, createAttestedChannelPair } from '../../packages/reploid/src/inference/attested/session.js';
import { createSyntheticWorld, syntheticHost, SYNTHETIC_MODEL } from '../helpers/attested-gpu-fixtures.js';
import { parseExecutionExtension, EXECUTION_ERROR_STATUS } from '../../server/text-request-options.js';
import { pilotLedger, taskMessages, scoreAnswer, libraryMediaType } from '../../scripts/attested-gpu-pilot.js';
import task from '../fixtures/attested-gpu/build-diagnosis-task.json' with { type: 'json' };

const ALL = ['model-id', 'timing', 'length', 'access-patterns'];
const execution = (overrides = {}) => ({ placement: 'network-allowed', participants: { kind: 'open' }, confidentiality: 'attested-execution', allowMetadata: ALL, ...overrides });
const model = { ...SYNTHETIC_MODEL, adapterIdentities: [] };
const unused = () => { throw new Error('plaintext port must not run'); };

let world;
beforeAll(async () => { world = await createSyntheticWorld(); }, 60000);

function setup({ faults = {}, platform = 'intel-tdx', credits = null, price = 2, enabled = true, offers = null } = {}) {
  const record = {}, sessions = [];
  const offer = { schema: 'reploid.attested-gpu-offer/v1', participantId: 'peer:attested-synthetic', platform,
    launchId: platform === 'intel-tdx' ? 'synthetic-tdx-27b' : 'synthetic-snp-27b', model: SYNTHETIC_MODEL, operator: 'synthetic cloud (test only)',
    price: { unit: 'noncash-service-credit', creditsPerOutputToken: price } };
  const attestedExecution = createAttestedExecution({ policy: world.policy, now: () => world.now, credits, unreviewedAttestedExecution: true,
    discover: async () => offers ?? [{ endpoint: 'memory', offer }],
    connect: async () => {
      const [requester, host] = createAttestedChannelPair();
      sessions.push(serveAttestedSession({ channel: host, host: syntheticHost(world, { platform, faults, record }), now: () => world.now }));
      return requester;
    } });
  const inference = createInference({ resolveRoute: unused, execute: unused, now: () => world.now, ...(enabled ? { attestedExecution, unreviewedAttestedExecution: true } : {}) });
  return { inference, record, sessions, attestedExecution };
}
async function runOnce(inference, { messages = taskMessages(task), maxOutputTokens = 256, exec = execution() } = {}) {
  const plan = await inference.prepare({ model, generation: { maxOutputTokens }, execution: exec });
  const run = await inference.run({ planId: plan.id, requestId: 'req-1', input: { messages } });
  const events = [];
  for await (const event of run.events) events.push(event);
  return { plan, events, result: await run.result };
}

describe('attested execution is off by default and distinct', () => {
  it('refuses attested-execution everywhere the route is not enabled', async () => {
    expect(ATTESTED_EXECUTION_STATUS.available).toBe(false);
    expect(() => compileExecutionRequirements(execution())).toThrow(expect.objectContaining({ code: 'ATTESTED_EXECUTION_UNAVAILABLE' }));
    const off = setup({ enabled: false });
    await expect(off.inference.prepare({ model, generation: { maxOutputTokens: 8 }, execution: execution() }))
      .rejects.toMatchObject({ code: 'ATTESTED_EXECUTION_UNAVAILABLE' });
    const halfOn = createInference({ resolveRoute: unused, execute: unused, attestedExecution: off.attestedExecution });
    await expect(halfOn.prepare({ model, generation: { maxOutputTokens: 8 }, execution: execution() })).rejects.toMatchObject({ code: 'ATTESTED_EXECUTION_UNAVAILABLE' });
    expect(() => parseExecutionExtension({ execution: execution() })).toThrow(expect.objectContaining({ code: 'ATTESTED_EXECUTION_UNAVAILABLE', status: 422 }));
    expect(EXECUTION_ERROR_STATUS.ATTESTATION_REJECTED).toBe(422);
  });

  it('the port itself refuses without its own flag, before discovery or a connection', async () => {
    const discover = vi.fn(async () => []), connect = vi.fn();
    const port = createAttestedExecution({ policy: world.policy, discover, connect });
    const request = { model, generation: { maxOutputTokens: 8 }, execution: execution() };
    await expect(port.resolve(request)).rejects.toMatchObject({ code: 'ATTESTED_EXECUTION_UNAVAILABLE' });
    await expect(port.execute({ plan: {}, pinned: {}, requestId: 'r', messages: [{ role: 'user', content: 'SENSITIVE' }] }))
      .rejects.toMatchObject({ code: 'ATTESTED_EXECUTION_UNAVAILABLE' });
    // The inference flag alone does not open a port that was built without its own.
    const inference = createInference({ resolveRoute: unused, execute: unused, attestedExecution: port, unreviewedAttestedExecution: true });
    await expect(inference.prepare(request)).rejects.toMatchObject({ code: 'ATTESTED_EXECUTION_UNAVAILABLE' });
    expect(discover).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it('a plan without its pinned executor is refused, and the prompt never reaches the readable port', async () => {
    const { attestedExecution } = setup();
    const execute = vi.fn(async () => ({})), resolveRoute = vi.fn();
    // A port that returns the route but not the executor it pinned (a host wrapper or a bug).
    const unpinned = { ...attestedExecution, resolve: async (...args) => { const { pinned, ...rest } = await attestedExecution.resolve(...args); return rest; } };
    const inference = createInference({ resolveRoute, execute, now: () => world.now, attestedExecution: unpinned, unreviewedAttestedExecution: true });
    const plan = await inference.prepare({ model, generation: { maxOutputTokens: 8 }, execution: execution() });
    await expect(inference.run({ planId: plan.id, requestId: 'req-unpinned', input: { messages: [{ role: 'user', content: 'SENSITIVE' }] } }))
      .rejects.toMatchObject({ code: 'EXECUTION_PLAN_CHANGED' });
    expect(execute).not.toHaveBeenCalled();
    expect(resolveRoute).not.toHaveBeenCalled();
  });

  it('never satisfies requester-only, even with the attested route enabled', async () => {
    const { inference, record } = setup();
    await expect(inference.prepare({ model, generation: { maxOutputTokens: 8 }, execution: execution({ confidentiality: 'requester-only', allowMetadata: ['model-id', 'timing', 'length'] }) }))
      .rejects.toMatchObject({ code: 'CONFIDENTIAL_EXECUTION_UNAVAILABLE' });
    expect(record.messages).toBeUndefined();
  });

  it('requires network placement, all four disclosed metadata names and an output ceiling', async () => {
    const { inference } = setup();
    await expect(inference.prepare({ model, generation: { maxOutputTokens: 8 }, execution: execution({ allowMetadata: ['model-id', 'timing', 'length'] }) }))
      .rejects.toMatchObject({ code: 'LEAKAGE_NOT_ALLOWED' });
    await expect(inference.prepare({ model, execution: execution() })).rejects.toMatchObject({ code: 'EXECUTION_REQUEST_INVALID' });
    await expect(inference.prepare({ model, generation: { maxOutputTokens: 8 }, execution: execution({ placement: 'local-only', participants: { kind: 'none' } }) }))
      .rejects.toMatchObject({ code: 'EXECUTION_ROUTE_UNAVAILABLE' });
  });

  it('only routes to offers on the requester\'s own allowlist and price ceiling', async () => {
    const offer = { schema: 'reploid.attested-gpu-offer/v1', participantId: 'peer:x', platform: 'intel-tdx', launchId: 'not-approved', model: SYNTHETIC_MODEL,
      operator: 'o', price: { unit: 'noncash-service-credit', creditsPerOutputToken: 1 } };
    for (const offers of [[{ endpoint: 'e', offer }], [{ endpoint: 'e', offer: { ...offer, launchId: 'synthetic-tdx-27b', price: { ...offer.price, creditsPerOutputToken: 99 } } }]]) {
      await expect(setup({ offers }).inference.prepare({ model, generation: { maxOutputTokens: 8 }, execution: execution() }))
        .rejects.toMatchObject({ code: 'EXECUTION_ROUTE_UNAVAILABLE' });
    }
  });
});

describe('the pilot requester page', () => {
  it('serves the library\'s JSON modules as JSON, which a browser requires before it loads them', () => {
    // inference/index.js reaches contracts/partition.js, which imports transport/partition-errors.json as a JSON module.
    expect(libraryMediaType('/lib/transport/partition-errors.json')).toBe('application/json');
    expect(libraryMediaType('/lib/inference/index.js')).toBe('text/javascript');
  });
});

describe('an attested run', () => {
  it('discloses the trust boundary, then answers with the model and a credit charge on the ordinary receipt shape', async () => {
    const ledger = pilotLedger(1000);
    const { inference, record } = setup({ credits: ledger.ports, faults: { answer: 'readSettings replaces loadSettings; EXPORT_DIR may be undefined; currency usd is lower case.' } });
    const { plan, events, result } = await runOnce(inference);
    expect(plan.disclosures).toMatchObject({ operatorReadsContent: false, executorsReadContent: true, metadata: ALL,
      target: { statement: 'Nobody can read it', status: 'a target, not claimed' }, performance: { claimed: false } });
    expect(plan.disclosures.trustBoundary.outside[0]).toMatch(/cloud operator/);
    expect(plan.disclosures.trustBoundary.trusted[0]).toMatch(/NVIDIA, and AMD or Intel/);
    expect(plan.maxCharge).toEqual({ maximum: 512, unit: 'noncash-service-credit' });
    expect(events.map(event => event.type)).toEqual(['admitted', ...events.slice(1, -1).map(() => 'output.delta'), 'completed']);
    expect(record.messages[0].content).toContain('=== Build log ===');
    expect(result.status).toBe('completed');
    expect(result.settlement).toMatchObject({ unit: 'noncash-service-credit', charge: result.usage.outputTokens * 2, status: 'settled-in-pilot-ledger' });
    expect(ledger.state.balance).toBe(1000 - result.settlement.charge);
    const receipt = result.executionReceipt;
    expect(receipt).toMatchObject({ schema: 'reploid.execution-receipt/v1', requested: { model, execution: execution() },
      route: { backend: 'attested-gpu/v1', protocol: 'reploid.attested-gpu/v1', attested: { launchId: 'synthetic-tdx-27b', platform: 'intel-tdx' } } });
    expect(receipt.evidence.confidentiality.mode).toBe('attested-execution');
    expect(receipt.evidence.confidentiality.verified.map(item => item.claim)).toEqual(['requester-nonce', 'cpu-confidential-vm', 'gpu-confidential-computing',
      'approved-launch', 'session-key-binding', 'sealed-to-attested-key']);
    expect(receipt.evidence.confidentiality.notVerified).toEqual(expect.arrayContaining(['hardware-vendor-attestation-soundness', 'side-channels', 'independent-security-review']));
    expect(receipt.evidence.timing).toMatchObject({ measuredBy: 'requester' });
    expect(scoreAnswer(task, result.output.text).passedKeywords).toBe(true);
  });

  it('a failed proof sends no prompt, holds no credits and returns no output', async () => {
    const ledger = pilotLedger(1000);
    const { inference, record, sessions } = setup({ credits: ledger.ports, faults: { ccMode: 'off' } });
    const { result, events } = await runOnce(inference);
    expect(result).toMatchObject({ status: 'failed', output: null, settlement: null, error: { code: 'ATTESTATION_REJECTED' } });
    expect(events.map(event => event.type)).toEqual(['failed']);
    expect(record.messages).toBeUndefined();
    expect((await Promise.all(sessions))[0].outcome).toBe('aborted');
    expect(ledger.state.log).toEqual([]);
    expect(result.executionReceipt.evidence.confidentiality.verified).toEqual([]);
  });

  it('releases the credit hold when the runtime fails after binding', async () => {
    const ledger = pilotLedger(1000);
    const { inference } = setup({ credits: ledger.ports, faults: { failRuntime: true } });
    const { result } = await runOnce(inference);
    expect(result).toMatchObject({ status: 'failed', output: null, error: { code: 'ATTESTED_RUNTIME_FAILED' } });
    expect(ledger.state.balance).toBe(1000);
    expect(ledger.state.log.map(entry => Object.keys(entry)[0])).toEqual(['hold', 'released']);
  });

  it('refuses an answer whose token counts are negative, and charges nothing', async () => {
    const ledger = pilotLedger(1000);
    const { inference } = setup({ credits: ledger.ports, faults: { usage: { inputTokens: 812, outputTokens: -40 } } });
    const { result } = await runOnce(inference);
    expect(result).toMatchObject({ status: 'failed', output: null, settlement: null, error: { code: 'ATTESTED_PROTOCOL_VIOLATION' } });
    expect(ledger.state.balance).toBe(1000);
    expect(ledger.state.log.map(entry => Object.keys(entry)[0])).toEqual(['hold', 'released']);
  });

  it('refuses to hold more credits than the account has, before the prompt is sealed', async () => {
    const ledger = pilotLedger(10);
    const { inference, record } = setup({ credits: ledger.ports });
    const { result } = await runOnce(inference);
    expect(result).toMatchObject({ status: 'failed', error: { code: 'CREDIT_INSUFFICIENT' } });
    expect(record.messages).toBeUndefined();
  });

  it('a stored attested policy maps back to attested-execution, never to requester-only', async () => {
    const { inference } = setup();
    const { result } = await runOnce(inference, { maxOutputTokens: 64 });
    expect(result.status).toBe('completed');
    const { policyId } = result.executionReceipt.requested;
    expect(policyId).toMatch(/^sha256:/);
    const { compileAttestedExecutionRequirements } = await import('../../packages/reploid/src/chat/execution-policy.js');
    const policy = compileAttestedExecutionRequirements(execution(), 'reploid.attested-gpu/v1', 'sha256:' + 'a'.repeat(64));
    expect(policy).toMatchObject({ computation: 'attested', collusion: 'none' });
    expect(executionRequirementsFor(policy).confidentiality).toBe('attested-execution');
  });
});
