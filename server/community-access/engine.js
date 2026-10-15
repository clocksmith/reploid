/**
 * @fileoverview Community Access: donor- and operator-funded service with fair
 * queues, per-account usage limits, account and device rate limits and
 * visible availability, admitted only under funded and admitted capacity.
 *
 * Pool funding allocates from a commitment in the ledger's funding register
 * and issues it as a `community_access` lot into a dedicated pool account,
 * never into a member account, so registering or requesting access gives a
 * member nothing to hold or transfer. The issuance consumes the allocation. An admitted request reserves its quoted
 * maximum from a pool account and settles through the ledger like any other
 * quote; that charge is Community Access consumption, which the ledger's
 * solvency snapshot discloses as subsidy. Whether operators guarantee a
 * basic-service floor is an explicit policy switch; under the proposed
 * default (`none`) a request is queued or told to retry, and neither a queue
 * position nor a balance promises completion.
 */

import {
  FUNDER_KINDS,
  assertId,
  buildQuote,
  cloneJson,
  hashCanonical,
  isNonEmptyString,
  lotIdForSource,
  sha256Hex,
  sourceClaimKey,
  toMs
} from '../ledger/domain.js';
import { FUNDING_REFUSAL_CODES } from '../ledger/funding/register.js';
import { assertLedgerStoreContract } from '../ledger/store-contract.js';
import {
  ENTRY_SCHEMA,
  FUNDING_SCHEMA,
  FUNDING_USE,
  OCCUPANCY_ID,
  POOL_FUNDER_KINDS,
  POOL_OWNER_ID,
  SUBSIDY_REPORT_SCHEMA,
  entryView,
  estimateWaitMs,
  fail,
  fairOrder,
  floorEligible,
  poolAccountIds,
  poolForLane,
  queueProblem,
  rateLimitProblem,
  readCapacityEvidence,
  rollCounter,
  rollUsage,
  usageProblem,
  validateCommunityAccessPolicy
} from './domain.js';
import { assertCommunityAccessBackend, assertCommunityAccessContract } from './store-contract.js';

const defaultClock = () => new Date().toISOString();
const emptyOccupancy = () => ({ waiting: 0, active: { floor: 0, general: 0 } });
const counterId = (scope, subject) => sha256Hex(`rate\u0000${scope}\u0000${subject}`);

const assertKnownKeys = (input, allowed, operation) => {
  const unknown = Object.keys(input || {}).filter((key) => !allowed.includes(key));
  if (unknown.length) fail('invalid_input', `${operation} does not accept: ${unknown.join(', ')}`, { unknown });
};

const validId = (value) => {
  try {
    assertId(value, 'id');
    return true;
  } catch {
    return false;
  }
};

const withTotal = (byKind) => ({ total: Object.values(byKind).reduce((sum, value) => sum + value, 0), byFunderKind: byKind });
// Reported over the ledger's whole funder vocabulary, whichever kinds pools accept.
const emptyByFunder = () => Object.fromEntries(FUNDER_KINDS.map((kind) => [kind, 0]));

/**
 * @param {object} options
 * @param {object} options.backend transactional document backend (see stores.js)
 * @param {object} options.ledger credit ledger store; its issuanceAuthority should include
 *   createFundingIssuanceAuthority over this backend
 * @param {object} options.accounts authenticated account port:
 *   participantAccount(participantId) -> accountId | null
 * @param {Function} options.readCommunityCapacity admitted-capacity port: () -> evidence
 *   `{ schema, evidenceId, observedAt, admittedSlots, meanOccupancyMs? }` from the execution owners
 * @param {object} options.policy explicit Community Access policy; there is no default
 * @param {Function} [options.fundingAuthority] funding-authority decision port:
 *   ({ action: 'fund_pool', fundingId, commitmentId, quantity, poolAccountId,
 *   authority: { actorId, decisionId } }) -> { allowed, reason? }. Which actors hold
 *   that authority is policy outside this store; without the port pool funding fails closed
 */
