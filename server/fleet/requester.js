import { hashJson } from '../../shared/vendor/reploid/artifacts/signatures.js';
import { assert, fleetCreditQuote } from './contract.js';
import { createAttemptEvidenceSigner, openOutputAcknowledgments } from '../../shared/vendor/reploid/mesh/partitions/partition-attempt-evidence.js';
import { partitionAdapterIdentities } from '../../shared/vendor/reploid/mesh/partitions/partition-contract.js';
import { effectiveRequestDigest, normalizeGenerationSettings } from '../../shared/vendor/reploid/mesh/generation-settings.js';
import { signSettlementStop } from './settlement-terms.js';
import { countersignReceipt } from '../../shared/vendor/reploid/artifacts/receipt.js';
import { MESH_OPERATION_SETTLEMENT_RECORDS_SCHEMA, executeMeshOperation, openMeshOperationCharge } from '../../shared/vendor/reploid/mesh/operation-envelope.js';

/** How a charged whole-model answer is labelled: with every signed record an outsider needs, or without. */
export const VERIFIABLE_CHARGE_LABELS = Object.freeze({ signed: 'signed-records', none: 'no-verifiable-receipt' });

/**
 * One whole-model request's signed settlement records as this requester holds them now (docs/verify-a-trade.md).
 * `label` is `signed-records` only when the requester's terms, the provider's acceptance and closing receipt, and the
 * requester's acknowledgment or stop are all held; anything less is `no-verifiable-receipt` with what is missing.
 */
export function settlementRecordsOf({ reservationId, charge, policy, reason = null }) {
  const summary = charge?.summary() ?? null;
  return { schema: MESH_OPERATION_SETTLEMENT_RECORDS_SCHEMA, reservationId,
    label: summary?.complete ? VERIFIABLE_CHARGE_LABELS.signed : VERIFIABLE_CHARGE_LABELS.none,
    ...(summary ? { attemptId: summary.attemptId, requesterId: summary.requesterId, providerId: summary.providerId, missing: summary.missing,
      acknowledged: summary.acknowledged, stopped: summary.stopped, faulted: summary.faulted } : { missing: ['terms', 'acceptance', 'close', 'acknowledgment'] }),
    ...(reason ? { reason } : {}), policy: charge ? structuredClone(policy) : null, records: charge ? charge.records() : [] };
}

export function buildFleetRequestOutcome({
  attemptId = null, threadId = null, reservationId = null, executionId = null,
  mode, model, providerId = null, providerIdentity = null, inputDigest,
  phase, dispatched, acknowledged, settlement = null, maximum = 0, recordedAt = Date.now()
}) {
  const settled = typeof settlement?.settledAt === 'number';
  const terminal = ['cancelled', 'failed', 'expired'].includes(settlement?.status);
  const finished = !dispatched
    ? {
        status: settlement?.status ?? 'cancelled_queued',
        charge: 0,
        outputTokens: 0,
        settledAt: settlement?.settledAt ?? recordedAt,
        evidenceHash: null
      }
    : settled
      ? {
          status: settlement.status ?? 'completed',
          charge: settlement.charge,
          outputTokens: settlement.outputTokens ?? null,
          settledAt: settlement.settledAt,
          evidenceHash: settlement.evidenceHash ?? null
        }
      : null;
  const unknown = !dispatched ? null : settled
    ? (mode === 'whole-model' && terminal ? { providerExecutionTokensBeforeStop: 'unmetered' } : null)
    : {
        reservationId,
        executionId,
        providerId,
        providerIdentity,
        providerExecution: 'unresolved',
        heldCredits: maximum
      };
  return Object.freeze({
    schema: 'reploid.request-outcome/v1',
    attemptId,
    threadId,
    reservationId,
    executionId,
    mode,
    model: Object.freeze({ id: model.id, identity: model.identity }),
    providerId,
    providerIdentity,
    inputDigest,
    phase,
    dispatched,
    acknowledged: Object.freeze({
      deltaCount: acknowledged?.deltaCount ?? 0,
      outputCharacters: acknowledged?.outputCharacters ?? 0,
      acknowledgedOutputTokens: acknowledged?.acknowledgedOutputTokens ?? 0
    }),
    finished: finished ? Object.freeze(finished) : null,
    unknown: unknown ? Object.freeze(unknown) : null,
    recordedAt
  });
}

