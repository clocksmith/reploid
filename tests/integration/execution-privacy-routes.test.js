// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInference, FREE } from '../../packages/reploid/src/inference/index.js';
import { createWholeModelRequester } from '../../server/whole-model-requester.js';
import { createRecoveryMesh } from '../helpers/generation-recovery-mesh.js';
import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';
const network = (kind = 'open', ids = [], policy = {}) => createExecutionPolicy({
  placement: 'network-allowed', recipients: { kind, ids }, ...policy
});
const cleanup = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
it('executes named and open recipient policies over authenticated mesh and binds the selected offer before disclosure', async () => {
  const seen = [];
  const f = await createRecoveryMesh(cleanup, { execute: async (_messages, _update, control) => {
    seen.push(control); return { model: 'model', modelIdentity: 'sha256:' + 'a'.repeat(64), adapterIdentities: [], content: 'actual answer',
      completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 7, generatedTokenCount: 3, stopReason: 'eos-token' } };
  } });
  for (const kind of ['open', 'named']) {
    const privacy = kind === 'named' ? network(kind, [f.identities[1].peerId]) : network();
    const result = await f.requesterMesh.generate(f.messages, null, { signal: new AbortController().signal, modelId: 'model',
      modelIdentity: 'sha256:' + 'a'.repeat(64), privacy, offerId: 'ordinary-generation', requestContext: { contextId: 'same-thread' } });
    expect(result.content).toBe('actual answer');
    expect(seen.at(-1).privacyBinding.policy).toEqual(privacy);
    expect(seen.at(-1).privacyBinding.route.route.offerId).toBe('ordinary-generation');
    expect(seen.at(-1).privacyBinding.route.hops.map(row => row.recipient)).toEqual([f.identities[1].peerId]);
  }
  const requests = f.wire.filter(row => row.type === 'reploid:generation-request');
  expect(requests).toHaveLength(2); expect(requests.every(row => row.payload.privacyBinding)).toBe(true);
  await f.replay({ requestId: 'tampered-policy-attempt', privacyBinding: null });
  await vi.waitFor(() => expect(f.wire.some(row => row.type === 'reploid:generation-error' && row.payload.error === 'Current execution policy and admission protocol required')).toBe(true));
  expect(seen).toHaveLength(2);
});
it('refuses local-only and unsupported backends before any mesh payload', async () => {
  const f = await createRecoveryMesh(cleanup);
  for (const privacy of [createExecutionPolicy(), network('open', [], { computation: 'cryptographic', protocol: 'unsupported', keyContext: 'client-key' })]) {
    await expect(f.requesterMesh.generate(f.messages, null, { signal: new AbortController().signal, modelId: 'model',
      modelIdentity: 'sha256:' + 'a'.repeat(64), privacy })).rejects.toThrow();
  }
  expect(f.wire.filter(row => row.type === 'reploid:generation-request')).toEqual([]);
});
it('never serves a stronger tier through a weaker one: each unmet requirement refuses before any prompt data leaves the requester', async () => {
  const executed = [];
  const f = await createRecoveryMesh(cleanup, { execute: async (_messages, _update, control) => {
    executed.push(control); return { model: 'model', modelIdentity: 'sha256:' + 'a'.repeat(64), adapterIdentities: [], content: 'actual answer',
      completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 7, generatedTokenCount: 3, stopReason: 'eos-token' } };
  } });
  const ask = (privacy, signal = new AbortController().signal) => f.requesterMesh.generate(f.messages, null, { signal, modelId: 'model',
    modelIdentity: 'sha256:' + 'a'.repeat(64), privacy, offerId: 'ordinary-generation', requestContext: { contextId: 'tier-thread' } });
  const prompt = f.messages[0].content;
  const leaked = () => f.wire.filter(row => JSON.stringify(row.payload).includes(prompt));
  // The only reachable provider is identities[1]. Each policy below asks for something it cannot give.
  const unmet = {
    'restricted, local only': createExecutionPolicy(),
    'cryptographic shares (no evaluator installed)': network('open', [], { computation: 'cryptographic', protocol: 'additive-shares-two-server/v1', keyContext: 'client-key' }),
    'provider-visible with attested hardware': network('open', [], { computation: 'attested', attestation: 'sha256:' + 'b'.repeat(64) }),
    'provider-visible with ephemeral retention': network('open', [], { retention: 'ephemeral' }),
    'restricted to the provider, against all-remote collusion': network('named', [f.identities[1].peerId], { collusion: 'all-remote' }),
  };
  for (const [label, privacy] of Object.entries(unmet)) {
    await expect(ask(privacy), label).rejects.toThrow();
    expect(f.wire.filter(row => row.type === 'reploid:generation-request'), label).toEqual([]);
    expect(leaked(), label).toEqual([]);
    expect(executed, label).toEqual([]);
  }
  // A restricted request whose named recipient is not present, while a provider's identity is still unproven, does
  // not refuse: it waits until the caller's signal or the generation deadline ends it. It still discloses nothing.
  // The only message is the requester's identity proof, which is how peers' verified identities become known.
  const absent = network('named', ['peer:someone-else']);
  const sentBefore = f.wire.length;
  await expect(ask(absent, AbortSignal.timeout(150))).rejects.toThrow();
  expect(f.wire.slice(sentBefore).map(row => row.type).filter(type => type !== 'reploid:identity-proof')).toEqual([]);
  expect(f.wire.filter(row => row.type === 'reploid:generation-request')).toEqual([]);
  expect(leaked()).toEqual([]);
  expect(executed).toEqual([]);
  // Once every provider serving the model has proven an identity outside the named recipients, waiting cannot help:
  // the request ends at once and names who serves it (TRUST-06). Still nothing is sent to it.
  const proven = await f.requesterMesh.verifyPeerIdentity(f.requesterMesh.getSwarmSnapshot().peers[0].peerId, AbortSignal.timeout(2000));
  expect(proven).toBe(f.identities[1].peerId);
  const provenBefore = f.wire.length;
  await expect(ask(absent, AbortSignal.timeout(2000))).rejects.toMatchObject({ code: 'NO_PERMITTED_PROVIDER', providerIdentities: [f.identities[1].peerId] });
  expect(f.wire.slice(provenBefore).map(row => row.type).filter(type => type !== 'reploid:identity-proof')).toEqual([]);
  expect(leaked()).toEqual([]);
  expect(executed).toEqual([]);
  // A policy that asks to be downgraded, or that is not a complete versioned policy, is not a policy.
  expect(() => network('named', [f.identities[1].peerId], { allowDowngrade: true })).toThrow(/downgrade/);
  expect(() => network('open', [], { computation: 'cryptographic', protocol: 'additive-shares-two-server/v1' })).toThrow(/key context/);
  await expect(ask({ ...network(), tier: 'cryptographic' })).rejects.toThrow();
  expect(() => network('named')).toThrow(/nonempty/);
  expect(() => network('named', ['duplicate', 'duplicate'])).toThrow(/unique/);
  expect(() => network('open', [f.identities[1].peerId])).toThrow(/recipient/);
  expect(leaked()).toEqual([]);
  // The refusals changed nothing: the tier the provider can meet still runs, bound to exactly what was asked.
  const visible = network();
  expect((await ask(visible)).content).toBe('actual answer');
  expect(executed).toHaveLength(1);
  expect(executed[0].privacyBinding.policy).toEqual(visible);
  const restricted = network('named', [f.identities[1].peerId]);
  expect((await ask(restricted)).content).toBe('actual answer');
  expect(executed[1].privacyBinding.policy).toEqual(restricted);
  expect(executed[1].privacyBinding.route.hops.map(row => row.recipient)).toEqual([f.identities[1].peerId]);
});