export function createCommunityAccess({ backend, ledger, accounts, readCommunityCapacity, policy, fundingAuthority = null, clock = defaultClock } = {}) {
  assertCommunityAccessBackend(backend);
  assertLedgerStoreContract(ledger);
  if (typeof accounts?.participantAccount !== 'function') throw new TypeError('Community Access requires an accounts port with participantAccount');
  if (typeof readCommunityCapacity !== 'function') throw new TypeError('Community Access requires a readCommunityCapacity port');
  if (fundingAuthority !== null && typeof fundingAuthority !== 'function') throw new TypeError('fundingAuthority must be a function');
  const accessPolicy = validateCommunityAccessPolicy(policy);
  const pools = poolAccountIds(accessPolicy);

  const loadCapacity = async (now) => {
    let evidence = null;
    try {
      evidence = await readCommunityCapacity();
    } catch {
      evidence = null;
    }
    return readCapacityEvidence(evidence, accessPolicy, now);
  };

  const resolveAccount = async (participantId) => {
    if (!isNonEmptyString(participantId)) fail('invalid_input', 'participantId must name the authenticated participant');
    const accountId = await accounts.participantAccount(participantId);
    if (!isNonEmptyString(accountId)) fail('participant_not_registered', 'participant has no authenticated account');
    if (pools.includes(accountId)) fail('invalid_input', 'a funding pool cannot request Community Access');
    return accountId;
  };

  // Advisory checks outside the queue transaction; admission rechecks against the ledger.
  const precheck = async (maxCharge, now) => {
    const capacity = await loadCapacity(now);
    if (!capacity.ok) return { capacity, problem: { reason: capacity.reason } };
    const balances = await Promise.all(pools.map((poolId) => ledger.getAccount(poolId)));
    const funded = balances.some((pool) => (pool?.available ?? 0) >= maxCharge);
    return { capacity, problem: funded ? null : { reason: 'unfunded' } };
  };

  /** Change one request and its queue counters atomically. */
  const changeEntry = (requestId, change) => backend.runTransaction(async (tx) => {
    const entry = await tx.get('entries', requestId);
    const occupancy = (await tx.get('occupancy', OCCUPANCY_ID)) ?? emptyOccupancy();
    const usage = rollUsage(await tx.get('usage', entry.accountId), entry.accountId, accessPolicy, clock());
    const result = change({ entry, occupancy, usage, now: clock() });
    if (!result) return { status: 'unchanged', entry };
    tx.set('entries', requestId, { ...result.entry, updatedAt: clock() });
    tx.set('occupancy', OCCUPANCY_ID, occupancy);
    tx.set('usage', entry.accountId, usage);
    return { status: result.status, entry: result.entry };
  });

  const leaveQueue = (occupancy, usage) => {
    occupancy.waiting -= 1;
    usage.waiting -= 1;
  };

  /** Claim a slot in one lane for a waiting request and count its usage. */
  const claimSlot = (requestId, lane, laneSlots) => changeEntry(requestId, ({ entry, occupancy, usage, now }) => {
    if (entry.state !== 'waiting') return null;
    if (occupancy.active[lane] >= laneSlots) return { status: 'full', entry };
    if (lane === 'floor' && !floorEligible(accessPolicy, usage)) return { status: 'full', entry };
    const limited = usageProblem(usage, entry.maxCharge, accessPolicy);
    leaveQueue(occupancy, usage);
    if (limited) {
      return { status: 'limited', entry: { ...entry, state: 'unavailable', reason: limited.reason, reasonDetails: { resetsAt: limited.resetsAt } } };
    }
    occupancy.active[lane] += 1;
    usage.admissions += 1;
    usage.authorizedCredits += entry.maxCharge;
    if (lane === 'floor') usage.floorAdmissions += 1;
    return {
      status: 'claimed',
      entry: { ...entry, state: 'admitting', lane, poolAccountId: poolForLane(accessPolicy, lane), usageWindow: usage.windowStart, claimedAt: now }
    };
  });

  /** Return a claimed slot: back to the queue, or out of it as unavailable. */
  const releaseClaim = (requestId, outcome) => changeEntry(requestId, ({ entry, occupancy, usage }) => {
    if (entry.state !== 'admitting') return null;
    occupancy.active[entry.lane] -= 1;
    if (usage.windowStart === entry.usageWindow) {
      usage.admissions -= 1;
      usage.authorizedCredits -= entry.maxCharge;
      if (entry.lane === 'floor') usage.floorAdmissions -= 1;
    }
    const cleared = { ...entry, lane: null, poolAccountId: null, usageWindow: null, claimedAt: null };
    if (outcome.state === 'waiting') {
      occupancy.waiting += 1;
      usage.waiting += 1;
      return { status: 'requeued', entry: { ...cleared, state: 'waiting' } };
    }
    return { status: 'unavailable', entry: { ...cleared, state: 'unavailable', reason: outcome.reason, reasonDetails: outcome.reasonDetails ?? {} } };
  });

  const markUnavailable = (requestId, reason, reasonDetails = {}) => changeEntry(requestId, ({ entry, occupancy, usage }) => {
    if (entry.state !== 'waiting') return null;
    leaveQueue(occupancy, usage);
    return { status: 'unavailable', entry: { ...entry, state: 'unavailable', reason, reasonDetails } };
  });

  /** Reserve the quoted maximum from the lane's pool. Deterministic ids make a retry after a crash converge. */
  const ledgerAdmit = async (entry) => {
    const scope = sha256Hex(`${entry.requestId}\u0000${entry.poolAccountId}`);
    const quoteId = `ca_${scope.slice(0, 40)}`;
    try {
      const quote = await ledger.createQuote({ ...entry.quote, quoteId, accountId: entry.poolAccountId, idempotencyKey: `community-quote:${scope}` });
      const acceptance = await ledger.acceptQuote({
        quoteId, accountId: entry.poolAccountId, quoteHash: quote.quoteHash, deviceId: entry.deviceId, idempotencyKey: `community-accept:${scope}`
      });
      return { ok: true, quote, acceptance };
    } catch (error) {
      return { ok: false, error };
    }
  };

  /**
   * Finish one claimed request. Returns 'admitted', 'requeued' (its pool
   * cannot fund it now), 'unavailable' or 'pending' (an unexpected failure;
   * the claim stays for the next pass to resume).
   */
  const completeAdmission = async (entry) => {
    const attempt = await ledgerAdmit(entry);
    if (attempt.ok) {
      const { entry: admitted } = await changeEntry(entry.requestId, ({ entry: current }) => (current.state !== 'admitting' ? null : {
        status: 'admitted',
        entry: {
          ...current,
          state: 'admitted',
          reservationId: attempt.acceptance.reservationId,
          quoteId: attempt.quote.quoteId,
          quoteHash: attempt.quote.quoteHash,
          admittedAt: attempt.acceptance.acceptedAt
        }
      }));
      return { status: 'admitted', entry: admitted };
    }
    const code = attempt.error?.code;
    if (code === 'insufficient_balance') {
      if (entry.lane === 'floor' && accessPolicy.guarantee.floor.shortfall === 'unavailable') {
        await releaseClaim(entry.requestId, { state: 'unavailable', reason: 'floor_shortfall', reasonDetails: { cause: 'floor_unfunded' } });
        return { status: 'unavailable', lane: entry.lane };
      }
      await releaseClaim(entry.requestId, { state: 'waiting' });
      return { status: 'requeued', lane: entry.lane };
    }
    if (isNonEmptyString(code)) {
      await releaseClaim(entry.requestId, { state: 'unavailable', reason: 'quote_rejected', reasonDetails: { code } });
      return { status: 'unavailable', lane: entry.lane };
    }
    return { status: 'pending', lane: entry.lane, error: attempt.error?.message ?? null };
  };

  /** Try each lane open to the request in order; a lane whose pool cannot fund the head is closed for the pass. */
  const tryAdmit = async (entry, floor, capacity, closed) => {
    let lanes = floor ? ['floor', 'general'] : ['general'];
    if (floor && capacity.floorShortfall) {
      if (accessPolicy.guarantee.floor.shortfall === 'unavailable') {
        await markUnavailable(entry.requestId, 'floor_shortfall', { cause: 'reserved_slots_not_admitted' });
        return 'unavailable';
      }
      lanes = ['general'];
    }
    for (const lane of lanes) {
      if (closed.has(lane)) continue;
      const claim = await claimSlot(entry.requestId, lane, capacity.lanes[lane]);
      if (claim.status === 'full') continue;
      if (claim.status !== 'claimed') return claim.status;
      const result = await completeAdmission(claim.entry);
      if (result.status !== 'requeued') return result.status;
      closed.add(lane);
    }
    return 'waiting';
  };

  /** Close admitted requests whose ledger reservation is no longer open, freeing their slots. */
  const releaseFinished = async () => {
    const released = [];
    for (const entry of await backend.list('entries', { field: 'state', value: 'admitted' })) {
      const reservation = await ledger.getReservation(entry.reservationId);
      if (!reservation || reservation.status === 'open') continue;
      const { status } = await changeEntry(entry.requestId, ({ entry: current, occupancy, now }) => {
        if (current.state !== 'admitted') return null;
        occupancy.active[current.lane] -= 1;
        return {
          status: 'completed',
          entry: { ...current, state: 'completed', outcome: reservation.status, charge: reservation.settlement?.charge ?? null, completedAt: now }
        };
      });
      if (status === 'completed') released.push(entry.requestId);
    }
    return released;
  };

  const expireWaiting = async (now, limit = Infinity) => {
    const due = (await backend.list('entries', { field: 'state', value: 'waiting' }))
      .filter((entry) => toMs(entry.enqueuedAt) + accessPolicy.queue.maxWaitMs <= toMs(now))
      .sort((left, right) => toMs(left.enqueuedAt) - toMs(right.enqueuedAt) || left.requestId.localeCompare(right.requestId))
      .slice(0, limit);
    const expired = [];
    for (const entry of due) {
      const { status } = await markUnavailable(entry.requestId, 'queue_wait_exceeded');
      if (status === 'unavailable') expired.push(entry.requestId);
    }
    return expired;
  };

  // Finished admissions free their slots and overdue entries leave the queue before any decision.
  const housekeep = async (now) => ({ released: await releaseFinished(), expired: await expireWaiting(now) });

  const usageFor = async (entries) => new Map(await Promise.all([...new Set(entries.map((entry) => entry.accountId))]
    .map(async (accountId) => [accountId, await backend.get('usage', accountId)])));

  const queuePosition = async (requestId, now) => {
    const waiting = await backend.list('entries', { field: 'state', value: 'waiting' });
    const order = fairOrder(waiting, { policy: accessPolicy, usageByAccount: await usageFor(waiting), now });
    const index = order.findIndex(({ entry }) => entry.requestId === requestId);
    return index === -1 ? null : index + 1;
  };

  /** The funding-authority port must allow the named authority's decision; it fails closed. */
  const authorizeFunding = async (request) => {
    if (typeof fundingAuthority !== 'function') {
      fail('funding_authority_required', 'pool funding needs a funding-authority decision port');
    }
    const decision = await fundingAuthority(cloneJson(request));
    if (decision?.allowed !== true) {
      fail('funding_not_authorized', 'the funding authority did not allow this decision', { reason: decision?.reason ?? null });
    }
  };

  /** Move a funding record from one status to the next in one transaction; otherwise return it unchanged. */
  const advanceFunding = (fundingId, from, change) => backend.runTransaction(async (tx) => {
    const current = await tx.get('fundings', fundingId);
    if (current.status !== from) return current;
    const updated = { ...current, ...change(current, clock()) };
    tx.set('fundings', fundingId, updated);
    return updated;
  });

  /** Allocate the pool's credits from the named commitment; a register refusal is final and retained. */
  const allocatePool = async (record) => {
    let allocation;
    try {
      allocation = await ledger.allocateFunding({
        commitmentId: record.commitmentId, use: FUNDING_USE, useRef: record.fundingId, credits: record.quantity,
        ...(record.commitmentAmount === null ? {} : { amount: record.commitmentAmount }),
        accountId: record.poolAccountId, authority: record.authority, funderKinds: [...POOL_FUNDER_KINDS],
        idempotencyKey: `community-allocation:${record.fundingId}`
      });
    } catch (error) {
      if (!FUNDING_REFUSAL_CODES.includes(error?.code)) throw error;
      await advanceFunding(record.fundingId, 'allocating', (current, now) => ({
        status: 'refused', refusal: { code: error.code, message: error.message, details: error.details ?? {} }, closedAt: now
      }));
      throw error;
    }
    return advanceFunding(record.fundingId, 'allocating', (current, now) => ({
      status: 'allocated', allocationId: allocation.allocationId, funderId: allocation.funderId,
      funderKind: allocation.funderKind, validUntil: allocation.validUntil, allocatedAt: now
    }));
  };

  /**
   * Issue the allocated credits into the pool; the ledger consumes the
   * allocation in the issuance transaction. If the commitment's validity
   * ended first, the allocation returns to it and the funding expires.
   */
  const issueFunding = async (record) => {
    await ledger.openAccount({ accountId: record.poolAccountId, ownerId: POOL_OWNER_ID });
    const source = {
      fundingId: record.fundingId,
      funderId: record.funderId,
      funderKind: record.funderKind,
      commitmentId: record.commitmentId,
      allocationId: record.allocationId,
      poolAccountId: record.poolAccountId,
      communityAccessPolicyVersion: record.policyVersion
    };
    const lotId = lotIdForSource(sourceClaimKey('community_access', source));
    try {
      await ledger.issueCredits({
        accountId: record.poolAccountId, provenance: 'community_access', amount: record.quantity, source,
        idempotencyKey: `community-funding:${record.fundingId}`
      });
    } catch (error) {
      if (error?.code === 'commitment_expired') {
        await ledger.releaseFundingAllocation({
          allocationId: record.allocationId, consumedCredits: 0, closure: 'expired', idempotencyKey: `community-allocation-expiry:${record.fundingId}`
        });
        return advanceFunding(record.fundingId, 'allocated', (current, now) => ({ status: 'expired', closedAt: now }));
      }
      const lot = error?.code === 'duplicate_issuance_source' ? await ledger.getLot(lotId) : null;
      if (lot?.accountId !== record.poolAccountId || lot?.source?.fundingId !== record.fundingId) throw error;
    }
    const lot = await ledger.getLot(lotId);
    return advanceFunding(record.fundingId, 'allocated', () => ({ status: 'issued', lotId, issuedAt: lot.issuedAt }));
  };

  /** Drive a funding record forward from wherever a crash left it. */
  const completeFunding = async (initial) => {
    let record = initial;
    if (record.status === 'refused') fail(record.refusal.code, record.refusal.message, record.refusal.details);
    if (record.status === 'allocating') record = await allocatePool(record);
    if (record.status === 'allocated') record = await issueFunding(record);
    return record;
  };

  const store = {
    kind: backend.kind,
    policy: accessPolicy,

    /**
     * Fund a declared pool account from a commitment in the ledger's funding
     * register (a POOL_FUNDER_KINDS funder; the commitment supplies it) and
     * issue it as `community_access` credit there, under a named authority's
     * decision allowed by the funding-authority port and recorded on the
     * allocation. Funding never credits a member account. The funding id is
     * the idempotency identity; a repeat finishes an interrupted allocation
     * or issuance.
     */
    async recordFunding(input = {}) {
      assertKnownKeys(input, ['fundingId', 'commitmentId', 'quantity', 'poolAccountId', 'commitmentAmount', 'authority'], 'recordFunding');
      const { fundingId, commitmentId, quantity, poolAccountId, commitmentAmount } = input;
      assertId(fundingId, 'fundingId');
      assertId(commitmentId, 'commitmentId');
      if (!Number.isSafeInteger(quantity) || quantity <= 0) fail('invalid_input', 'quantity must be a positive integer');
      if (commitmentAmount !== undefined && (!Number.isSafeInteger(commitmentAmount) || commitmentAmount <= 0)) {
        fail('invalid_input', 'commitmentAmount must be a positive integer in the commitment unit');
      }
      if (!pools.includes(poolAccountId)) {
        fail('not_a_pool_account', 'Community Access funding goes only to a declared pool account, never to a member account', { poolAccountId });
      }
      const named = input.authority;
      if (!named || typeof named !== 'object' || Object.keys(named).some((key) => !['actorId', 'decisionId'].includes(key))
        || !isNonEmptyString(named.actorId) || !isNonEmptyString(named.decisionId)) {
        fail('invalid_input', 'pool funding needs authority { actorId, decisionId } naming the deciding authority and its decision');
      }
      const authority = { actorId: named.actorId, decisionId: named.decisionId };
      const request = { fundingId, commitmentId, quantity, poolAccountId, ...(commitmentAmount === undefined ? {} : { commitmentAmount }), authority };
      const requestHash = hashCanonical(request);
      // A recorded funding was already decided; a new one needs the port's decision first.
      if (!await backend.get('fundings', fundingId)) {
        await authorizeFunding({ action: 'fund_pool', fundingId, commitmentId, quantity, poolAccountId, authority });
      }
      const now = clock();
      const record = await backend.runTransaction(async (tx) => {
        const existing = await tx.get('fundings', fundingId);
        if (existing) {
          if (existing.requestHash !== requestHash) fail('funding_conflict', 'funding id was already recorded with different terms', { fundingId });
          return existing;
        }
        const created = {
          schema: FUNDING_SCHEMA, ...request, commitmentAmount: commitmentAmount ?? null, policyVersion: accessPolicy.policyVersion, requestHash,
          status: 'allocating', allocationId: null, funderId: null, funderKind: null, validUntil: null, refusal: null, lotId: null,
          recordedAt: now, allocatedAt: null, issuedAt: null, closedAt: null
        };
        tx.create('fundings', fundingId, created);
        return created;
      });
      return completeFunding(record);
    },

    async getFunding(fundingId) {
      return backend.get('fundings', fundingId);
    },

    /** Finish pool fundings a crash left allocating or allocated; failures stay for the next pass. */
    async resumeFunding({ limit = 100 } = {}) {
      const pending = (await Promise.all(['allocating', 'allocated'].map((status) => backend.list('fundings', { field: 'status', value: status }))))
        .flat()
        .sort((left, right) => toMs(left.recordedAt) - toMs(right.recordedAt) || left.fundingId.localeCompare(right.fundingId))
        .slice(0, limit);
      const results = [];
      for (const record of pending) {
        try {
          results.push({ fundingId: record.fundingId, status: (await completeFunding(record)).status });
        } catch (error) {
          const current = await backend.get('fundings', record.fundingId);
          results.push({ fundingId: record.fundingId, status: current?.status ?? null, code: error?.code ?? 'funding_failed' });
        }
      }
      return results;
    },

    /**
     * Queue-wait expiry on its own: waiting requests past the declared wait
     * leave the queue as unavailable (explicit retry), oldest first, at most
     * `limit` per call. Only queue entries expire; no balance changes.
     */
    async expireQueue({ limit = 100 } = {}) {
      if (!Number.isSafeInteger(limit) || limit <= 0) fail('invalid_input', 'limit must be a positive integer');
      return { expired: await expireWaiting(clock(), limit) };
    },

    /**
     * Ask for Community Access with the caller's quote terms. Rate-limited
     * requests are refused without a record; every other request is recorded
     * as queued or unavailable, then an admission pass runs. `requestId` is
     * the idempotency identity: a repeat returns the current state.
     */
    async requestAccess(input = {}) {
      assertKnownKeys(input, ['requestId', 'participantId', 'deviceId', 'quote'], 'requestAccess');
      const { requestId, participantId, deviceId, quote } = input;
      assertId(requestId, 'requestId');
      if (!isNonEmptyString(deviceId)) fail('invalid_input', 'deviceId must name the authenticated device');
      // The requester supplies terms only; the pool account and quote id are never theirs to name.
      assertKnownKeys(quote, ['service', 'pricing', 'terms'], 'requestAccess.quote');
      const now = clock();
      buildQuote({ ...quote, quoteId: 'probe', accountId: accessPolicy.poolAccountId }, { policy: ledger.policy, now });
      const accountId = await resolveAccount(participantId);
      const maxCharge = quote.pricing.maxCharge;
      const requestHash = hashCanonical({ accountId, deviceId, quote });
      const existing = await backend.get('entries', requestId);
      if (existing) {
        if (existing.requestHash !== requestHash) fail('idempotency_conflict', 'request id was already used with a different request');
        return store.getRequest(requestId);
      }
      await housekeep(now);
      const { problem } = await precheck(maxCharge, now);
      const outcome = await backend.runTransaction(async (tx) => {
        const prior = await tx.get('entries', requestId);
        const accountKey = counterId('account', accountId);
        const deviceKey = counterId('device', deviceId);
        const accountCounter = rollCounter(await tx.get('counters', accountKey), { scope: 'account', subject: accountId }, accessPolicy.rateLimits.account, now);
        const deviceCounter = rollCounter(await tx.get('counters', deviceKey), { scope: 'device', subject: deviceId }, accessPolicy.rateLimits.device, now);
        const usage = rollUsage(await tx.get('usage', accountId), accountId, accessPolicy, now);
        const occupancy = (await tx.get('occupancy', OCCUPANCY_ID)) ?? emptyOccupancy();
        if (prior) return { recorded: true };
        const limited = rateLimitProblem({ accountCounter, deviceCounter }, accessPolicy);
        if (limited) return { recorded: false, limited };
        accountCounter.count += 1;
        deviceCounter.count += 1;
        const blocked = problem ?? usageProblem(usage, maxCharge, accessPolicy) ?? queueProblem(usage, occupancy, accessPolicy);
        if (!blocked) {
          usage.waiting += 1;
          occupancy.waiting += 1;
        }
        const { reason = null, ...reasonDetails } = blocked ?? {};
        tx.create('entries', requestId, {
          schema: ENTRY_SCHEMA,
          requestId,
          accountId,
          participantId,
          deviceId,
          quote,
          maxCharge,
          requestHash,
          policyVersion: accessPolicy.policyVersion,
          state: blocked ? 'unavailable' : 'waiting',
          reason,
          reasonDetails,
          lane: null,
          poolAccountId: null,
          enqueuedAt: now,
          reservationId: null,
          quoteId: null,
          quoteHash: null,
          admittedAt: null,
          completedAt: null,
          outcome: null,
          charge: null,
          updatedAt: now
        });
        tx.set('counters', accountKey, accountCounter);
        tx.set('counters', deviceKey, deviceCounter);
        tx.set('usage', accountId, usage);
        tx.set('occupancy', OCCUPANCY_ID, occupancy);
        return { recorded: true };
      });
      if (!outcome.recorded) {
        return { requestId, accountId, guarantee: accessPolicy.guarantee.mode, state: 'unavailable', ...outcome.limited, retry: 'explicit' };
      }
      await store.admitWaiting();
      return store.getRequest(requestId);
    },

    /** The request's visible state: queued with position and estimate, available, completed or unavailable with reason. */
    async getRequest(requestId) {
      const entry = await backend.get('entries', requestId);
      if (!entry) return null;
      const now = clock();
      if (entry.state !== 'waiting' && entry.state !== 'admitting') return entryView(entry, { policy: accessPolicy });
      const capacity = await loadCapacity(now);
      const position = entry.state === 'admitting' ? 1 : await queuePosition(requestId, now);
      return entryView(entry, { policy: accessPolicy, position, capacity });
    },

    /** What a new request from this participant and device would meet now, without recording one. */
    async describeAvailability({ participantId, deviceId, maxCharge } = {}) {
      if (!isNonEmptyString(deviceId)) fail('invalid_input', 'deviceId must name the authenticated device');
      if (!Number.isSafeInteger(maxCharge) || maxCharge < 0) fail('invalid_input', 'maxCharge must be a non-negative integer');
      const accountId = await resolveAccount(participantId);
      const now = clock();
      await housekeep(now);
      const view = (fields) => ({ accountId, guarantee: accessPolicy.guarantee.mode, completion: 'not_guaranteed', ...fields });
      const [accountCounter, deviceCounter, usage, occupancy] = await Promise.all([
        backend.get('counters', counterId('account', accountId))
          .then((counter) => rollCounter(counter, { scope: 'account', subject: accountId }, accessPolicy.rateLimits.account, now)),
        backend.get('counters', counterId('device', deviceId))
          .then((counter) => rollCounter(counter, { scope: 'device', subject: deviceId }, accessPolicy.rateLimits.device, now)),
        backend.get('usage', accountId).then((record) => rollUsage(record, accountId, accessPolicy, now)),
        backend.get('occupancy', OCCUPANCY_ID).then((record) => record ?? emptyOccupancy())
      ]);
      const problem = rateLimitProblem({ accountCounter, deviceCounter }, accessPolicy)
        ?? usageProblem(usage, maxCharge, accessPolicy)
        ?? queueProblem(usage, occupancy, accessPolicy);
      if (problem) return view({ state: 'unavailable', ...problem, retry: 'explicit' });
      const { capacity, problem: supply } = await precheck(maxCharge, now);
      if (supply) return view({ state: 'unavailable', ...supply, retry: 'explicit' });
      const free = capacity.lanes.general - occupancy.active.general
        + (floorEligible(accessPolicy, usage) ? capacity.lanes.floor - occupancy.active.floor : 0);
      if (free > 0 && occupancy.waiting === 0) return view({ state: 'available' });
      const position = occupancy.waiting + 1;
      return view({ state: 'queued', position, estimatedWaitMs: estimateWaitMs(position, capacity) });
    },

    /**
     * One admission pass: free slots of finished requests, expire requests
     * past the queue wait (explicit retry), resume interrupted admissions,
     * then admit waiting requests in fair order while admitted slots and
     * pool funding allow.
     */
    async admitWaiting({ limit = 100 } = {}) {
      const now = clock();
      const { released, expired } = await housekeep(now);
      const capacity = await loadCapacity(now);
      const admitted = [];
      const pending = [];
      for (const entry of await backend.list('entries', { field: 'state', value: 'admitting' })) {
        const result = await completeAdmission(entry);
        if (result.status === 'admitted') admitted.push(entry.requestId);
        if (result.status === 'pending') pending.push(entry.requestId);
      }
      if (capacity.ok) {
        const waiting = await backend.list('entries', { field: 'state', value: 'waiting' });
        const closed = new Set();
        for (const { entry, floor } of fairOrder(waiting, { policy: accessPolicy, usageByAccount: await usageFor(waiting), now })) {
          if (admitted.length >= limit) break;
          const status = await tryAdmit(entry, floor, capacity, closed);
          if (status === 'admitted') admitted.push(entry.requestId);
          if (status === 'pending') pending.push(entry.requestId);
        }
      }
      return { capacity: capacity.ok ? { evidenceId: capacity.evidenceId, lanes: capacity.lanes } : { reason: capacity.reason }, released, expired, admitted, pending };
    },

    /**
     * Funding by funder kind, and consumption attributed to the funding lots
     * the ledger charged, net of refunds; beside the ledger's own solvency
     * subsidy figure. Every number derives from durable records.
     */
    async getSubsidyReport() {
      const funded = emptyByFunder();
      for (const funding of await backend.list('fundings')) {
        if (funding.status === 'issued') funded[funding.funderKind] += funding.quantity;
      }
      const consumed = emptyByFunder();
      const funderOfLot = new Map();
      const poolBalances = [];
      for (const poolId of pools) {
        for (const entry of await ledger.listJournal(poolId)) {
          const sign = entry.type === 'charge' ? 1 : entry.type === 'refund' ? -1 : 0;
          if (!sign) continue;
          for (const lot of entry.lots) {
            if (!funderOfLot.has(lot.lotId)) funderOfLot.set(lot.lotId, (await ledger.getLot(lot.lotId))?.source?.funderKind ?? null);
            const kind = funderOfLot.get(lot.lotId);
            if (kind in consumed) consumed[kind] += sign * lot.amount;
          }
        }
        const pool = await ledger.getAccount(poolId);
        poolBalances.push({ poolAccountId: poolId, available: pool?.available ?? 0, held: pool?.held ?? 0 });
      }
      const snapshot = await ledger.getSolvencySnapshot();
      return {
        schema: SUBSIDY_REPORT_SCHEMA,
        policyVersion: accessPolicy.policyVersion,
        guarantee: accessPolicy.guarantee.mode,
        generatedAt: clock(),
        funded: withTotal(funded),
        consumed: withTotal(consumed),
        pools: poolBalances,
        solvencySubsidy: snapshot.subsidy
      };
    }
  };
  return assertCommunityAccessContract(store);
}

