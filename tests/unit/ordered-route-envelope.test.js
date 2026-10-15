import { describe, expect, it, vi } from 'vitest';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createPartitionGrantAuthority } from '../../packages/reploid/src/mesh/partitions/partition-grants.js';
import { createPartitionChat } from '../../packages/reploid/src/mesh/partitions/partition-chat.js';
import { ROUTE_ENVELOPE_POLICY, createRouteEnvelope, validateRouteEnvelopePolicy }
  from '../../packages/reploid/src/mesh/partitions/partition-route-envelope.js';
import { fixture as routeFixture } from '../fixtures/ordered-partition-ports.js';

// Seeded from the measured placement C envelope: one requester, prompts up to 512 tokens with answers
// up to 255, or up to 1,024 with answers up to 63; two requesters, up to 512 / 255 each.
const measured = route => ({ schema: 'reploid.route-envelope-policy/v1', undeclaredRoutes: 'existing-limits',
  routes: [{ modelIdentity: route.modelIdentity, planId: route.planId, evidence: 'artifacts/placement-c-envelope-20261015/README.md',
    cells: [{ maxConcurrency: 1, maxPromptTokens: 512, maxAnswerTokens: 255 }, { maxConcurrency: 1, maxPromptTokens: 1024, maxAnswerTokens: 63 },
      { maxConcurrency: 2, maxPromptTokens: 512, maxAnswerTokens: 255 }] }] });
const outside = { code: 'WORKLOAD_OUTSIDE_ENVELOPE' };

describe('declared route envelope policy', () => {
  it('loads the component policy and accepts no omitted or defaulted member', () => {
    expect(ROUTE_ENVELOPE_POLICY.schema).toBe('reploid.route-envelope-policy/v1');
    const route = routeFixture(3).route, policy = measured(route);
    expect(validateRouteEnvelopePolicy(policy).routes).toHaveLength(1);
    for (const change of [p => delete p.undeclaredRoutes, p => { p.undeclaredRoutes = 'allow'; }, p => delete p.routes[0].evidence,
      p => { p.routes[0].cells[0].maxAnswerTokens = 0; }, p => { p.routes.push(structuredClone(p.routes[0])); }]) {
      const copy = structuredClone(policy); change(copy);
      expect(() => validateRouteEnvelopePolicy(copy)).toThrow();
    }
  });
  it('admits inside the measured cells and refuses prompts, caller answer limits and concurrency outside them', () => {
    const route = routeFixture(3).route, envelope = () => createRouteEnvelope({ policy: measured(route), route });
    const one = envelope();
    expect(one.admit({ attemptId: 'a', promptTokens: 512, answerTokens: 255, explicit: true })).toMatchObject({ answerTokens: 255 });
    one.release('a');
    expect(one.admit({ attemptId: 'b', promptTokens: 1024, answerTokens: 63, explicit: true })).toMatchObject({ answerTokens: 63 });
    one.release('b');
    expect(() => one.admit({ attemptId: 'c', promptTokens: 1024, answerTokens: 64, explicit: true })).toThrow(expect.objectContaining(outside));
    expect(() => one.admit({ attemptId: 'd', promptTokens: 1588, answerTokens: 63, explicit: true })).toThrow(expect.objectContaining(outside));
    // Without a caller limit, the route's allowance bounds the answer at the declared length.
    expect(one.admit({ attemptId: 'e', promptTokens: 800, answerTokens: 4096, explicit: false }))
      .toMatchObject({ answerTokens: 63, envelope: { concurrency: 1, maxAnswerTokens: 63 } });
    one.release('e');
    const two = envelope();
    two.admit({ attemptId: 'a', promptTokens: 300, answerTokens: 4096, explicit: false });
    expect(two.admit({ attemptId: 'b', promptTokens: 512, answerTokens: 4096, explicit: false })).toMatchObject({ answerTokens: 255, envelope: { concurrency: 2 } });
    expect(() => two.admit({ attemptId: 'c', promptTokens: 56, answerTokens: 63, explicit: true })).toThrow(expect.objectContaining(outside));
    // A running 1,024-token prompt is supported only alone: a second request is refused, the first keeps running.
    const long = envelope();
    long.admit({ attemptId: 'a', promptTokens: 1000, answerTokens: 4096, explicit: false });
    expect(() => long.admit({ attemptId: 'b', promptTokens: 56, answerTokens: 63, explicit: true })).toThrow(expect.objectContaining(outside));
    expect(long.getState()).toEqual({ declared: true, running: 1 });
  });
  it('applies the declared undeclared-route rule', () => {
    const route = routeFixture(3).route, other = { ...route, planId: 'sha256:' + 'f'.repeat(64) };
    expect(createRouteEnvelope({ policy: measured(route), route: other }).admit({ attemptId: 'a', promptTokens: 5000, answerTokens: 4096, explicit: false }))
      .toEqual({ answerTokens: 4096, envelope: null });
    expect(() => createRouteEnvelope({ policy: { ...measured(route), undeclaredRoutes: 'refuse' }, route: other })
      .admit({ attemptId: 'a', promptTokens: 1, answerTokens: 1, explicit: false })).toThrow(expect.objectContaining(outside));
  });
});