// reploid/inference over the real whole-model requester and peer mesh. The transport and the generator are test-owned.
describe('the inference API over the authenticated mesh', () => {
  const model = { id: 'model', identity: 'sha256:' + 'a'.repeat(64), name: 'Model', provider: 'doppler' };
  const readable = (participants = { kind: 'open' }, allowMetadata = ['model-id', 'timing', 'length', 'access-patterns']) => ({
    protection: 'plaintext', route: 'auto', participants, allowMetadata });
  async function boot({ resolve } = {}) {
    let whole, clock = 1000;
    const f = await createRecoveryMesh(cleanup, { modelId: model.id, modelIdentity: model.identity,
      authorize: async input => input.action === 'mesh.dispatch' ? whole.authorize(input) : true });
    whole = createWholeModelRequester({ mesh: f.requesterMesh, models: [model] });
    await vi.waitFor(() => expect(whole.getModels()).toHaveLength(1));
    const executed = [];
    const inference = createInference({ now: () => clock,
      resolveRoute: resolve ?? ((request) => request.execution.participants.kind === 'named'
        ? { shape: 'remote', backend: 'doppler-plaintext/v1', participants: request.execution.participants.ids, selection: 'one-of', maxCharge: FREE }
        : { shape: 'remote', backend: 'doppler-plaintext/v1', selection: 'any-eligible', maxCharge: FREE }),
      execute: ({ policy, request }, controls) => { executed.push(request.requestId); return whole.generate({ model: whole.getModels()[0],
        threadId: 'thread', attemptId: request.attemptId, privacy: policy, messages: request.messages }, controls); } });
    const prompt = f.messages[0].content;
    const sent = () => f.wire.filter(row => row.type === 'reploid:generation-request');
    const leaked = () => f.wire.filter(row => JSON.stringify(row.payload).includes(prompt));
    const ask = async (execution, requestId, { advance = 0 } = {}) => {
      const plan = await inference.prepare({ model: { id: model.id, identity: model.identity }, generation: { maxOutputTokens: 8 }, execution });
      clock += advance;
      const run = await inference.run({ planId: plan.id, requestId, input: { messages: f.messages } }, { signal: AbortSignal.timeout(5000) });
      const events = [];
      for await (const event of run.events) events.push(event.type);
      return { plan, result: await run.result, events };
    };
    return { f, inference, ask, sent, leaked, executed, provider: f.identities[1].peerId };
  }

  it('admits each requirement only on a route that meets it and receipts exactly what was checked', async () => {
    const { f, ask, sent, provider } = await boot();
    for (const [requestId, execution] of [['open-1', readable()], ['named-1', readable({ kind: 'named', ids: [provider] })]]) {
      const { plan, result, events } = await ask(execution, requestId);
      expect(plan).toMatchObject({ protection: 'plaintext', routeKind: 'remote', maxCharge: { kind: 'free' } });
      expect(plan.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(plan.disclosure.metadata.items).toEqual(['model-id', 'timing', 'length', 'access-patterns']);
      // Every section names its readers: this device and the remote executor, never an empty list.
      for (const section of ['prompt', 'intermediate', 'answer']) {
        expect(plan.disclosure[section].readers[0]).toEqual({ role: 'requester-device' });
        expect(plan.disclosure[section].readers).toHaveLength(2);
        expect(plan.disclosure[section].readers[1].role).toBe('answering-computer');
      }
      // This provider answers without streaming, so no output.delta arrives between admission and the terminal event.
      expect(events).toEqual(['admitted', 'completed']);
      expect(result).toMatchObject({ requestId, status: 'completed', output: { text: 'actual answer', finishReason: 'stop' },
        usage: { inputTokens: 7, outputTokens: 3 } });
      const receipt = result.executionReceipt;
      expect(receipt.requested.execution).toEqual(execution);
      expect(receipt.route).toMatchObject({ planRouteId: plan.route.id, shape: 'remote', participants: [provider],
        backend: 'doppler-plaintext/v1', protocol: null });
      expect(receipt.evidence.privacy.checks).toEqual([{ claim: 'content-recipients', by: 'requester',
        method: 'route-binding-before-release', value: [provider] }]);
      expect(receipt.evidence.privacy.notVerified).toEqual(['recipient-conduct', 'erasure', 'hardware-attestation']);
      expect(receipt.evidence.integrity.checks.map(row => row.claim)).toEqual(['model-identity', 'adapter-identities', 'stream-matches-answer']);
      expect(receipt.evidence.credits).toMatchObject({ checkedHere: false });
      expect(receipt.evidence.integrity.notVerified).toContain('correct-computation');
      expect(JSON.stringify(receipt)).not.toContain(f.messages[0].content);
    }
    expect(sent()).toHaveLength(2);
  });

  it('refuses an unavailable protection and disallowed leakage before any route lookup or message, and never retries as plaintext', async () => {
    const resolve = vi.fn(() => ({ shape: 'remote', backend: 'doppler-plaintext/v1', selection: 'any-eligible', maxCharge: FREE }));
    const { inference, sent, leaked, executed } = await boot({ resolve });
    const before = resolve.mock.calls.length;
    for (const protection of ['homomorphic', 'attested', 'secret-sharing']) {
      await expect(inference.prepare({ model: { id: model.id, identity: model.identity }, execution: { ...readable(), protection } }))
        .rejects.toMatchObject({ code: 'CONFIDENTIAL_EXECUTION_UNAVAILABLE' });
    }
    expect(resolve.mock.calls.length).toBe(before);
    await expect(inference.prepare({ model: { id: model.id, identity: model.identity }, execution: readable({ kind: 'open' }, ['model-id']) }))
      .rejects.toMatchObject({ code: 'LEAKAGE_NOT_ALLOWED' });
    await expect(inference.prepare({ model: { id: model.id, identity: model.identity }, input: { messages: [] }, execution: readable() }))
      .rejects.toMatchObject({ code: 'EXECUTION_REQUEST_INVALID' });
    expect(sent()).toEqual([]); expect(leaked()).toEqual([]); expect(executed).toEqual([]);
  });

  it('refuses a substituted participant, a changed route and an expired plan with nothing sent', async () => {
    // The plan pins a participant the mesh will not pick: the admission check refuses before the prompt leaves.
    const { f, ask, sent, leaked } = await boot({ resolve: () => ({ shape: 'remote', backend: 'doppler-plaintext/v1',
      participants: ['peer:pinned-elsewhere'], selection: 'one-of', maxCharge: FREE }) });
    const substituted = await ask(readable(), 'substituted');
    expect(substituted.result).toMatchObject({ status: 'failed', output: null, error: { code: 'EXECUTION_PLAN_CHANGED' } });
    expect(substituted.events).toEqual(['failed']);
    expect(substituted.result.executionReceipt.route).toBeNull();
    expect(sent()).toEqual([]); expect(leaked()).toEqual([]); expect(f.executions).toBe(0);

    let moved = false;
    const moving = await boot({ resolve: () => moved ? { shape: 'remote', backend: 'doppler-plaintext/v1', participants: ['peer:other'], selection: 'one-of', maxCharge: FREE }
      : { shape: 'remote', backend: 'doppler-plaintext/v1', selection: 'any-eligible', maxCharge: FREE } });
    const plan = await moving.inference.prepare({ model: { id: model.id, identity: model.identity }, execution: readable() });
    moved = true;
    await expect(moving.inference.run({ planId: plan.id, requestId: 'moved', input: { messages: moving.f.messages } }))
      .rejects.toMatchObject({ code: 'EXECUTION_PLAN_CHANGED' });
    moved = false;
    await expect(moving.ask(readable(), 'late', { advance: 10 * 60 * 1000 })).rejects.toMatchObject({ code: 'EXECUTION_PLAN_EXPIRED' });
    expect(moving.sent()).toEqual([]); expect(moving.leaked()).toEqual([]); expect(moving.executed).toEqual([]);
  });
});
