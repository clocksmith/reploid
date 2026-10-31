/** Atomic settlement preparation. Historical reputation reads stay outside storage transactions. */
import { hashJson } from '../hash.js';
import { ACCEPTANCE_V2, canonicalAcceptanceTerms } from '../../../packages/reploid/src/artifacts/acceptance.js';
import { POOL_SETTLEMENT_STORAGE_BUDGET } from '../store-contract.js';
import { getPolicy } from '../policy-router.js';
import { verifyRequesterAcceptance } from '../verifier.js';
import { assignmentIsCurrent } from '../coordinator-transitions.js';
import { buildAcceptanceSummary } from './acceptance.js';
import { acceptedLedgerReasonForJob, spendLedgerReasonForJob, ensureAgreementCommitRevealReady } from './agreement-lifecycle.js';
import { createReputationSeedEvent, hasLegacyReputationEvidence, projectProviderReputation } from '../reputation-projection.js';
import { deriveProviderAdmission } from '../runtime-profile.js';
import { REPUTATION_EVENT_TYPES } from '../../../self/pool/reputation.js';

const fail = (status, message, code = 'settlement_invalid') => Object.assign(new Error(message), { status, code });
const clone = value => structuredClone(value ?? null);
const effectId = (kind, identity) => `${kind}_${hashJson(identity).slice(7)}`;
const same = (left, right) => hashJson(left ?? null) === hashJson(right ?? null);
const hasCurrentAttemptEvidence = (record, job, v2) => assignmentIsCurrent(record, job)
  && (!v2 || (record.assignmentAttemptId === job.assignmentAttemptId
    && (record.ringAttemptId ?? null) === (job.ringAttemptId ?? null)));

/** Bound serialized evidence and effects before either adapter can mutate storage. */
export function validateSettlementStorageBudget(plan) {
  const records = [...plan.reads, ...plan.writes];
  const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (records.length > POOL_SETTLEMENT_STORAGE_BUDGET.maxRecords
    || records.some(record => bytes(record.value) > POOL_SETTLEMENT_STORAGE_BUDGET.maxRecordBytes)
    || bytes(plan.result) > POOL_SETTLEMENT_STORAGE_BUDGET.maxRecordBytes
    || bytes(plan) > POOL_SETTLEMENT_STORAGE_BUDGET.maxPlanBytes) {
    throw fail(413, 'settlement evidence exceeds the storage budget', 'settlement_storage_budget_exceeded');
  }
  return plan;
}

/** Called on fresh transaction reads. No I/O, clock, randomness or mutation. */
export function validateSettlementSnapshot(plan, actualValues) {
  if (actualValues.length !== plan.reads.length || plan.reads.some((read, index) => !same(read.value, actualValues[index]))) {
    throw fail(409, 'settlement evidence changed; retry with current evidence', 'settlement_evidence_changed');
  }
}

/** The signed payload, not a particular ECDSA signature encoding, identifies the decision. */
export function receiptSettlementDecisionId(jobId, receiptHash, acceptance) {
  if (acceptance.schema === ACCEPTANCE_V2) return effectId('settlement_v2', canonicalAcceptanceTerms(acceptance));
  // Persisted v1 IDs include selector and signed metadata. Never reinterpret them.
  const { requesterSignature, ...payload } = acceptance;
  return effectId('settlement', { jobId, receiptHash, payload });
}

