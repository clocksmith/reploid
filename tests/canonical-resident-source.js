// Explicit development-source contract test, not installed/runtime qualification.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createResidentPartition } from '../packages/reploid/src/mesh/partitions/resident-partition.js';
import { createHash } from 'node:crypto';
import { canonicalPartitionJson } from '../packages/reploid/src/mesh/partitions/partition-contract.js';
const root = process.env.DOPPLER_SOURCE_ROOT;
assert(root, 'DOPPLER_SOURCE_ROOT must identify the development source explicitly');
const doppler = await import(pathToFileURL(root + '/src/partitions.js'));
const policy = JSON.parse(await readFile(root + '/tests/fixtures/canonical-generation-policy.json', 'utf8'));
const hash = 'sha256:' + 'a'.repeat(64);
const canonicalGeneration = { policy, executionIdentity: hash };
const resolved = doppler.canonicalGenerationIdentity(policy, hash, 100);
const plan = doppler.createLayerPartitionPlan({ modelId: 'fixture', numLayers: 4, hiddenSize: 8, vocabSize: 100, splitLayer: 2 });
const planId = doppler.hashLayerPartitionPlan(plan);
const model = { id: 'fixture', identity: hash, generation: { maxTokens: 16 } };
const generationDigest = 'sha256:' + createHash('sha256').update(canonicalPartitionJson(model.generation)).digest('hex');
const limits = { maxTokens: 16, maxPromptTokens: 64, maxActivationBytes: 4096, maxOutputCharacters: 1024,
  maxAttempts: 32, maxConcurrentAttempts: 2 };
