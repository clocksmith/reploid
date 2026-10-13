// Actual canonical transitions, signatures and durable publication; GPU steps
// and tokenization are injected. Includes the requester/A duplex composition.
import assert from 'node:assert/strict';
import { createPartitionChat } from '../packages/reploid/src/mesh/partitions/partition-chat.js';
import { createPartitionEntry } from '../packages/reploid/src/mesh/partitions/partition-entry.js';
import { fixture, runtime, plan, planId, limits, hash, epoch } from './canonical-runner-fixture.js';
async function check({ zero = false, stale = false, declined = false, changedDuringApproval = false, entry = false, closeDuringApproval = false } = {}) {
  const f = await fixture({ zero }); await f.runner.close();
  let tokenizations = 0;
  f.devices.forEach((device, index) => Object.assign(device, { index, subscribe: () => () => {}, refresh: async () => {},
    getState: () => ({ ready: true, phase: 'ready', receipt: {} }),
    tokenize: async () => { tokenizations++; return { tokenIds: [1, 2], modelIdentity: hash }; } }));
  const chat = createPartitionChat({ runtime, local: f.devices[0], remote: f.devices[1], authority: f.grantAuthority,
    model: { id: plan.modelId, identity: hash, name: 'fixture' }, plan, planId, limits, grantTtlMs: 60000,
    canonical: { coordinatorEpoch: epoch }, authorizeRequester: async () => true });
  const model = chat.getModels()[0];
  assert(model.canonical);
  const context = { schema: 'reploid.partition-publication-context/v1', ...model.canonical,
    publisherEpoch: epoch, deadlineAt: Date.now() + 60000 };
  Object.assign(f.input.canonical.attempt, { routeId: context.routeId });
  const request = { ...f.input.identity, meshId: 'mesh', participantId: 'requester', model,
    canonical: structuredClone(context), messages: [{ role: 'user', content: 'actual tokenization input' }],
    members: [], permissions: { sharingScope: 'public' } };
  if (stale) request.canonical.stages[1].deviceEpoch = '1'.repeat(32);
  const entries = [];
  try {
    if (entry) {
      const channels = [new EventTarget(), new EventTarget()];
      channels.forEach((channel, i) => Object.assign(channel, { readyState: 'open', ordered: true, maxRetransmits: null,
        maxPacketLifeTime: null, bufferedAmount: 0,
        send(data) { queueMicrotask(() => channels[1 - i].dispatchEvent(new MessageEvent('message', { data: structuredClone(data) }))); },
        close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.dispatchEvent(new Event('close'));
          queueMicrotask(() => channels[1 - i].close()); } }));
      const channelLimits = { maxFrameBytes: 16384, maxControlBytes: 131072, maxPayloadBytes: 4096, maxPendingBytes: 16384,
        maxPendingRequests: 16, maxRequestsPerChannel: 128, maxBufferedBytes: 131072, maxTransferBytes: 4194304, timeoutMs: 3000 };
      const inputLimits = { maxInputCharacters: 8192, maxOutputCharacters: 8192, maxAttempts: 8, maxConcurrentAttempts: 2, descriptorTtlMs: 10000 };
      for (let i = 0; i < 2; i++) entries.push(createPartitionEntry({ channel: channels[i], canonical: true,
        localParticipantId: i ? f.devices[0].id : 'requester', remoteParticipantId: i ? 'requester' : f.devices[0].id,
        service: i ? chat : null, authorize: async () => true, limits: channelLimits, inputLimits }));
      await entries[0].refresh();
      const projected = [];
      const result = await entries[0].generate(request, { publication: f.publication,
        onDelta() { throw Error('raw canonical delta reached requester'); },
        onPublished(record) { assert(f.state().records.some(saved => saved.receipt.receiptDigest === record.receipt.receiptDigest)); projected.push(record); } });
      assert.equal(result.content, zero ? '' : '34');
      assert.equal(projected.length, zero ? 1 : 2); assert.equal(f.state().attempts[0].status, 'completed');
      assert.equal(result.execution.publications, undefined);
      return;
    }
    const operation = chat.generate(request, { signal: new AbortController().signal, publication: f.publication,
      onDelta: () => assert(f.state().records.length > 0), onState() {}, requestApproval: async () => {
        if (changedDuringApproval) f.devices[1].getCanonicalStage = () => ({ ...context.stages[1], deviceEpoch: '2'.repeat(32) });
        if (closeDuringApproval) await chat.close();
        return !declined;
      } });
    if (stale || declined || changedDuringApproval || closeDuringApproval) {
      await assert.rejects(operation);
      assert.equal(f.counters.a + f.counters.b, 0);
      if (stale || declined || closeDuringApproval) assert.equal(tokenizations, 0);
    } else {
      const result = await operation;
      assert.equal(f.state().records.length, zero ? 1 : 2);
      assert.equal(result.execution.canonicalAttempt.inputDigest, runtime.tokenDigest([1, 2], 100, limits.maxPromptTokens));
      assert.equal(result.execution.canonicalAttempt.routeId, context.routeId);
      assert.deepEqual(result.execution.canonicalAttempt.stages, context.stages);
      assert.equal(result.content, zero ? '' : '34');
      assert.equal(f.state().attempts[0].status, 'completed');
    }
  } finally { await Promise.all(entries.map(value => value.close())); await chat.close(); }
}
for (const options of [{}, { entry: true }, { entry: true, zero: true }, { zero: true }, { stale: true }, { declined: true }, { changedDuringApproval: true }, { closeDuringApproval: true }]) await check(options);
console.log('canonical chat: actual prompt-bound v3 grant, target/mirror transitions, durable signatures, N=0 and changed placement refusal pass');
