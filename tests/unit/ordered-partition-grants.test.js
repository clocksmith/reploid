import { describe, it, expect, vi } from 'vitest';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createPartitionGrantAuthority, orderedPartitionDisclosure } from '../../packages/reploid/src/mesh/partitions/partition-grants.js';
import { fixture as runnerFixture } from '../fixtures/ordered-partition-ports.js';
import { createLayerPartitionRunner } from '../../packages/reploid/src/mesh/partitions/partition-runner.js';
const sha = 'sha256:' + 'a'.repeat(64);
async function fixture() {
  const signer = await createSigningIdentity({ algorithm: 'ECDSA' });
  let now = 100;
  const authority = createPartitionGrantAuthority({ identity: signer, meshId: 'mesh', maxGrants: 20, maxTtlMs: 1000, now: () => now });
  const route = { schema: 'reploid.partition-route/v1', modelId: 'm', modelIdentity: sha, planId: sha,
    activation: { schema: 'doppler.activation-tensor/v1', dtype: 'f32', precision: 'f32', hiddenSize: 8, components: 1, elementStrideBytes: 4 },
    stages: [signer.peerId, 'middle', 'final'].map((participantId, index) => ({ index, participantId, transportId: 't' + index,
      residentId: 'r' + index, executionId: 'e' + index })) };
  const identity = { schema: 'reploid.partition-attempt/v2', route, threadId: 'thread', attemptId: 'attempt', requesterId: 'requester', placementGeneration: 0 };
  const disclosure = orderedPartitionDisclosure(identity);
  const limits = { maxTokens: 4, maxPromptTokens: 32, maxActivationBytes: 4096, maxOutputCharacters: 100 };
  const controls = { approved: true, ttlMs: 100, disclosure, generationDigest: sha };
  const grant = await authority.issueOrdered(identity, limits, controls);
  const request = { identity, coordinatorId: signer.peerId, action: 'mesh.transfer_intermediate_activation',
    fromStage: 1, toStage: 2, recipients: ['middle', signer.peerId, 'final'], step: 0, inputTokenCount: 2, generationDigest: sha, activationBytes: 64 };
  return { authority, identity, disclosure, limits, controls, grant, request, expire: () => now = 201 };
}
describe('explicit ordinary ordered route grants', () => {
  it('signs and verifies complete coordinator-mediated recipient closure with actual WebCrypto', async () => {
    const f = await fixture();
    expect(f.grant.claim.schema).toBe('reploid.partition-grant/v4');
    expect(await f.authority.verify(f.grant, f.request)).toBe(true);
    expect(await f.authority.verify(f.grant, { ...f.request, action: 'mesh.transfer_token_context', partitionIndex: 1,
      recipients: [f.request.coordinatorId, 'middle'] })).toBe(true);
    expect(await f.authority.verify(f.grant, { ...f.request, action: 'mesh.transfer_partition_output', partitionIndex: 2,
      recipients: ['final', f.request.coordinatorId, 'requester'] })).toBe(true);
  });
  it('rejects unapproved relay disclosure, changed stage, changed recipient path and changed payload budget', async () => {
    const f = await fixture();
    const hiddenRelay = structuredClone(f.controls); hiddenRelay.disclosure.activationPaths[1] = ['middle', 'final'];
    await expect(f.authority.issueOrdered(f.identity, f.limits, hiddenRelay)).rejects.toThrow(/disclosure/);
    for (const override of [{ recipients: ['middle', 'final'] }, { coordinatorId: 'requester' }, { toStage: 1 },
      { generationDigest: 'sha256:' + 'b'.repeat(64) }, { activationBytes: 4097 }, { step: 4 },
      { action: 'mesh.execute_partition_stage', partitionIndex: 3 }]) {
      expect(await f.authority.verify(f.grant, { ...f.request, ...override })).toBe(false);
    }
    const identity = structuredClone(f.identity); identity.route.stages[1].residentId = 'replacement';
    expect(await f.authority.verify(f.grant, { ...f.request, identity })).toBe(false);
  });
  it('rejects revoked or expired execution but permits only the exact owner cleanup', async () => {
    const f = await fixture(); f.authority.revoke(f.grant); f.expire();
    expect(await f.authority.verify(f.grant, f.request)).toBe(false);
    const cleanup = { identity: f.identity, coordinatorId: f.request.coordinatorId, action: 'mesh.execute_partition_stage', partitionIndex: 1 };
    expect(await f.authority.verify(f.grant, cleanup, { settlement: true })).toBe(true);
    expect(await f.authority.verify(f.grant, { ...cleanup, partitionIndex: 9 }, { settlement: true })).toBe(false);
    f.authority.close(); expect(await f.authority.verify(f.grant, cleanup, { settlement: true })).toBe(false);
  });
  it('does not accept signature tampering or reinterpret legacy grants', async () => {
    const f = await fixture(), changed = structuredClone(f.grant);
    changed.claim.limits.maxActivationBytes++;
    expect(await f.authority.verify(changed, f.request)).toBe(false);
    changed.claim.schema = 'reploid.partition-grant/v2';
    expect(await f.authority.verify(changed, f.request)).toBe(false);
  });
});

