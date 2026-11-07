import { afterEach, expect, it, vi } from 'vitest';
import { qualifiedPartitionRoute, availablePartitionRoute, currentPartitionRoute } from '../../apps/poolday/host/partition-release.js';
import { createChatExecution } from '../../apps/poolday/host/chat-execution.js';
import { projectChatCatalog } from '../../apps/poolday/host/chat-view.js';
import { projectModelRoutes } from '../../apps/poolday/ui/pool-home/model-providers.js';

const approvals = vi.hoisted(() => []);
vi.mock('../../apps/poolday/config/partition-releases.json', () => ({ default: { approvals } }));
afterEach(() => { approvals.length = 0; });

const route = { id: 'fixture', identity: 'sha256:model', provider: 'doppler', availability: 'ready',
  partition: { planId: 'sha256:plan', participantA: 'a', participantB: 'b' }, adapters: [] };
const approval = { modelId: route.id, modelIdentity: route.identity, partition: route.partition,
  adapterIdentities: [], evidence: 'test-fixture://route-qualification' };

it('requires host approval, never advertised qualification or readiness alone', () => {
  expect(availablePartitionRoute({ ...route, qualified: true, evidence: approval.evidence })).toBe(false);
  expect(qualifiedPartitionRoute(route, [{ ...approval, evidence: '' }])).toBe(false);
  expect(availablePartitionRoute(route, [approval])).toBe(true);
});
it.each([
  { identity: 'sha256:other' }, { adapters: [{ identity: 'sha256:adapter', baseModelIdentity: route.identity }] },
  { partition: { ...route.partition, participantB: 'c' } },
  { partition: { ...route.partition, planId: 'sha256:other-plan' } },
  { partition: { ...route.partition, participantB: 'a' } },
  { partition: { planId: 'sha256:plan' } }
])('rejects an approval reused for changed or incomplete bindings: %j', change => {
  expect(qualifiedPartitionRoute({ ...route, ...change }, [approval])).toBe(false);
});
it('rechecks availability and the exact route, without silently substituting a stage', () => {
  expect(currentPartitionRoute(route, [route], [approval])).toBe(true);
  expect(currentPartitionRoute({ ...route, availability: 'unavailable' }, [route], [approval])).toBe(true);
  expect(currentPartitionRoute(route, [{ ...route, availability: 'unavailable' }], [approval])).toBe(false);
  expect(currentPartitionRoute(route, [{ ...route, partition: { ...route.partition, participantB: 'new' } }], [approval])).toBe(false);
});
it('keeps whole-model replicas visible without advertising an unapproved split', () => {
  const { partition, ...base } = route;
  const peers = ['a', 'b'].map(peerId => ({ peerId, model: base.id, modelIdentity: base.identity, readiness: 'ready', hasInference: true, availableSlots: 1 }));
  const models = projectChatCatalog({ models: [base], peers, partitionModels: [route] });
  expect(models).toHaveLength(1);
  expect(models[0]).toMatchObject({ availability: 'ready', providerIds: ['a', 'b'] });
  expect(projectModelRoutes({ models, network: { consumer: { peers } } }, base).map(row => row.type)).toEqual(['Whole model']);
});
it('rejects a restored unqualified selection before calling the partition executor', async () => {
  const generate = vi.fn();
  const execution = createChatExecution({ service: {}, models: [route], getModels: () => [route], profile: {}, scheduler: {}, partitions: { generate } });
  await expect(execution.execute({ model: route, permissions: { executionLocation: 'network' } }, {})).rejects.toThrow('not qualified');
  expect(generate).not.toHaveBeenCalled();
  await execution.close();
});

it('allows an approved route but rechecks after asynchronous accounting admission', async () => {
  approvals.push(approval);
  let current = route;
  const generate = vi.fn(async () => 'answer');
  let drop = false;
  const earning = { async run(request, controls, dispatch) {
    await Promise.resolve();
    if (drop) current = { ...route, availability: 'unavailable' };
    return dispatch(request, controls);
  } };
  const execution = createChatExecution({ service: {}, models: [route], getModels: () => [current], profile: {}, scheduler: {}, partitions: { generate }, earning });
  const request = { model: route, permissions: { executionLocation: 'network' } };
  expect(await execution.execute(request, {})).toBe('answer');
  drop = true;
  await expect(execution.execute(request, {})).rejects.toThrow('unavailable');
  expect(generate).toHaveBeenCalledTimes(1);
  await execution.close();
});
it('rejects a partition smuggled into ordinary model discovery', () => {
  expect(projectChatCatalog({ models: [route], peers: [], partitionModels: [] })).toEqual([]);
});
