/**
 * `execution.protection`, `topology` and `listCapabilities` in reploid/inference: refusals before disclosure, no
 * downgrade, complete disclosures and idempotent runs. Injected ports; no physical inference.
 */
import { describe, it, expect, vi } from 'vitest';
import { createInference, createSecretSharedExecution, assertDisclosureComplete, PROTECTIONS, PROTECTION_DISPLAY, PROTECTION_ROUTES,
  gatedCapabilities, describeDisclosure, SECRET_SHARED_BACKEND } from '../../packages/reploid/src/inference/index.js';

const hash = c => 'sha256:' + c.repeat(64);
const model = { id: 'tiny', identity: hash('a') };
const ALL = ['model-id', 'timing', 'length', 'access-patterns'];
const execution = (overrides = {}) => ({ protection: 'plaintext', route: 'auto', participants: { kind: 'open' }, allowMetadata: ALL, ...overrides });
const remote = { shape: 'remote', backend: 'doppler-plaintext/v1', participants: ['peer:b'], selection: 'one-of', maxCharge: { kind: 'capped', maximum: 10, unit: 'credit' } };
const messages = [{ role: 'user', content: 'secret prompt' }];

async function admitted(job, controls) {
  const { bindExecutionRoute, plaintextExecutionRoute } = await import('../../packages/reploid/src/chat/execution-policy.js');
  const request = { model: { id: model.id, identity: model.identity }, privacy: job.policy };
  const privacyBinding = await bindExecutionRoute(request, plaintextExecutionRoute(request, { recipients: ['peer:b'] }));
  if (!await controls.requestApproval({ privacyBinding })) throw Error('declined');
  controls.onDelta({ text: 'ok' });
  return { content: 'ok', modelId: model.id, modelIdentity: model.identity, serviceCredit: { charged: 3, released: 7 } };
}

function secretShared() {
  return createSecretSharedExecution({
    resolve: async () => ({ route: { id: 'r', shape: 'split', selection: 'all', backend: SECRET_SHARED_BACKEND, protocol: 'reploid.secret-shared-2party/v1',
      model: { ...model, adapterIdentities: [] }, planIdentity: hash('p'), participants: ['peer:a', 'peer:b'],
      secretShared: { stages: [{ index: 0, layers: [0, 11], shares: ['peer:a', 'peer:b'] }] } }, maxCharge: { kind: 'free' } }),
    execute: async () => { throw Error('not reached'); } });
}

describe('protection refusals happen before anything is resolved or sent', () => {
  it('refuses attested on every host, even with every unreviewed route enabled', async () => {
    const resolveRoute = vi.fn(), execute = vi.fn();
    const inference = createInference({ resolveRoute, execute, secretSharedExecution: secretShared(), unreviewedSecretSharedExecution: true });
    for (const route of ['auto', 'remote']) {
      await expect(inference.prepare({ model, execution: execution({ protection: 'attested', route }) }))
        .rejects.toMatchObject({ code: 'CONFIDENTIAL_EXECUTION_UNAVAILABLE', message: expect.stringMatching(/Verified hardware is unavailable/),
          reason: expect.stringMatching(/no attested route is enabled/) });
    }
    expect(resolveRoute).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses homomorphic and secret-sharing where their routes are off, and requires protection and route', async () => {
    const resolveRoute = vi.fn(), execute = vi.fn();
    const inference = createInference({ resolveRoute, execute });
    for (const protection of ['homomorphic', 'secret-sharing']) {
      await expect(inference.prepare({ model, execution: execution({ protection }) })).rejects.toMatchObject({ code: 'CONFIDENTIAL_EXECUTION_UNAVAILABLE' });
    }
    const { protection: _p, ...noProtection } = execution();
    const { route: _t, ...noRoute } = execution();
    for (const bad of [noProtection, noRoute, { ...execution(), confidentiality: 'executor-readable' }, { ...execution(), placement: 'network-allowed' }]) {
      await expect(inference.prepare({ model, execution: bad })).rejects.toMatchObject({ code: 'EXECUTION_REQUEST_INVALID' });
    }
    // prepare takes no prompt.
    await expect(inference.prepare({ model, execution: execution(), messages })).rejects.toMatchObject({ code: 'EXECUTION_REQUEST_INVALID' });
    expect(resolveRoute).not.toHaveBeenCalled();
  });
});

