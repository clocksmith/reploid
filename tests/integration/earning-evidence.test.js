// @vitest-environment node
// Settlement that no longer depends only on the requester's unsigned report. Real resident stages sign
// cumulative receipts with their registered participant identities; the requester's browser host signs
// the attempt's charge binding and acknowledges each output it received; contributor hosts submit their
// own evidence through their outboxes. The ledger verifies every signature against the signer's
// registration at its signing time and settles from acknowledged evidence under the quote's evidence
// terms, holding unacknowledged asserted work in dispute for operational review. Memory and fake
// Firestore stores; test-only provider, policies, windows and amounts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MAX_UNACKNOWLEDGED_OUTPUTS, createAttemptEvidenceSigner, openOutputAcknowledgments } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { CAPACITY_EVIDENCE_SCHEMA as COMMUNITY_CAPACITY_SCHEMA } from '../../server/community-access/domain.js';
import { createCommunityAccess } from '../../server/community-access/engine.js';
import { createMemoryCommunityAccessBackend } from '../../server/community-access/stores.js';
import { EVIDENCE_TERMS, FULL_CHARGE, REPORT_SCHEMA, SHARE, createEarningHarness } from '../helpers/earning-harness.js';
import { newIdentity } from '../helpers/account-fixture.js';
import { STEPS, residentRoute } from '../helpers/resident-route.js';
import { MIN, advance, clock, commit, decidedBy, fund, fundingAuthority, fx, quoteInput } from '../helpers/reward-fixture.js';

// Test-only Community Access policy: no guarantee, one pool, and the evidence terms its quotes carry.
const COMMUNITY_POLICY = Object.freeze({
  policyVersion: 'test-community/1',
  poolAccountId: 'pool_general',
  guarantee: { mode: 'none' },
  queue: { maxLength: 4, maxPerAccount: 2, maxWaitMs: 10 * MIN },
  usage: { windowMs: 60 * MIN, maxAdmissions: 3, maxAuthorizedCredits: 200 },
  rateLimits: { account: { windowMs: MIN, maxRequests: 5 }, device: { windowMs: MIN, maxRequests: 4 } },
  capacity: { evidenceMaxAgeMs: 5 * MIN },
  evidence: EVIDENCE_TERMS
});
// Past the quoted deadline (three minutes) plus the evidence window (five), before the reservation period ends (ten).
const PAST_WINDOW = 3 * MIN + EVIDENCE_TERMS.windowMs + MIN;
const withheld = (url, init) => (url.endsWith('/reports') ? Promise.reject(new Error('the requester withholds its report')) : fetch(url, init));

