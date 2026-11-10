import { hashJson } from '../../packages/reploid/src/artifacts/signatures.js';
import { partitionAdapterIdentities } from '../../packages/reploid/src/mesh/partitions/partition-contract.js';
import { assert } from './contract.js';

/** Provider-side enforcement: skipping credit admission cannot obtain credited service. */
export function createFleetExecutionAdmission({ credits, model }) {
  const exact = { id: model.id, identity: model.identity, adapterIdentities: partitionAdapterIdentities(model) };
  const outputLimit = model.generation?.maxTokens;
  assert(Number.isSafeInteger(outputLimit) && outputLimit > 0, 'Credited providers need an explicit output bound');
  return Object.freeze({
    async whole({ request, consumer }) {
      assert(request.consumer === consumer, 'Execution consumer differs from authenticated peer');
      await credits.call('admit', { id: `service:${consumer}:${request.requestId}`, executionId: request.requestId,
        consumer, mode: 'whole-model', model: exact, inputDigest: await hashJson(request.messages), outputLimit });
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
