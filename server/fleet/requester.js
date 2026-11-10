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
      let reservation = null, dispatched = false, acknowledgments = null, routeIdentity = null;
      const wrapped = { ...controls,
        requestApproval: async disclosure => {
          assert(!reservation, 'One provider per request; replacements need explicit retry');
          if (await controls.requestApproval(structuredClone(disclosure)) !== true) return false;
          controls.signal.throwIfAborted();
          const executionId = partition ? request.attemptId : disclosure.requestId;
          const binding = { id: `service:${identity.peerId}:${executionId}`, executionId,
            consumer: identity.peerId, mode: partition ? 'partition' : 'whole-model', model: { id: request.model.id,
              identity: request.model.identity, adapterIdentities: partitionAdapterIdentities(request.model) },
            inputDigest: await hashJson(request.messages), maxOutputTokens,
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
            wrapped.onOutput = record => acknowledgments.observe(record);
          }
          reservation = await credits.reserve(binding);
          try {
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
      const result = await participant.generate(request, wrapped);
      assert(reservation && dispatched, 'Output arrived without credit admission');
      // A lost settlement response is retryable by reservation id, without generating again.
      const evidence = partition ? { identity: routeIdentity,
        receipts: (result.execution?.settlement?.cleanup || []).map(row => row.receipt),
        acknowledgment: acknowledgments.evidence().acknowledged?.acknowledgment } : result.execution?.receipt;
      try {
        const settlement = await credits.settle(reservation.id, evidence);
        return { ...result, serviceCredit: settlement };
      } catch (error) {
        // Delivery succeeded. Preserve the answer while the durable client retries accounting.
        return { ...result, serviceCredit: { id: reservation.id, status: 'pending', error: error.message } };
      }
    }
  });
}
