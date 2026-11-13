import { hashJson } from '../../packages/reploid/src/artifacts/signatures.js';
import { assert, fleetCreditQuote } from './contract.js';
import { createAttemptEvidenceSigner, openOutputAcknowledgments } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { partitionAdapterIdentities } from '../../packages/reploid/src/mesh/partitions/partition-contract.js';

export function buildFleetRequestOutcome({
  attemptId = null, threadId = null, reservationId = null, executionId = null,
  mode, model, providerId = null, providerIdentity = null, inputDigest,
  phase, dispatched, acknowledged, settlement = null, maximum = 0, recordedAt = Date.now()
}) {
  const settled = typeof settlement?.settledAt === 'number';
  const terminal = settlement?.status === 'cancelled' || settlement?.status === 'failed';
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

/** Compose credit admission with the native requester's existing disclosure gate. */
export function createFleetRequester({
  participant, identity, credits, maxOutputTokens,
  onOutcome = () => {}, lookupOutcome = () => null, resolveProviderId = () => null
}) {
  assert(participant?.generate && identity?.peerId && credits?.reserve && credits?.settle,
    'Requester, signing identity and service-credit owner required');
  const readReservation = id => typeof credits.request === 'function' ? credits.request(id) : credits.call('request', { id });
  const recoverReservation = id => typeof credits.recover === 'function' ? credits.recover(id) : credits.call('recover', { id });
  return Object.freeze({
    async generate(request, controls) {
      request = structuredClone(request);
      assert(typeof controls?.requestApproval === 'function' && controls.signal, 'Explicit disclosure and cancellation required');
      const partition = Boolean(request.model.partition);
      const mode = partition ? 'partition' : 'whole-model';
      const outputLimit = Math.min(maxOutputTokens, request.generationRequest?.maxOutputTokens ?? maxOutputTokens,
        request.model.generation?.maxTokens ?? maxOutputTokens);
      assert(Number.isSafeInteger(outputLimit) && outputLimit > 0, 'Explicit bounded output required');
      if (partition) request.generationRequest = { schema: 'reploid.partition-generation-request/v1',
        usage: 'raw-model-tokens/v1', maxOutputTokens: outputLimit };
      const inputDigest = await hashJson(request.messages);
      let reservation = null, dispatched = false, abandoned = false, acknowledgments = null, routeIdentity = null, observeOutput = null;
      let disclosedProviderId = null, disclosedProviderIdentity = null, deltaCount = 0, outputCharacters = 0;
      const wrapped = { ...controls,
        ...(controls.onDelta ? {
          onDelta(value) {
            const chunk = typeof value === 'string' ? value : typeof value?.text === 'string' ? value.text : '';
            deltaCount += 1;
            outputCharacters += chunk.length;
            return controls.onDelta(value);
          }
        } : {}),
        authorizationExpiresAt: () => Math.min(reservation?.deadline ?? Infinity, controls.authorizationExpiresAt?.() ?? Infinity),
        requestApproval: async disclosure => {
          assert(!reservation, 'One provider per request; replacements need explicit retry');
          const terms = await credits.call('terms', { id: request.model.id, identity: request.model.identity });
          const acceptedQuote = fleetCreditQuote(terms.policy, outputLimit, mode);
          if (await controls.requestApproval({ ...structuredClone(disclosure), serviceCreditQuote: structuredClone(acceptedQuote) }) !== true) return false;
          controls.signal.throwIfAborted();
          const executionId = partition ? request.attemptId : disclosure.requestId;
          const binding = { id: `service:${identity.peerId}:${executionId}`, executionId,
            consumer: identity.peerId, mode, model: { id: request.model.id,
              identity: request.model.identity, adapterIdentities: partitionAdapterIdentities(request.model) },
            inputDigest, maxOutputTokens: outputLimit, acceptedQuote,
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
              reservationId: binding.id, identity: routeIdentity });
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
            ...(pair ? { acknowledgedReceipt: pair.receipt } : {}) };
          await credits.collect(reservation.id, evidence);
          if (result && evidence.receipts.length === routeIdentity.route.stages.length) {
            settlement = await credits.settle(reservation.id, evidence);
          } else settlement = await credits.fence(reservation.id, identity.peerId);
        } else if (result?.execution?.receipt) settlement = await credits.settle(reservation.id, result.execution.receipt);
        else if (failure?.generationTerminal) settlement = await credits.collect(reservation.id, { terminal: failure.generationTerminal });
        else settlement = await credits.fence(reservation.id, identity.peerId);
      } catch (error) {
        settlement = { id: reservation.id, status: 'pending', error: error.message };
        // Sealing admission is durable even if collection/settlement could not reach the service.
        await credits.fence(reservation.id, identity.peerId).catch(() => {});
      }
      const completed = typeof settlement?.settledAt === 'number' && !['cancelled', 'failed'].includes(settlement?.status);
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
      if (failure) {
        if (typeof failure === 'object') {
          failure.serviceCredit = settlement;
          failure.disconnect = outcome;
        }
        throw failure;
      }
      return { ...result, serviceCredit: settlement };
    },
    async recover({ reservationId, messages, providerId }, controls, recoverExecution = participant.recoverGeneration) {
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
      const prior = lookupOutcome(reservationId);
      const emit = (dispatched, settlement, extraTokens = null, resolvedPeer = null) => {
        const completed = typeof settlement?.settledAt === 'number' && !['cancelled', 'failed'].includes(settlement?.status);
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
            acknowledgedOutputTokens: extraTokens ?? (completed ? (settlement.outputTokens ?? 0) : (prior?.acknowledged?.acknowledgedOutputTokens ?? 0))
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
      if (row.binding.mode === 'partition') {
        const settled = await recoverReservation(reservationId);
        const outcome = emit(true, settled);
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
        messages: structuredClone(messages)
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
    }
  });
}
