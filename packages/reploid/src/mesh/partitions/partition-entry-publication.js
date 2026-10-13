import { assertPartition as assert, canonicalPartitionJson, samePartitionIdentity,
  validatePartitionIdentity } from './partition-contract.js';

export const ENTRY_PUBLICATION_SCHEMA = 'reploid.partition-publication/v1';
const same = (a, b) => canonicalPartitionJson(a) === canonicalPartitionJson(b);
const epoch = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const methods = ['head', 'admit', 'publish', 'cancel'];
export function validateEntryPublicationContext(value, request) {
  assert(value?.schema === 'reploid.partition-publication-context/v1' && epoch(value.publisherEpoch)
    && epoch(value.coordinatorEpoch) && digest(value.routeId) && digest(value.generation?.generationId)
    && digest(value.generation.executionIdentity) && value.generation.policy
    && Number.isSafeInteger(value.generation.policy.maxGeneratedTokens) && value.generation.policy.maxGeneratedTokens >= 0
    && Number.isSafeInteger(value.vocabSize) && value.vocabSize > 0
    && Number.isSafeInteger(value.deadlineAt) && value.deadlineAt > 0
    && Array.isArray(value.stages) && value.stages.length === 2
    && value.stages.every((stage, i) => stage.participantId === [request.participantA, request.participantB][i]
      && stage.partitionIndex === i && digest(stage.stageId) && epoch(stage.participantEpoch)
      && epoch(stage.deviceEpoch) && typeof stage.residentId === 'string' && stage.residentId.length > 0
      && digest(stage.executionId)), 'Invalid entry publication context');
  return structuredClone(value);
}
/** A publication request travels on the already authenticated requester/A channel.
 * It never conveys another conversation's history, a tensor or a raw text delta. */
export function entryPublicationEnvelope(request, method, body) {
  validatePartitionIdentity(request);
  assert(methods.includes(method), 'Unknown publication method');
  const { meshId, requesterId, participantA, participantB, modelId, modelIdentity, planId,
    threadId, attemptId, placementGeneration, canonical } = request;
  return { schema: ENTRY_PUBLICATION_SCHEMA, operation: 'publication', method, meshId, requesterId,
    participantA, participantB, modelId, modelIdentity, planId, threadId, attemptId, placementGeneration,
    canonical: structuredClone(canonical), body: structuredClone(body) };
}
export function matchingEntryPublication(message, request) {
  return request?.schema === 'reploid.partition-input/v2' && message.schema === ENTRY_PUBLICATION_SCHEMA
    && message.operation === 'publication' && methods.includes(message.method)
    && message.meshId === request.meshId && samePartitionIdentity(message, request)
    && same(message.canonical, request.canonical);
}
/** This port belongs to the requester, not the input executor. The transaction
 * owner validates cursors/signatures and fences uncertain storage outcomes. */
