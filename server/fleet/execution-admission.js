import { hashJson } from '../../packages/reploid/src/artifacts/signatures.js';
import { partitionAdapterIdentities } from '../../packages/reploid/src/mesh/partitions/partition-contract.js';
import { effectiveRequestDigest, isCanonicalGenerationSettings, normalizeGenerationSettings } from '../../packages/reploid/src/mesh/generation-settings.js';
import { assert, same } from './contract.js';

/** Provider-side enforcement: skipping credit admission cannot obtain credited service. */
export function createFleetExecutionAdmission({ credits, model }) {
  const exact = { id: model.id, identity: model.identity, adapterIdentities: partitionAdapterIdentities(model) };
  const outputLimit = model.generation?.maxTokens;
  assert(Number.isSafeInteger(outputLimit) && outputLimit > 0, 'Credited providers need an explicit output bound');
  return Object.freeze({
    async whole({ request, consumer }) {
      assert(request.consumer === consumer, 'Execution consumer differs from authenticated peer');
      // The digest is derived here, from the model identity, adapters, messages and settings this
      // provider received. Nothing the requester says about its own digest is used.
      assert(request.settings === undefined || isCanonicalGenerationSettings(request.settings), 'Canonical generation settings required');
      const settings = normalizeGenerationSettings(request.settings);
      const limit = settings?.maxOutputTokens ?? outputLimit;
      assert(limit <= outputLimit, 'Caller output limit exceeds the prepared model ceiling');
      let settingsDigest;
      if (settings) {
        // The payload must name exactly the variant this provider serves and admits credit for, so
        // an adapter or model identity changed on the way here is refused before inference.
        const adapterIdentities = request.adapterIdentities ?? [];
        assert(request.modelIdentity === exact.identity && same(adapterIdentities, exact.adapterIdentities),
          'Execution request names another model variant than this provider serves');
        settingsDigest = await effectiveRequestDigest({ modelIdentity: request.modelIdentity, adapterIdentities,
          messages: request.messages, settings });
      }
      await credits.call('admit', { id: `service:${consumer}:${request.requestId}`, executionId: request.requestId,
        consumer, mode: 'whole-model', model: exact, inputDigest: await hashJson(request.messages), outputLimit: limit,
        ...(settings ? { settingsDigest } : {}) });
      return true;
    },
    async partition(request) {
      assert(request.charge?.reservationId && request.identity?.requesterId, 'Credited stage requires signed admission');
      await credits.call('admit', { id: request.charge.reservationId, executionId: request.identity.attemptId,
        consumer: request.identity.requesterId, mode: 'partition', model: exact, route: request.identity,
        partitionIndex: request.partitionIndex, outputLimit: request.maxTokens });
    },
    partitionReceipt(bundle) { return credits.collect(bundle.reservationId, bundle); },
    terminal(terminal) {
      return credits.collect(`service:${terminal.consumer}:${terminal.requestId}`, { terminal });
    },
    async receipt(receipt) {
      assert(receipt.jobHash?.startsWith('request:'), 'Whole-model request receipt required');
      return credits.settle(`service:${receipt.consumer}:${receipt.jobHash.slice(8)}`, receipt);
    }
  });
}