/** How long a stopped split answer waits for the ledger to take the requester's stop before the stages are stopped. */
const STOP_HANDOFF_MS = 2000;

/** Compose credit admission with the native requester's existing disclosure gate. */
export function createFleetRequester({
  participant, identity, credits, maxOutputTokens,
  onOutcome = () => {}, lookupOutcome = () => null, resolveProviderId = () => null,
  // A standing policy: send whole-model requests only to a provider that signs the settlement records.
  requireVerifiableCharge = false,
  // Receives `{ reservationId, read }` for each dispatched whole-model request; `read()` returns its records as held then.
  onSettlementRecords = () => {}
}) {
  assert(participant?.generate && identity?.peerId && credits?.reserve && credits?.settle,
    'Requester, signing identity and service-credit owner required');
  const readReservation = id => typeof credits.request === 'function' ? credits.request(id) : credits.call('request', { id });
  const recoverReservation = id => typeof credits.recover === 'function' ? credits.recover(id) : credits.call('recover', { id });
  /**
   * The person stopped a whole-model answer before this requester countersigned a receipt, including after the
   * provider had already finished, when nobody signs a cancellation. The requester's own signed stop settles the hold
   * now, at zero: whole-model output has no acknowledged count, and no receipt can be countersigned after it. A
   * receipt countersigned before the stop would have had to reach the ledger first; the ledger refuses the later one.
   * A lost connection is not a stop: its answer stays recoverable until the deadline plus the release window.
   */
  const signStop = (binding, acknowledged) => signSettlementStop({ signer: createAttemptEvidenceSigner({ identity }), acknowledged,
    terms: { requesterId: identity.peerId, reservationId: binding.id, attemptId: binding.executionId } });
  // A request that signed settlement terms stops with the stop that names them, so its records hold the same stop.
  const settleStop = async (binding, charge = null) => credits.settle(binding.id, charge ? await charge.stop() : await signStop(binding, 0));
  // The output limit a request is quoted and reserved for: the caller's limit, never above the model or policy ceiling.
  const outputLimitOf = (request, settings) => Math.min(maxOutputTokens, request.generationRequest?.maxOutputTokens ?? maxOutputTokens,
    request.model.generation?.maxTokens ?? maxOutputTokens, settings?.maxOutputTokens ?? maxOutputTokens);
  return Object.freeze({
    /**
     * The most this request can charge, from the same credit terms and output limit `generate` quotes it with, for the
     * inference plan's `maxCharge`. Sends nothing to any provider.
     */
    async chargeCeiling(request) {
      const mode = request.model.partition ? 'partition' : 'whole-model';
      const terms = await credits.call('terms', { id: request.model.id, identity: request.model.identity });
      const { maximum, unit } = fleetCreditQuote(terms.policy, outputLimitOf(request, normalizeGenerationSettings(request.settings)), mode);
      return { kind: 'capped', maximum, unit };
    },
    async generate(request, controls) {
      request = structuredClone(request);
      assert(typeof controls?.requestApproval === 'function' && controls.signal, 'Explicit disclosure and cancellation required');
      const partition = Boolean(request.model.partition);
      const mode = partition ? 'partition' : 'whole-model';
      // Generation settings are quoted and reserved as part of the effective request: the hold is
      // sized by the caller's own limit (never above the model or policy ceiling), and the digest
      // of model identity, messages and settings is what the provider must present for admission.
      let settings = normalizeGenerationSettings(request.settings);
      assert(!settings || !partition, 'Generation settings are not supported on a partition route');
      if (settings) request.settings = structuredClone(settings);
      const outputLimit = outputLimitOf(request, settings);
      assert(Number.isSafeInteger(outputLimit) && outputLimit > 0, 'Explicit bounded output required');
      // A whole-model provider admits for its prepared model ceiling unless the request names a smaller limit, so a
      // requester whose own cap is below the model's would be refused. It sends that cap as the request's limit.
      if (!partition && !settings && Number.isSafeInteger(request.model.generation?.maxTokens) && outputLimit < request.model.generation.maxTokens) {
        settings = normalizeGenerationSettings({ maxOutputTokens: outputLimit });
        request.settings = structuredClone(settings);
      }
      // The provider is admitted for exactly the caller's limit, so a limit above the ceiling cannot be
      // quoted lower and still match: it is refused here, before a quote, a hold or any disclosure.
      if (settings && settings.maxOutputTokens !== null && settings.maxOutputTokens > outputLimit) {
        throw Object.assign(Error('Caller output limit exceeds the fleet credit policy or the prepared model ceiling'),
          { status: 400, param: 'maxOutputTokens' });
      }
      if (partition) request.generationRequest = { schema: 'reploid.partition-generation-request/v1',
        usage: 'raw-model-tokens/v1', maxOutputTokens: outputLimit };
      const inputDigest = await hashJson(request.messages);
      const settingsDigest = settings ? await effectiveRequestDigest({ modelIdentity: request.model.identity,
        adapterIdentities: partitionAdapterIdentities(request.model), messages: request.messages, settings }) : null;
      let reservation = null, dispatched = false, abandoned = false, acknowledgments = null, routeIdentity = null, observeOutput = null;
      let disclosedProviderId = null, disclosedProviderIdentity = null, deltaCount = 0, outputCharacters = 0, splitStop = null;
      // Whole-model only: the policy the hold was quoted under and this request's signed charge, once a provider that
      // signs the records was chosen.
      let quotedPolicy = null, charge = null, unsignedReason = 'provider-does-not-sign';
      // The signed records of this whole-model request, labelled by what is held: read again later, they include a
      // provider's closing record that arrives after a stop.
      const readRecords = () => settlementRecordsOf({ reservationId: reservation.id, charge, policy: quotedPolicy, reason: charge ? null : unsignedReason });
      const verifiable = requireVerifiableCharge === true || request.verifiableCharge === 'required';
      // A split answer the person stops: the requester signs its stop and hands it to the ledger before the stages are
      // told to stop, so the ledger has it before any stage closes. With it the ledger charges the acknowledged prefix.
      // A lost connection is not a stop and signs nothing; the stages then close an unfinished answer, which under the
      // current rules is an unattributed disconnect and charges the same prefix (docs/settlement-replay.md step 9).
      const forwarded = partition ? new AbortController() : null;
      const forwardAbort = () => {
        const reason = controls.signal.reason;
        if (!(reason?.requesterStop === true && reservation && dispatched && acknowledgments)) return forwarded.abort(reason);
        const sent = (async () => {
          splitStop = await signStop(reservation, acknowledgments.state().count);
          await credits.collect(reservation.id, { identity: routeIdentity, receipts: [], stop: splitStop });
        })().catch(() => {});
        // Bounded: an unreachable ledger never holds the stop back; the closing evidence carries the stop again.
        Promise.race([sent, new Promise(resolve => setTimeout(resolve, STOP_HANDOFF_MS).unref?.())]).then(() => forwarded.abort(reason));
      };
      if (forwarded) {
        if (controls.signal.aborted) forwarded.abort(controls.signal.reason);
        else controls.signal.addEventListener('abort', forwardAbort, { once: true });
      }
      const wrapped = { ...controls, ...(forwarded ? { signal: forwarded.signal } : {}),
        ...(controls.onDelta ? {
          onDelta(value) {
            const chunk = typeof value === 'string' ? value : typeof value?.text === 'string' ? value.text : '';
            deltaCount += 1;
            outputCharacters += chunk.length;
            return controls.onDelta(value);
          }
        } : {}),
        authorizationExpiresAt: () => Math.min(reservation?.deadline ?? Infinity, controls.authorizationExpiresAt?.() ?? Infinity),
        // The mesh asks for the signed terms after this requester approved the disclosure and holds the cost, and only
        // for a provider that advertises it signs the records. `required` refuses, before any hold, when none does.
        ...(partition ? {} : { settlement: { required: verifiable,
          async open({ requestId, recipientIdentity, planDigest }) {
            assert(reservation && dispatched && reservation.executionId === requestId && disclosedProviderIdentity === recipientIdentity,
              'Settlement terms need the approved reservation of this request');
            try {
              charge = await openMeshOperationCharge({ signer: createAttemptEvidenceSigner({ identity }), requestId, planDigest,
                recipient: recipientIdentity, reservationId: reservation.id, policy: quotedPolicy, maxCostUnits: outputLimit,
                ...(typeof reservation.accountId === 'string' && reservation.accountId ? { debitAccount: reservation.accountId } : {}) });
              // Handed over as soon as the terms are signed, so a host that keeps records on disk has them if it dies mid-answer.
              try { onSettlementRecords({ reservationId: reservation.id, read: readRecords }); } catch { /* The caller's store is its own. */ }
            } catch (error) {
              // Terms this requester cannot sign under the quoted policy: served unsigned and labelled, unless required.
              if (verifiable) throw error;
              unsignedReason = 'terms-not-signed';
            }
            return charge;
          } } }),
        requestApproval: async disclosure => {
          assert(!reservation, 'One provider per request; replacements need explicit retry');
          const terms = await credits.call('terms', { id: request.model.id, identity: request.model.identity });
          quotedPolicy = terms.policy;
          const acceptedQuote = fleetCreditQuote(terms.policy, outputLimit, mode);
          if (await controls.requestApproval({ ...structuredClone(disclosure), serviceCreditQuote: structuredClone(acceptedQuote) }) !== true) return false;
          controls.signal.throwIfAborted();
          const executionId = partition ? request.attemptId : disclosure.requestId;
          const binding = { id: `service:${identity.peerId}:${executionId}`, executionId,
            consumer: identity.peerId, mode, model: { id: request.model.id,
              identity: request.model.identity, adapterIdentities: partitionAdapterIdentities(request.model) },
            inputDigest, ...(settingsDigest ? { settingsDigest } : {}), maxOutputTokens: outputLimit, acceptedQuote,
            // The salted commitment the provider is asked to admit before the prompt is sent. With it in the
            // reservation, the provider can check credit from the request's details alone.
            ...(!partition && typeof disclosure.admission?.promptCommitment === 'string'
              ? { admission: { schema: 'reploid.credit-preadmission/v1', commitment: disclosure.admission.promptCommitment } } : {}),
            providers: [{ participantId: typeof disclosure.recipientIdentity === 'string' ? disclosure.recipientIdentity
              : disclosure.recipientIdentity?.participantId ?? disclosure.recipientIdentity?.peerId, weight: 1 }] };
          if (partition) {
            routeIdentity = { schema: 'reploid.partition-attempt/v2', threadId: request.threadId, attemptId: executionId,
              requesterId: identity.peerId, placementGeneration: request.placementGeneration ?? 0, route: disclosure.route };
            const plan = terms.model.plans?.find(row => row.id === disclosure.route.planId);
            assert(plan?.creditWeights?.length === disclosure.route.stages.length, 'No accepted credit terms for this partition');
            binding.route = routeIdentity;
            binding.providers = disclosure.route.stages.map((stage, index) => ({ participantId: stage.participantId, weight: plan.creditWeights[index] }));
            acknowledgments = await openOutputAcknowledgments({ signer: createAttemptEvidenceSigner({ identity }),
              reservationId: binding.id, identity: routeIdentity,
              // Requester-held edges: the chain that reaches every stage carries no answer text (partition-attempt-evidence.js).
              textlessOutputs: request.privacyBinding?.route?.backend === 'doppler-partition-edges/v1' });
            // Optional read-only view of the requester's own signed acknowledgments, for a caller that keeps its evidence.
            const held = acknowledgments;
            controls.onAcknowledgments?.(Object.freeze({ evidence: () => held.evidence(), count: () => held.state().count }));
            wrapped.charge = acknowledgments.charge;
            wrapped.onOutput = observeOutput = async record => {
              const pair = await acknowledgments.observe(record);
              if (pair) await credits.collect(binding.id, { identity: routeIdentity, receipts: [], acknowledged: pair });
              return pair;
            };
          }
          disclosedProviderId = typeof disclosure.providerId === 'string' ? disclosure.providerId : null;
          disclosedProviderIdentity = binding.providers[0]?.participantId ?? null;
          reservation = await credits.reserve(binding);
          try {
            if (partition) await credits.collect(reservation.id, { identity: routeIdentity, receipts: [], acknowledgment: acknowledgments.charge });
            controls.signal.throwIfAborted();
            // A lost response leaves admission uncertain; never automatically release that hold.
            dispatched = true;
            await credits.dispatch(reservation.id, identity.peerId);
            controls.onReservation?.(reservation.id);
          } catch (error) {
            if (!dispatched) {
              await credits.abandonBeforeDispatch(reservation.id, identity.peerId);
              abandoned = true;
            }
            throw error;
          }
          return true;
        }
      };
      let result, failure;
      try { result = await participant.generate(request, wrapped); }
      catch (error) { failure = error; }
      finally { if (forwarded) controls.signal.removeEventListener('abort', forwardAbort); }
      if (!reservation || !dispatched) {
        const recordedAt = Date.now();
        const outcome = buildFleetRequestOutcome({
          attemptId: request.attemptId ?? null,
          threadId: request.threadId ?? null,
          reservationId: reservation?.id ?? null,
          executionId: reservation?.executionId ?? null,
          mode,
          model: request.model,
          inputDigest,
          phase: 'queued',
          dispatched: false,
          acknowledged: { deltaCount: 0, outputCharacters: 0, acknowledgedOutputTokens: 0 },
          settlement: { status: abandoned ? 'abandoned' : 'cancelled_queued', charge: 0, outputTokens: 0, settledAt: recordedAt },
          maximum: 0,
          recordedAt
        });
        onOutcome(outcome);
        if (failure) {
          if (typeof failure === 'object') failure.disconnect = outcome;
          throw failure;
        }
        throw Error('Output arrived without credit admission');
      }
      let settlement;
      try {
        if (partition) {
          const closing = result?.execution?.settlement ?? failure?.partitionSettlement;
          // A dropped output RPC can recover through the bounded closing response. These are
          // actual final-stage signed outputs, not a token count inferred from the visible answer.
          for (const record of closing?.unacknowledgedOutputs || []) {
            if (record.step >= acknowledgments.state().count) await observeOutput(record);
          }
          const pair = acknowledgments.evidence().acknowledged;
          const evidence = { identity: routeIdentity,
            receipts: (closing?.cleanup || []).flatMap(row => row?.receipt ? [row.receipt] : []),
            acknowledgment: pair?.acknowledgment ?? acknowledgments.charge,
            ...(pair ? { acknowledgedReceipt: pair.receipt } : {}), ...(splitStop ? { stop: splitStop } : {}) };
          await credits.collect(reservation.id, evidence);
          if (result && evidence.receipts.length === routeIdentity.route.stages.length) {
            settlement = await credits.settle(reservation.id, evidence);
          } else settlement = await credits.fence(reservation.id, identity.peerId);
        } else if (result?.execution?.receipt) settlement = await credits.settle(reservation.id, result.execution.receipt);
        else if (failure?.generationTerminal) settlement = await credits.collect(reservation.id, { terminal: failure.generationTerminal });
        else if (failure && controls.signal.reason?.requesterStop === true) settlement = await settleStop(reservation, charge);
        else settlement = await credits.fence(reservation.id, identity.peerId);
      } catch (error) {
        settlement = { id: reservation.id, status: 'pending', error: error.message };
        // Sealing admission is durable even if collection/settlement could not reach the service.
        await credits.fence(reservation.id, identity.peerId).catch(() => {});
      }
      const completed = typeof settlement?.settledAt === 'number' && !['cancelled', 'failed', 'expired'].includes(settlement?.status);
      const acknowledgedOutputTokens = partition
        ? (acknowledgments?.state().count ?? 0)
        : completed ? (settlement.outputTokens ?? result?.usage?.outputTokens ?? 0) : 0;
      const outcome = buildFleetRequestOutcome({
        attemptId: request.attemptId ?? null,
        threadId: request.threadId ?? null,
        reservationId: reservation.id,
        executionId: reservation.executionId,
        mode,
        model: request.model,
        providerId: disclosedProviderId,
        providerIdentity: disclosedProviderIdentity,
        inputDigest,
        phase: 'in-flight',
        dispatched: true,
        acknowledged: { deltaCount, outputCharacters, acknowledgedOutputTokens },
        settlement,
        maximum: reservation.maximum,
        recordedAt: Date.now()
      });
      onOutcome(outcome);
      if (!partition) { try { onSettlementRecords({ reservationId: reservation.id, read: readRecords }); } catch { /* The caller's store is its own. */ } }
      if (failure) {
        if (typeof failure === 'object') {
          failure.serviceCredit = settlement;
          failure.disconnect = outcome;
          if (!partition) failure.settlementRecords = readRecords();
        }
        throw failure;
      }
      return { ...result, serviceCredit: settlement, ...(partition ? {} : { settlementRecords: readRecords() }) };
    },
    async recover({ reservationId, messages, providerId, settings: suppliedSettings, stop = false }, controls, recoverExecution = participant.recoverGeneration) {
      assert(typeof reservationId === 'string' && reservationId.length > 0 && Array.isArray(messages) && messages.length > 0
        && controls?.signal && typeof recoverExecution === 'function', 'Bound reservation, original messages and cancellation required');
      controls.signal.throwIfAborted();
      let row;
      try { row = await readReservation(reservationId); }
      catch (error) {
        if (/Unknown credit reservation|Not a participant/i.test(error?.message || '')) {
          throw Object.assign(Error('Unknown credit reservation'), { status: 404 });
        }
        throw error;
      }
      if (!row) throw Object.assign(Error('Unknown credit reservation'), { status: 404 });
      if (row.binding?.consumer !== identity.peerId) {
        throw Object.assign(Error('Reservation belongs to another requester'), { status: 403 });
      }
      const inputDigest = await hashJson(messages);
      if (inputDigest !== row.binding.inputDigest) {
        throw Object.assign(Error('Recovery input differs from the accepted request'), { status: 409 });
      }
      // Both absent, or the same effective request: recovery never reads an outcome for other settings.
      let settings, settingsDigest = null;
      try {
        settings = normalizeGenerationSettings(suppliedSettings);
        if (settings) settingsDigest = await effectiveRequestDigest({ modelIdentity: row.binding.model.identity,
          adapterIdentities: row.binding.model.adapterIdentities || [], messages, settings });
      } catch (error) { throw Object.assign(Error(error.message), { status: 400 }); }
      if (settingsDigest !== (row.binding.settingsDigest ?? null)) {
        throw Object.assign(Error('Recovery settings differ from the accepted request'), { status: 409 });
      }
      const prior = lookupOutcome(reservationId);
      const emit = (dispatched, settlement, extraTokens = null, resolvedPeer = null) => {
        const completed = typeof settlement?.settledAt === 'number' && !['cancelled', 'failed', 'expired'].includes(settlement?.status);
        const outcome = buildFleetRequestOutcome({
          attemptId: prior?.attemptId ?? null,
          threadId: prior?.threadId ?? null,
          reservationId,
          executionId: row.binding.executionId,
          mode: row.binding.mode,
          model: row.binding.model,
          providerId: resolvedPeer ?? prior?.providerId ?? null,
          providerIdentity: row.binding.providers[0]?.participantId ?? null,
          inputDigest,
          phase: dispatched ? 'in-flight' : 'queued',
          dispatched,
          acknowledged: {
            deltaCount: prior?.acknowledged?.deltaCount ?? 0,
            outputCharacters: prior?.acknowledged?.outputCharacters ?? 0,
            acknowledgedOutputTokens: extraTokens ?? (settlement?.reason === 'interrupted-stage-owner' ? settlement.outputTokens : null)
              ?? (completed ? (settlement.outputTokens ?? 0) : (prior?.acknowledged?.acknowledgedOutputTokens ?? 0))
          },
          settlement,
          maximum: dispatched ? row.binding.maximum : 0,
          recordedAt: Date.now()
        });
        onOutcome(outcome);
        return outcome;
      };
      if (row.state === 'abandoned') {
        const outcome = emit(false, { status: 'abandoned', charge: 0, outputTokens: 0, settledAt: row.binding.createdAt });
        return { status: 'abandoned', outcome };
      }
      if (row.state === 'reserved') {
        await credits.abandonBeforeDispatch(reservationId, identity.peerId);
        const outcome = emit(false, { status: 'abandoned', charge: 0, outputTokens: 0, settledAt: Date.now() });
        return { status: 'abandoned', outcome };
      }
      if (row.state === 'settled') {
        const outcome = emit(true, row.outcome);
        return { status: row.outcome.status ?? 'completed', serviceCredit: row.outcome, outcome };
      }
      // `stop: true` ends an unsettled whole-model answer instead of recovering it: the signed stop settles it at zero.
      if (stop === true && row.binding.mode === 'whole-model') {
        let settled;
        try { settled = await settleStop(row.binding); }
        catch { settled = (await readReservation(reservationId))?.outcome ?? { id: reservationId, status: 'pending' }; }
        const outcome = emit(true, settled, 0);
        return { status: typeof settled?.settledAt === 'number' ? (settled.status ?? 'completed') : 'unresolved', serviceCredit: settled, outcome };
      }
      if (row.binding.mode === 'partition') {
        const settled = await recoverReservation(reservationId);
        const outcome = emit(true, settled, settled?.acknowledgedOutputTokens);
        return { status: typeof settled?.settledAt === 'number' ? (settled.status ?? 'completed') : 'unresolved', serviceCredit: settled, outcome };
      }
      const fenced = await credits.fence(reservationId, identity.peerId);
      if (typeof fenced?.settledAt === 'number') {
        const outcome = emit(true, fenced);
        return { status: fenced.status ?? 'completed', serviceCredit: fenced, outcome };
      }
      const targetProviderId = providerId ?? prior?.providerId ?? await resolveProviderId(reservationId, row.binding);
      if (typeof targetProviderId !== 'string' || !targetProviderId) {
        throw Object.assign(Error('Recovery peer required'), { status: 409 });
      }
      const request = {
        threadId: prior?.threadId ?? `recover-${row.binding.executionId}`,
        attemptId: prior?.attemptId ?? row.binding.executionId,
        model: {
          id: row.binding.model.id,
          identity: row.binding.model.identity,
          adapters: (row.binding.model.adapterIdentities || []).map(adapterId => ({
            identity: adapterId, baseModelIdentity: row.binding.model.identity
          }))
        },
        messages: structuredClone(messages),
        ...(settings ? { settings: structuredClone(settings) } : {})
      };
      const reference = {
        requestId: row.binding.executionId,
        providerId: targetProviderId,
        providerIdentity: row.binding.providers[0].participantId
      };
      const recovered = await recoverExecution(request, reference, { signal: controls.signal });
      controls.signal.throwIfAborted();
      if (recovered?.status === 'unresolved') {
        const outcome = emit(true, { id: reservationId, status: 'pending' }, null, targetProviderId);
        return {
          status: 'unresolved',
          serviceCredit: { id: reservationId, status: 'pending', heldCredits: row.binding.maximum },
          outcome
        };
      }
      if (recovered?.status === 'completed') {
        const settled = await credits.settle(reservationId, recovered.result.execution.receipt);
        const outcome = emit(true, settled, settled.outputTokens, targetProviderId);
        return {
          status: 'completed',
          ...recovered.result,
          execution: { ...recovered.result.execution, serviceCredit: settled },
          serviceCredit: settled,
          outcome
        };
      }
      const settled = await credits.collect(reservationId, { terminal: recovered.terminal });
      const outcome = emit(true, settled, 0, targetProviderId);
      return { status: recovered.terminal.status, serviceCredit: settled, outcome };
    },
    /**
     * A mesh operation other than generation (mesh/operation-envelope.js), on the same ledger, enrollment and stop
     * as `generate`: the envelope is authorized against `offer(envelope)` before anything is held or sent (a refusal
     * throws synchronously), the granted recipient must still be enrolled, the hold is the operation's
     * `maxCostUnits` at the accepted price, and the provider's receipt is countersigned and settled. Cancelling through
     * `signal` settles the hold at zero with the requester's signed stop; any other failure fences it.
     */
    executeOperation(envelope, { signal, offer }) {
      return executeMeshOperation(envelope, { signal }, {
        offer,
        async reserve(value, inputDigest) {
          const recipient = value.recipientGrant.recipient;
          const network = await credits.call('computers', {});
          assert((network.computers || []).some(row => row.participantIds?.includes(recipient)),
            'The granted recipient is not enrolled; nothing was sent');
          const terms = await credits.call('terms', { id: value.modelId, identity: value.manifestDigest });
          const binding = { id: `service:${identity.peerId}:${value.requestId}`, executionId: value.requestId, consumer: identity.peerId,
            mode: 'whole-model', operation: value.operation, model: { id: value.modelId, identity: value.manifestDigest, adapterIdentities: [] },
            inputDigest, maxOutputTokens: value.maxCostUnits, acceptedQuote: fleetCreditQuote(terms.policy, value.maxCostUnits, 'whole-model'),
            providers: [{ participantId: recipient, weight: 1 }] };
          const reservation = await credits.reserve(binding);
          try { await credits.dispatch(reservation.id, identity.peerId); }
          catch (error) { await credits.abandonBeforeDispatch(reservation.id, identity.peerId).catch(() => {}); throw error; }
          return reservation;
        },
        send: (value, controls) => participant.sendMeshOperation(value, controls),
        countersign: receipt => countersignReceipt(receipt, identity),
        settle: (reservation, receipt) => credits.settle(reservation.id, receipt),
        // Nothing was countersigned, so the requester's own stop at zero is the whole settlement of a cancelled call.
        cancel: reservation => (signal?.aborted ? settleStop(reservation) : credits.fence(reservation.id, identity.peerId))
      });
    }
  });
}
