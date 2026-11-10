import { hashJson } from '../../packages/reploid/src/artifacts/signatures.js';
import { assert } from './contract.js';
import { createAttemptEvidenceSigner, openOutputAcknowledgments } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { partitionAdapterIdentities } from '../../packages/reploid/src/mesh/partitions/partition-contract.js';

/** Compose credit admission with the native requester's existing disclosure gate. */
export function createFleetRequester({ participant, identity, credits, maxOutputTokens }) {
  assert(participant?.generate && identity?.peerId && credits?.reserve && credits?.settle,
    'Requester, signing identity and service-credit owner required');
  return Object.freeze({
    async generate(request, controls) {
      request = structuredClone(request);
      assert(typeof controls?.requestApproval === 'function' && controls.signal, 'Explicit disclosure and cancellation required');
      const partition = Boolean(request.model.partition);
      const outputLimit = Math.min(maxOutputTokens, request.generationRequest?.maxOutputTokens ?? maxOutputTokens,
        request.model.generation?.maxTokens ?? maxOutputTokens);
      assert(Number.isSafeInteger(outputLimit) && outputLimit > 0, 'Explicit bounded output required');
      if (partition) request.generationRequest = { schema: 'reploid.partition-generation-request/v1',
        usage: 'raw-model-tokens/v1', maxOutputTokens: outputLimit };
      let reservation = null, dispatched = false, acknowledgments = null, routeIdentity = null, observeOutput = null;
      const wrapped = { ...controls,
        authorizationExpiresAt: () => Math.min(reservation?.deadline ?? Infinity, controls.authorizationExpiresAt?.() ?? Infinity),
        requestApproval: async disclosure => {
          assert(!reservation, 'One provider per request; replacements need explicit retry');
          if (await controls.requestApproval(structuredClone(disclosure)) !== true) return false;
          controls.signal.throwIfAborted();
          const executionId = partition ? request.attemptId : disclosure.requestId;
          const binding = { id: `service:${identity.peerId}:${executionId}`, executionId,
            consumer: identity.peerId, mode: partition ? 'partition' : 'whole-model', model: { id: request.model.id,
              identity: request.model.identity, adapterIdentities: partitionAdapterIdentities(request.model) },
            inputDigest: await hashJson(request.messages), maxOutputTokens: outputLimit,
            providers: [{ participantId: typeof disclosure.recipientIdentity === 'string' ? disclosure.recipientIdentity
              : disclosure.recipientIdentity?.participantId ?? disclosure.recipientIdentity?.peerId, weight: 1 }] };
          if (partition) {
            routeIdentity = { schema: 'reploid.partition-attempt/v2', threadId: request.threadId, attemptId: executionId,
              requesterId: identity.peerId, placementGeneration: request.placementGeneration ?? 0, route: disclosure.route };
            const terms = await credits.call('terms', binding.model);
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
          reservation = await credits.reserve(binding);
          try {
            if (partition) await credits.collect(reservation.id, { identity: routeIdentity, receipts: [], acknowledgment: acknowledgments.charge });
            controls.signal.throwIfAborted();
            // A lost response leaves admission uncertain; never automatically release that hold.
            dispatched = true;
            await credits.dispatch(reservation.id, identity.peerId);
          } catch (error) {
            if (!dispatched) await credits.abandonBeforeDispatch(reservation.id, identity.peerId);
            throw error;
          }
          return true;
        }
      };
      let result, failure;
      try { result = await participant.generate(request, wrapped); }
      catch (error) { failure = error; }
      if (!reservation || !dispatched) {
        if (failure) throw failure;
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
          } else settlement = await credits.fence(reservation.id);
        } else if (result?.execution?.receipt) settlement = await credits.settle(reservation.id, result.execution.receipt);
        else settlement = await credits.fence(reservation.id);
      } catch (error) {
        settlement = { id: reservation.id, status: 'pending', error: error.message };
        // Sealing admission is durable even if collection/settlement could not reach the service.
        await credits.fence(reservation.id).catch(() => {});
      }
      if (failure) {
        if (typeof failure === 'object') failure.serviceCredit = settlement;
        throw failure;
      }
      return { ...result, serviceCredit: settlement };
    }
  });
}