async function coordinator(promptTokens) {
  const f = routeFixture(3), signer = await createSigningIdentity({ algorithm: 'ECDSA' });
  const ids = [signer.peerId, 'peer:' + 'a'.repeat(24), 'peer:' + 'b'.repeat(24)];
  ids.forEach((id, index) => { f.route.stages[index].participantId = id; f.stages[index].id = id; });
  f.stages.forEach((stage, index) => Object.assign(stage, { index, getState: () => ({ ready: true }),
    subscribe: () => () => {}, refresh: vi.fn(async () => ({ ready: true })) }));
  f.limits.maxTokens = 4096; f.limits.maxPromptTokens = 4096; f.limits.maxActivationBytes = 4096 * 8 * 4;
  f.stages[0].tokenize = vi.fn(async () => ({ modelIdentity: f.route.modelIdentity,
    tokenIds: Array.from({ length: promptTokens }, (_, i) => i % 100), generation: { maxTokens: 4096 } }));
  const authority = createPartitionGrantAuthority({ identity: signer, meshId: 'mesh', maxGrants: 50, maxTtlMs: 60000 });
  const chat = createPartitionChat({ runtime: f.runtime, model: { id: 'model', name: 'Fixture', identity: f.route.modelIdentity },
    authority, plan: f.plan, planId: f.route.planId, limits: f.limits, grantTtlMs: 60000,
    ordered: { route: f.route, stages: f.stages, envelope: measured(f.route) }, authorizeRequester: async () => true });
  const request = { meshId: 'mesh', participantId: signer.peerId, threadId: 'thread', attemptId: 'attempt',
    model: chat.getModels()[0], messages: [{ role: 'user', content: 'hello' }], permissions: { sharingScope: 'approved-partition-path' } };
  return { f, chat, request, close: async () => { await chat.close(); authority.close(); } };
}

describe('ordered chat refuses outside the declared envelope before any stage disclosure (injected computation)', () => {
  it('refuses a 1,588-token prompt after local tokenization, reserving, granting and sending nothing to other stages', async () => {
    const c = await coordinator(1588);
    try {
      await expect(c.chat.generate(c.request, { requestApproval: async () => true })).rejects.toMatchObject(outside);
      expect(c.f.stages.map(stage => stage.reserve.mock.calls.length)).toEqual([0, 0, 0]);
      expect(c.f.stages.some(stage => stage.executeStage.mock.calls.length)).toBe(false);
      // The coordinator's own tokenizer reservation is released.
      expect(c.f.stages[0].closeAttempt).toHaveBeenCalledTimes(1);
      expect(c.chat.getState()).toMatchObject({ pendingInputs: 0, unsettledInputs: 0 });
    } finally { await c.close(); }
  });
  it('runs an 800-token prompt with its answer allowance bounded to the declared 63 tokens and records the envelope', async () => {
    const c = await coordinator(800);
    try {
      const result = await c.chat.generate(c.request, { requestApproval: async () => true });
      expect(result.content).toBe('012');
      expect(c.f.stages[1].reserve.mock.calls[0][0]).toMatchObject({ maxTokens: 63, generation: { maxTokens: 63 } });
      expect(result.execution.envelope).toMatchObject({ concurrency: 1, promptTokens: 800, maxAnswerTokens: 63 });
    } finally { await c.close(); }
  });
});
