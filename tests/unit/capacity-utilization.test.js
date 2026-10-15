// Capacity-weighted readiness utilization over exported records: maintained readiness, consumed admissions by outcome,
// paid versus unpaid readiness, unknown coverage, routes and the REP-14 CLI loader. Synthetic records only.
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { summarizeCapacityUtilization, readinessContractsFromOffers } from '../../packages/reploid/src/measurement/index.js';
import { loadUtilizationInput, formatUtilization } from '../../scripts/capacity-utilization.js';

const S = 1000, M = 'sha256:' + 'a'.repeat(64), P = 'plan-1';
const span = (participantId, stageIndex, from, to, state = 'ready', capacity = { unit: 'attempt-slots', amount: 2 }) =>
  ({ schema: 'reploid.readiness-span/v1', participantId, modelIdentity: M, planId: P, stageIndex, from: from * S, to: to * S, state,
    capacity: state === 'ready' ? capacity : null });
const route = participants => ({ schema: 'reploid.partition-route/v1', modelId: 'model', modelIdentity: M, planId: P,
  stages: participants.map((participantId, index) => ({ index, participantId })) });
const admission = (participantId, index, attemptId, reservedAt, settledAt, { failure = null, participants = ['a', 'b'], resources = { attemptSlots: 1 } } = {}) => ({
  identity: { schema: 'reploid.partition-attempt/v2', threadId: 't', attemptId, requesterId: 'r', placementGeneration: 0, route: route(participants) },
  participantId, index, phase: settledAt === null ? 'reserved' : failure ? 'failed' : 'settled',
  reservedAt: reservedAt * S, settlingAt: settledAt === null ? null : settledAt * S, settledAt: settledAt === null ? null : settledAt * S, failure, resources });
const contract = (participantId, stageIndex, from, to, status = 'accepted', offerId = `offer-${participantId}-${from}`) =>
  ({ offerId, participantId, modelIdentity: M, planId: P, stageIndex, from: from * S, to: to * S, status });
const interval = { from: 0, to: 100 * S };
const stageOf = (summary, participantId) => summary.contributors.find(row => row.participantId === participantId).stages[0];

