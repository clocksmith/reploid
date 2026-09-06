// Synthetic execution fixture. Exercises application plumbing, never model qualification.
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';
import { PACK_EXECUTION_MODE, PACK_OPERATION_WORKLOADS } from '../../self/pool/operation-model.js';

const digest = (value) => `sha256:${value.repeat(64)}`;
export async function createDocumentPackFixture() {
  const artifacts = [{ artifactId: 'weights', hash: digest('a'), role: 'weights', path: 'weights.bin', sizeBytes: 4 }];
  const identity = { schema: 'doppler.pack/v2', packId: 'fixture', semanticRoot: digest('b'),
    envelopeDigest: digest('c'), artifactClosureDigest: await hashDopplerEvidence(artifacts) };
  const targetPlanDigest = digest('d');
  const binding = (operation) => ({ ...identity, artifacts, requiredOperation: operation, acceptedTargetPlanDigests: [targetPlanDigest] });
  const model = (operation) => ({ modelId: 'fixture', runtime: 'doppler', runtimeVersion: '0.5.1', backend: 'browser-webgpu',
    executionMode: PACK_EXECUTION_MODE, workload: PACK_OPERATION_WORKLOADS[operation], modelHash: identity.semanticRoot,
    manifestHash: identity.envelopeDigest, executablePack: binding(operation), packSource: 'https://fixtures.invalid/pack.json',
    packOpenOptions: { trustedSigners: { fixture: { kty: 'OKP', crv: 'Ed25519', x: 'fixture' } } },
    application: { applicationId: `synthetic-document-${operation}` } });
  const calls = [];
  let closes = 0;
  const service = {
    prepare: async () => ({ version: '0.5.1' }),
    close: async () => { closes++; },
    openPack: async () => ({ schema: 'doppler.pack-session/v1', loaded: true, modelId: 'fixture', packIdentity: identity,
      selectedTargetPlanDigest: targetPlanDigest, verification: { artifactReceipts: artifacts.map(({ artifactId, hash, sizeBytes }) => ({ artifactId, hash, sizeBytes })) },
      async *executeOperation(request) {
        calls.push(request);
        const output = request.operation.name === 'embed'
          ? { embeddings: request.input.texts.map((text) => ({ embedding: /apple/i.test(text) ? [1, 0] : [0, 1] })) }
          : { evidence: { schema: 'doppler_rerank_evidence/v1',
            scores: request.input.documents.map((_, index) => ({ index, score: index })),
            ranking: request.input.documents.map((_, index) => ({ index, score: index })).reverse().map((row, index) => ({ ...row, rank: index + 1 })) } };
        const requestHash = await hashDopplerEvidence(request);
        const receiptBody = { schema: 'doppler.pack-operation-receipt/v1', operation: request.operation,
          pack: identity, targetPlanDigest, artifactReceipts: this.verification.artifactReceipts,
          runtimeVersion: '0.5.1', requestHash, assignmentHash: null,
          inputHash: await hashDopplerEvidence({ input: request.input, options: request.options }), outputHash: await hashDopplerEvidence(output) };
        const receipt = { ...receiptBody, receiptDigest: await hashDopplerEvidence(receiptBody) };
        const body = { schema: 'doppler.pack-operation-event/v1', operation: request.operation,
          requestHash, assignmentHash: null, eventIndex: 0, previousEventDigest: null, status: 'completed', output, receipt };
        yield { ...body, eventDigest: await hashDopplerEvidence(body) };
      }
    })
  };
  return { service, calls, closes: () => closes, configuration: {
    schema: 'reploid.document-models/v1', queryPrefix: '', embedding: model('embed'), reranker: model('rerank') } };
}