it('runs the existing ordered runner under genuine signed v4 grants (injected numerical ports)', async () => {
  const f = runnerFixture(3);
  const signer = await createSigningIdentity({ algorithm: 'ECDSA' });
  f.route.stages[0].participantId = signer.peerId; f.stages[0].id = signer.peerId;
  const authority = createPartitionGrantAuthority({ identity: signer, meshId: 'mesh', maxGrants: 4, maxTtlMs: 1000 });
  const grant = await authority.issueOrdered(f.request.identity, f.limits, { approved: true, ttlMs: 1000,
    disclosure: orderedPartitionDisclosure(f.request.identity), generationDigest: await f.runtime.hashPartitionGeneration(f.request.generation) });
  const runner = createLayerPartitionRunner({ ...f, authorize: request => authority.verify(request.grant, request) });
  try {
    const result = await runner.execute({ ...f.request, grants: { execution: Array(3).fill(grant),
      tokenContext: Array(3).fill(grant), activation: Array(2).fill(grant), output: grant } });
    expect(result.content).toBe('012'); expect(runner.getState().unsettled).toBe(0);
  } finally { await runner.close(); authority.close(); }
});
it('snapshots approved identity, recipient closure and limits before asynchronous signing', async () => {
  const f = await fixture(), expected = structuredClone({ identity: f.identity, disclosure: f.disclosure, limits: f.limits });
  const pending = f.authority.issueOrdered(f.identity, f.limits, f.controls);
  f.identity.route.stages[1].residentId = 'changed-after-approval';
  f.disclosure.activationPaths[1].push('unapproved'); f.limits.maxTokens = 1000;
  const grant = await pending;
  expect(grant.claim.identity).toEqual(expected.identity); expect(grant.claim.disclosure).toEqual(expected.disclosure);
  expect(grant.claim.limits).toEqual(expected.limits);
});

describe('verified grant binding cache', () => {
  it('verifies a signature once, then refuses binding changes, expiry and revocation from the cached binding', async () => {
    const f = await fixture(), verify = vi.spyOn(crypto.subtle, 'verify');
    try {
      for (let step = 0; step < 4; step++) expect(await f.authority.check(f.grant, { ...f.request, step, inputTokenCount: step ? 1 : 2 })).toEqual({ ok: true, reason: null });
      expect(verify).toHaveBeenCalledTimes(1);
      const identity = structuredClone(f.identity); identity.attemptId = 'other';
      expect(await f.authority.check(f.grant, { ...f.request, identity })).toMatchObject({ ok: false, reason: 'declined' });
      expect(await f.authority.check(f.grant, { ...f.request, recipients: ['middle', 'final'] })).toMatchObject({ ok: false });
      expect(await f.authority.check(f.grant, { ...f.request, step: 4 })).toMatchObject({ ok: false });
      // A changed claim reusing the verified signature is verified afresh, and fails.
      const changed = structuredClone(f.grant); changed.claim.limits.maxActivationBytes++;
      expect(await f.authority.check(changed, f.request)).toMatchObject({ ok: false, reason: 'declined' });
      expect(verify).toHaveBeenCalledTimes(2);
      f.expire();
      expect(await f.authority.check(f.grant, f.request)).toEqual({ ok: false, reason: 'expired' });
      expect(await f.authority.verify(f.grant, f.request)).toBe(false);
    } finally { verify.mockRestore(); }
  });
  it('reports revocation on every later check of a cached grant', async () => {
    const f = await fixture();
    expect(await f.authority.verify(f.grant, f.request)).toBe(true);
    f.authority.revoke(f.grant);
    expect(await f.authority.check(f.grant, f.request)).toEqual({ ok: false, reason: 'revoked' });
  });
  it('a stage verifying a remote coordinator grant runs one signature verification per attempt grant', async () => {
    const f = await fixture(), stage = createPartitionGrantAuthority({ identity: await createSigningIdentity({ algorithm: 'ECDSA' }),
      meshId: 'mesh', maxGrants: 2, maxTtlMs: 1000, now: () => 150 });
    const verify = vi.spyOn(crypto.subtle, 'verify');
    try {
      for (let step = 0; step < 3; step++) expect(await stage.verify(f.grant, { ...f.request, step, inputTokenCount: step ? 1 : 2 })).toBe(true);
      expect(verify).toHaveBeenCalledTimes(1);
      stage.close();
      expect(await stage.verify(f.grant, f.request)).toBe(false);
    } finally { verify.mockRestore(); }
  });
});
