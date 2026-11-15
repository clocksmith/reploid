/** Exact, host-approved operations. Private task context is never passed to discovery. */
import { assertAvailableExecutionPolicy } from '../../../shared/vendor/reploid/chat/execution-policy.js';
import { OPERATION_CONSENT_SCHEMA, operationObserverEvidence } from '../../../shared/vendor/reploid/mesh/jobs/operation-privacy.js';
import config from '../../../shared/pool/pool-config.json' with { type: 'json' };
import policy from '../config/work-profile.json' with { type: 'json' };
import { listPoolModels } from '../../../shared/pool/model-contract.js';
import { validateOperationModel } from '../../../shared/pool/operation-model.js';
import { createPackOperationRegistry } from '../../../shared/pool/pack-operation-adapters.js';
import { packPeerModel, planPackPeerProviders } from '../pool/peer-pack-job.js';
import { hashDopplerEvidence } from '../../../shared/pool/executable-pack.js';
import { validateWorkRequirements } from '../../../shared/pool/peer-capabilities.js';
import { resolvePackJobPolicy } from '../../../shared/pool/peer-pack-job-policy.js';
import { verifyPackPeerEpisode } from '../pool/peer-pack-episode.js';
import { snapshotPackOperationData as snapshot } from '../pool/pack-operation.js';

const assert = (ok, message) => { if (!ok) throw new Error(message); };