describe.each(['memory', 'firestore'])('settlement from signed evidence (%s store)', (kind) => {
  let h;
  beforeEach(async () => { h = await createEarningHarness(kind).open(); });
  afterEach(async () => { await h.close(); });

  const reservationOf = async (requester, threadId) => h.services.ledger.getReservation((await requester.attempts.getThread(threadId)).reservationId);
  const submitAll = async ({ c0, c1, route }) => ({
    c0: await c0.claims().submitEvidence(route.admissions(0)),
    c1: await c1.claims().submitEvidence(route.admissions(1))
  });
  const settleDue = async () => {
    const answer = await h.operator('POST', '/operator/evidence/settle-due', {});
    if (answer.status !== 200) throw Object.assign(new Error(`settle-due ${answer.status}: ${JSON.stringify(answer.body)}`), { answer });
    return answer.body.results;
  };

  it('settles an honest completed answer at once, as without evidence, and keeps later evidence without effect', async () => {
    const net = await h.network();
    const { c0, c1, route, stageOffers, requester, requesterAccount } = net;
    const thread = requester.thread();
    const attempt = await requester.app.send(thread, 'Question');
    expect(attempt.status).toBe('completed');
    const reservation = await reservationOf(requester, thread);
    // The report carried the requester's acknowledgment of every output with the final stage's completion receipt.
    expect(reservation).toMatchObject({ status: 'settled', settlement: { outcome: 'full', charge: FULL_CHARGE, basis: 'report', dispute: null } });
    expect(await h.journal(requesterAccount)).toEqual([['issue', 100], ['reserve', 60], ['charge', FULL_CHARGE], ['release', 60 - FULL_CHARGE]]);
    const kept = await h.services.ledger.getAttemptEvidence({ reservationId: reservation.reservationId, attemptId: attempt.id });
    expect(kept).toMatchObject({ acknowledged: { count: STEPS }, stages: { 1: { output: { count: STEPS, done: true } } } });

    // Each stage host closed its receipt and holds the final acknowledgment; submitting it changes no balance.
    const submitted = await submitAll(net);
    expect([...submitted.c0, ...submitted.c1]).toEqual([expect.objectContaining({ status: 'done' }), expect.objectContaining({ status: 'done' })]);
    expect(await h.services.ledger.getAttemptEvidence({ reservationId: reservation.reservationId, attemptId: attempt.id }))
      .toMatchObject({ stages: { 0: { status: 'settled', steps: STEPS }, 1: { status: 'settled', steps: STEPS } }, acknowledged: { count: STEPS } });
    expect(await h.journal(requesterAccount)).toEqual([['issue', 100], ['reserve', 60], ['charge', FULL_CHARGE], ['release', 60 - FULL_CHARGE]]);
    expect((await c0.claims({ stageShare: stageOffers[0] }).claimStageShares(route.admissions(0)))[0]).toMatchObject({ outcome: 'accepted', issuance: 'issued' });
    expect(await h.issued(c1.accountId)).toBe(0);
    await h.reconcileBooks([requesterAccount, c0.accountId, c1.accountId]);
  });

  it('settles from the stages\' receipts and the forwarded acknowledgments when the requester withholds its report', async () => {
    const net = await h.network({ fetch: withheld });
    const { c0, c1, route, stageOffers, requester, requesterAccount, requesterIdentity } = net;
    const thread = requester.thread();
    const attempt = await requester.app.send(thread, 'Question');
    expect(attempt.status).toBe('completed');
    const open = await reservationOf(requester, thread);
    expect(open).toMatchObject({ status: 'open', settlement: null });
    // Without evidence the hold would expire at zero charge; the contributors submit theirs instead.
    await submitAll(net);
    expect(await settleDue()).toEqual([]);
    expect((await h.services.ledger.getReservation(open.reservationId)).status).toBe('open');

    advance(PAST_WINDOW);
    const [decided] = await settleDue();
    expect(decided).toMatchObject({ reservationId: open.reservationId, status: 'settled', basis: 'evidence',
      settlement: { outcome: 'full', charge: FULL_CHARGE, metering: { output: STEPS }, attempt: { attemptId: attempt.id } } });
    expect(await h.journal(requesterAccount)).toEqual([['issue', 100], ['reserve', 60], ['charge', FULL_CHARGE], ['release', 60 - FULL_CHARGE]]);
    expect(await settleDue()).toEqual([]);

    // Stage shares follow the evidence-settled outcome through each stage's own verified receipt.
    expect((await c0.claims({ stageShare: stageOffers[0] }).claimStageShares(route.admissions(0)))[0]).toMatchObject({ outcome: 'accepted', issuance: 'issued' });
    expect((await c1.claims({ stageShare: stageOffers[1] }).claimStageShares(route.admissions(1)))[0]).toMatchObject({ outcome: 'accepted', issuance: 'pending' });
    expect(await h.journal(c0.accountId)).toEqual([['issue', SHARE]]);

    // The withheld report, sent late from a restarted host, has no second effect.
    const late = h.requesterHost({ route, identity: requesterIdentity, storage: requester.storage });
    expect(await late.attempts.reconcile()).toEqual([expect.objectContaining({ ok: false, code: 'reservation_already_settled', pending: false })]);
    expect(await h.journal(requesterAccount)).toEqual([['issue', 100], ['reserve', 60], ['charge', FULL_CHARGE], ['release', 60 - FULL_CHARGE]]);
    await h.reconcileBooks([requesterAccount, c0.accountId, c1.accountId]);
  });

  it('overrides a report that understates acknowledged work, whether the evidence arrives after the report or before it', async () => {
    // A requester host that acknowledged every output, then reports a cancellation after one step without its evidence.
    let gate = null;
    const understate = async (url, init) => {
      if (url.endsWith('/reports') && init?.body) {
        const body = JSON.parse(init.body);
        if (body.report.result === 'completed') {
          const { attemptId, identity, execution } = body.report;
          body.report = { schema: REPORT_SCHEMA, result: 'cancelled', attemptId, identity, cancellation: { cause: 'requester' },
            activity: { schema: 'reploid.partition-activity/v1', identity, sequence: 0, stepSummary: { count: 1,
              stages: execution.stepSummary.stages.map((row) => ({ partitionIndex: row.partitionIndex, steps: 1, stepMs: { count: 1, total: 0 } })) } } };
          init = { ...init, body: JSON.stringify(body) };
        }
        if (gate) { gate.reached.resolve(); await gate.release.promise; }
      }
      return fetch(url, init);
    };
    const net = await h.network({ fetch: understate });
    const { c0, c1, route, stageOffers, requester, requesterAccount } = net;
    const thread = requester.thread();
    expect((await requester.app.send(thread, 'Question')).status).toBe('completed');
    // The understated report waits for the evidence window instead of settling one step's cancellation.
    const reported = await reservationOf(requester, thread);
    expect(reported).toMatchObject({ status: 'open', report: { rule: 'cancelled_after_dispatch', settle: { outcome: 'cancellation', metering: { output: 1 } } } });
    expect(await requester.attempts.getThread(thread)).toMatchObject({ status: 'awaiting_evidence', retryable: false });
    expect((await h.http(h.base, 'POST', `/reservations/${reported.reservationId}/attempts`, { token: (await requester.client.ensureSession()).token, key: 'rebind',
      body: { attemptId: 'att_rebind', recipients: [c0.identity.peerId] } })).body.error).toBe('attempt_already_reported');
    await submitAll(net);
    advance(PAST_WINDOW);
    const [decided] = await settleDue();
    expect(decided).toMatchObject({ basis: 'report_overridden', settlement: { outcome: 'full', charge: FULL_CHARGE, metering: { output: STEPS } } });
    expect(await h.journal(requesterAccount)).toEqual([['issue', 100], ['reserve', 60], ['charge', FULL_CHARGE], ['release', 60 - FULL_CHARGE]]);

    // Evidence first: the understated report contradicts it on arrival and settles from the acknowledgments at once.
    gate = { reached: Promise.withResolvers(), release: Promise.withResolvers() };
    const second = requester.thread();
    const sending = requester.app.send(second, 'Follow-up');
    await gate.reached.promise;
    const submitted = await submitAll(net);
    expect(submitted.c0.at(-1)).toMatchObject({ status: 'done', rejected: [] });
    gate.release.resolve();
    expect((await sending).status).toBe('completed');
    expect(await reservationOf(requester, second)).toMatchObject({ status: 'settled',
      settlement: { outcome: 'full', charge: FULL_CHARGE, basis: 'report_overridden' } });
    expect((await h.journal(requesterAccount)).slice(4)).toEqual([['reserve', 60], ['charge', FULL_CHARGE], ['release', 60 - FULL_CHARGE]]);
    expect((await c0.claims({ stageShare: stageOffers[0] }).claimStageShares(route.admissions(0))).map((row) => row.outcome)).toEqual(['accepted', 'accepted']);
    await h.reconcileBooks([requesterAccount, c0.accountId, c1.accountId]);
  });

  it('settles the acknowledged part when the requester stops acknowledging, and holds the rest in dispute until review', async () => {
    // A requester host that acknowledges only the first output and withholds its report.
    const firstOnly = (generate) => (request, controls) => {
      const view = Object.create(controls);
      Object.defineProperty(view, 'onOutput', { get: () => controls.onOutput && ((record) => (record.step === 0 ? controls.onOutput(record) : null)) });
      return generate(request, view);
    };
    const net = await h.network({ fetch: withheld, generate: firstOnly });
    const { c0, c1, route, stageOffers, requester, requesterAccount } = net;
    const thread = requester.thread();
    expect((await requester.app.send(thread, 'Question')).status).toBe('completed');
    const { reservationId } = await reservationOf(requester, thread);
    await submitAll(net);
    expect(await h.services.ledger.getAttemptEvidence({ reservationId, attemptId: route.admissions(0)[0].identity.attemptId }))
      .toMatchObject({ acknowledged: { count: 1 }, stages: { 1: { output: { count: STEPS, done: true } } } });
    advance(PAST_WINDOW);
    const partial = Math.ceil(1 / 2);
    const held = FULL_CHARGE - partial;
    const [decided] = await settleDue();
    expect(decided).toMatchObject({ status: 'disputed', basis: 'evidence', dispute: { disputeId: `dsp:${reservationId}`, held, status: 'pending_review' },
      settlement: { outcome: 'partial_delivery', metering: { output: 1 }, charge: partial, released: 60 - partial - held } });
    expect(await h.journal(requesterAccount)).toEqual([['issue', 100], ['reserve', 60], ['charge', partial], ['release', 60 - partial - held]]);
    expect(await h.services.ledger.getAccount(requesterAccount)).toMatchObject({ held });
    // Disputed work never expires into a release, and earns nothing yet.
    advance(10 * MIN);
    expect(await h.services.ledger.expireReservations()).toEqual([]);
    expect((await c0.claims({ stageShare: stageOffers[0] }).claimStageShares(route.admissions(0)))[0]).toMatchObject({ status: 'open', tries: 1 });
    expect(await h.reconcileBooks([requesterAccount, c0.accountId, c1.accountId])).toMatchObject({ reservations: { disputed: { count: 1, held } } });

    // Operational review: the dispute names its charges; the asserted disposition charges the held difference.
    const dispute = (await h.operator('GET', `/operator/disputes/${encodeURIComponent(`dsp:${reservationId}`)}`)).body;
    expect(dispute).toMatchObject({ status: 'pending_review', acknowledgedCharge: partial, assertedCharge: FULL_CHARGE,
      dispositionCharges: { acknowledged: 0, asserted: held }, asserted: { outcome: 'full', metering: { output: STEPS } } });
    expect((await h.operator('GET', '/operator/disputes')).body.disputes.map((row) => row.disputeId)).toEqual([dispute.disputeId]);
    const resolve = (key, disposition) => h.operator('POST', `/operator/disputes/${encodeURIComponent(dispute.disputeId)}/resolve`, { disposition, decisionId: 'review:1' }, key);
    expect((await resolve('resolve-0', 'paid_in_part')).status).toBe(400);
    const resolved = await resolve('resolve-1', 'asserted');
    expect(resolved.body).toMatchObject({ outcome: 'full', charge: FULL_CHARGE, released: 60 - FULL_CHARGE,
      dispute: { status: 'resolved', disposition: 'asserted', charged: held, reviewer: { reviewerId: 'settlement_test', authority: 'operational_review' } } });
    expect((await resolve('resolve-1', 'asserted')).body).toEqual(resolved.body);
    expect((await resolve('resolve-2', 'acknowledged')).body.error).toBe('dispute_already_resolved');
    expect(await h.journal(requesterAccount)).toEqual([['issue', 100], ['reserve', 60], ['charge', partial], ['release', 60 - partial - held], ['charge', held]]);

    // The resolved outcome earns the stage shares, once.
    expect((await c0.claims({ stageShare: stageOffers[0] }).claimStageShares(route.admissions(0)))[0]).toMatchObject({ outcome: 'accepted', issuance: 'issued' });
    expect(await h.journal(c0.accountId)).toEqual([['issue', SHARE]]);
    await h.reconcileBooks([requesterAccount, c0.accountId, c1.accountId]);
  });

  it('bounds unacknowledged work: an honest answer never waits, and one left unacknowledged stops within K + 1 outputs', async () => {
    const K = MAX_UNACKNOWLEDGED_OUTPUTS;
    const steps = 8;
    // An honest requester acknowledges every output; with K outputs of slack the route never waits for it.
    const honest = await h.network({ steps });
    const thread = honest.requester.thread();
    const answer = await honest.requester.app.send(thread, 'Question');
    expect(answer.status).toBe('completed');
    expect(honest.requester.app.getState().threads[0].messages.at(-1).content).toBe('01234567');
    const [receipt] = honest.route.runner.getState().attempts;
    // In-process stages decode in microseconds, so the requester's signing can trail by a few milliseconds; it never runs overdue.
    if (process.env.REPLOID_REPORT_ACK_WAITS) console.log('honest integration acknowledgment waits', JSON.stringify(receipt.acknowledgments));
    expect(receipt.acknowledgments).toMatchObject({ bound: K });
    expect(receipt.acknowledgments.waitedMs).toBeLessThan(1000);
    expect(await reservationOf(honest.requester, thread)).toMatchObject({ status: 'settled', settlement: { outcome: 'full', charge: 10 + steps / 2 } });
    await h.reconcileBooks([honest.requesterAccount]);
  });

  it('stops a route whose requester stops acknowledging, settles what it acknowledged and keeps the dispute within the bound', async () => {
    const K = MAX_UNACKNOWLEDGED_OUTPUTS;
    const steps = 8;
    const waitMs = 150;
    const firstOnly = (generate) => (request, controls) => {
      const view = Object.create(controls);
      Object.defineProperty(view, 'onOutput', { get: () => controls.onOutput && ((record) => (record.step === 0 ? controls.onOutput(record) : null)) });
      return generate(request, view);
    };
    const net = await h.network({ steps, acknowledgmentWaitMs: waitMs, generate: firstOnly });
    const { c0, c1, route, requester, requesterAccount } = net;
    const thread = requester.thread();
    const attempt = await requester.app.send(thread, 'Question');
    // The coordinator waited for the acknowledgment of output 2 before step 3, up to the attempt's deadline, then ended it.
    expect(attempt).toMatchObject({ status: 'failed' });
    const [receipt] = route.runner.getState().attempts;
    expect(receipt).toMatchObject({ phase: 'failed', acknowledgments: { bound: K, waits: 1 } });
    expect(receipt.acknowledgments.waitedMs).toBeGreaterThanOrEqual(waitMs - 20);
    // Every stage stopped within K + 1 outputs of the one acknowledged output, and closed its receipt.
    const acknowledged = 1;
    for (const index of [0, 1]) {
      expect(route.admissions(index)[0].evidence.receipts[0]).toMatchObject({ steps: acknowledged + K + 1, status: 'settled' });
    }
    const reservation = await reservationOf(requester, thread);
    expect(reservation).toMatchObject({ status: 'open', attempts: [expect.objectContaining({ status: 'failed', reason: 'execution_failed:ACKNOWLEDGMENT_OVERDUE' })] });
    await submitAll(net);
    advance(PAST_WINDOW);
    // Acknowledged work is charged as partial delivery; what the stages ran beyond it is disputed, never more than K + 1 outputs.
    const partial = Math.ceil(acknowledged / 2);
    const assertedOutputs = acknowledged + K + 1;
    const held = Math.ceil(assertedOutputs / 2) - partial;
    const [decided] = await settleDue();
    expect(decided).toMatchObject({ status: 'disputed', basis: 'evidence', dispute: { held },
      settlement: { outcome: 'partial_delivery', metering: { output: acknowledged }, charge: partial } });
    const dispute = await h.services.ledger.getDispute(`dsp:${reservation.reservationId}`);
    expect(dispute.asserted.metering.output).toBe(assertedOutputs);
    expect(dispute.asserted.metering.output - dispute.acknowledged.metering.output).toBeLessThanOrEqual(K + 1);
    expect(await h.journal(requesterAccount)).toEqual([['issue', 100], ['reserve', 60], ['charge', partial], ['release', 60 - partial - held]]);
    await h.reconcileBooks([requesterAccount, c0.accountId, c1.accountId]);
  });

  it('pays contributors serving a founder-funded Community Access request from receipts, charging the pool', async () => {
    // A process whose ledger lets the Community Access pool accept quotes for the requester devices it admits.
    await h.close();
    h = await createEarningHarness(kind).open({ communityPoolAccountIds: [COMMUNITY_POLICY.poolAccountId] });
    const access = createCommunityAccess({
      backend: createMemoryCommunityAccessBackend(), ledger: h.services.ledger, policy: COMMUNITY_POLICY, fundingAuthority, clock,
      accounts: { participantAccount: h.services.identity.participantAccount },
      readCommunityCapacity: async () => ({ schema: COMMUNITY_CAPACITY_SCHEMA, evidenceId: 'community-capacity:test', observedAt: clock(), admittedSlots: 1 })
    });
    await commit(h.services.ledger, { commitmentId: 'founder_commitment', funderKind: 'operator', amount: 100 });
    expect(await access.recordFunding({ fundingId: 'founder_pool', commitmentId: 'founder_commitment', quantity: 100,
      poolAccountId: COMMUNITY_POLICY.poolAccountId, authority: decidedBy('decision:founder_pool') })).toMatchObject({ status: 'issued' });
    const c0 = await h.contributor('contributor-0');
    const c1 = await h.contributor('contributor-1');
    const requesterIdentity = await newIdentity('ECDSA');
    const requester = h.clientFor({ identity: requesterIdentity, host: 'browser', subject: 'community-member' });
    const session = await requester.ensureSession();
    const route = await residentRoute({ participants: [c0.identity.peerId, c1.identity.peerId], requesterId: requesterIdentity.peerId,
      signers: [c0.signer, c1.signer] });
    try {
      const stageOffers = [await h.offer(c0, { offerId: 'offer_stage_0' }), await h.offer(c1, { offerId: 'offer_stage_1' })];
      // The member asks for access with service terms; the pool's policy stamps its evidence terms on the quote.
      const { service, pricing, terms } = quoteInput({ quoteId: 'unused', accountId: COMMUNITY_POLICY.poolAccountId });
      const admitted = await access.requestAccess({ requestId: 'community:1', participantId: requesterIdentity.peerId, deviceId: session.deviceId,
        quote: { service, pricing, terms } });
      expect(admitted).toMatchObject({ state: 'available', reservationId: expect.any(String) });
      const reservation = await h.services.ledger.getReservation(admitted.reservationId);
      expect(reservation).toMatchObject({ accountId: COMMUNITY_POLICY.poolAccountId, deviceId: session.deviceId, terms: { evidence: COMMUNITY_POLICY.evidence } });
      await expect(access.requestAccess({ requestId: 'community:other-terms', participantId: requesterIdentity.peerId, deviceId: session.deviceId,
        quote: { service, pricing, terms: { ...terms, evidence: { ...COMMUNITY_POLICY.evidence, windowMs: MIN } } } })).rejects.toMatchObject({ code: 'evidence_terms_mismatch' });

      // The requester's device binds its attempt to the pool reservation it was admitted under, then runs the route acknowledging outputs.
      const attemptId = 'community-attempt';
      expect((await h.http(h.base, 'POST', `/reservations/${admitted.reservationId}/attempts`, { token: session.token, key: 'community-bind',
        body: { attemptId, recipients: [c0.identity.peerId, c1.identity.peerId] } })).status).toBe(200);
      const identity = { schema: 'reploid.partition-attempt/v2', threadId: 'community-thread', attemptId, requesterId: requesterIdentity.peerId,
        placementGeneration: 0, route: route.route };
      const acknowledgments = await openOutputAcknowledgments({ signer: createAttemptEvidenceSigner({ identity: requesterIdentity, now: () => fx.nowMs }),
        identity, reservationId: admitted.reservationId });
      const result = await route.requester.generate({ threadId: identity.threadId, attemptId, messages: [{ role: 'user', content: 'Question' }] },
        { requestApproval: async () => true, charge: acknowledgments.charge, onOutput: (record) => acknowledgments.observe(record) });
      expect(result.content).toBe('012');
      // Without the requester's report, the contributors' receipts and forwarded acknowledgments settle it from the pool.
      await c0.claims().submitEvidence(route.admissions(0));
      await c1.claims().submitEvidence(route.admissions(1));
      advance(PAST_WINDOW);
      expect(await settleDue()).toEqual([expect.objectContaining({ status: 'settled', basis: 'evidence',
        settlement: expect.objectContaining({ outcome: 'full', charge: FULL_CHARGE }) })]);
      const pool = await h.services.ledger.listJournal(COMMUNITY_POLICY.poolAccountId);
      expect(pool.map((entry) => [entry.type, entry.amount, entry.lots[0].provenance])).toEqual([
        ['issue', 100, 'community_access'], ['reserve', 60, 'community_access'], ['charge', FULL_CHARGE, 'community_access'], ['release', 60 - FULL_CHARGE, 'community_access']
      ]);
      // Stage shares are paid as for a paid request; the counterparty is the member's own account, not the pool.
      expect((await c0.claims({ stageShare: stageOffers[0] }).claimStageShares(route.admissions(0)))[0]).toMatchObject({ outcome: 'accepted', issuance: 'issued' });
      expect(await h.journal(c0.accountId)).toEqual([['issue', SHARE]]);
      expect(await h.journal(session.accountId)).toEqual([]);
      await h.reconcileBooks([COMMUNITY_POLICY.poolAccountId, session.accountId, c0.accountId, c1.accountId]);
    } finally { await route.close(); }
  });

  it('rejects forged, impersonated, revoked-device, cross-attempt and outsider evidence', async () => {
    const net = await h.network({ fetch: withheld });
    const { c0, c1, route, requester, requesterAccount } = net;
    const first = requester.thread();
    expect((await requester.app.send(first, 'Question')).status).toBe('completed');
    const firstRecord = route.admissions(0)[0];
    const bundle = structuredClone(firstRecord.evidence);
    const finalReceipt = route.admissions(1)[0].evidence.receipts[0];
    const post = (client, evidence) => client.send({ opId: `evidence:${crypto.randomUUID()}`, path: '/attempt-evidence', body: { evidence } }).catch((error) => error);
    const reasons = (error) => error.body?.details?.reasons ?? [];

    // A receipt altered after signing, and one signed by another key in a stage participant's name.
    const forged = structuredClone(bundle.receipts[0]);
    forged.steps += 1;
    expect(reasons(await post(c0.client, { ...bundle, receipts: [forged], acknowledged: null }))).toEqual(['receipt:0:signature_invalid']);
    const impostor = createAttemptEvidenceSigner({ identity: await newIdentity('Ed25519'), now: () => fx.nowMs });
    const { publicJwk: _key, signature: _signature, ...body } = finalReceipt;
    const impersonated = await impostor.sign('reploid.stage-receipt/v1', { ...body, sequence: body.sequence + 1, steps: STEPS });
    expect(reasons(await post(c0.client, { ...bundle, receipts: [impersonated], acknowledged: null }))).toEqual(['receipt:1:signer_key_mismatch']);
    // An acknowledgment signed by a contributor in the requester's name: not the requester's registered key.
    const ack = bundle.acknowledged.acknowledgment;
    const { publicJwk: _ackKey, signature: _ackSignature, ...ackBody } = ack;
    const fakeAck = await c0.signer.sign('reploid.output-acknowledgment/v1', ackBody);
    expect(reasons(await post(c0.client, { ...bundle, receipts: [], acknowledged: { ...bundle.acknowledged, acknowledgment: fakeAck } })))
      .toEqual(['acknowledgment:signer_key_mismatch']);

    // The final stage's device is revoked; receipts it signs afterwards are not attributed to any registration.
    advance(MIN);
    const desk = await h.http(h.base, 'POST', '/accounts/sign-in', { body: { providerId: h.provider.providerId, assertion: h.provider.issue({ subject: c1.subject }) } });
    expect((await h.http(h.base, 'DELETE', `/devices/${c1.session.deviceId}`, { token: desk.body.session.token, key: 'revoke', body: { reason: 'retired' } })).status).toBe(200);
    await fund(h.services.ledger, requesterAccount, 100, 'purchase:second');
    const second = requester.thread();
    expect((await requester.app.send(second, 'Question')).status).toBe('completed');
    const secondBundle = structuredClone(route.admissions(0)[1].evidence);
    const revokedReceipt = route.admissions(1)[1].evidence.receipts[0];
    expect((await post(c1.client, route.admissions(1)[1].evidence)).code).toBe('session_device_revoked');
    const relayed = await post(c0.client, { ...secondBundle, receipts: [secondBundle.receipts[0], revokedReceipt] });
    // Its acknowledgment pairs with a receipt from the revoked device, so it is not kept either.
    expect(relayed).toMatchObject({ changed: true, acknowledged: null, rejected: [{ item: 'receipt:1', problem: 'signer_not_registered' },
      { item: 'acknowledgment', problem: 'paired_signer_not_registered' }] });
    // The first attempt's receipt does not count for the second attempt, nor for the second reservation.
    expect(reasons(await post(c0.client, { ...secondBundle, receipts: [bundle.receipts[0]], acknowledged: null }))).toEqual(['receipt:0:receipt_binding_mismatch']);
    // Named under the second reservation, the first attempt is no attempt of it this device took part in.
    expect((await post(c0.client, { ...bundle, reservationId: secondBundle.reservationId })).code).toBe('reservation_not_found');
    // A device that took no part in the attempt learns nothing about the reservation.
    const outsider = await h.contributor('outsider');
    expect((await post(outsider.client, bundle)).code).toBe('reservation_not_found');

    // Only verified evidence was kept: the first attempt's genuine bundle settles it; the second, with no verified final-stage
    // receipt or acknowledgment, proves nothing chargeable and releases.
    expect(await post(c0.client, bundle)).toMatchObject({ changed: true, rejected: [] });
    advance(PAST_WINDOW);
    const decided = await settleDue();
    expect(decided.map((row) => [row.status, row.settlement?.outcome ?? null, row.settlement?.charge ?? null, row.dispute])).toEqual([
      ['settled', 'full', FULL_CHARGE, null], ['expired', 'expired', 0, null]
    ]);
    expect(await h.journal(requesterAccount)).toEqual([['issue', 100], ['reserve', 60], ['issue', 100], ['reserve', 60],
      ['charge', FULL_CHARGE], ['release', 60 - FULL_CHARGE], ['release', 60]]);
    await h.reconcileBooks([requesterAccount, c0.accountId, c1.accountId]);
  });

  it('charges nothing for receipts the requester never acknowledged, even when the contributors collude', async () => {
    // The requester host acknowledges nothing and withholds its report; both contributors assert the full route.
    const silent = (generate) => (request, controls) => {
      const view = Object.create(controls);
      Object.defineProperty(view, 'onOutput', { get: () => undefined });
      return generate(request, view);
    };
    const net = await h.network({ fetch: withheld, generate: silent });
    const { c0, c1, route, stageOffers, requester, requesterAccount } = net;
    const thread = requester.thread();
    expect((await requester.app.send(thread, 'Question')).status).toBe('completed');
    const { reservationId } = await reservationOf(requester, thread);
    await submitAll(net);
    // Honest stages refuse to run more than K + 1 outputs past the acknowledgments; a fabricated later receipt
    // claiming more outputs than the route produced asserts no more than that bound.
    const { publicJwk: _key, signature: _signature, ...body } = route.admissions(1)[0].evidence.receipts[0];
    const inflated = await c1.signer.sign('reploid.stage-receipt/v1', { ...body, sequence: body.sequence + 1, steps: STEPS + 2,
      output: { ...body.output, count: STEPS + 2 }, tokens: { ...body.tokens, processed: body.tokens.processed + 2 } });
    expect(await c1.client.send({ opId: 'evidence:inflated', path: '/attempt-evidence',
      body: { evidence: { ...route.admissions(1)[0].evidence, receipts: [inflated], acknowledged: null } } })).toMatchObject({ changed: true, rejected: [] });

    advance(PAST_WINDOW);
    const bound = MAX_UNACKNOWLEDGED_OUTPUTS + 1;
    // The capped count no longer matches the inflated completion, so it is asserted as partial delivery of the bound.
    const asserted = Math.ceil(bound / 2);
    const [decided] = await settleDue();
    expect(decided).toMatchObject({ status: 'disputed', settlement: null, dispute: { held: asserted } });
    expect((await h.services.ledger.getDispute(`dsp:${reservationId}`)).asserted).toMatchObject({ outcome: 'partial_delivery', metering: { output: bound } });
    expect(await h.journal(requesterAccount)).toEqual([['issue', 100], ['reserve', 60], ['release', 60 - asserted]]);
    expect((await c1.claims({ stageShare: stageOffers[1] }).claimStageShares(route.admissions(1)))[0]).toMatchObject({ status: 'open' });

    // Review releases the unacknowledged assertion: nothing is charged and no share is earned.
    const resolved = await h.operator('POST', `/operator/disputes/${encodeURIComponent(`dsp:${reservationId}`)}/resolve`,
      { disposition: 'acknowledged', decisionId: 'review:collusion' }, 'resolve-collusion');
    expect(resolved.body).toMatchObject({ outcome: 'unacknowledged', charge: 0, released: 60, dispute: { disposition: 'acknowledged', charged: 0 } });
    expect(await h.journal(requesterAccount)).toEqual([['issue', 100], ['reserve', 60], ['release', 60 - asserted], ['release', asserted]]);
    expect((await c0.claims({ stageShare: stageOffers[0] }).claimStageShares(route.admissions(0)))[0]).toMatchObject({ status: 'done', outcome: 'rejected' });
    expect(await h.issued(c0.accountId) + await h.issued(c1.accountId)).toBe(0);
    await h.reconcileBooks([requesterAccount, c0.accountId, c1.accountId]);
  });

  it('gives duplicate evidence and repeated decisions one effect', async () => {
    const net = await h.network({ fetch: withheld });
    const { c0, route, requester, requesterAccount } = net;
    expect((await requester.app.send(requester.thread(), 'Question')).status).toBe('completed');
    const evidence = route.admissions(0)[0].evidence;
    const { token } = await c0.client.ensureSession();
    const submit = (key) => h.http(h.base, 'POST', '/attempt-evidence', { token, key, body: { evidence } });
    const first = await submit('evidence-1');
    expect(first).toMatchObject({ status: 201, body: { changed: true, acknowledged: { count: STEPS } } });
    // The same request under its key replays; under another key it merges into what is kept and changes nothing.
    expect(await submit('evidence-1')).toEqual(first);
    expect((await submit('evidence-2')).body).toMatchObject({ changed: false });
    expect((await h.http(h.base, 'POST', '/attempt-evidence', { token, key: 'evidence-1', body: { evidence: { ...evidence, acknowledged: null } } })).body.error)
      .toBe('idempotency_conflict');
    advance(PAST_WINDOW);
    expect(await settleDue()).toHaveLength(1);
    expect(await settleDue()).toEqual([]);
    expect(await h.services.ledger.expireReservations()).toEqual([]);
    expect((await submit('evidence-3')).body).toMatchObject({ changed: false, reservationStatus: 'settled' });
    expect(await h.journal(requesterAccount)).toEqual([['issue', 100], ['reserve', 60], ['charge', FULL_CHARGE], ['release', 60 - FULL_CHARGE]]);
    await h.reconcileBooks([requesterAccount, c0.accountId]);
  });

  it('reconciles evidence in flight across a crash and restart to its one kept record and one decision', async () => {
    let crash = true;
    const faulty = await h.start({ faultHooks: { afterComponent: ({ routeId }) => {
      if (routeId === 'POST /attempt-evidence' && crash) { crash = false; throw new Error('process failed after the evidence committed'); }
    } } });
    const net = await h.network({ fetch: withheld });
    const { c0, c1, route, requester, requesterAccount } = net;
    expect((await requester.app.send(requester.thread(), 'Question')).status).toBe('completed');
    // The coordinator host submits through the failing process: the ledger kept it, the answer was lost.
    const onFaulty = h.clientFor({ on: faulty, identity: c0.identity, host: 'native', subject: c0.subject, storage: c0.storage });
    expect((await c0.claims({}, onFaulty).submitEvidence(route.admissions(0)))[0]).toMatchObject({ status: 'pending' });
    const [op] = await onFaulty.pending();
    expect(await h.binding('POST /attempt-evidence', { accountId: c0.accountId, deviceId: c0.session.deviceId }, op.key)).toMatchObject({ status: 'unknown' });
    const reservationId = route.admissions(0)[0].evidence.reservationId;
    const attemptId = route.admissions(0)[0].identity.attemptId;
    const kept = await h.services.ledger.getAttemptEvidence({ reservationId, attemptId });
    expect(kept).toMatchObject({ acknowledged: { count: STEPS } });

    // The restarted host resends the stored request to a restarted process: it reconciles to the same kept record.
    const restarted = c0.claims({}, h.clientFor({ on: await h.start(), identity: c0.identity, host: 'native', subject: c0.subject, storage: c0.storage }));
    expect(await restarted.reconcile()).toEqual([expect.objectContaining({ ok: true, body: expect.objectContaining({ changed: true, evidenceId: kept.evidenceId }) })]);
    // Observing the same record again replays the stored answer under the same key.
    expect(await restarted.submitEvidence(route.admissions(0))).toEqual([expect.objectContaining({ status: 'done', evidenceId: kept.evidenceId })]);
    expect(await restarted.submitEvidence(route.admissions(0))).toEqual([]);
    expect(await h.services.ledger.getAttemptEvidence({ reservationId, attemptId })).toEqual(kept);
    await c1.claims().submitEvidence(route.admissions(1));
    // No sweep ran before the reservation period ended: expiry makes the same one decision instead of releasing.
    advance(11 * MIN);
    expect(await h.services.ledger.expireReservations()).toEqual([expect.objectContaining({ outcome: 'full', charge: FULL_CHARGE })]);
    expect(await settleDue()).toEqual([]);
    expect(await h.journal(requesterAccount)).toEqual([['issue', 100], ['reserve', 60], ['charge', FULL_CHARGE], ['release', 60 - FULL_CHARGE]]);
    await h.reconcileBooks([requesterAccount, c0.accountId, c1.accountId]);
  });
}, 60_000);
