/**
 * @fileoverview Contract obligation scheduling for REP-11: custody and service
 * challenges on contracted storage, execution probes on prepared readiness,
 * one per configured kind in every interval of each accepted contract.
 *
 * Each interval's obligation is a durable slot keyed by contract, kind and
 * interval index, planned once (a per-contract cursor advances in the same
 * transaction), with an unpredictable issue time drawn inside the interval
 * and stored, so a restart neither re-draws, skips nor repeats it. A runner
 * claims a slot in one transaction, then issues through the reward store's
 * own `issueChallenge` or `probeReadiness` under a key derived from the
 * slot, so concurrent or resumed issuance converges on one challenge. An
 * interval whose issue window passed before any runner reached it is recorded
 * `missed_window`; nothing is silently dropped. A missed scheduling window is
 * the scheduler's, so it records no challenge and no outage: the interval is
 * simply unverified. Probes settle on their own path (the reward store's
 * probe run); the scheduler records only the challenge it produced.
 *
 * Ports:
 * - transport.deliver({ challenge, offer }) -> { delivered: true, receiptRef }:
 *   hand a custody or service challenge to the contributor's device (and a
 *   service challenge's designated acquirer). It resolves only on the
 *   recipient's acknowledgement and is retried until the response deadline;
 *   a repeat after a crash may deliver twice, and the challenge still takes
 *   one answer. No production transport exists yet.
 * - selectAcquirer({ offer, slot }) -> participantId | null: the designated
 *   acquirer of a service challenge; the reward store still refuses one that
 *   is the contributor, its owner or a policy-linked account.
 */

import { isNonEmptyString, toMs } from '../ledger/domain.js';
import { CURSOR_SCHEMA, SLOT_SCHEMA, cursorIdFor, slotIdFor } from './domain.js';

export const OBLIGATION_JOB_ID = 'rewards.obligations';
export const OBLIGATION_KINDS = Object.freeze({
  contracted_storage: Object.freeze(['custody', 'service']),
  prepared_readiness: Object.freeze(['execution'])
});
export const SLOT_STATUSES = Object.freeze([
  'planned', 'issuing', 'delivering', 'issued', 'delivered', 'delivery_unconfirmed', 'missed_window', 'refused', 'unassigned'
]);
const DELIVERED_KINDS = new Set(['custody', 'service']);
// Reward refusals that end a slot rather than leave it for the next pass.
const MISSED_CODES = new Set(['challenge_outside_contract']);

const isPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const iso = (ms) => new Date(ms).toISOString();

const geometry = (offer) => {
  const start = toMs(offer.duration.startsAt);
  const end = toMs(offer.duration.endsAt);
  const interval = offer.obligations.intervalMs;
  return { start, end, interval, count: Math.ceil((end - start) / interval) };
};
const bounds = (shape, index) => ({ startsMs: shape.start + index * shape.interval, endsMs: Math.min(shape.start + (index + 1) * shape.interval, shape.end) });
// The first interval still open when the contract was accepted; earlier ones owed nothing.
const firstOwed = (offer, shape) => Math.max(0, Math.floor((toMs(offer.acceptedAt) - shape.start) / shape.interval));

/** A reward refusal is final for the slot; a crash or storage failure is retried. */
const isRefusal = (error) => error?.name === 'RewardError' && error.retryable !== true;

/**
 * @param {object} options
 * @param {object} options.backend the scheduler's backend (slots and cursors)
 * @param {object} options.rewards contribution reward store
 * @param {object} [options.transport] delivery port for custody and service challenges
 * @param {Function} [options.selectAcquirer] service-challenge acquirer port
 * @param {Function} options.random random(n) -> integer in [0, n) for unpredictable issue times
 */
