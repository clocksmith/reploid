/** Whole-model HTTP accounting over accepted ledger quotes. No prices, credits,
 * quality rules or account authority originate here. Interrupted dispatch stays
 * held until execution evidence exists; reconnecting never executes it again. */
import { createHash } from 'node:crypto';
import { assertLedgerBackend, assertLedgerStoreContract } from './ledger/store-contract.js';
import { billableEventIdFor } from './ledger/attempt-outcomes.js';
import { conversionHash } from './ledger/conversion/records.js';
import { createTrialAdmission } from './trial-admission.js';
import { verifyReceipt } from '../packages/reploid/src/artifacts/receipt.js';
import { matchesWholeModelReceipt } from '../packages/reploid/src/artifacts/whole-model-receipt.js';
import { hashJson } from '../packages/reploid/src/artifacts/signatures.js';
import { partitionAdapterIdentities } from '../packages/reploid/src/mesh/partitions/partition-contract.js';

export const TEXT_ACCOUNTING_COLLECTIONS = Object.freeze({ jobs: 'text_accounting_jobs', receipts: 'text_accounting_receipts' });
const key = value => createHash('sha256').update(value).digest('hex');
const assert = (ok, message, status = 409) => { if (!ok) throw Object.assign(Error(message), { status }); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 512;

// Conservative exposure, not a service price: charge every credit against the
// cap, even purchased credit. Ceil prevents fractional minor units understating it.
function exposure(record, credits) {
  assert(Number.isSafeInteger(credits) && credits >= 0, 'Invalid ledger charge');
  const numerator = BigInt(credits) * BigInt(record.rate.perMinorUnits), denominator = BigInt(record.rate.credits);
  const minor = (numerator + denominator - 1n) / denominator;
  assert(minor <= BigInt(Number.MAX_SAFE_INTEGER), 'Exposure overflow');
  return Number(minor);
}

/** resolveAcceptedRequest is the authenticated account/terms owner. It returns
 * { accountId, deviceId, requesterId, reservationId, conversionId } only after
 * accepting published terms. assessQuality returns an explicit policy-bound
 * { outcome, policyVersion, decisionId, reason? }; signatures are not quality. */
export function createTextAccounting({ ledger, backend, trialBackend, trialPolicy, policyVersion,
  resolveAcceptedRequest, assessQuality, production = true, clock = () => new Date().toISOString() }) {
  assertLedgerStoreContract(ledger); assertLedgerBackend(backend);
  assert(!production || ledger.kind === 'firestore' && backend.kind === 'firestore', 'Production accounting requires durable shared storage');
  assert(text(policyVersion) && typeof resolveAcceptedRequest === 'function' && typeof assessQuality === 'function',
    'Explicit pricing, account acceptance and quality authorities required');
  const read = id => backend.get('jobs', key(id));
  const update = (id, mutate) => backend.runTransaction(async tx => {
    const record = await tx.get('jobs', key(id));
    assert(record, 'Accounting request missing');
    const next = mutate(record); tx.set('jobs', key(id), next); return next;
  });
  const trial = createTrialAdmission({ backend: trialBackend, policy: trialPolicy, production,
    clock: () => Date.parse(clock()),
    async readReservation(id) {
      const record = await read(id), reservation = await ledger.getReservation(id);
      if (!record || !reservation) return null;
      return { reservationId: id, accountId: reservation.accountId, accepted: reservation.quoteHash === record.quoteHash,
        currency: record.conversion.currency, quoteIdentity: record.quoteHash,
        maxSubsidyMinor: exposure(record.conversion, reservation.authorizedMax), expiresAt: Date.parse(reservation.expiresAt) };
    },
    async readSettlement(id) {
      const record = await read(id), reservation = await ledger.getReservation(id);
      if (!record?.settlementInput || reservation?.status !== 'settled') return null;
      const settled = reservation.settlement;
      assert(settled.billableEventId === billableEventIdFor(id), 'Unbound accounting settlement');
      return { reservationId: id, accountId: reservation.accountId, settlementId: settled.settlementId,
        currency: record.conversion.currency, subsidyMinor: exposure(record.conversion, settled.charge), executionSettled: true };
    }
  });
  async function reconcile(reservationId) {
    const record = await read(reservationId);
    if (!record?.settlementInput) return { settled: false };
    await ledger.settleReservation({ ...record.settlementInput, idempotencyKey: `text:${key(reservationId)}` });
    const reservation = await ledger.getReservation(reservationId);
    // Failed-quality review may retain the economic hold even after GPU cleanup.
    if (reservation.status !== 'settled') return { settled: false, status: reservation.status };
    if (await trial.getReservation(reservationId)) await trial.reconcile(reservationId);
    await update(reservationId, current => ({ ...current, phase: 'settled' }));
    return { settled: true, settlement: reservation.settlement };
  }
  return Object.freeze({
    reconcile, getRecord: read, getTrialState: () => trial.getState(),
    /** Authenticated contribution routes resolve references against kept evidence;
     * the contributor never supplies a requester reservation or charge. */
    async resolveContribution({ participantId, receiptId, jobHash }) {
      assert([participantId, receiptId, jobHash].every(text), 'Bound receipt reference required');
      const index = await backend.get('receipts', key(`${participantId}|${jobHash}`));
      if (!index || index.receiptId !== receiptId) return null;
      const record = await read(index.reservationId);
      if (!record || record.receipt?.provider !== participantId || record.receipt.receiptId !== receiptId
        || record.receipt.jobHash !== jobHash) return null;
      return { reservationId: record.reservationId, attemptId: record.attemptId, settled: record.phase === 'settled' };
    },
    async run(request, controls, execute) {
      request = structuredClone(request);
      assert(!request.model.partition, 'Whole-model accounting cannot settle partition execution');
      assert(text(controls?.principal?.subject) && typeof controls.requestApproval === 'function', 'Authenticated request and disclosure required');
      const accepted = await resolveAcceptedRequest({ principal: controls.principal, request: structuredClone(request), signal: controls.signal });
      assert(accepted && ['accountId', 'deviceId', 'requesterId', 'reservationId', 'conversionId'].every(field => text(accepted[field])),
        'An authorized accepted quote is required', 403);
      const { reservationId, accountId, deviceId, requesterId } = accepted;
      const reservation = await ledger.getReservation(reservationId), quote = reservation && await ledger.getQuote(reservation.quoteId);
      const conversion = await ledger.getConversion(accepted.conversionId);
      assert(reservation?.status === 'open' && reservation.accountId === accountId && reservation.deviceId === deviceId
        && !reservation.attempts.length && quote?.status === 'accepted' && quote.reservationId === reservationId
        && quote.quoteHash === reservation.quoteHash, 'Accepted reservation is unavailable or belongs to another device');
      assert(quote.pricing.basis.policyVersion === policyVersion && !reservation.terms.evidence,
        'Quote policy does not cover whole-model accounting');
      assert(reservation.terms.settlement.cancellationQueued?.kind === 'fixed'
        && reservation.terms.settlement.cancellationQueued.amount === 0,
      'Trial admission requires accepted terms with no fee before dispatch');
      assert(reservation.service.model.modelId === request.model.id
        && reservation.service.model.deployedRepresentation === request.model.identity
        && same(reservation.service.model.adapters, partitionAdapterIdentities(request.model)), 'Quoted model variant differs from the request');
      assert(conversion?.currency === 'USD' && conversion.recordHash === conversionHash(conversion)
        && conversion.policyVersion === policyVersion && Date.parse(conversion.effectiveFrom) <= Date.parse(reservation.acceptedAt),
        'An effective pinned conversion from the approved policy is required');
      const inputDigest = await hashJson(request.messages);
      const record = { reservationId, accountId, deviceId, requesterId, quoteHash: quote.quoteHash,
        attemptId: request.attemptId, inputDigest, conversion, phase: 'accepted', admitted: false,
        providerIdentity: null, receipt: null, quality: null, settlementInput: null };
      await backend.runTransaction(async tx => {
        assert(!await tx.get('jobs', key(reservationId)), 'Accepted request already claimed; reconcile without repeating inference');
        tx.create('jobs', key(reservationId), record);
      });
      let dispatched = false, admitted = false, observed = false;
      try {
        const admission = await trial.reserve({ reservationId, accountId });
        assert(admission.admitted, 'Trial reservation already claimed');
        admitted = true;
        await update(reservationId, current => ({ ...current, admitted: true }));
        controls.signal.throwIfAborted();
        const result = structuredClone(await execute(structuredClone(request), { ...controls,
          async requestApproval(preview) {
            preview = structuredClone(preview);
            assert(!dispatched && preview.attemptId === request.attemptId && preview.modelId === request.model.id
              && preview.modelIdentity === request.model.identity && text(preview.recipientIdentity)
              && await hashJson(preview.input?.messages) === inputDigest
              && same(preview.adapterIdentities || [], partitionAdapterIdentities(request.model)), 'Accounting disclosure binding changed');
            if (await controls.requestApproval(structuredClone(preview)) !== true) return false;
            controls.signal.throwIfAborted();
            // From here an interrupted write/bind is uncertain, never queued cancellation.
            dispatched = true;
            await update(reservationId, current => ({ ...current, phase: 'dispatching', providerIdentity: preview.recipientIdentity }));
            await ledger.bindAttempt({ reservationId, attemptId: request.attemptId, recipients: [preview.recipientIdentity],
              idempotencyKey: `text-bind:${key(reservationId)}` });
            return true;
          }
        }));
        observed = true;
        const kept = await read(reservationId), receipt = result.execution?.receipt;
        const verified = receipt && await verifyReceipt(receipt);
        assert(dispatched && receipt?.version === 2 && verified?.providerValid && verified.consumerValid
          && receipt.provider === kept.providerIdentity && receipt.consumer === requesterId
          && result.attemptId === request.attemptId && result.threadId === request.threadId
          && receipt.model === request.model.id && result.modelIdentity === request.model.identity
          && same(result.adapterIdentities, partitionAdapterIdentities(request.model))
          && await matchesWholeModelReceipt(receipt, request.messages, { ...result, completion: result.execution.completion })
          && result.usage?.schema === receipt.usage && result.usage.inputTokens === receipt.inputTokens && result.usage.outputTokens === receipt.outputTokens,
        'Measured countersigned execution receipt required');
        const receiptKey = key(`${receipt.provider}|${receipt.jobHash}`);
        await backend.runTransaction(async tx => {
          const current = await tx.get('jobs', key(reservationId));
          assert(!await tx.get('receipts', receiptKey), 'Execution receipt already used for another request');
          tx.create('receipts', receiptKey, { reservationId, receiptId: receipt.receiptId });
          tx.set('jobs', key(reservationId), { ...current, phase: 'observed', receipt });
        });
        const quality = structuredClone(await assessQuality({ request: structuredClone(request), result: structuredClone(result),
          reservation: structuredClone(reservation) }));
        assert(quality?.policyVersion === reservation.service.qualityPolicyVersion && text(quality.decisionId)
          && ['full', 'reduced', 'failed_quality'].includes(quality.outcome), 'Explicit quality decision required');
        const completedAt = clock();
        const settlementInput = { reservationId, billableEventId: billableEventIdFor(reservationId), attemptId: request.attemptId,
          outcome: Date.parse(completedAt) > Date.parse(reservation.service.deadline) ? 'timeout' : quality.outcome,
          metering: { context: receipt.inputTokens, output: receipt.outputTokens }, completedAt,
          reason: quality.reason || quality.decisionId, evidenceRef: receipt.receiptId };
        await update(reservationId, current => ({ ...current, phase: 'validated', quality, settlementInput }));
        const accounting = await reconcile(reservationId);
        return { ...result, accounting };
      } catch (error) {
        // No output/dispatch means no GPU work. Persist the terminal intent before
        // calling the ledger, so failure after commit can reconcile on restart.
        if (!dispatched && !observed) {
          await update(reservationId, current => ({ ...current, admitted, phase: 'cancelled', settlementInput: {
            reservationId, billableEventId: billableEventIdFor(reservationId), outcome: 'cancellation', metering: {},
            reason: 'Request ended before provider dispatch'
          } }));
          await reconcile(reservationId);
        }
        throw error;
      }
    }
  });
}
