import assert from 'node:assert/strict';
import { createLayerPartitionRunner } from '../packages/reploid/src/mesh/partitions/partition-runner.js';
import { fixture, runtime, plan, limits, hash } from './canonical-runner-fixture.js';

{
  const f = await fixture(); const result = await f.runner.executeCanonical(f.input);
  assert.deepEqual(result.tokenIds, [3, 4]); assert.equal(f.counters.commits, 2); assert.equal(f.counters.closes, 2);
  assert.equal(f.state().records.length, 2); assert.equal(result.execution.schema, 'reploid.mesh.canonical-partition-execution/v1');
  for (const [before, after] of [['b0', 'commit0'], ['commit0', 'stored0'], ['stored0', 'ack0'], ['ack0', 'a1']]) {
    assert(f.events.indexOf(before) < f.events.indexOf(after), before + ' precedes ' + after);
  }
  assert.equal(f.runner.getState().active, 0); await f.runner.close();
}
for (const options of [{ zero: true }, { full: true }, { forged: true }, { unknown: true }, { decline: true }]) {
  const f = await fixture(options);
  if (options.zero || options.full) {
    const result = await f.runner.executeCanonical(f.input); assert.deepEqual(result.tokenIds, []);
    assert.equal(f.counters.a + f.counters.b + f.counters.commits, 0); assert.deepEqual(f.state().records[0].evidence, []);
  } else {
    await assert.rejects(f.runner.executeCanonical(f.input));
    assert.equal(f.events.some(e => e.startsWith('delta')), false, 'failed or uncertain publication cannot reach UI');
    if (options.forged) assert.equal(f.counters.commits, 0, 'unauthenticated B cannot mutate A cursor');
    if (options.unknown) assert.equal(f.state().records.length, 1, 'unknown storage completion preserves actual durable result');
    if (options.decline) assert.equal(f.counters.a + f.counters.b, 0);
  }
  assert.equal(f.counters.closes, options.decline ? 0 : 2); await f.runner.close();
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
{
  const authenticationGate = { entered: deferred(), release: deferred() };
  const f = await fixture({ authenticationGate }), controller = new AbortController();
  const pending = f.runner.executeCanonical({ ...f.input, signal: controller.signal });
  await authenticationGate.entered.promise;
  controller.abort(Error('named attempt cancelled'));
  authenticationGate.release.resolve();
  await assert.rejects(pending);
  assert.equal(f.state().records.length, 0, 'cancellation that wins before transaction prevents publication');
  assert.equal(f.state().attempts[0].status, 'cancelled');
  assert.equal(f.counters.closes, 2); assert.equal(f.events.some(e => e.startsWith('delta')), false);
  await f.runner.close();
}
for (const mutate of [input => { input.canonical.attempt.stages[0].deviceEpoch = '1'.repeat(32); },
  input => { input.canonical.generation.policy.maxGeneratedTokens++; }, input => { input.tokenIds = [8, 9]; },
  input => { input.identity.planId = hash; }, input => { input.canonical.publication = { requiresCommitEvidence: false }; }]) {
  const f = await fixture();
  // Preserve the live publication port while isolating caller-owned metadata.
  f.input.canonical.attempt = structuredClone(f.input.canonical.attempt);
  f.input.canonical.generation = structuredClone(f.input.canonical.generation);
  mutate(f.input); await assert.rejects(f.runner.executeCanonical(f.input));
  assert.equal(f.counters.a + f.counters.b + f.counters.commits, 0);
  await f.runner.close();
}
{
  const gate = { entered: deferred(), release: deferred() };
  const a = await fixture({ attemptId: 'first', authenticationGate: gate }), b = await fixture({ attemptId: 'second' });
  const byAttempt = { first: a, second: b };
  const devices = [0, 1].map(index => Object.fromEntries(Object.entries(a.devices[index]).map(([key, value]) => {
    if (typeof value !== 'function' || key.startsWith('getCanonical')) return [key, value];
    return [key, request => byAttempt[(request.identity ?? request).attemptId].devices[index][key](request)];
  })));
  const shared = createLayerPartitionRunner({ runtime, plan, limits, deviceA: devices[0], deviceB: devices[1], canonical: true,
    authorize: request => byAttempt[request.attemptId].authorize(request) });
  const first = shared.executeCanonical(a.input); await gate.entered.promise;
  assert.equal(shared.getState().active, 1);
  const second = await shared.executeCanonical(b.input);
  assert.deepEqual(second.tokenIds, [3, 4], 'another conversation completes while the first awaits storage authentication');
  assert.equal(a.state().records.length, 0); assert.equal(shared.getState().active, 1);
  gate.release.resolve(); await first; assert.equal(shared.getState().active, 0);
  await shared.close(); await a.runner.close(); await b.runner.close();
}
{
  const f = await fixture(); await f.runner.executeCanonical(f.input); await f.runner.close();
  const dispatched = f.counters.a + f.counters.b, closed = f.counters.closes;
  const restarted = createLayerPartitionRunner({ runtime, plan, limits, deviceA: f.devices[0], deviceB: f.devices[1],
    canonical: true, authorize: f.authorize });
  await assert.rejects(restarted.executeCanonical(f.input), /already admitted/);
  assert.equal(f.counters.a + f.counters.b, dispatched, 'a new coordinator object cannot regenerate a durable attempt');
  assert.equal(f.counters.closes, closed, 'rejected duplicate cannot close resources owned by another coordinator');
  await restarted.close();
}
console.log('canonical runner: actual transition/signature/publication ordering, no premature UI, N=0, forged B, unknown commit and refusal pass');