export async function prepareReceiptSettlement({ store, receiptHash, acceptance: suppliedAcceptance, boundRequesterId }) {
  const acceptance = clone(suppliedAcceptance);
  const v2 = acceptance?.schema === ACCEPTANCE_V2;
  if (!acceptance || typeof acceptance.accepted !== 'boolean' || (!v2 && acceptance.receiptHash !== receiptHash)) {
    throw fail(400, 'acceptance must bind the requested receipt and a boolean decision');
  }
  const reads = new Map();
  const writes = new Map();
  const read = async (collection, id) => {
    if (typeof id !== 'string' || !id) throw fail(400, 'settlement record identity missing');
    const key = `${collection}:${id}`;
    if (!reads.has(key)) reads.set(key, { collection, id, value: clone(await store.getSettlementRecord(collection, id)) });
    return clone(reads.get(key).value);
  };
  const write = (collection, id, value) => writes.set(`${collection}:${id}`, { collection, id, value: clone(value) });
  try {
    const receipt = await read('receipts', receiptHash);
    if (!receipt) throw fail(404, 'receipt not found');
    const job = await read('jobs', receipt.jobId);
    if (!job) throw fail(404, 'job not found');
    if (boundRequesterId !== undefined && job.requesterId !== boundRequesterId) {
      throw fail(403, 'authenticated requester binding no longer matches the job', 'settlement_requester_binding_changed');
    }
    if (!receipt.verifierDecision?.accepted) throw fail(400, 'receipt is not verifier-accepted');
    if (!hasCurrentAttemptEvidence(receipt, job, v2)) throw fail(409, 'receipt does not belong to the current job attempt');
    const currentHashes = job.agreement?.status === 'accepted' ? job.agreement.receiptHashes : job.receiptHashes || [job.receiptHash];
    if (!Array.isArray(currentHashes) || !currentHashes.includes(receiptHash)) throw fail(409, 'receipt is not in the current agreement');
    const policy = getPolicy(job.policyId);
    if (!policy) throw fail(409, 'settlement policy is unavailable');
    const limit = Number(policy.maxRingSize || policy.redundancy || 1);
    if (!Number.isSafeInteger(limit) || limit < 1 || currentHashes.length > limit || new Set(currentHashes).size !== currentHashes.length) {
      throw fail(400, 'settlement receipt set exceeds its policy or contains duplicates');
    }
    const authentication = await verifyRequesterAcceptance({ job, acceptance });
    if (!authentication.accepted) {
      const error = fail(400, 'requester acceptance rejected');
      error.verifierDecision = authentication;
      throw error;
    }
    const decisionId = receiptSettlementDecisionId(job.jobId, receiptHash, acceptance);
    if (job.settlement) {
      if ((job.settlement.version || 1) !== (v2 ? 2 : 1) || job.settlement.decisionId !== decisionId) {
        throw fail(409, 'job already has a different settlement decision', 'settlement_conflict');
      }
      if (v2) {
        // Replay does not re-price. It still authenticates and snapshots every
        // member of the current attempt, including either URL selector.
        for (const hash of acceptance.receiptHashes) {
          const member = await read('receipts', hash);
          const allocation = acceptance.providerPoints.find(entry => entry.receiptHash === hash);
          if (!member?.verifierDecision?.accepted || member.jobId !== job.jobId
            || member.requesterId !== job.requesterId || !hasCurrentAttemptEvidence(member, job, v2)
            || member.providerId !== allocation?.providerId) throw fail(409, 'settled agreement evidence is missing or changed');
          if (!member.assignmentId) throw fail(409, 'settled assignment identity is missing');
          if (member.assignmentId) {
            const assignment = await read('assignments', member.assignmentId);
            if (!assignment || assignment.jobId !== job.jobId || assignment.providerId !== member.providerId
              || !hasCurrentAttemptEvidence(assignment, job, v2)) throw fail(409, 'settled assignment evidence is missing or changed');
          }
        }
      }
      return validateSettlementStorageBudget({ replay: true, reads: [...reads.values()], writes: [], result: clone(job.settlement.result) });
    }
    if (['acceptance_processing', 'accepted', 'rejected_by_requester'].includes(job.status)) {
      throw fail(409, 'legacy job settlement requires explicit reconciliation', 'settlement_legacy_reconciliation_required');
    }
    const at = new Date().toISOString();
    const savedAcceptance = { ...acceptance, createdAt: at };
    const reputationSnapshots = new Map();
    const reputation = async providerId => {
      if (!reputationSnapshots.has(providerId)) {
        // Capture the revision before scanning history. Every reputation writer advances it.
        const current = await read('reputationState', providerId) || { providerId };
        const events = clone(await store.listPoolEventsForProvider(providerId));
        const projected = projectProviderReputation(providerId, events, current);
        reputationSnapshots.set(providerId, { current, events, projected });
      }
      return clone(reputationSnapshots.get(providerId).projected);
    };
    const snapshotStore = {
      getReceipt: id => read('receipts', id),
      getProvider: id => read('providers', id),
      getReputation: reputation,
      getAssignmentCommitment: id => read('commitmentEvents', id),
      getAssignmentReveal: id => read('revealEvents', id)
    };
    let result;
    let jobPatch;
    let summary;
    if (v2 || acceptance.accepted) {
      summary = await buildAcceptanceSummary({ store: snapshotStore, job, receiptHash, version: v2 ? 2 : 1 });
      if (summary.agreedRecords.length !== summary.receiptHashes.length || !summary.receiptHashes.includes(receiptHash)) {
        throw fail(409, 'accepted agreement set is missing verifier-accepted receipts');
      }
      const providerIds = new Set();
      for (const record of summary.agreedRecords) {
        if (record.jobId !== job.jobId || record.requesterId !== job.requesterId || !hasCurrentAttemptEvidence(record, job, v2)
          || providerIds.has(record.providerId)) throw fail(409, 'agreement receipt ownership or current attempt mismatch');
        providerIds.add(record.providerId);
        if (v2 && !record.assignmentId) throw fail(409, 'agreement assignment identity is missing');
        if (record.assignmentId) {
          const assignment = await read('assignments', record.assignmentId);
          if (!assignment || assignment.jobId !== job.jobId || assignment.providerId !== record.providerId
            || !hasCurrentAttemptEvidence(assignment, job, v2)) throw fail(409, 'agreement assignment is missing or stale');
        }
      }
      const decision = await verifyRequesterAcceptance({ job, acceptance, expectedAcceptance: summary });
      if (!decision.accepted) {
        const error = fail(400, 'requester acceptance rejected');
        error.verifierDecision = decision;
        throw error;
      }
    }
    if (!acceptance.accepted) {
      result = { acceptance: savedAcceptance, ledgerEvent: null, reputation: await reputation(receipt.providerId) };
      write('receipts', receiptHash, { ...receipt, requesterAcceptance: savedAcceptance, ledgerEvent: null, updatedAt: at });
      jobPatch = { status: 'rejected_by_requester', requesterAcceptance: savedAcceptance };
    } else {
      if (job.agreement && job.agreement.status !== 'accepted') throw fail(409, 'selected policy has not reached an accepted final state');
      const reasons = await ensureAgreementCommitRevealReady({ store: snapshotStore, job, agreedRecords: summary.agreedRecords });
      if (reasons.length) throw fail(409, 'accepted agreement set is missing required commit-reveal evidence');
      if (job.maxPointSpend != null && summary.totalProviderPoints > Number(job.maxPointSpend)) {
        throw fail(402, 'accepted result exceeds requester maxPointSpend');
      }
      const ledgerEvents = [];
      const reputations = [];
      for (const record of summary.agreedRecords) {
        const points = summary.providerPoints.find(entry => entry.receiptHash === record.receiptHash).points;
        const ledgerId = effectId('ledger', { decisionId, kind: 'award', receiptHash: record.receiptHash, providerId: record.providerId });
        const ledgerEvent = { ledgerId, eventType: 'points_awarded', reason: acceptedLedgerReasonForJob(job, summary.receiptHashes.length),
          receiptHash: record.receiptHash, providerId: record.providerId, requesterId: job.requesterId,
          userId: record.providerId, points, acceptance: savedAcceptance, createdAt: at };
        const snapshot = reputationSnapshots.get(record.providerId);
        const events = [...snapshot.events];
        if (!events.length && hasLegacyReputationEvidence(snapshot.current)) {
          const seed = { ...createReputationSeedEvent(record.providerId, snapshot.current), createdAt: at };
          events.push(seed);
          write('poolEvents', seed.eventId, seed);
        }
        const event = { eventId: effectId('reputation', { decisionId, receiptHash: record.receiptHash, providerId: record.providerId }),
          type: REPUTATION_EVENT_TYPES.requesterAccepted, category: 'reputation', providerId: record.providerId,
          jobId: job.jobId, receiptHash: record.receiptHash, points, createdAt: at };
        events.push(event);
        const projected = projectProviderReputation(record.providerId, events, snapshot.current);
        const admission = deriveProviderAdmission({ provider: await snapshotStore.getProvider(record.providerId) || {},
          reputation: projected, policy: getPolicy('ring_quorum_receipt') || {} });
        const next = { ...projected, admissionPolicyId: admission.policyId, admissionLane: admission.laneId,
          ringEligible: admission.ringEligible, evidenceRevision: Number(snapshot.current.evidenceRevision || 0) + 1, updatedAt: at };
        write('poolEvents', event.eventId, event);
        write('pointsLedger', ledgerId, ledgerEvent);
        write('reputationState', record.providerId, next);
        write('receipts', record.receiptHash, { ...record, requesterAcceptance: savedAcceptance, ledgerEvent, reputation: next, updatedAt: at });
        ledgerEvents.push(ledgerEvent);
        reputations.push(next);
      }
      const spendId = effectId('ledger', { decisionId, kind: 'spend', requesterId: job.requesterId });
      const requesterSpendEvent = summary.totalProviderPoints > 0 ? { ledgerId: spendId, eventType: 'points_spent',
        reason: spendLedgerReasonForJob(job, summary.receiptHashes.length), receiptHash,
        receiptHashes: summary.receiptHashes, requesterId: job.requesterId, userId: job.requesterId,
        points: -summary.totalProviderPoints, acceptance: savedAcceptance, createdAt: at } : null;
      if (requesterSpendEvent) write('pointsLedger', spendId, requesterSpendEvent);
      result = { acceptance: savedAcceptance, ledgerEvents, requesterSpendEvent, reputations };
      jobPatch = { status: 'accepted', requesterAcceptance: savedAcceptance, ledgerEvents, requesterSpendEvent,
        acceptedReceiptHashes: summary.receiptHashes };
    }
    write('receiptAcceptances', receiptHash, savedAcceptance);
    write('jobs', job.jobId, { ...job, ...jobPatch, settlement: { version: v2 ? 2 : 1, decisionId, result }, updatedAt: at });
    // Include effect absence in the transaction read set. Historical partial effects must not be overwritten.
    for (const entry of writes.values()) {
      const prior = await read(entry.collection, entry.id);
      if (['pointsLedger', 'poolEvents', 'receiptAcceptances'].includes(entry.collection) && prior) {
        throw fail(409, 'existing settlement effects require reconciliation', 'settlement_legacy_reconciliation_required');
      }
    }
    return validateSettlementStorageBudget({ reads: [...reads.values()], writes: [...writes.values()], result: clone(result) });
  } catch (error) {
    // Preparation can straddle a concurrent commit. Do not mistake its effects
    // or changed economics for legacy corruption or an invalid signed request.
    for (const record of reads.values()) {
      if (!same(record.value, await store.getSettlementRecord(record.collection, record.id))) {
        throw fail(409, 'settlement evidence changed; retry with current evidence', 'settlement_evidence_changed');
      }
    }
    throw error;
  }
}