/**
 * Ledger issuance decision for Community Access credit: allow a
 * `community_access` lot only for allocated funding, into its declared pool
 * account, with matching quantity, funder and register allocation. Member
 * accounts never qualify.
 */
export function createFundingIssuanceAuthority({ backend, policy } = {}) {
  assertCommunityAccessBackend(backend);
  const pools = poolAccountIds(validateCommunityAccessPolicy(policy));
  return async function fundingIssuanceAuthority(request) {
    if (request?.provenance !== 'community_access') return { allowed: false, reason: 'provenance_not_governed' };
    const source = request.source || {};
    const funding = validId(source.fundingId) ? await backend.get('fundings', source.fundingId) : null;
    if (!funding) return { allowed: false, reason: 'funding_not_recorded' };
    const matches = pools.includes(request.accountId)
      && funding.poolAccountId === request.accountId
      && funding.quantity === request.amount
      && funding.funderId === source.funderId
      && funding.funderKind === source.funderKind
      && funding.allocationId !== null
      && funding.allocationId === source.allocationId
      && funding.commitmentId === source.commitmentId;
    if (!matches) return { allowed: false, reason: 'issuance_request_mismatch' };
    return { allowed: true, decisionId: `community-funding:${funding.fundingId}`, limitId: null };
  };
}

export default createCommunityAccess;
