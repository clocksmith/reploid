// @vitest-environment node
// The requester's side of a stopped split answer: it signs its own stop and hands it to the ledger before the stages
// are told to stop, then sends it again with the closing evidence. A lost connection signs nothing. The ledger is a
// recording stand-in here; tests/unit/settlement-replay.test.js covers what the ledger charges with and without a stop.
import { expect, it } from 'vitest';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createFleetRequester } from '../../server/fleet/requester.js';
import { SETTLEMENT_STOP_SCHEMA, verifySettlementStop } from '../../server/fleet/settlement-terms.js';

const PLAN = `sha256:${'b'.repeat(64)}`, MODEL_IDENTITY = `sha256:${'a'.repeat(64)}`;
const POLICY = { schema: 'reploid.service-credit-policy/v1', version: 'test/1', unit: 'noncash-service-credit', creditsPerOutputToken: 1,
  maxDebt: 100, maxOutputTokens: 20, maxPendingPerComputer: 2, maxClockSkewMs: 1000, maxRequestMs: 60000, allowSameOwner: true };

async function stoppedSplitAnswer(reason) {
  const [requester, ...stages] = await Promise.all([0, 1, 2].map(() => createSigningIdentity({ algorithm: 'Ed25519' })));
  const route = { schema: 'reploid.partition-route/v1', modelId: 'model', modelIdentity: MODEL_IDENTITY, planId: PLAN,
    activation: { schema: 'doppler.activation-tensor/v1', dtype: 'f32', hiddenSize: 8, precision: 'f32', components: 1, elementStrideBytes: 4 },
    stages: stages.map((stage, index) => ({ index, participantId: stage.peerId, transportId: `t${index}`, residentId: `r${index}`, executionId: `e${index}` })) };
  const events = [];
  let stagesStopped = false;
  const credits = {
    call: async operation => (operation === 'terms' ? { policy: POLICY, model: { plans: [{ id: PLAN, creditWeights: [1, 1] }] } } : null),
    reserve: async binding => ({ ...binding, deadline: Date.now() + POLICY.maxRequestMs, maximum: binding.maxOutputTokens }),
    collect: async (_id, evidence) => { events.push({ collect: evidence, stagesStopped }); return { status: 'pending' }; },
    dispatch: async () => {}, fence: async () => ({ status: 'pending' }), settle: async () => ({ status: 'pending' }), abandonBeforeDispatch: async () => {}
  };
  const participant = {
    async generate(request, controls) {
      expect(await controls.requestApproval({ route, recipientIdentity: stages[0].peerId })).toBe(true);
      // The split route stops its stages when this signal aborts.
      await new Promise(resolve => controls.signal.addEventListener('abort', resolve, { once: true }));
      stagesStopped = true;
      throw controls.signal.reason;
    }
  };
  const fleet = createFleetRequester({ participant, identity: requester, credits, maxOutputTokens: 10 });
  const person = new AbortController();
  const answer = fleet.generate({ model: { id: 'model', identity: MODEL_IDENTITY, partition: { planId: PLAN } }, threadId: 'thread',
    attemptId: 'attempt', messages: [{ role: 'user', content: 'test' }] }, { signal: person.signal, requestApproval: async () => true }).catch(error => error);
  while (!events.length) await new Promise(resolve => setTimeout(resolve, 1));
  person.abort(reason);
  await answer;
  return { events, requester };
}

it('hands the ledger the requester\'s signed stop before the stages are stopped, and again with the closing evidence', async () => {
  const { events, requester } = await stoppedSplitAnswer(Object.assign(new DOMException('Stopped by owner', 'AbortError'), { requesterStop: true }));
  const withStop = events.filter(row => row.collect.stop);
  expect(withStop).toHaveLength(2);
  expect(withStop[0].stagesStopped).toBe(false);
  const checked = await verifySettlementStop(withStop[0].collect.stop);
  expect(checked).toMatchObject({ ok: true, body: { schema: SETTLEMENT_STOP_SCHEMA, requesterId: requester.peerId, attemptId: 'attempt', acknowledged: 0 } });
  expect(withStop[1].collect.stop).toEqual(withStop[0].collect.stop);
});

it('signs no stop when the connection is lost', async () => {
  const { events } = await stoppedSplitAnswer(Error('Connection lost'));
  expect(events.some(row => row.collect.stop)).toBe(false);
});