describe('capacity-weighted readiness utilization', () => {
  it('weights readiness by admitted slots, splits paid readiness and keeps gaps unknown rather than zero', () => {
    const summary = summarizeCapacityUtilization({ interval,
      readiness: [span('a', 0, 0, 60), span('a', 0, 60, 80, 'unready')],
      contracts: [contract('a', 0, 0, 40), contract('a', 0, 40, 60, 'offered')],
      admissions: [admission('a', 0, 'done', 10, 30), admission('a', 0, 'broken', 20, 50, { failure: 'Stage failed' }),
        admission('a', 0, 'stopped', 45, 55), admission('a', 0, 'undecided', 50, 58)],
      attempts: [{ attemptId: 'done', status: 'completed', satisfactory: true }, { attemptId: 'broken', status: 'failed' },
        { attemptId: 'stopped', status: 'cancelled' }, { attemptId: 'undecided', status: 'completed' }] });
    const stage = stageOf(summary, 'a');
    expect(stage.contracts).toEqual(['offer-a-0']);
    expect(stage.maintained).toEqual({ capacitySeconds: null, knownCapacitySeconds: 120, paidCapacitySeconds: 80, unpaidCapacitySeconds: 40,
      readyMs: 60 * S, unreadyMs: 20 * S, unknownMs: 20 * S, undeclaredCapacityMs: 0, paidUnknownMs: 0 });
    // Overlapping admissions each hold their own slot: 20 + 30 + 10 + 8 slot-seconds.
    expect(stage.consumed).toMatchObject({ capacitySeconds: 68, admissions: 4, open: 0, unknownAmount: 0 });
    expect(stage.consumed.byOutcome).toMatchObject({ satisfactory: { admissions: 1, capacitySeconds: 20, paidCapacitySeconds: 20 },
      failed: { admissions: 1, capacitySeconds: 30, paidCapacitySeconds: 20 }, cancelled: { capacitySeconds: 10, paidCapacitySeconds: 0 },
      unassessed: { admissions: 1, capacitySeconds: 8 } });
    expect(stage.ratios).toEqual({ reasons: ['readiness-gaps', 'unassessed-completions'],
      usefulToMaintained: null, usefulToPaid: null, occupiedToMaintained: null });
  });

  it('computes useful, paid and occupied ratios per contributor and per route when every input is known', () => {
    const summary = summarizeCapacityUtilization({ interval,
      readiness: [span('a', 0, 0, 100), span('b', 1, 0, 100)],
      contracts: [contract('a', 0, 0, 50)],
      admissions: [admission('a', 0, 'x', 0, 20), admission('b', 1, 'x', 0, 20), admission('a', 0, 'y', 10, 30), admission('b', 1, 'y', 10, 30),
        admission('a', 0, 'z', 60, 70), admission('b', 1, 'z', 60, 70, { failure: 'Lost' })],
      attempts: [{ attemptId: 'x', status: 'completed', satisfactory: true, supply: 'mesh' },
        { attemptId: 'y', status: 'completed', satisfactory: false, supply: 'mesh' }, { attemptId: 'z', status: 'failed', supply: 'mesh' },
        { attemptId: 'h', status: 'completed', supply: 'hosted' }] });
    expect(stageOf(summary, 'a')).toMatchObject({ unit: 'attempt-slots',
      maintained: { capacitySeconds: 200, paidCapacitySeconds: 100, unpaidCapacitySeconds: 100 },
      consumed: { capacitySeconds: 50, byOutcome: { satisfactory: { capacitySeconds: 20, paidCapacitySeconds: 20 },
        unsatisfactory: { capacitySeconds: 20 }, failed: { capacitySeconds: 10 } } },
      ratios: { reasons: [], usefulToMaintained: 0.1, usefulToPaid: 0.2, occupiedToMaintained: 0.25 } });
    // Stage b holds no contract: its useful/paid ratio has no denominator.
    expect(stageOf(summary, 'b').ratios).toEqual({ reasons: [], usefulToMaintained: 0.1, usefulToPaid: null, occupiedToMaintained: 0.25 });
    expect(summary.contributors.find(row => row.participantId === 'a').total).toMatchObject({ unit: 'attempt-slots',
      maintained: { capacitySeconds: 200 }, ratios: { usefulToMaintained: 0.1 } });
    expect(summary.routes).toHaveLength(1);
    expect(summary.routes[0]).toMatchObject({ route: { planId: P, participants: ['a', 'b'] }, unit: 'attempt-slots',
      maintained: { capacitySeconds: 400, paidCapacitySeconds: 100, readyMs: 100 * S },
      consumed: { capacitySeconds: 100, admissions: 6, byOutcome: { satisfactory: { capacitySeconds: 40, paidCapacitySeconds: 20 } } },
      ratios: { reasons: [], usefulToMaintained: 0.1, usefulToPaid: 0.2, occupiedToMaintained: 0.25 } });
    // Hosted answers are counted apart and never become mesh capacity.
    expect(summary.attempts.bySupply).toMatchObject({ mesh: 3, hosted: 1, mixed: 0, unclassified: 0 });
  });

  it('makes a route unknown while any stage is unknown and ready only while every stage is ready', () => {
    const summary = summarizeCapacityUtilization({ interval,
      readiness: [span('a', 0, 0, 100), span('b', 1, 0, 40), span('b', 1, 40, 70, 'unready')],
      admissions: [admission('a', 0, 'x', 0, 10), admission('b', 1, 'x', 0, 10)], attempts: [{ attemptId: 'x', status: 'completed', satisfactory: true }] });
    expect(summary.routes[0].maintained).toMatchObject({ readyMs: 40 * S, unreadyMs: 30 * S, unknownMs: 30 * S, knownCapacitySeconds: 160, capacitySeconds: null });
    expect(summary.routes[0].ratios.reasons).toEqual(['readiness-gaps']);
  });

  it('reports open admissions, undeclared capacity and unknown amounts as unknown', () => {
    const open = summarizeCapacityUtilization({ interval, observedUntil: 80 * S, readiness: [span('a', 0, 0, 100)],
      admissions: [admission('a', 0, 'running', 70, null)], attempts: [{ attemptId: 'running', status: 'executing' }] });
    expect(stageOf(open, 'a').consumed).toMatchObject({ capacitySeconds: 10, open: 1, byOutcome: { active: { admissions: 1 } } });
    expect(stageOf(open, 'a').ratios).toMatchObject({ reasons: ['open-after-observation', 'active-attempts'], occupiedToMaintained: null });

    const undeclared = summarizeCapacityUtilization({ interval, readiness: [span('a', 0, 0, 100, 'ready', null)] });
    expect(stageOf(undeclared, 'a').maintained).toMatchObject({ capacitySeconds: null, knownCapacitySeconds: 0, undeclaredCapacityMs: 100 * S });
    expect(stageOf(undeclared, 'a').ratios.reasons).toEqual(['capacity-not-declared']);

    const bytes = summarizeCapacityUtilization({ interval, readiness: [span('a', 0, 0, 100, 'ready', { unit: 'bytes', amount: 4096 })],
      admissions: [admission('a', 0, 'x', 0, 10), admission('b', 1, 'x', 0, 10, { resources: { attemptSlots: 1, attemptBytes: 1024 } })],
      attempts: [{ attemptId: 'x', status: 'completed', satisfactory: true }] });
    expect(stageOf(bytes, 'a')).toMatchObject({ unit: 'bytes', maintained: { capacitySeconds: 409600 }, consumed: { unknownAmount: 1 },
      ratios: { reasons: ['unknown-consumption-amount'], usefulToMaintained: null } });
    expect(summarizeCapacityUtilization({ interval, admissions: [admission('a', 0, 'x', 0, 10)] }).contributors[0].stages[0]
      .consumed.byOutcome.unmatched.admissions).toBe(1);
  });

  it('merges repeated exports of one admission and refuses contradictory or overlapping records', () => {
    const first = admission('a', 0, 'x', 0, null), settled = admission('a', 0, 'x', 0, 10);
    const merged = summarizeCapacityUtilization({ interval, readiness: [span('a', 0, 0, 100)], admissions: [first, settled],
      attempts: [{ attemptId: 'x', status: 'completed', satisfactory: true }] });
    expect(stageOf(merged, 'a').consumed).toMatchObject({ admissions: 1, open: 0, capacitySeconds: 10 });
    expect(() => summarizeCapacityUtilization({ interval, admissions: [settled, admission('a', 0, 'x', 5, 10)] })).toThrow('conflicting admission');
    expect(() => summarizeCapacityUtilization({ interval, readiness: [span('a', 0, 0, 50), span('a', 0, 40, 60)] })).toThrow('overlap');
    expect(() => summarizeCapacityUtilization({ interval, readiness: [span('a', 0, 0, 50),
      span('a', 0, 50, 60, 'ready', { unit: 'bytes', amount: 1 })] })).toThrow('several capacity units');
    expect(() => summarizeCapacityUtilization({ interval: { from: 10, to: 10 } })).toThrow('interval');
  });

  it('loads exported workspaces, resident states, offers and quality decisions for the CLI', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'capacity-utilization-'));
    const offer = { schema: 'reploid.contribution-offer/v1', offerId: 'readiness-1', category: 'prepared_readiness', status: 'accepted',
      work: { category: 'prepared_readiness', participantId: 'a', contractedBy: 'operator', stage: { model: { modelId: 'model', modelIdentity: M, planId: P }, stageIndex: 0 } },
      duration: { startsAt: new Date(0).toISOString(), endsAt: new Date(50 * S).toISOString() } };
    expect(readinessContractsFromOffers([offer, { ...offer, category: 'contracted_storage' }])).toEqual([contract('a', 0, 0, 50, 'accepted', 'readiness-1')]);
    const workspace = { schema: 'reploid.chat-workspace/v1', threads: [{ attempts: [{ id: 'x', status: 'completed',
      provenance: { schema: 'reploid.answer-provenance/v1', supply: 'mesh' } }] }] };
    const file = path.join(directory, 'input.json');
    await writeFile(file, JSON.stringify({ schema: 'reploid.capacity-utilization-input/v1',
      interval: { from: new Date(0).toISOString(), to: new Date(100 * S).toISOString() }, readiness: [span('a', 0, 0, 100)],
      residentStates: [{ reservations: { records: [admission('a', 0, 'x', 0, 20, { participants: ['a'] })] } }],
      workspaces: [workspace], offers: [offer], quality: [{ attemptId: 'x', satisfactory: true }] }));
    const input = await loadUtilizationInput([file]);
    expect(input.attempts).toEqual([{ attemptId: 'x', status: 'completed', supply: 'mesh', satisfactory: true }]);
    const summary = summarizeCapacityUtilization(input);
    expect(stageOf(summary, 'a').ratios).toEqual({ reasons: [], usefulToMaintained: 0.1, usefulToPaid: 0.2, occupiedToMaintained: 0.1 });
    const text = formatUtilization(summary);
    expect(text).toContain('maintained ready 200.0 (known 200.0; paid 100.0, unpaid 100.0)');
    expect(text).toContain('useful/maintained 0.100; useful/paid 0.200');
    expect(text).toContain('Attempts 1 by answer supply: mesh 1');
    const gaps = formatUtilization(summarizeCapacityUtilization({ ...input, readiness: [span('a', 0, 0, 60)] }));
    expect(gaps).toContain('maintained ready unknown');
    expect(gaps).toContain('useful/maintained unknown (readiness-gaps)');
  });
});
