import { hashJson } from '../../shared/vendor/reploid/artifacts/signatures.js';
import { partitionAdapterIdentities } from '../../shared/vendor/reploid/mesh/partitions/partition-contract.js';
import { effectiveRequestDigest, isCanonicalGenerationSettings, normalizeGenerationSettings } from '../../shared/vendor/reploid/mesh/generation-settings.js';
import { assert, same } from './contract.js';

/** Provider-side enforcement: skipping credit admission cannot obtain credited service. */
export function createFleetExecutionAdmission({ credits, model, stageOwner = null }) {
  const exact = { id: model.id, identity: model.identity, adapterIdentities: partitionAdapterIdentities(model) };
  const outputLimit = model.generation?.maxTokens;
  assert(Number.isSafeInteger(outputLimit) && outputLimit > 0, 'Credited providers need an explicit output bound');
  let account = null;
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
    /**
     * Before the prompt is sent: the request's details and its salted commitment, no messages. Resolves true
     * only when the ledger holds a live reservation for exactly this request and commitment. An
     * unsupported ledger or refusal stops the attempt before disclosure.
     */
    async preadmit({ request, consumer }) {
      assert(request.consumer === consumer, 'Execution consumer differs from authenticated peer');
      assert(request.messages === undefined && request.settings === undefined, 'Pre-disclosure admission carries no prompt');
      assert(request.modelIdentity === exact.identity && same(request.adapterIdentities ?? [], exact.adapterIdentities),
        'Execution request names another model variant than this provider serves');
      const result = await credits.call('preadmit', { id: `service:${consumer}:${request.requestId}`, executionId: request.requestId,
        consumer, mode: 'whole-model', model: exact, commitment: request.promptCommitment });
      assert(result?.preadmitted === true, 'Exact credit preadmission is required before disclosure');
      // Signed settlement terms sent with the request must name this reservation and exactly its hold: this provider's
      // acceptance is then of the terms the ledger reserved under, not of another quote.
      const terms = request.settlement?.terms;
      if (terms !== undefined) {
        assert(terms?.reservationId === `service:${consumer}:${request.requestId}` && terms.maximum === result.maximum
          && terms.maxOutputTokens === result.maxOutputTokens, 'Settlement terms differ from the credit reservation');
      }
      return true;
    },
    /** A mesh operation other than generation (mesh/operation-envelope.js), admitted before its payload is sent: for
     * the base model this provider serves, the input digest the requester reserved (the provider checks the payload
     * against it when it arrives) and the units the requester reserved. The signed settlement terms must name this
     * reservation and exactly its hold, as for generation. */
    async operation({ envelope, consumer, inputDigest, settlement }) {
      assert(envelope.modelId === exact.id && envelope.manifestDigest === exact.identity && exact.adapterIdentities.length === 0,
        'Operation names another model variant than this provider serves');
      const id = `service:${consumer}:${envelope.requestId}`;
      const result = await credits.call('admit', { id, executionId: envelope.requestId, consumer,
        mode: 'whole-model', model: exact, inputDigest, outputLimit: envelope.maxCostUnits });
      const terms = settlement?.terms;
      assert(terms?.reservationId === id && terms.maxOutputTokens === envelope.maxCostUnits
        && (result?.maximum === undefined || terms.maximum === result.maximum), 'Settlement terms differ from the credit reservation');
      return true;
    },
    async partition(request) {
      assert(request.charge?.reservationId && request.identity?.requesterId, 'Credited stage requires signed admission');
      const payload = { id: request.charge.reservationId, executionId: request.identity.attemptId,
        consumer: request.identity.requesterId, mode: 'partition', model: exact, route: request.identity,
        partitionIndex: request.partitionIndex, outputLimit: request.maxTokens };
      if (stageOwner) await stageOwner.admit(credits, payload);
      else await credits.call('admit', payload);
    },
    /**
     * The owner account this provider's key is enrolled under, which it signs into its acceptance as the account it is
     * paid into. Read once from the ledger's own statement of this account.
     */
    settlementAccount() {
      account ??= Promise.resolve(credits.call('statementMine', {})).then(statement => {
        assert(typeof statement?.accountId === 'string' && statement.accountId, 'The ledger named no account for this provider');
        return statement.accountId;
      });
      account.catch(() => { account = null; });
      return account;
    },
    ...(stageOwner ? { checkpoint: (request, index, receipt) => stageOwner.checkpoint(request, index, receipt) } : {}),
    partitionReceipt(bundle) { return stageOwner ? stageOwner.finish(credits, bundle) : credits.collect(bundle.reservationId, bundle); },
    terminal(terminal) {
      return credits.collect(`service:${terminal.consumer}:${terminal.requestId}`, { terminal });
    },
    async receipt(receipt) {
      assert(receipt.jobHash?.startsWith('request:'), 'Whole-model request receipt required');
      return credits.settle(`service:${receipt.consumer}:${receipt.jobHash.slice(8)}`, receipt);
    }
  });
}

/** Keep released step results behind the durable signed evidence write on a credited native stage. */
export function bindFleetStageAdmission(resident, admission, index) {
  return { ...resident,
    async reserve(request) {
      await admission.partition({ ...request, partitionIndex: index });
      return resident.reserve(request);
    },
    ...(admission.checkpoint ? { async executeStage(input) {
      const result = await resident.executeStage(input);
      admission.checkpoint(input, index, result.receipt);
      return result;
    } } : {})
  };
}
