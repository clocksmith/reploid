import { verifyPackPeerEpisode } from './peer-pack-episode.js';
/** Product workflow. The network port receives only the reviewed public task. */
import config from './pool-config.json' with { type: 'json' };
import { createDocumentSearch } from './document-search.js';
import { snapshotPackOperationData as snapshot } from './pack-operation.js';
import { hashDopplerEvidence } from './executable-pack.js';
import { packPeerModel, planPackPeerProviders } from './peer-pack-job.js';
import { createPackOperationRegistry } from './pack-operation-adapters.js';
import { validateWorkRequirements } from './peer-capabilities.js';
import { resolvePackJobPolicy } from './peer-pack-job-policy.js';

const assert = (ok, message) => { if (!ok) throw new Error(message); };

export function createDocumentAssistant({ executor, network = null, onChange = () => {},
  policy = config.documentDelegation, jobPolicy = config.peerJobs, registry = createPackOperationRegistry() }) {
  policy = snapshot(policy);
  jobPolicy = resolvePackJobPolicy(jobPolicy);
  assert(policy?.schema === 'reploid.document-delegation-policy/v1' && policy.inputClass === 'public_text'
    && Number.isSafeInteger(policy.maxTaskBytes) && policy.maxTaskBytes > 0
    && Number.isSafeInteger(policy.maxDraftBytes) && policy.maxDraftBytes > 0
    && Number.isSafeInteger(policy.maxPreviewMs) && policy.maxPreviewMs > 0, 'Document sharing policy is missing');
  let settings, preview = null, busy = false, closed = false, epoch = 0, controller = null;
  let phase = 'idle', remoteRecord = null, combined = null;
  const combinedHistory = new WeakMap();
  const state = () => ({ ...search.getState(), result: combined || search.getState().result,
    history: search.getState().history.map(row => combinedHistory.has(row.result) ? { ...row, result: combinedHistory.get(row.result) } : row),
    busy: busy || search.getState().busy,
    delegation: { available: Boolean(network && settings?.generator), preview: preview?.display ?? null, phase } });
  const notify = () => { if (!closed) onChange(state()); };
  const search = createDocumentSearch({ executor, onChange: () => notify() });
  const invalidate = () => { epoch++; preview = null; remoteRecord = null; combined = null; controller?.abort(new Error('Sharing cancelled')); phase = 'idle'; };
  const current = token => { assert(!closed && token === epoch, 'Sharing cancelled'); controller?.signal.throwIfAborted(); };
  return {
    getState: state,
    connectNetwork(value) {
      assert(!busy && value && typeof value.describe === 'function' && typeof value.run === 'function', 'A compatible operation network is required');
      invalidate(); network = value; notify();
    },
    configure(value) { assert(!busy, 'Cancel sharing before changing models'); search.configure(value); settings = snapshot(value); invalidate(); notify(); },
    async setDocuments(value) { assert(!busy, 'Cancel sharing before changing documents'); invalidate(); return search.setDocuments(value); },
    async search(value) { assert(!busy, 'Cancel sharing before searching again'); invalidate(); return search.search(value); },
    withdrawDelegation() { assert(!busy, 'Cancel the active task before editing'); invalidate(); notify(); },
    async prepareDelegation({ task }) {
      assert(!busy && !search.getState().busy && !closed, 'Another operation is running');
      assert(network && settings?.generator, 'Connect another computer and choose an answer model first');
      const result = search.getState().result;
      assert(result?.matches?.length, 'Search your documents first');
      assert(typeof task === 'string' && task.trim() && new TextEncoder().encode(task).length <= policy.maxTaskBytes,
        'Write a short task containing only information you want to share');
      invalidate();
      const token = epoch;
      busy = true; phase = 'preparing'; notify();
      try {
        // Deliberately no query, passage, filename or corpus object in this call.
        const model = packPeerModel(settings.generator, registry);
        const available = snapshot(await network.describe({ model }));
        current(token);
        assert(available.adverts.length > 0, 'No compatible computer is available');
        const operation = registry[model.executablePack.requiredOperation].definition.dopplerOperation;
        const adapterSet = jobPolicy.execution.adapters.defaultAdapterSet;
        const now = Date.now();
        const requirements = validateWorkRequirements({ schema: 'reploid.pool.work-requirements/v1',
          modelIdentity: await hashDopplerEvidence(model), operation, inputClass: policy.inputClass,
          adapterIdentities: [], expertIdentities: [], providerIds: available.adverts.map(advert => advert.fromPeerId),
          resources: available.resources, limits: available.limits });
        const plan = await planPackPeerProviders({ adverts: available.adverts, requirements, now, registry, policy: jobPolicy });
        current(token);
        assert(plan.selectedProviderId, 'No compatible computer is available');
        const advertHash = plan.candidates.find(row => row.providerId === plan.selectedProviderId).advertHash;
        const advert = available.adverts.find(row => row.messageHash === advertHash);
        const request = snapshot({ model, input: { prompt: task }, options: settings.generationOptions, adapterSet,
          limits: { ...available.limits, deadlineAt: now + available.limits.maxJobMs }, resources: available.resources,
          consent: { schema: 'reploid.peer.public_operation_consent/v1', publicInput: true, providerIds: [plan.selectedProviderId] },
          acceptanceMode: 'execution', comparisonPolicy: null, reference: null });
        const expiresAt = Math.min(now + policy.maxPreviewMs, Date.parse(advert.expiresAt),
          advert.body.capabilities.observedAt + jobPolicy.assignmentPolicy.maxObservationAgeMs);
        const id = await hashDopplerEvidence({ request, advert, corpusHash: result.corpusHash, expiresAt });
        current(token);
        preview = { id, request, advert, result, token, expiresAt,
          display: snapshot({ id, text: task, providerId: plan.selectedProviderId, modelId: model.modelId,
            bytes: new TextEncoder().encode(task).length, expiresAt }) };
        phase = 'review';
        return preview.display;
      } finally { busy = false; notify(); }
    },
    async approveDelegation({ previewId, text, publicInput }) {
      assert(!busy && preview && !closed, 'Prepare a task before sharing');
      const approved = preview;
      assert(publicInput === true && previewId === approved.id && text === approved.display.text,
        'Approve the exact text shown before sharing');
      assert(Date.now() < approved.expiresAt, 'This preview expired. Review a new preview before sharing');
      preview = null; busy = true; phase = 'remote'; controller = new AbortController(); notify();
      try {
        current(approved.token);
        const remote = await network.run({ request: approved.request, providerAdverts: [approved.advert], signal: controller.signal });
        current(approved.token);
        assert(remote.assessment?.accepted === true && remote.assessment.claim === 'execution-identity-only'
          && typeof remote.execution?.output?.text === 'string'
          && new TextEncoder().encode(remote.execution.output.text).length <= policy.maxDraftBytes, 'Remote draft is incomplete or exceeds its limit');
        assert(await hashDopplerEvidence(remote.execution.request.input) === await hashDopplerEvidence(approved.request.input)
          && await hashDopplerEvidence(remote.job.body.intent.model) === await hashDopplerEvidence(approved.request.model)
          && remote.job.toPeerId === approved.display.providerId, 'Remote result belongs to a different task');
        await verifyPackPeerEpisode({ job: remote.job, updates: remote.updates, acceptance: remote.acceptance, reference: null, models: [approved.request.model], registry });
        current(approved.token);
        for (const field of ['options', 'limits', 'adapterSet', 'consent']) {
          assert(await hashDopplerEvidence(remote.job.body.intent[field] ?? remote.execution.request[field])
            === await hashDopplerEvidence(approved.request[field]), 'Remote execution differs from the approved plan');
        }
        remoteRecord = snapshot(remote);
        phase = 'combining'; notify();
        // Remote text is quoted data. Only the local model sees the private passages.
        const result = await search.search({ query: approved.result.query, rerank: approved.result.reranked,
          generateAnswer: true, remoteDraft: remote.execution.output.text });
        current(approved.token);
        combined = snapshot({ ...result, execution: 'local-and-approved-peer', remoteExecution: remoteRecord, disclosure: approved.display });
        combinedHistory.set(search.getState().history[0].result, combined);
        phase = 'completed';
        return combined;
      } finally { busy = false; controller = null; notify(); }
    },
    cancel() { invalidate(); search.cancel(); notify(); },
    clear() { invalidate(); search.clear(); notify(); },
    async close() { closed = true; invalidate(); await search.close(); settings = null; }
  };
}