describe('never downgrade', () => {
  it('a protected request never falls back to a plaintext route, and a plaintext request never takes a protected one', async () => {
    const resolveRoute = vi.fn(async () => remote), execute = vi.fn();
    const failing = createSecretSharedExecution({ resolve: async () => { throw Object.assign(Error('no operators'), { code: 'EXECUTION_ROUTE_UNAVAILABLE' }); },
      execute });
    const inference = createInference({ resolveRoute, execute, secretSharedExecution: failing, unreviewedSecretSharedExecution: true });
    await expect(inference.prepare({ model, execution: execution({ protection: 'secret-sharing', allowMetadata: ['model-id', 'timing', 'length'] }) }))
      .rejects.toMatchObject({ code: 'EXECUTION_ROUTE_UNAVAILABLE' });
    expect(resolveRoute).not.toHaveBeenCalled();
    const offered = createInference({ resolveRoute: async () => ({ ...remote, backend: SECRET_SHARED_BACKEND }), execute });
    await expect(offered.prepare({ model, execution: execution() })).rejects.toMatchObject({ code: 'EXECUTION_ROUTE_UNAVAILABLE' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('holds an explicit route exactly, and refuses at run when the route or its charge changed after the plan', async () => {
    let candidate = remote;
    const execute = vi.fn(admitted);
    const inference = createInference({ resolveRoute: async () => candidate, execute });
    await expect(inference.prepare({ model, execution: execution({ route: 'split' }) })).rejects.toMatchObject({ code: 'EXECUTION_ROUTE_UNAVAILABLE' });
    const plan = await inference.prepare({ model, execution: execution({ route: 'remote' }) });
    expect(plan).toMatchObject({ protection: 'plaintext', routeKind: 'remote', maxCharge: { kind: 'capped', maximum: 10, unit: 'credit' } });
    expect(plan.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    candidate = { ...remote, participants: ['peer:c'] };
    await expect(inference.run({ planId: plan.id, requestId: 'changed', input: { messages } })).rejects.toMatchObject({ code: 'EXECUTION_PLAN_CHANGED' });
    candidate = { ...remote, maxCharge: { kind: 'capped', maximum: 11, unit: 'credit' } };
    const again = await inference.prepare({ model, execution: execution() });
    candidate = { ...remote, maxCharge: { kind: 'capped', maximum: 12, unit: 'credit' } };
    await expect(inference.run({ planId: again.id, requestId: 'pricier', input: { messages } })).rejects.toMatchObject({ code: 'EXECUTION_PLAN_CHANGED' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('never plans a network route whose charge it cannot cap; a local route is free', async () => {
    const { maxCharge: _m, ...uncapped } = remote;
    await expect(createInference({ resolveRoute: async () => uncapped, execute: vi.fn() }).prepare({ model, execution: execution() }))
      .rejects.toMatchObject({ code: 'EXECUTION_ROUTE_UNAVAILABLE', message: expect.stringMatching(/cannot be capped/) });
    const local = await createInference({ resolveRoute: async () => ({ shape: 'local', backend: 'doppler-plaintext/v1' }), execute: vi.fn() })
      .prepare({ model, execution: { protection: 'plaintext', route: 'local', allowMetadata: [] } });
    expect(local).toMatchObject({ routeKind: 'local', maxCharge: { kind: 'free' } });
    // A free plan that turns out to charge is refused at run.
    let candidate = { ...remote, maxCharge: { kind: 'free' } };
    const execute = vi.fn(admitted);
    const inference = createInference({ resolveRoute: async () => candidate, execute });
    const plan = await inference.prepare({ model, execution: execution() });
    candidate = remote;
    await expect(inference.run({ planId: plan.id, requestId: 'free', input: { messages } })).rejects.toMatchObject({ code: 'EXECUTION_PLAN_CHANGED' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('auto never chooses requester-held edges, and records the concrete route it chose', async () => {
    const split = { shape: 'split', backend: 'doppler-partition-plaintext/v1', participants: ['peer:a', 'peer:b'], selection: 'all', maxCharge: { kind: 'free' } };
    const plan = await createInference({ resolveRoute: async () => split, execute: vi.fn() }).prepare({ model, execution: execution() });
    expect(plan.routeKind).toBe('split');
    // Under plaintext, auto may widen who reads the message by choosing a split: the plan names every reader first.
    expect(plan.disclosure.prompt.readers).toEqual([{ role: 'requester-device' }, { role: 'stage-operator', selection: 'all', ids: ['peer:a', 'peer:b'] }]);
    const edges = { ...split, backend: 'doppler-partition-edges/v1', participants: ['a', 'm', 'z'], edgeParticipants: ['a', 'z'] };
    await expect(createInference({ resolveRoute: async () => edges, requesterDevices: () => ['a', 'z'], execute: vi.fn() }).prepare({ model, execution: execution() }))
      .rejects.toMatchObject({ code: 'EXECUTION_ROUTE_UNAVAILABLE' });
  });
});

describe('disclosure', () => {
  it('names readers for the prompt, intermediate state, answer and metadata, never an empty list', async () => {
    for (const candidate of [{ shape: 'local', backend: 'doppler-plaintext/v1' }, remote,
      { shape: 'remote', backend: 'doppler-plaintext/v1', selection: 'any-eligible', maxCharge: { kind: 'free' } }]) {
      const requested = candidate.shape === 'local' ? { protection: 'plaintext', route: 'local', allowMetadata: ALL } : execution();
      const plan = await createInference({ resolveRoute: async () => candidate, execute: vi.fn() }).prepare({ model, execution: requested });
      for (const section of ['prompt', 'intermediate', 'answer', 'metadata']) {
        expect(plan.disclosure[section].readers.length).toBeGreaterThan(0);
        expect(plan.disclosure[section].readers[0]).toEqual({ role: 'requester-device' });
        expect(typeof plan.disclosure[section].verified).toBe('boolean');
      }
      expect(plan.disclosure.review).toEqual({ state: 'not-applicable' });
    }
    const plan = await createInference({ resolveRoute: async () => remote, execute: vi.fn() }).prepare({ model, execution: execution() });
    expect(plan.disclosure.prompt.readers[1]).toEqual({ role: 'answering-computer', selection: 'one-of', ids: ['peer:b'] });
    expect(plan.disclosure.prompt.assumptions).toEqual(['recipient-conduct-unchecked']);
    expect(plan.disclosure.metadata.items).toEqual(ALL);
    const empty = structuredClone(plan.disclosure);
    empty.intermediate.readers = [];
    expect(() => assertDisclosureComplete(empty)).toThrow(expect.objectContaining({ code: 'EXECUTION_ROUTE_UNAVAILABLE' }));
    expect(() => assertDisclosureComplete({ ...plan.disclosure, answer: { ...plan.disclosure.answer, readers: 'unknown' } })).not.toThrow();
    // Roles and assumptions are fixed codes; free text is refused.
    expect(() => assertDisclosureComplete({ ...plan.disclosure, prompt: { ...plan.disclosure.prompt, readers: [{ role: 'the operator' }] } })).toThrow();
    expect(() => assertDisclosureComplete({ ...plan.disclosure, prompt: { ...plan.disclosure.prompt, assumptions: ['they are nice'] } })).toThrow();
    // A reviewed disclosure names who reviewed it, when and where.
    const reviewed = { state: 'reviewed', by: 'Example Lab', at: '2026-11-25T00:00:00.000Z', reference: 'https://example.org/review' };
    expect(() => assertDisclosureComplete({ ...plan.disclosure, review: reviewed })).not.toThrow();
    expect(() => assertDisclosureComplete({ ...plan.disclosure, review: { ...reviewed, at: 1795000000000 } })).toThrow();
    expect(describeDisclosure(plan.disclosure)).toMatch(/^Your prompt: read by this device and the computer that answers \(peer:b\)\./);
  });
});

describe('run and receipt', () => {
  it('never dispatches or charges a repeated request ID twice', async () => {
    const execute = vi.fn(admitted);
    const inference = createInference({ resolveRoute: async () => remote, execute });
    const plan = await inference.prepare({ model, execution: execution() });
    const [one, two] = await Promise.all([inference.run({ planId: plan.id, requestId: 'same', input: { messages } }),
      inference.run({ planId: plan.id, requestId: 'same', input: { messages } })]);
    expect(one).toBe(two);
    const result = await one.result;
    expect(result.status).toBe('completed');
    const other = await inference.prepare({ model, execution: execution() });
    await expect(inference.run({ planId: other.id, requestId: 'same', input: { messages } })).rejects.toMatchObject({ code: 'EXECUTION_REQUEST_INVALID' });
    expect(execute).toHaveBeenCalledOnce();
    // The receipt keeps privacy, integrity and credits apart.
    const receipt = result.executionReceipt;
    expect(receipt).toMatchObject({ schema: 'reploid.execution-receipt/v2', api: 'reploid.inference/v2', protection: 'plaintext', routeKind: 'remote',
      route: { participants: ['peer:b'], backend: 'doppler-plaintext/v1' } });
    expect(receipt.evidence.privacy).toMatchObject({ protection: 'plaintext', contentReadBy: { participants: ['peer:b'] } });
    expect(receipt.evidence.integrity.checks.map(check => check.claim)).toContain('model-identity');
    expect(receipt.evidence.credits).toMatchObject({ record: { kind: 'service-credit', charged: 3, released: 7 }, checkedHere: false });
  });

  it('a run refused before anything was sent frees its request ID', async () => {
    let candidate = remote;
    const execute = vi.fn(admitted);
    const inference = createInference({ resolveRoute: async () => candidate, execute });
    const plan = await inference.prepare({ model, execution: execution() });
    candidate = { ...remote, participants: ['peer:c'] };
    await expect(inference.run({ planId: plan.id, requestId: 'retry', input: { messages } })).rejects.toMatchObject({ code: 'EXECUTION_PLAN_CHANGED' });
    candidate = remote;
    const fresh = await inference.prepare({ model, execution: execution() });
    expect((await (await inference.run({ planId: fresh.id, requestId: 'retry', input: { messages } })).result).status).toBe('completed');
    expect(execute).toHaveBeenCalledOnce();
  });

  it('records a receipt on failure too', async () => {
    const inference = createInference({ resolveRoute: async () => remote, execute: async () => { throw Object.assign(Error('gone'), { serviceCredit: { released: 10 } }); } });
    const plan = await inference.prepare({ model, execution: execution() });
    const result = await (await inference.run({ planId: plan.id, requestId: 'f', input: { messages } })).result;
    expect(result.status).toBe('failed');
    expect(result.executionReceipt).toMatchObject({ status: 'failed', route: null, evidence: { privacy: { checks: [] }, credits: { record: { kind: 'service-credit', released: 10 } } } });
  });
});

describe('listCapabilities', () => {
  it('reports each protection as available, unavailable or unknown with a reason, what was checked and when; advisory only', async () => {
    const resolveRoute = vi.fn(async () => remote), execute = vi.fn();
    const inference = createInference({ resolveRoute, execute, now: () => Date.UTC(2026, 10, 25) });
    const listed = await inference.listCapabilities({ model });
    expect(listed.advisory).toBe(true);
    expect(listed.capabilities.map(row => row.protection)).toEqual(PROTECTIONS);
    const byName = Object.fromEntries(listed.capabilities.map(row => [row.protection, row]));
    expect(byName.plaintext).toMatchObject({ status: 'available', checkedAt: '2026-11-25T00:00:00.000Z' });
    // Per protection, every route it allows and that route's availability.
    expect(byName.plaintext.routes.map(row => [row.route, row.status])).toEqual([['local', 'unavailable'], ['remote', 'available'],
      ['split', 'unavailable'], ['split-local-edges', 'unavailable'], ['auto', 'available']]);
    expect(byName.plaintext.routes[1]).toMatchObject({ checked: ['host-configuration', 'requirements', 'route-resolution', 'disclosure', 'charge-ceiling'] });
    expect(byName.plaintext.routes[1].latency).toBeUndefined();
    for (const protection of ['secret-sharing', 'homomorphic', 'attested']) {
      expect(byName[protection]).toMatchObject({ status: 'unavailable', reason: expect.any(String), code: 'CONFIDENTIAL_EXECUTION_UNAVAILABLE', checked: ['host-configuration'] });
      expect(byName[protection].routes.map(row => row.route)).toEqual(PROTECTION_ROUTES[protection]);
    }
    expect(execute).not.toHaveBeenCalled();
    // Without a model nothing is resolved; a resolver failure outside the API's codes is unknown, not unavailable.
    expect((await inference.listCapabilities()).capabilities[0]).toMatchObject({ protection: 'plaintext', status: 'unknown' });
    const flaky = createInference({ resolveRoute: async () => { throw Error('network down'); }, execute });
    expect((await flaky.listCapabilities({ model })).capabilities[0]).toMatchObject({ status: 'unknown', reason: 'network down' });
    await expect(inference.listCapabilities({ model, messages })).rejects.toMatchObject({ code: 'EXECUTION_REQUEST_INVALID' });
  });

  it('shows a latency estimate only from a measurement', async () => {
    const inference = createInference({ resolveRoute: async () => remote, execute: vi.fn(),
      latencyEstimate: async ({ protection }) => protection === 'plaintext' ? { milliseconds: 820, measuredAt: '2026-11-24T00:00:00.000Z', source: 'receipt p50' } : null });
    const [plaintext] = (await inference.listCapabilities({ model })).capabilities;
    expect(plaintext.routes[1].latency).toEqual({ milliseconds: 820, measuredAt: '2026-11-24T00:00:00.000Z', source: 'receipt p50' });
    // A measurement without the one time format is not shown.
    const loose = createInference({ resolveRoute: async () => remote, execute: vi.fn(), latencyEstimate: async () => ({ milliseconds: 1, measuredAt: 1795000000000, source: 'x' }) });
    expect((await loose.listCapabilities({ model })).capabilities[0].routes[1].latency).toBeUndefined();
  });

  it('gated capabilities name every protection and its reason, and display names carry no speed claim', () => {
    const rows = gatedCapabilities({ at: 0 });
    expect(rows.map(row => [row.protection, row.status])).toEqual([['plaintext', 'unknown'], ['secret-sharing', 'unavailable'],
      ['homomorphic', 'unavailable'], ['attested', 'unavailable']]);
    expect(gatedCapabilities({ enabled: ['plaintext', 'attested'] })[3].status).toBe('unavailable');
    for (const { label, line } of Object.values(PROTECTION_DISPLAY)) {
      expect(`${label} ${line}`).not.toMatch(/slow|fast|private\b|confidential/i);
    }
  });
});
