// @vitest-environment node
// A charged attempt that the coordinator queues and that never runs: its admission wait times out, or
// the quoted deadline (which includes queueing) passes while it waits. The requester host's earning
// client binds the attempt before its input leaves the device, then reports what the route returned;
// the ledger's declared outcome rules decide. Real accounts, ledger, routes and outcome rules over
// memory and fake-Firestore stores, under report-only and evidence terms. The coordinator's admission
// is the library's attempt queue in front of the resident route's requester port; test-only bounds.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import failureMessages from '../../packages/reploid/src/transport/partition-errors.json' with { type: 'json' };
import { ATTEMPT_QUEUE_POLICY_SCHEMA, createPartitionAttemptQueue } from '../../packages/reploid/src/mesh/partitions/partition-attempt-queue.js';
import { EVIDENCE_TERMS, createEarningHarness } from '../helpers/earning-harness.js';
import { MIN, advance } from '../helpers/reward-fixture.js';

// Past the quoted deadline (three minutes) plus the evidence window, before the reservation period ends (ten).
const PAST_WINDOW = 3 * MIN + EVIDENCE_TERMS.windowMs + MIN;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe.each([['memory', 'report-only'], ['memory', 'evidence'], ['firestore', 'report-only'], ['firestore', 'evidence']])(
  'a queued attempt that never runs (%s store, %s terms)', (kind, terms) => {
    let h;
    beforeEach(async () => { h = await createEarningHarness(kind, terms === 'evidence' ? {} : { evidence: null }).open(); });
    afterEach(async () => { await h.close(); });

    /** One slot, already taken: the requester's attempt waits behind it at the coordinator. */
    async function occupiedRoute(maxQueueWaitMs) {
      const queue = createPartitionAttemptQueue({ policy: { schema: ATTEMPT_QUEUE_POLICY_SCHEMA, maxQueuedAttempts: 2, maxQueuedPerRequester: 2, maxQueueWaitMs } });
      const gate = { check: ({ admitted }) => admitted < 1 };
      const occupant = await queue.admit({ key: 'route', attemptId: 'occupant', requesterId: 'another-requester', ...gate });
      // Approval and the reservation binding precede dispatch; the coordinator then queues the attempt.
      // Nothing is tokenized, reserved or sent to a stage before admission.
      const generate = (requesterGenerate) => (request, controls) => {
        const view = Object.create(controls);
        view.requestApproval = async (preview) => {
          const approved = await controls.requestApproval(preview);
          if (approved !== true) return approved;
          await queue.admit({ key: 'route', attemptId: request.attemptId, requesterId: 'requester', signal: controls.signal, ...gate,
            onQueued: () => controls.onState?.({ threadId: request.threadId, attemptId: request.attemptId, status: 'queued' }) });
          return true;
        };
        return requesterGenerate(request, view);
      };
      return { queue, occupant, generate };
    }
    const reservationOf = async (requester, threadId) => h.services.ledger.getReservation((await requester.attempts.getThread(threadId)).reservationId);
    const settleDue = async () => {
      const answer = await h.operator('POST', '/operator/evidence/settle-due', {});
      expect(answer.status).toBe(200);
      return answer.body.results;
    };

    it('reports a queue timeout as a failed attempt with its code; it is never charged and its hold is released', async () => {
      const occupied = await occupiedRoute(50);
      const net = await h.network({ generate: occupied.generate });
      const { route, requester, requesterAccount } = net;
      const thread = requester.thread();
      const attempt = await requester.app.send(thread, 'Question');
      expect(attempt).toMatchObject({ status: 'failed', error: failureMessages.CAPACITY_QUEUE_TIMEOUT });
      expect(occupied.queue.getState()).toMatchObject({ queued: 0, admitted: 1 });
      // No stage admitted, executed or signed anything for it.
      expect(route.runner.getState().attempts).toEqual([]);
      expect([route.admissions(0), route.admissions(1)]).toEqual([[], []]);

      // The bound attempt closes as failed with its code; the acceptance stays open for an explicit retry.
      const open = await reservationOf(requester, thread);
      expect(open).toMatchObject({ status: 'open', settlement: null,
        attempts: [expect.objectContaining({ attemptId: attempt.id, status: 'failed', reason: 'execution_failed:CAPACITY_QUEUE_TIMEOUT' })] });
      expect(await requester.attempts.getThread(thread)).toMatchObject({ retryable: true,
        attempts: [expect.objectContaining({ attemptId: attempt.id, reported: true })] });
      expect(await h.journal(requesterAccount)).toEqual([['issue', 100], ['reserve', 60]]);

      // Stopping retries settles the acceptance as provider failure under the accepted terms: no charge.
      await requester.attempts.abandon(thread);
      if (terms === 'evidence') {
        // Without stage evidence the decision waits for the evidence window, then releases the whole hold.
        expect((await reservationOf(requester, thread)).status).toBe('open');
        advance(PAST_WINDOW);
        const [decided] = await settleDue();
        expect(decided).toMatchObject({ reservationId: open.reservationId, status: 'settled', settlement: { outcome: 'provider_failure', charge: 0 } });
      }
      expect(await reservationOf(requester, thread)).toMatchObject({ status: 'settled', settlement: { outcome: 'provider_failure', charge: 0 } });
      expect(await h.journal(requesterAccount)).toEqual([['issue', 100], ['reserve', 60], ['release', 60]]);
      await h.reconcileBooks([requesterAccount]);
      occupied.occupant.release();
    });

    it('stops a waiting attempt at the quoted deadline, which includes its queue time: a zero-charge timeout that releases the hold', async () => {
      const occupied = await occupiedRoute(60_000);
      const net = await h.network({ generate: occupied.generate });
      const { route, requester, requesterAccount } = net;
      const thread = requester.thread();
      const sending = requester.app.send(thread, 'Question');
      while (occupied.queue.getState().queued === 0) await flush();
      expect(requester.app.getState().threads.find((row) => row.id === thread).attempts.at(-1).status).toBe('queued');
      advance(3 * MIN);
      requester.fireDeadline();
      const attempt = await sending;
      expect(attempt).toMatchObject({ status: 'failed', error: 'The quoted deadline passed' });
      // Cancellation removed the wait; nothing was admitted, so nothing else settles.
      expect(occupied.queue.getState()).toMatchObject({ queued: 0, admitted: 1 });
      expect(route.runner.getState().attempts).toEqual([]);
      expect([route.admissions(0), route.admissions(1)]).toEqual([[], []]);
      if (terms === 'evidence') {
        expect((await reservationOf(requester, thread)).status).toBe('open');
        advance(PAST_WINDOW);
        const [decided] = await settleDue();
        expect(decided).toMatchObject({ status: 'settled', settlement: { outcome: 'timeout', charge: 0 } });
      }
      expect(await reservationOf(requester, thread)).toMatchObject({ status: 'settled',
        settlement: { outcome: 'timeout', charge: 0, attempt: { attemptId: attempt.id } } });
      expect(await h.journal(requesterAccount)).toEqual([['issue', 100], ['reserve', 60], ['release', 60]]);
      await h.reconcileBooks([requesterAccount]);
      occupied.occupant.release();
    });
  });