export function createObligationJob({ backend, rewards, transport = null, selectAcquirer = null, random, clock = () => new Date().toISOString() } = {}) {
  if (typeof rewards?.listContracts !== 'function' || typeof rewards.issueChallenge !== 'function' || typeof rewards.probeReadiness !== 'function') {
    throw new TypeError('obligation scheduling requires the reward store');
  }
  if (typeof random !== 'function') throw new TypeError('obligation scheduling requires random(n) for unpredictable issue times');

  /**
   * Options: { kinds: { contracted_storage?: [...], prepared_readiness?: [...] },
   * issueWindow: { numerator, denominator } }, the fraction of each interval,
   * from its start, within which the issue time is drawn.
   */
  const validateOptions = (options) => {
    const problems = [];
    const kinds = options?.kinds;
    if (!kinds || typeof kinds !== 'object' || !Object.keys(kinds).length) problems.push('kinds must list obligation kinds per contracted category');
    for (const [category, list] of Object.entries(kinds || {})) {
      const allowed = OBLIGATION_KINDS[category];
      if (!allowed) problems.push(`kinds.${category} is not a contracted category`);
      else if (!Array.isArray(list) || !list.length || new Set(list).size !== list.length || list.some((kind) => !allowed.includes(kind))) {
        problems.push(`kinds.${category} must list distinct kinds from ${allowed.join(', ')}`);
      }
    }
    const listed = Object.values(kinds || {}).flat();
    if (listed.some((kind) => DELIVERED_KINDS.has(kind)) && typeof transport?.deliver !== 'function') {
      problems.push('custody and service obligations need a transport with deliver()');
    }
    if (listed.includes('service') && typeof selectAcquirer !== 'function') problems.push('service obligations need a selectAcquirer port');
    const window = options?.issueWindow;
    if (!isPositiveInteger(window?.numerator) || !isPositiveInteger(window?.denominator) || window.numerator > window.denominator) {
      problems.push('issueWindow must be { numerator, denominator } with 0 < numerator <= denominator');
    }
    return problems;
  };

  /** Move a slot on only if it is still where this runner last saw it. */
  const advance = (slotId, expected, change) => backend.runTransaction(async (tx) => {
    const slot = await tx.get('slots', slotId);
    if (!slot || slot.status !== expected.status || (expected.claimLeaseId !== undefined && (slot.claim?.leaseId ?? null) !== expected.claimLeaseId)) return null;
    const updated = { ...slot, ...change(slot, clock()), updatedAt: clock() };
    tx.set('slots', slotId, updated);
    return updated;
  });

  /** Create slots for every interval reached since the cursor, in one transaction with the cursor. */
  const plan = (offer, kind, options, nowMs, budget) => backend.runTransaction(async (tx) => {
    const shape = geometry(offer);
    const cursorId = cursorIdFor(offer.offerId, kind);
    const cursor = await tx.get('cursors', cursorId);
    const next = cursor ? cursor.plannedThrough + 1 : firstOwed(offer, shape);
    const current = Math.min(shape.count - 1, Math.floor((nowMs - shape.start) / shape.interval));
    if (nowMs < shape.start || next > current || budget <= 0) return [];
    const last = Math.min(current, next + budget - 1);
    const indexes = Array.from({ length: last - next + 1 }, (_, offset) => next + offset);
    const existing = [];
    for (const index of indexes) existing.push(await tx.get('slots', slotIdFor(offer.offerId, kind, index)));
    const now = iso(nowMs);
    const acceptedMs = toMs(offer.acceptedAt);
    const created = [];
    indexes.forEach((index, position) => {
      if (existing[position]) return;
      const { startsMs, endsMs } = bounds(shape, index);
      const windowStart = Math.max(startsMs, acceptedMs);
      const span = Math.floor(((endsMs - windowStart) * options.issueWindow.numerator) / options.issueWindow.denominator);
      const missed = endsMs <= nowMs;
      const slot = {
        schema: SLOT_SCHEMA,
        slotId: slotIdFor(offer.offerId, kind, index),
        offerId: offer.offerId,
        category: offer.category,
        kind,
        intervalIndex: index,
        intervalStartsAt: iso(startsMs),
        intervalEndsAt: iso(endsMs),
        dueAt: iso(windowStart + (span > 0 ? random(span) : 0)),
        issueBy: iso(endsMs),
        status: missed ? 'missed_window' : 'planned',
        reason: missed ? 'interval_ended_before_planning' : null,
        plannedAt: now,
        claim: null,
        attempts: 0,
        acquirerParticipantId: null,
        challengeId: null,
        issuedAt: null,
        lateByMs: null,
        challengeStatus: null,
        delivery: null,
        error: null,
        closedAt: missed ? now : null,
        updatedAt: now
      };
      tx.create('slots', slot.slotId, slot);
      created.push(slot);
    });
    tx.set('cursors', cursorId, {
      schema: CURSOR_SCHEMA, cursorId, offerId: offer.offerId, kind, plannedThrough: last, complete: last === shape.count - 1, updatedAt: now
    });
    return created;
  });

  const findIssued = async (slot) => (await rewards.listChallenges(slot.offerId)).find((challenge) => challenge.obligationRef === slot.slotId) ?? null;

  const recordIssued = (slot, leaseId, challenge) => advance(slot.slotId, { status: 'issuing', claimLeaseId: leaseId }, (current, now) => ({
    status: DELIVERED_KINDS.has(current.kind) ? 'delivering' : 'issued',
    challengeId: challenge.challengeId,
    issuedAt: challenge.issuedAt,
    respondBy: challenge.respondBy,
    lateByMs: Math.max(0, toMs(challenge.issuedAt) - toMs(current.dueAt)),
    challengeStatus: challenge.status,
    delivery: DELIVERED_KINDS.has(current.kind) ? { attempts: 0, deliveredAt: null, receiptRef: null, lastError: null } : null,
    error: null,
    closedAt: DELIVERED_KINDS.has(current.kind) ? null : now
  }));

  /** Issue a claimed slot's obligation through the reward store, under a key derived from the slot. */
  const issue = async (slot, leaseId, offer) => {
    const nowMs = toMs(clock());
    if (nowMs >= toMs(slot.issueBy)) {
      // A resumed slot past its window counts only a challenge an earlier attempt already issued.
      const found = await findIssued(slot);
      if (found) return recordIssued(slot, leaseId, found);
      return advance(slot.slotId, { status: 'issuing', claimLeaseId: leaseId }, (current, now) => ({ status: 'missed_window', reason: 'issue_window_passed', closedAt: now }));
    }
    const common = { offerId: slot.offerId, obligationRef: slot.slotId, idempotencyKey: `obligation:${slot.slotId}` };
    try {
      const challenge = slot.kind === 'execution'
        ? await rewards.probeReadiness(common)
        : await rewards.issueChallenge({ ...common, kind: slot.kind, ...(slot.kind === 'service' ? { acquirerParticipantId: slot.acquirerParticipantId } : {}) });
      return (await recordIssued(slot, leaseId, challenge)) ?? { ...slot, status: 'issued_elsewhere' };
    } catch (error) {
      const code = isNonEmptyString(error?.code) ? error.code : 'issue_failed';
      if (MISSED_CODES.has(code) || isRefusal(error)) {
        return advance(slot.slotId, { status: 'issuing', claimLeaseId: leaseId }, (current, now) => ({
          status: MISSED_CODES.has(code) ? 'missed_window' : 'refused', reason: code, error: { code, message: String(error?.message ?? error) }, closedAt: now
        }));
      }
      // A crash or storage failure stays claimed; the next pass resumes it under the same key.
      await advance(slot.slotId, { status: 'issuing', claimLeaseId: leaseId }, () => ({ error: { code, message: String(error?.message ?? error) } }));
      return { ...slot, status: 'issuing', error: { code } };
    }
  };

  /** Hand an issued challenge to its recipients until acknowledged or its deadline passes. */
  const deliver = async (slot, offer) => {
    const challenge = (await rewards.listChallenges(slot.offerId)).find((entry) => entry.challengeId === slot.challengeId);
    const expected = { status: 'delivering' };
    if (!challenge || toMs(clock()) > toMs(challenge.respondBy)) {
      return advance(slot.slotId, expected, (current, now) => ({
        status: 'delivery_unconfirmed', reason: 'response_deadline_passed', challengeStatus: challenge?.status ?? null, closedAt: now
      }));
    }
    try {
      const receipt = await transport.deliver({ challenge, offer });
      if (receipt?.delivered !== true) throw Object.assign(new Error('the transport did not confirm delivery'), { code: 'delivery_unconfirmed' });
      return advance(slot.slotId, expected, (current, now) => ({
        status: 'delivered',
        delivery: { ...current.delivery, attempts: current.delivery.attempts + 1, deliveredAt: now, receiptRef: receipt.receiptRef ?? null, lastError: null },
        closedAt: now
      }));
    } catch (error) {
      const code = isNonEmptyString(error?.code) ? error.code : 'delivery_failed';
      const updated = await advance(slot.slotId, expected, (current, now) => ({
        delivery: { ...current.delivery, attempts: current.delivery.attempts + 1, lastError: { code, message: String(error?.message ?? error), at: now } }
      }));
      return { ...(updated ?? slot), error: { code } };
    }
  };

  // A refusal or an unfinished issuance or delivery is a failed item; a missed window is recorded, not failed.
  const item = (slot) => ({
    ref: slot.slotId, offerId: slot.offerId, kind: slot.kind, intervalIndex: slot.intervalIndex, status: slot.status,
    reason: slot.reason ?? null, challengeId: slot.challengeId ?? null, challengeStatus: slot.challengeStatus ?? null,
    ...(slot.error?.code && slot.status !== 'missed_window' ? { code: slot.error.code } : {})
  });

  return {
    validateOptions,

    async run({ limit, options, lease, heartbeat }) {
      let budget = limit;
      const items = [];
      const nowMs = toMs(clock());
      const contracts = await rewards.listContracts();
      const byOffer = new Map(contracts.map((offer) => [offer.offerId, offer]));
      // 1. Plan the intervals each contract has reached.
      for (const offer of contracts) {
        for (const kind of options.kinds[offer.category] ?? []) {
          if (budget <= 0) break;
          const cursor = await backend.get('cursors', cursorIdFor(offer.offerId, kind));
          if (cursor?.complete) continue;
          const created = await plan(offer, kind, options, nowMs, budget);
          budget -= created.length;
          created.forEach((slot) => items.push(item(slot)));
        }
      }
      // 2. Act on open slots, earliest due first.
      const open = (await Promise.all(['planned', 'issuing', 'delivering'].map((status) => backend.list('slots', { field: 'status', value: status })))).flat()
        .sort((left, right) => toMs(left.dueAt) - toMs(right.dueAt) || left.slotId.localeCompare(right.slotId));
      for (const slot of open) {
        if (budget <= 0) break;
        const offer = byOffer.get(slot.offerId) ?? await rewards.getOffer(slot.offerId);
        const now = toMs(clock());
        if (slot.status === 'planned' && now < toMs(slot.dueAt)) continue;
        if (slot.status === 'issuing' && slot.claim?.leaseId === lease.leaseId) continue;
        if (!await heartbeat()) break;
        budget -= 1;
        if (slot.status === 'delivering') {
          if (typeof transport?.deliver !== 'function') continue;
          const delivered = await deliver(slot, offer);
          if (delivered) items.push(item(delivered));
          continue;
        }
        if (slot.status === 'planned' && now >= toMs(slot.issueBy)) {
          const missed = await advance(slot.slotId, { status: 'planned' }, (current, at) => ({ status: 'missed_window', reason: 'issue_window_passed', closedAt: at }));
          if (missed) items.push(item(missed));
          continue;
        }
        let acquirer = slot.acquirerParticipantId;
        if (slot.status === 'planned' && slot.kind === 'service') {
          acquirer = await selectAcquirer({ offer, slot });
          if (!isNonEmptyString(acquirer)) {
            const unassigned = await advance(slot.slotId, { status: 'planned' }, (current, at) => ({ status: 'unassigned', reason: 'no_acquirer', closedAt: at }));
            if (unassigned) items.push(item(unassigned));
            continue;
          }
        }
        const claimed = await advance(slot.slotId, slot.status === 'planned' ? { status: 'planned' } : { status: 'issuing', claimLeaseId: slot.claim?.leaseId ?? null }, (current, at) => ({
          status: 'issuing',
          claim: { leaseId: lease.leaseId, runnerId: lease.runnerId, passId: lease.passId, claimedAt: at, previous: current.claim ?? null },
          attempts: current.attempts + 1,
          acquirerParticipantId: current.acquirerParticipantId ?? acquirer ?? null
        }));
        if (!claimed) continue;
        let result = await issue(claimed, lease.leaseId, offer);
        // A newly issued challenge goes to its recipients at once when the batch allows; later passes retry.
        if (result?.status === 'delivering' && budget > 0 && typeof transport?.deliver === 'function') {
          budget -= 1;
          result = (await deliver(result, offer)) ?? result;
        }
        items.push(item(result));
      }
      return { items, backlog: budget <= 0 };
    }
  };
}

export default createObligationJob;
