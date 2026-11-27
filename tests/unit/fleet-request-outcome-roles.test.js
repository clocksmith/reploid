// @vitest-environment node
/**
 * Every operation record names its roles (reploid.operation-roles/1) beside the fields it already had and outside the
 * signed bytes: the request outcome (reploid.request-outcome/v1) and the settlement-records summaries.
 */
import { describe, expect, it } from 'vitest';
import { parseOperationRoles } from '../../packages/reploid/src/contracts/computer-records.js';
import { buildFleetRequestOutcome, settlementRecordsOf } from '../../server/fleet/requester.js';
import { summarizeTradeRecords } from '../../server/fleet/trade-record-store.js';

const requester = 'peer:aaaaaaaaaaaaaaaaaaaaaaaa', host = 'peer:bbbbbbbbbbbbbbbbbbbbbbbb';
const base = { attemptId: 'a1', threadId: 't1', mode: 'whole-model', model: { id: 'm', identity: `sha256:${'1'.repeat(64)}` },
  inputDigest: `sha256:${'2'.repeat(64)}`, acknowledged: { deltaCount: 1, outputCharacters: 2, acknowledgedOutputTokens: 1 }, recordedAt: 5 };
const roles = { schema: 'reploid.operation-roles/1', operation: 'inference', operationId: 'service:r1',
  consumer: { computerId: requester, participantId: requester }, provider: { computerId: 'bee', participantId: host } };

describe('request outcome roles', () => {
  it('names the consumer and provider of a dispatched whole-model request beside providerId and providerIdentity', () => {
    const outcome = buildFleetRequestOutcome({ ...base, reservationId: 'service:r1', executionId: 'e1', providerId: 'bee', providerIdentity: host,
      consumerId: requester, phase: 'in-flight', dispatched: true, settlement: { status: 'completed', charge: 3, outputTokens: 1, settledAt: 6 }, maximum: 8 });
    expect(outcome).toMatchObject({ schema: 'reploid.request-outcome/v1', providerId: 'bee', providerIdentity: host, operationRoles: roles });
    expect(parseOperationRoles(outcome.operationRoles)).toEqual(roles);
    // The key stands for its computer when the ledger enrollment is not known.
    expect(buildFleetRequestOutcome({ ...base, reservationId: 'service:r1', providerIdentity: host, consumerId: requester, phase: 'in-flight',
      dispatched: true, maximum: 8 }).operationRoles.provider).toEqual({ computerId: host, participantId: host });
  });

  it('has no roles before a provider is known, without a reservation, or for a split answer', () => {
    const queued = buildFleetRequestOutcome({ ...base, consumerId: requester, phase: 'queued', dispatched: false });
    expect(queued.operationRoles).toBeNull();
    expect(buildFleetRequestOutcome({ ...base, mode: 'partition', reservationId: 'service:r1', providerId: 'bee', providerIdentity: host,
      consumerId: requester, phase: 'in-flight', dispatched: true }).operationRoles).toBeNull();
  });
});

describe('settlement-records summary roles', () => {
  const terms = { schema: 'reploid.settlement-terms/v1', reservationId: 'service:r1', attemptId: 'a1', requesterId: requester,
    shares: [{ participantId: host }] };
  it('summarizeTradeRecords names the two keys as operation roles', () => {
    expect(summarizeTradeRecords([terms], 'service:r1').operationRoles).toEqual({ ...roles,
      provider: { computerId: host, participantId: host } });
    expect(summarizeTradeRecords([], 'service:r1').operationRoles).toBeNull();
  });
  it('settlementRecordsOf carries the roles beside requesterId and providerId, outside the signed records', () => {
    const charge = { summary: () => ({ complete: false, attemptId: 'a1', requesterId: requester, providerId: host, missing: ['close'],
      acknowledged: null, stopped: false, faulted: false }), records: () => [terms] };
    const held = settlementRecordsOf({ reservationId: 'service:r1', charge, policy: {} });
    expect(held).toMatchObject({ requesterId: requester, providerId: host, operationRoles: { ...roles, provider: { computerId: host, participantId: host } } });
    expect(held.records).toEqual([terms]);
  });
});
