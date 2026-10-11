/** Physical extension of the same signed-job and IndexedDB fixture, one GPU/operator. */
import { start, storagePolicy } from './independent-units-browser.js';
import { prepareLocalPackRelease } from '../../self/pool/pack-release-policy.js';
import { hashDopplerEvidence, assertPackSession } from '../../self/pool/executable-pack.js';
import { runPackOperation } from '../../self/pool/pack-operation.js';
import { packPeerModel } from '../../self/pool/peer-pack-job.js';
import { openCapsule } from '/src/client/doppler-api.browser.js';
import { getCapsuleIdentity } from '/src/capsule.js';
import { resolveEmbeddingBatchSemantics } from '/src/capsule-runtime.js';
import { DOPPLER_VERSION } from '/src/version.js';
import { evaluateEmbeddingReference } from '/src/config/embedding-reference.js';
import { getBufferPool } from '/src/memory/buffer-pool.js';

export async function startPhysical(saved = null, createFixture = start) {
  const configuration = await (await fetch('/physical/config.json')).json();
  const { config, reference, capsule, expectedReferenceDigest } = configuration;
  if (await hashDopplerEvidence(reference) !== expectedReferenceDigest
    || expectedReferenceDigest !== config.application.oracle.digest) throw new Error('Independent source reference identity changed');
  const adapter = await navigator.gpu.requestAdapter();
  const gpu = { vendor: adapter?.info.vendor, description: adapter?.info.description,
    isFallbackAdapter: adapter?.isFallbackAdapter ?? adapter?.info.isFallbackAdapter };
  if (gpu.vendor !== config.requiredVendor || gpu.isFallbackAdapter !== false
    || /swiftshader|llvmpipe|software/i.test(gpu.description)) throw new Error('Physical GPU required');
  const identity = getCapsuleIdentity(capsule);
  const model = { modelId: identity.capsuleId, modelHash: identity.semanticRoot, manifestHash: identity.envelopeDigest,
    runtime: 'doppler', backend: 'browser-webgpu', runtimeVersion: DOPPLER_VERSION, workload: 'embedding',
    executionMode: 'complete_pack_browser', application: config.application, packOpenOptions: config.openOptions,
    executablePack: { ...identity, artifacts: capsule.artifacts, requiredOperation: 'embed',
      acceptedTargetPlanDigests: config.openOptions.acceptedTargetPlanDigests } };
  const release = await prepareLocalPackRelease({ model });
  let session;
  try {
    session = await openCapsule(`${location.origin}/capsule/${encodeURIComponent(config.capsuleFilename)}`, release.options);
    await assertPackSession(model.executablePack, session);
    await release.assertCurrent(session);
    if (session.verification.lifecycle.authorization?.mode === 'retained-local') throw new Error('Delegation requires current eligibility');
    const semantics = resolveEmbeddingBatchSemantics(session.manifest);
    if (semantics.inputField !== 'texts' || semantics.state !== 'reset-per-text') throw new Error('Independent input semantics required');
    const approved = { application: config.application, semantics, independentReference: expectedReferenceDigest };
    const binding = packPeerModel(model);
    const boundModel = await hashDopplerEvidence(binding), approvedDigest = await hashDopplerEvidence(approved);
    let active = false;
    const gpuBudgetBytes = 1420000000;
    const buffers = () => {
      const stats = getBufferPool().getStats();
      if (stats.peakBytesAllocated > gpuBudgetBytes) throw new Error('Physical embedding allocation ceiling exceeded');
      return stats;
    };
    buffers();
    const fixture = await createFixture(saved, {
      model, texts: reference.input.texts, reference: { embeddings: reference.outputs.map(row => ({ embedding: row.embedding, tokens: row.tokenIds })) },
      inputApplication: config.application, application: approved, absoluteTolerance: reference.tolerances.embeddingMaxAbs, unitSize: 3,
      storagePolicy: { ...storagePolicy, maxBytes: 16777216 },
      resources: { gpuBytes: gpuBudgetBytes, storageBytes: capsule.artifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0),
        bandwidthBytesPerSecond: 0 },
      coordinatorLimits: { maxUnits: 16, maxInputBytes: 1048576, maxConcurrentUnits: 1 },
      jobLimits: { maxInputBytes: 1048576, maxOutputBytes: 1048576, maxStreamBytes: 4194304, maxEvents: 32, maxJobMs: 180000 },
      async validateApplication(application, request) {
        if (await hashDopplerEvidence(application) !== approvedDigest
          || await hashDopplerEvidence(request.model) !== boundModel
          || await hashDopplerEvidence(request.input.application) !== await hashDopplerEvidence(config.application)) {
          throw new Error('Unapproved embedding application or execution binding');
        }
        await release.assertCurrent(session);
      },
      async run({ input, options, assignment, limits, signal, onPartial, beforeExecute }) {
        if (active) throw new Error('Physical test session is already executing');
        active = true;
        try {
          await release.assertCurrent(session);
          return await runPackOperation({ binding: model.executablePack, session, runtimeVersion: DOPPLER_VERSION,
            request: { schema: 'doppler.capsule-operation-request/v1', operation: { name: 'embed', version: 1 }, input, options, assignment, limits },
            signal, onPartial, beforeExecute, assertCurrent: () => release.assertCurrent(session) });
        } finally { active = false; buffers(); }
      }
    });
    return {
      ...fixture, gpu, semantics, buffers, releaseCheckpoint: session.verification.lifecycle.checkpoint,
      async evaluate(parentId) {
        const record = await fixture.journal.get(parentId);
        const outputs = new Array(reference.input.texts.length);
        for (const unit of record.units) {
          if (!unit.outcome) throw new Error('Missing committed unit');
          const positions = record.manifest.units.find(value => value.unitId === unit.unitId).positions;
          unit.outcome.result.execution.output.embeddings.forEach((row, index) => {
            outputs[positions[index]] = { text: reference.input.texts[positions[index]], tokenIds: row.tokens, embedding: row.embedding };
          });
        }
        return { comparison: evaluateEmbeddingReference(reference, { input: reference.input,
          embeddingContract: reference.embeddingContract, outputs }), record, outputs };
      },
      async close() { await fixture.close(); await session.close(); release.close(); }
    };
  } catch (error) { await session?.close(); release.close(); throw error; }
}
