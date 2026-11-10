import { assertPartition as assert, samePartitionIdentity, canonicalPartitionBinding,
  partitionActivationContract, matchingPartitionActivation } from './partition-contract.js';
import { verifyPartitionStageCommit } from './partition-stage-commit.js';

const SCHEMA = 'reploid.canonical-partition-request/v1';
const stepKeys = ['schema', 'operation', 'phase', 'identity', 'canonicalAttempt', 'generationId', 'sequence',
  'step', 'tokenPosition', 'inputTokenCount', 'inputTokenIds', 'baseCursorId', 'baseCursor', 'grant', 'continuation'];
const digestBytes = async bytes => 'sha256:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  byte => byte.toString(16).padStart(2, '0')).join('');
const exact = (value, keys) => assert(value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), 'Invalid canonical wire fields');

/** Wire admission only. Doppler owns the declared tensor/cursor/publication contracts. */
export function createCanonicalPartitionContract({ runtime, plan, planId, modelIdentity }) {
  for (const name of ['metadataDigest', 'tokenDigest', 'residentAttemptDigest', 'validateResidentAttemptIdentity',
    'validateResidentCursor', 'validateOrdinaryActivation', 'validateExecutionPublication', 'validateAdmissionPublication',
    'serializeActivationFrame', 'validateActivationFrameForPlan']) assert(typeof runtime?.[name] === 'function', `Canonical partition capability required: ${name}`);
  plan = structuredClone(plan);
  const layout = partitionActivationContract(runtime, plan);
  const hash = (schema, value) => runtime.metadataDigest(schema, value);
  const equal = (a, b) => hash('reploid.canonical-wire-value/v1', a) === hash('reploid.canonical-wire-value/v1', b);
  const binding = request => {
    assert(equal(request.identity, canonicalPartitionBinding(request.identity)), 'Unknown canonical identity fields');
    assert(request.schema === SCHEMA && request.identity.modelId === plan.modelId && request.identity.modelIdentity === modelIdentity
      && request.identity.planId === planId, 'Canonical wire model/plan mismatch');
    const attempt = runtime.validateResidentAttemptIdentity(request.canonicalAttempt);
    assert(attempt.routeKind === 'two-stage-layer' && attempt.attemptId === request.identity.attemptId
      && attempt.requesterId === request.identity.requesterId && attempt.generationId === request.generationId
      && attempt.stages[0].participantId === request.identity.participantA && attempt.stages[1].participantId === request.identity.participantB,
    'Canonical wire attempt mismatch');
    assert(equal(attempt, request.grant.claim.canonicalAttempt) && request.grant.claim.vocabSize === plan.vocabSize
      && request.grant.claim.generation.generationId === attempt.generationId, 'Canonical wire grant binding mismatch');
    assert(Number.isSafeInteger(request.sequence) && request.sequence >= 0 && request.step === request.sequence,
      'Canonical wire sequence mismatch');
    return attempt;
  };
  const activationHeader = (request, byteLength, payloadDigest) => {
    const attempt = binding(request);
    assert(Number.isSafeInteger(request.tokenPosition) && request.tokenPosition >= 0
      && Number.isSafeInteger(request.inputTokenCount) && request.inputTokenCount > 0
      && Array.isArray(request.inputTokenIds) && request.inputTokenIds.length === request.inputTokenCount,
    'Canonical token row mismatch');
    const inputDigest = runtime.tokenDigest(request.inputTokenIds, plan.vocabSize, request.grant.claim.limits.maxPromptTokens);
    let tokenContextDigest = inputDigest;
    if (request.sequence === 0) assert(request.baseCursor === null && request.baseCursorId === null && request.tokenPosition === 0 && attempt.inputDigest === inputDigest,
      'Canonical bootstrap parent mismatch');
    else {
      const cursor = runtime.validateResidentCursor(request.baseCursor, request.grant.claim.generation.policy, plan.vocabSize);
      assert(cursor.cursorId === request.baseCursorId && cursor.generationId === attempt.generationId && !cursor.terminal
        && cursor.revision + 1 === request.sequence && cursor.materializedTokenCount === request.tokenPosition
        && request.inputTokenCount === 1 && request.inputTokenIds[0] === cursor.pendingTokenId, 'Canonical decode parent mismatch');
      tokenContextDigest = cursor.acceptedTokenDigest;
    }
    const expectedBytes = request.inputTokenCount * plan.hiddenSize * layout.elementStrideBytes;
    assert(Number.isSafeInteger(expectedBytes) && byteLength === expectedBytes
      && byteLength <= request.grant.claim.limits.maxActivationBytes && /^sha256:[a-f0-9]{64}$/.test(payloadDigest),
    'Canonical activation byte bound mismatch');
    return { schema: 'doppler.ordinary-activation/v1', attemptDigest: runtime.residentAttemptDigest(attempt),
      sequence: request.sequence, baseCursorId: request.baseCursorId, proposalId: null,
      sourceStageId: attempt.stages[0].stageId, destinationStageId: attempt.stages[1].stageId,
      rows: { start: request.tokenPosition, end: request.tokenPosition + request.inputTokenCount }, tokenContextDigest,
      layout: { dtype: layout.dtype, precision: layout.precision, components: layout.components,
        elementStrideBytes: layout.elementStrideBytes, hiddenSize: plan.hiddenSize, byteOrder: 'little-endian' },
      payloadBytes: byteLength, payloadDigest };
  };
  const validateHeader = (request, byteLength) => {
    try {
      hash(SCHEMA, request); exact(request, [...stepKeys, 'frame']);
      const frame = request.frame;
      exact(frame.metadata, ['identity', 'activation']);
      assert(samePartitionIdentity(frame.metadata.identity, request.identity)
        && equal(frame.metadata.identity, canonicalPartitionBinding(request.identity)), 'Canonical frame identity mismatch');
      assert(request.phase === 'step' && request.operation === 'step' && frame.schema === layout.schema
        && matchingPartitionActivation(frame, layout, true) && frame.step === request.step && frame.seqOffset === request.tokenPosition
        && equal(frame.shape, [1, request.inputTokenCount, plan.hiddenSize]) && frame.byteLength === byteLength,
      'Canonical tensor header mismatch');
      return equal(frame.metadata.activation, activationHeader(request, byteLength, frame.metadata.activation.payloadDigest));
    } catch { return false; }
  };
  return Object.freeze({
    schema: SCHEMA, validateBinding: binding, validateHeader,
    validateControl(request) {
      try {
        hash(SCHEMA, request); const attempt = binding(request);
        if (request.operation === 'settle') {
          exact(request, ['schema', 'operation', 'identity', 'canonicalAttempt', 'generationId', 'sequence', 'step', 'grant']);
          return true;
        }
        if (request.operation === 'published') {
          exact(request, [...stepKeys, 'publication', 'receipt', 'commits']);
          return request.phase === 'published';
        }
        exact(request, stepKeys);
        return ['reserve', 'admit'].includes(request.operation) && request.phase === 'admit'
          && request.sequence === 0 && request.tokenPosition === 0 && request.baseCursor === null && request.baseCursorId === null
          && request.inputTokenIds?.length === request.inputTokenCount
          && runtime.tokenDigest(request.inputTokenIds, plan.vocabSize, request.grant.claim.limits.maxPromptTokens) === attempt.inputDigest;
      } catch { return false; }
    },
    async fingerprint(request) {
      const { payload = new Uint8Array(), ...metadata } = structuredClone(request);
      assert(payload instanceof Uint8Array, 'Canonical payload bytes required');
      return hash('reploid.canonical-partition-request-digest/v1', { metadata,
        payloadBytes: payload.byteLength, payloadDigest: await digestBytes(payload) });
    },
    async serializeActivation(request) {
      const { activationTensor: source, ...metadata } = request;
      hash(SCHEMA, metadata);
      assert(source?.data?.byteLength <= request.grant.claim.limits.maxActivationBytes, 'Canonical activation exceeds grant');
      const { activationTensor, ...control } = structuredClone(request);
      request = control;
      assert(activationTensor?.data?.byteLength <= request.grant.claim.limits.maxActivationBytes, 'Canonical activation exceeds grant');
      const frame = { ...runtime.serializeActivationFrame({ ...activationTensor, metadata: {} }) };
      const payload = new Uint8Array(frame.buffer);
      frame.metadata = { identity: canonicalPartitionBinding(request.identity),
        activation: activationHeader(request, payload.byteLength, await digestBytes(payload)) };
      const { buffer, ...header } = frame;
      assert(validateHeader({ ...request, frame: header }, payload.byteLength), 'Canonical serialized header mismatch');
      runtime.validateOrdinaryActivation(frame.metadata.activation, payload,
        { maxRows: request.grant.claim.limits.maxPromptTokens, maxBytes: request.grant.claim.limits.maxActivationBytes });
      runtime.validateActivationFrameForPlan(frame, plan);
      return frame;
    },
    validatePayload(request, payload) {
      const { payload: _receivedBytes, ...metadata } = request;
      request = metadata;
      assert(validateHeader(request, payload.byteLength), 'Canonical activation header rejected');
      const validated = runtime.validateOrdinaryActivation(request.frame.metadata.activation, payload,
        { maxRows: request.grant.claim.limits.maxPromptTokens, maxBytes: request.grant.claim.limits.maxActivationBytes });
      return runtime.validateActivationFrameForPlan({ ...request.frame, buffer: validated.bytes.buffer }, plan);
    },
    async verifyPublication(request, retained) {
      try {
        hash('reploid.canonical-publication-ack/v1', { request, retained });
        request = structuredClone(request); retained = structuredClone(retained);
        exact(request, [...stepKeys, 'publication', 'receipt', 'commits']);
        assert(request.operation === 'published' && request.phase === 'published', 'Publication phase mismatch');
        const attempt = binding(request), { publication, receipt, commits } = request;
        assert(publication.sequence === request.sequence, 'Publication acknowledgment sequence mismatch');
        if (publication.schema === 'doppler.admission-publication/v1') {
          runtime.validateAdmissionPublication(publication, attempt, request.grant.claim.generation.policy, plan.vocabSize);
          assert(equal(publication.result, retained) && Array.isArray(commits) && commits.length === 0, 'Admission publication mismatch');
        } else {
          runtime.validateExecutionPublication(publication, attempt, request.grant.claim.generation.policy, plan.vocabSize, request.baseCursor);
          assert(Array.isArray(commits) && commits.length === attempt.stages.length, 'Publication evidence cardinality mismatch');
          assert(new Set(commits.map(commit => commit.acknowledgment.stageId)).size === commits.length, 'Duplicate publication evidence');
          for (const stage of attempt.stages) {
            const commit = commits.find(item => item.acknowledgment.stageId === stage.stageId);
            const acknowledgment = publication.acknowledgments.find(item => item.stageId === stage.stageId);
            assert(commit && equal(commit.acknowledgment, acknowledgment)
              && await verifyPartitionStageCommit({ runtime, attempt, stage, ...commit,
                transition: retained.transition, sequence: request.sequence, baseCursorId: request.baseCursorId }),
            'Publication stage evidence mismatch');
          }
          assert(equal(retained.commit, commits.find(item => item.acknowledgment.stageId === attempt.stages[1].stageId)), 'Publication differs from retained output-stage result');
        }
        exact(receipt, ['schema', 'conversationId', 'writerEpoch', 'index', 'coordinatorEpoch', 'attemptId', 'sequence', 'publicationDigest', 'receiptDigest']);
        const { receiptDigest, ...body } = receipt;
        return body.schema === 'reploid.publication-receipt/v1' && body.conversationId === request.identity.threadId
          && body.writerEpoch === attempt.publisherEpoch && body.coordinatorEpoch === attempt.coordinatorEpoch
          && body.attemptId === attempt.attemptId && body.sequence === request.sequence
          && body.publicationDigest === publication.publicationDigest && Number.isSafeInteger(body.index) && body.index >= 0
          && receiptDigest === hash(body.schema, body);
      } catch { return false; }
    },
  });
}
