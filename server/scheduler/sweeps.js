/**
 * @fileoverview Sweep jobs: the existing resume and expiry operations of the
 * ledger, funding register, rewards, Community Access and purchase
 * reconciliation, each run as a bounded scheduled pass.
 *
 * Every operation is owned and made idempotent by its component; a sweep only
 * calls it with the pass's batch limit and records what it reports. Only
 * reservations (their holds), allocations and queue entries expire, under
 * their owners' rules. No sweep expires a credit balance: released holds
 * return to their account, funding returns only what was never issued, and
 * issuance only adds. Purchase polling applies only what the processor's
 * authoritative status shows, under the payment component's own rules.
 */

const backlog = (count, limit) => count >= limit;
const failed = (code) => (code ? { code } : {});

/**
 * @param {object} services composed component stores; a sweep is registered only for those supplied
 * @param {object} [services.ledger] credit ledger store
 * @param {object} [services.rewards] contribution reward store
 * @param {object} [services.access] Community Access store
 * @param {object} [services.payments] purchase reconciliation store
 */
export function createSweepJobs({ ledger = null, rewards = null, access = null, payments = null } = {}) {
  const jobs = {};
  if (ledger) {
    // Open reservations past their period release their whole hold at zero charge.
    jobs['ledger.expireReservations'] = {
      async run({ limit }) {
        const settled = await ledger.expireReservations({ limit });
        return { items: settled.map((record) => ({ ref: record.reservationId, status: record.outcome, released: record.released })), backlog: backlog(settled.length, limit) };
      }
    };
    // Unissued donated-credit allocations after their commitment's validity return to it.
    jobs['ledger.expireAllocations'] = {
      async run({ limit }) {
        const results = await ledger.expireAllocations({ limit });
        return {
          items: results.map((result) => ({ ref: result.allocationId, status: result.status, returnedCredits: result.returnedCredits ?? null, ...failed(result.code) })),
          backlog: backlog(results.length, limit)
        };
      }
    };
  }
  if (rewards) {
    // Interrupted reservations finish; active ones past their commitment expire and return unauthorized funding.
    jobs['rewards.resumeFunding'] = {
      async run({ limit }) {
        const results = await rewards.resumeFunding({ limit });
        return {
          items: results.map((result) => ({ ref: result.fundingId, status: result.status, returned: result.returned ?? null, ...failed(result.code) })),
          backlog: backlog(results.length, limit)
        };
      }
    };
    // Validations left pending by a crash or a declined issuance are issued, or stay pending with the reason.
    jobs['rewards.resumeIssuance'] = {
      async run({ limit }) {
        const results = await rewards.resumeIssuance({ limit });
        return {
          items: results.map((result) => ({ ref: result.validationId, status: result.status, lotId: result.lotId ?? null, ...failed(result.code) })),
          backlog: backlog(results.length, limit)
        };
      }
    };
  }
  if (access) {
    // Interrupted pool fundings finish; one whose commitment ended first returns its allocation.
    jobs['community-access.resumeFunding'] = {
      async run({ limit }) {
        const results = await access.resumeFunding({ limit });
        return { items: results.map((result) => ({ ref: result.fundingId, status: result.status, ...failed(result.code) })), backlog: backlog(results.length, limit) };
      }
    };
    // Waiting requests past the declared queue wait leave the queue for explicit retry.
    jobs['community-access.expireQueue'] = {
      async run({ limit }) {
        const { expired } = await access.expireQueue({ limit });
        return { items: expired.map((requestId) => ({ ref: requestId, status: 'unavailable' })), backlog: backlog(expired.length, limit) };
      }
    };
  }
  if (payments) {
    // Payments still waiting on the processor or the ledger reconcile from authoritative status.
    jobs['payments.pollPending'] = {
      async run({ limit }) {
        const results = await payments.pollPending({ limit });
        return {
          items: results.map((result) => ({ ref: result.checkoutId, status: result.phase, ...failed(result.error?.code) })),
          backlog: backlog(results.length, limit)
        };
      }
    };
  }
  return jobs;
}

export default createSweepJobs;