export function createEntryPublicationScope({ request, owner, authorize, onPublished, maxControlBytes, maxOutputCharacters }) {
  assert(owner?.requiresCommitEvidence === true && ['reconcile', 'admitAttempt', 'publish', 'cancel']
    .every(name => typeof owner[name] === 'function') && typeof authorize === 'function'
    && typeof onPublished === 'function', 'Requester durable publication and projection ports required');
  assert(Number.isSafeInteger(maxControlBytes) && maxControlBytes > 0
    && Number.isSafeInteger(maxOutputCharacters) && maxOutputCharacters > 0, 'Publication channel bounds required');
  const copy = value => {
    const json = canonicalPartitionJson(value);
    assert(new TextEncoder().encode(json).byteLength <= maxControlBytes, 'Publication control budget exhausted');
    return JSON.parse(json);
  };
  const selected = copy(request), context = validateEntryPublicationContext(selected.canonical, selected);
  let closed = false, admitted = null, content = '', count = 0, terminal = false;
  const projections = new Map(), pending = new Set();
  let cancellation = null;
  const permit = async method => {
    assert(!closed && await authorize(method) === true && !closed, 'Publication delivery authority closed or revoked');
  };
  const identityMatches = identity => identity?.attemptId === selected.attemptId
    && identity.requesterId === selected.requesterId && identity.publisherEpoch === context.publisherEpoch
    && identity.coordinatorEpoch === context.coordinatorEpoch && identity.routeId === context.routeId
    && identity.generationId === context.generation.generationId && identity.routeKind === 'two-stage-layer'
    && same(identity.stages, context.stages);
  const call = async (method, body) => {
      assert(methods.includes(method), 'Unknown publication method');
      const value = copy(body); // Snapshot before any asynchronous authorization or storage.
      await permit(method);
      if (method === 'head') {
        assert(same(value, {}), 'Unexpected publication head input');
        const state = await owner.reconcile(); await permit(method);
        return copy({ head: state.head, attempts: state.attempts.filter(item => item.identity.attemptId === selected.attemptId
          && item.identity.coordinatorEpoch === context.coordinatorEpoch).map(item => ({ identity: item.identity })) });
      }
      if (method === 'admit') {
        assert(identityMatches(value.identity) && same(value.generationPolicy, context.generation.policy)
          && value.executionIdentity === context.generation.executionIdentity && value.vocabSize === context.vocabSize
          && value.deadlineAt === context.deadlineAt && (!admitted || same(admitted, value.identity)),
        'Publication admission differs from approved context');
        const result = await owner.admitAttempt(value); admitted = value.identity;
        await permit(method); return copy(result);
      }
      assert(admitted, 'Publication attempt has not been admitted');
      if (method === 'cancel') {
        assert(same(value, { attemptId: selected.attemptId, coordinatorEpoch: context.coordinatorEpoch }),
          'Cancellation differs from admitted attempt');
        const result = await owner.cancel(value.attemptId, value.coordinatorEpoch);
        await permit(method); return copy(result);
      }
      const publication = value.publication;
      assert(publication?.attemptId === selected.attemptId && publication.coordinatorEpoch === context.coordinatorEpoch
        && Number.isSafeInteger(publication.sequence) && publication.sequence >= 0
        && publication.sequence < Math.max(1, context.generation.policy.maxGeneratedTokens)
        && Array.isArray(value.evidence), 'Publication differs from admitted attempt');
      const receipt = copy(await owner.publish(publication, { evidence: value.evidence }));
      assert(receipt.conversationId === selected.threadId && receipt.writerEpoch === context.publisherEpoch
        && receipt.attemptId === selected.attemptId && receipt.coordinatorEpoch === context.coordinatorEpoch
        && receipt.sequence === publication.sequence && receipt.publicationDigest === publication.publicationDigest,
      'Durable publication receipt identity mismatch');
      await permit(method);
      // Duplicate delivery reuses the same projection promise. A failed projection
      // cannot be acknowledged or regenerated; the host reconciles saved history.
      let projected = projections.get(receipt.publicationDigest);
      if (!projected) {
        const text = publication.delta?.text ?? '';
        assert(typeof text === 'string' && content.length + text.length <= maxOutputCharacters,
          'Published output exceeds entry budget');
        assert(publication.sequence === count, 'Published projection sequence mismatch');
        projected = Promise.resolve().then(async () => {
          await permit(method);
          await onPublished(copy({ publication, receipt, evidence: value.evidence }));
          content += text; count++;
          terminal = publication.schema === 'doppler.admission-publication/v1' || publication.successor?.terminal === true;
        });
        projections.set(receipt.publicationDigest, projected);
      }
      await projected; await permit(method); return receipt;
  };
  return Object.freeze({
    async close({ cancel = false } = {}) {
      closed = true;
      await Promise.allSettled([...pending]);
      if (cancel && admitted) {
        if (!cancellation) cancellation = Promise.resolve().then(() => owner.cancel(selected.attemptId, context.coordinatorEpoch));
        try { await cancellation; } catch (error) { cancellation = null; throw error; }
      }
    },
    getProjection() { return { content, count, terminal }; },
    call(method, body) {
      const operation = call(method, body); pending.add(operation);
      operation.then(() => pending.delete(operation), () => pending.delete(operation));
      return operation;
    },
  });
}