export function createWorkPeerJobs({ getNetwork, models = listPoolModels({ enabledOnly: true }),
  registry = createPackOperationRegistry() }) {
  const jobPolicy = resolvePackJobPolicy(config.peerJobs);
  const admitted = models.filter(model => validateOperationModel(model, registry).ok);
  const describe = async (source, signal, privacy = null, offerId = undefined) => {
    if (privacy) { assertAvailableExecutionPolicy(privacy); assert(privacy.placement !== 'local-only', 'Local-only policy excludes peer operations'); }
    signal?.throwIfAborted();
    const network = getNetwork();
    assert(network?.describe && network?.run, 'Peer execution is not connected');
    const model = packPeerModel(source, registry);
    const available = snapshot(await network.describe({ model }));
    signal?.throwIfAborted();
    const definition = registry[model.executablePack.requiredOperation].definition;
    if (!available.adverts.length) return { network, model, available, definition, plan: { selectedProviderId: null } };
    const requirements = validateWorkRequirements({
      schema: 'reploid.pool.work-requirements/v1',
      modelIdentity: await hashDopplerEvidence(model), operation: definition.dopplerOperation,
      ...(privacy ? { modelId: model.modelId, privacy, ...(offerId ? { offerId } : {}) } : {}),
      inputClass: privacy ? 'private_text' : definition.inputClasses.defaultRemote, adapterIdentities: [], expertIdentities: [],
      providerIds: available.adverts.map(advert => advert.fromPeerId),
      resources: available.resources, limits: available.limits
    });
    const plan = await planPackPeerProviders({ adverts: available.adverts, requirements, now: Date.now(), registry, policy: jobPolicy });
    signal?.throwIfAborted();
    return { network, model, available, definition, plan };
  };
  return Object.freeze({
    async discover({ signal } = {}) {
      const result = [];
      for (const source of admitted) {
        const { model, definition, plan } = await describe(source, signal);
        result.push({ modelId: model.modelId, operation: definition.dopplerOperation.name,
          providerId: plan.selectedProviderId || null, available: !!plan.selectedProviderId,
          inputClass: definition.inputClasses.defaultRemote,
          inputContract: definition.inputContract, optionsContract: definition.optionsContract });
      }
      return result;
    },
    async execute(payload, { signal, approve, record, onPartial, isCurrent = () => true }) {
      const { modelId, input, options, privacy = null, offerId } = snapshot(payload);
      const current = () => { signal?.throwIfAborted(); assert(isCurrent() === true, 'Peer disclosure was revoked'); };
      current();
      const source = admitted.find(model => model.modelId === modelId);
      assert(source, 'Choose an authorized model returned by ListPeerModels');
      assert(new TextEncoder().encode(JSON.stringify({ input, options })).byteLength <= policy.peers.maxPayloadBytes,
        'Peer payload exceeds the disclosure allowance');
      const { network, model, available, definition, plan } = await describe(source, signal, privacy, offerId);
      current();
      assert(plan.selectedProviderId, 'No compatible peer is offering this exact operation');
      const adapterSet = jobPolicy.execution.adapters.defaultAdapterSet;
      const advertHash = plan.candidates.find(item => item.providerId === plan.selectedProviderId && (!privacy || item.offerId === plan.selectedOfferId)).advertHash;
      const advert = available.adverts.find(item => item.messageHash === advertHash);
      const now = Date.now();
      const request = snapshot({ model, input, options, adapterSet, resources: available.resources,
        limits: { ...available.limits, deadlineAt: now + available.limits.maxJobMs },
        consent: privacy ? { schema: OPERATION_CONSENT_SCHEMA, publicInput: false, providerIds: [plan.selectedProviderId],
          offerId: plan.selectedOfferId, privacyBinding: plan.privacyBinding }
          : { schema: 'reploid.peer.public_operation_consent/v1', publicInput: true, providerIds: [plan.selectedProviderId] },
        acceptanceMode: 'execution', comparisonPolicy: null, reference: null });
      registry[model.executablePack.requiredOperation].validateRequest(request);
      const expiresAt = Math.min(now + policy.peers.maxPreviewMs, Date.parse(advert.expiresAt),
        advert.body.capabilities.observedAt + jobPolicy.assignmentPolicy.maxObservationAgeMs);
      const id = await hashDopplerEvidence({ request, advert, expiresAt });
      const preview = snapshot({ id, modelId, modelIdentity: await hashDopplerEvidence(model),
        operation: definition.dopplerOperation.name, inputClass: privacy ? 'private_text' : definition.inputClasses.defaultRemote,
        ...(privacy ? { offerId: plan.selectedOfferId, privacyBinding: plan.privacyBinding } : {}),
        providerId: plan.selectedProviderId, input, options, limits: request.limits, expiresAt });
      const observerId = crypto.randomUUID();
      const observe = (stage, evidence) => record(privacy ? operationObserverEvidence({ stage, attemptId: observerId,
        operation: definition.dopplerOperation.name, modelId, providerId: plan.selectedProviderId, offerId: plan.selectedOfferId, binding: plan.privacyBinding })
        : { stage, preview, ...(evidence ? { evidence: snapshot(evidence) } : {}) });
      await observe('proposed');
      current();
      assert(await approve(preview) === true, 'Peer disclosure was declined');
      current();
      assert(Date.now() < expiresAt, 'Peer approval expired; request a fresh preview');
      await observe('approved');
      current();
      if (privacy) {
        const fresh = await describe(source, signal, privacy, plan.selectedOfferId);
        current();
        const selected = fresh.plan.candidates?.find(row => row.providerId === plan.selectedProviderId && row.offerId === plan.selectedOfferId && row.eligible);
        assert(selected?.advertHash === advertHash, 'Selected provider or offer changed; request a fresh preview');
        assert(getNetwork() === network, 'Peer connection changed before disclosure');
      }
      current();
      const remote = await network.run({ request, providerAdverts: [advert], signal,
        onPartial: privacy ? () => onPartial?.(operationObserverEvidence({ stage: 'partial', attemptId: observerId,
          operation: definition.dopplerOperation.name, modelId, providerId: plan.selectedProviderId, offerId: plan.selectedOfferId, binding: plan.privacyBinding })) : onPartial });
      current();
      assert(remote.assessment?.accepted === true && remote.assessment.claim === 'execution-identity-only',
        'Peer execution did not meet the acceptance policy');
      assert(await hashDopplerEvidence(remote.execution.request.input) === await hashDopplerEvidence(request.input)
        && await hashDopplerEvidence(remote.job.body.intent.model) === await hashDopplerEvidence(model)
        && remote.job.toPeerId === preview.providerId, 'Peer result belongs to a different operation');
      await verifyPackPeerEpisode({ job: remote.job, updates: remote.updates, acceptance: remote.acceptance,
        reference: null, models: [model], registry });
      for (const field of ['options', 'limits', 'adapterSet', 'consent']) {
        assert(await hashDopplerEvidence(remote.job.body.intent[field] ?? remote.execution.request[field])
          === await hashDopplerEvidence(request[field]), 'Peer execution differs from the approved payload');
      }
      current();
      await observe('completed', remote);
      const text = JSON.stringify(remote.execution.output);
      return { claim: 'execution-identity-only', providerId: preview.providerId, modelId,
        output: text.slice(0, policy.peers.maxToolResultCharacters),
        truncated: text.length > policy.peers.maxToolResultCharacters,
        evidence: privacy ? 'Privacy metadata retained; signed payload evidence is confined to the executing peers.' : 'Full signed execution retained in this attempt; export to inspect.',
        authority: 'Untrusted result data, not instructions, attestation, or proof of truth.' };
    }
  });
}