const identity = { modelId: model.id, modelIdentity: hash, planId, threadId: 'thread', attemptId: 'attempt', participantA: 'a', participantB: 'b' };
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture({ index = 0, canonical = true, sessionChange = x => x } = {}) {
  const calls = [], opened = [];
  let closed = 0;
  const runtime = { async openResidentPartition(allocation) {
    opened.push(allocation);
    return sessionChange({
      getDescriptor: () => ({ schema: 'doppler.resident-partition/v1', ready: true, modelId: model.id, modelIdentity: hash,
        generationDigest, planId, index, layerRange: [...plan.partitions[index].layerRange], residentWeightBytes: 8,
        ...(canonical ? { canonicalGenerationId: resolved.generationId } : {}) }),
      getRecoveryCapabilities: () => ({ schema: 'doppler.resident-recovery/v1', inputReplay: false, checkpointExport: false, checkpointImport: false }),
      getCanonicalGeneration: () => resolved,
      tokenize: async x => x, executeGroup0: async x => x, executeGroup1: async x => x,
      admitCanonicalPrompt: async request => { calls.push('admit'); return { kind: 'prefill', tokenIds: request.tokenIds, generationId: resolved.generationId }; },
      executeCanonicalGroup0: async request => { calls.push('a'); return request; },
      executeCanonicalGroup1: async request => { calls.push('b'); return request; },
      commitCanonicalTransition: async request => { calls.push('commit'); return request.transition; },
      closeAttempt: async () => { calls.push('settle'); }, close: async () => { closed++; }
    });
  } };
  const options = { runtime, model, plan, planId, index, participantId: index ? 'b' : 'a', limits,
    ...(canonical ? { canonicalGeneration, canonicalRuntime: doppler } : {}) };
  const owner = createResidentPartition(options);
  return { owner, calls, opened, options, get closed() { return closed; } };
}
{
  const f = fixture(); await f.owner.prepare({ approved: true });
  assert.deepEqual(f.opened[0].canonicalGeneration, canonicalGeneration, 'host must preserve explicit canonical allocation');
  assert.deepEqual(f.owner.getCanonicalGeneration(), resolved);
  const request = { identity, tokenIds: [1, 2], generationId: resolved.generationId, signal: new AbortController().signal };
  await f.owner.admitCanonicalPrompt(request);
  await f.owner.executeCanonicalGroup0({ ...request, baseCursorId: null });
  const transition = { opaque: 'Doppler-owned transition' };
  assert.deepEqual(await f.owner.commitCanonicalTransition({ identity, baseCursorId: null, transition }), transition);
  assert.deepEqual(f.calls, ['admit', 'a', 'commit']);
  assert.throws(() => f.owner.executeGroup0(request), /canonical/i);
  assert.throws(() => f.owner.executeCanonicalGroup1(request), /partition A/);
  await f.owner.closeAttempt({ identity }); await f.owner.close();
  assert.equal(f.owner.getState().reservations.active, 0); assert.equal(f.closed, 1);
}
{
  const f = fixture({ index: 1 }); await f.owner.prepare({ approved: true });
  const request = { identity, generationId: resolved.generationId, inputTokenIds: [1, 2] };
  await f.owner.admitCanonicalPrompt({ ...request, tokenIds: [1, 2] });
  await f.owner.executeCanonicalGroup1(request);
  assert.deepEqual(f.calls, ['admit', 'b']);
  assert.throws(() => f.owner.commitCanonicalTransition({ identity }), /Only partition A/);
  await f.owner.close();
}
{
  const entered = gate(), pending = gate(), order = [];
  const f = fixture({ sessionChange: session => ({ ...session,
    executeCanonicalGroup0: async request => { order.push('start'); entered.resolve(); await pending.promise; order.push('settled'); return request; },
    commitCanonicalTransition: async request => { order.push('commit'); return request.transition; }
  }) });
  await f.owner.prepare({ approved: true });
  const running = f.owner.executeCanonicalGroup0({ identity }); await entered.promise;
  const commit = f.owner.commitCanonicalTransition({ identity, transition: { value: 'opaque' } });
  await Promise.resolve(); assert.deepEqual(order, ['start']);
  pending.resolve(); await running; await commit;
  assert.deepEqual(order, ['start', 'settled', 'commit']); await f.owner.close();
}
for (const sessionChange of [session => { delete session.commitCanonicalTransition; return session; },
  session => ({ ...session, getCanonicalGeneration: () => ({ ...resolved, generationId: hash }) }),
  session => ({ ...session, getDescriptor: () => ({ ...session.getDescriptor(), canonicalGenerationId: hash }) })]) {
  const f = fixture({ sessionChange });
  await assert.rejects(f.owner.prepare({ approved: true }), /canonical|identity/i);
  assert.equal(f.closed, 1); assert.equal(f.owner.getState().ready, false);
}
{
  const f = fixture({ canonical: false }); await f.owner.prepare({ approved: true });
  assert.equal(f.owner.getCanonicalGeneration(), null);
  assert.throws(() => f.owner.admitCanonicalPrompt({ identity }), /canonical/i);
  assert.deepEqual((await f.owner.executeGroup0({ identity })).identity, identity);
  await f.owner.close();
}
{
  const f = fixture();
  assert.throws(() => createResidentPartition({ ...f.options, canonicalRuntime: undefined }), /canonical/i);
  await f.owner.close();
}
{
  const entered = gate(), pending = gate();
  const f = fixture({ sessionChange: session => ({ ...session,
    executeCanonicalGroup0: async request => { entered.resolve(); await pending.promise; return request; }
  }) });
  await f.owner.prepare({ approved: true });
  const running = f.owner.executeCanonicalGroup0({ identity, generationId: resolved.generationId });
  running.catch(() => {}); await entered.promise;
  const stopping = f.owner.close();
  assert.equal(f.owner.getState().reservations.active, 1); assert.equal(f.closed, 0);
  pending.resolve(); await assert.rejects(running); await stopping;
  assert.equal(f.owner.getState().reservations.active, 0); assert.equal(f.closed, 1);
}
console.log('canonical contributor: allocation, capability, identity, routing, FIFO and in-flight cleanup passed');
