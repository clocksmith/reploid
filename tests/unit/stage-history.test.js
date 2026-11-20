// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { canonicalize } from '../../packages/reploid/src/artifacts/canonical-json.js';
import { activeProviderRequests } from '../../server/fleet/native-host.js';
import { createStageHistory } from '../../server/fleet/stage-history.js';

const identity = { requesterId: 'requester', attemptId: 'attempt', route: { stages: [{ participantId: 'entry' }, { participantId: 'exit' }] } };
const archived = { phase: 'cleanup-failed', identity, acknowledgments: { waits: 1 } };
const state = { phase: 'ready', unknownAttempts: [archived] };
const id = 'service:requester:attempt';
function fixture() {
  const evidence = { identity, receipts: [] };
  const outcome = { id, settledAt: 42, evidenceHash: createHash('sha256').update(canonicalize(evidence)).digest('hex') };
  const record = { state: 'settled', binding: { id, mode: 'partition', route: identity }, evidence, outcome };
  return { record, credits: { call: vi.fn(async op => op === 'request' ? record : outcome) } };
}

it('uses exact authenticated settlement before removing a retired attempt from active capacity', async () => {
  const { record, credits } = fixture();
  const history = createStageHistory({ credits, participantId: 'entry', notify: () => {} });
  expect(activeProviderRequests(state)).toBe(1);
  await history.refresh(state);
  expect(credits.call.mock.calls).toEqual([['request', { id }], ['settle', { id, evidence: record.evidence }]]);
  const visible = history.view(state);
  expect(activeProviderRequests(visible)).toBe(0);
  expect(visible.creditReconciledAttempts[0]).toMatchObject({ phase: 'cleanup-failed', identity, creditSettlement: { settledAt: 42 } });
  expect(state.unknownAttempts).toEqual([archived]);
  expect(activeProviderRequests(history.view({ ...state, reservations: { active: 1 } }))).toBe(1);
  expect(activeProviderRequests(history.view({ ...state, attempts: [{ cleanupSettledAt: null }] }))).toBe(1);
  expect(activeProviderRequests(history.view({ ...state, unknownAttempts: [{...archived,identity:{...identity,threadId:'other'}}] }))).toBe(1);
});

it.each(['pending','identity','missing evidence','wrong hash','coordinator rejects proof','conflicting reply'])('retains unknown ownership when %s', async fault => {
  const { record, credits } = fixture();
  if (fault === 'pending') record.state='closing';
  if (fault === 'identity') record.binding.route={...identity,threadId:'unrelated'};
  if (fault === 'missing evidence') record.evidence=null;
  if (fault === 'wrong hash') record.outcome.evidenceHash='0'.repeat(64);
  if (fault === 'coordinator rejects proof') credits.call.mockImplementation(async op => {
    if (op === 'request') return record;
    throw Error('Signature or owner fence does not verify');
  });
  if (fault === 'conflicting reply') credits.call.mockImplementation(async op => op === 'request' ? record : { ...record.outcome,settledAt:43 });
  const history = createStageHistory({ credits, participantId:'entry', notify:()=>{} });
  expect(await history.refresh(state)).toBe(false);
  expect(activeProviderRequests(history.view(state))).toBe(1);
});

it('keeps unbilled historical and other contributors’ attempts outside fleet reconciliation',async()=>{
  const {credits}=fixture();
  const history=createStageHistory({credits,participantId:'entry',notify:()=>{}});
  const unpaid={...archived,acknowledgments:undefined},other={...archived,identity:{...identity,route:{stages:[{participantId:'other'}]}}};
  const rows={...state,unknownAttempts:[unpaid,other]};
  await history.refresh(rows);
  expect(credits.call).not.toHaveBeenCalled();
  expect(activeProviderRequests(history.view(rows))).toBe(2);
});
