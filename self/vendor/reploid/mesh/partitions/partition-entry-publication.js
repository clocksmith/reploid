import { assertPartition as assert, canonicalPartitionJson, samePartitionIdentity,
  validatePartitionIdentity, canonicalRouteAttemptBinding } from './partition-contract.js';
import { ORDERED_PUBLICATION_ATTEMPT_SCHEMA, validateOrderedPublicationContext } from './partition-ordered-publication.js';

export const ENTRY_PUBLICATION_SCHEMA = 'reploid.partition-publication/v1';
const same = (a, b) => canonicalPartitionJson(a) === canonicalPartitionJson(b);
const epoch = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const methods = ['head', 'admit', 'publish', 'publish-batch', 'cancel'];
const orderedInput = request => request?.schema === 'reploid.partition-input/v3';
const orderedKeys = ['meshId', 'requesterId', 'coordinatorId', 'modelId', 'modelIdentity', 'planId', 'threadId',
  'attemptId', 'placementGeneration'];
/** The owner interface a coordinator calls; the requester's scope answers it. */
export function entryPublicationPort(call) {
  assert(typeof call === 'function', 'Publication call port required');
  return Object.freeze({ requiresCommitEvidence: true,
    reconcile: () => call('head', {}), admitAttempt: body => call('admit', body),
    publish: (value, { evidence } = {}) => call('publish', { publication: value, evidence }),
    // Consecutive records committed by the requester in one transaction and projected once.
    publishBatch: async (values, { evidence } = {}) => (await call('publish-batch', { publications: values, evidence }))?.receipts,
    cancel: (attemptId, coordinatorEpoch) => call('cancel', { attemptId, coordinatorEpoch }) });
}
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
  assert(methods.includes(method), 'Unknown publication method');
  if (orderedInput(request)) {
    canonicalRouteAttemptBinding({ schema: 'reploid.partition-attempt/v2', route: request.route, threadId: request.threadId,
      attemptId: request.attemptId, requesterId: request.requesterId, placementGeneration: request.placementGeneration });
    return { schema: ENTRY_PUBLICATION_SCHEMA, operation: 'publication', method,
      ...Object.fromEntries(orderedKeys.map(key => [key, request[key]])), route: structuredClone(request.route),
      publication: validateOrderedPublicationContext(request.publication), body: structuredClone(body) };
  }
  validatePartitionIdentity(request);
  const { meshId, requesterId, participantA, participantB, modelId, modelIdentity, planId,
    threadId, attemptId, placementGeneration, canonical } = request;
  return { schema: ENTRY_PUBLICATION_SCHEMA, operation: 'publication', method, meshId, requesterId,
    participantA, participantB, modelId, modelIdentity, planId, threadId, attemptId, placementGeneration,
    canonical: structuredClone(canonical), body: structuredClone(body) };
}
export function matchingEntryPublication(message, request) {
  if (orderedInput(request)) {
    try {
      return request.publication !== undefined && message?.schema === ENTRY_PUBLICATION_SCHEMA && message.operation === 'publication'
        && methods.includes(message.method) && orderedKeys.every(key => message[key] === request[key])
        && message.canonical === undefined && message.participantA === undefined && message.participantB === undefined
        && same(message.route, request.route) && same(message.publication, request.publication);
    } catch { return false; }
  }
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
  const selected = copy(request), ordered = orderedInput(selected);
  const context = ordered ? validateOrderedPublicationContext(selected.publication) : validateEntryPublicationContext(selected.canonical, selected);
  let closed = false, admitted = null, admittedPolicy = null, content = '', count = 0, terminal = false;
  const projections = new Map(), pending = new Set();
  let cancellation = null;
  const permit = async method => {
    assert(!closed && await authorize(method) === true && !closed, 'Publication delivery authority closed or revoked');
  };
  // An ordered coordinator chooses its epoch at admission; canonical routes advertise it.
  const coordinatorEpoch = () => ordered ? admitted?.coordinatorEpoch : context.coordinatorEpoch;
  const sequenceLimit = () => ordered ? admittedPolicy.maxTokens : Math.max(1, context.generation.policy.maxGeneratedTokens);
  const identityMatches = identity => ordered
    ? identity?.schema === ORDERED_PUBLICATION_ATTEMPT_SCHEMA && identity.attemptId === selected.attemptId
      && identity.threadId === selected.threadId && identity.requesterId === selected.requesterId
      && identity.placementGeneration === selected.placementGeneration && identity.publisherEpoch === context.publisherEpoch
      && epoch(identity.coordinatorEpoch) && same(identity.route, selected.route)
    : identity?.attemptId === selected.attemptId
    && identity.requesterId === selected.requesterId && identity.publisherEpoch === context.publisherEpoch
    && identity.coordinatorEpoch === context.coordinatorEpoch && identity.routeId === context.routeId
    && identity.generationId === context.generation.generationId && identity.routeKind === 'two-stage-layer'
    && same(identity.stages, context.stages);
  const admissionMatches = value => identityMatches(value.identity) && (ordered
    ? value.executionIdentity === value.identity.generationDigest && Number.isSafeInteger(value.vocabSize) && value.vocabSize > 0
      && Number.isSafeInteger(value.generationPolicy?.maxTokens) && value.generationPolicy.maxTokens > 0
    : same(value.generationPolicy, context.generation.policy)
      && value.executionIdentity === context.generation.executionIdentity && value.vocabSize === context.vocabSize);
  const call = async (method, body) => {
      assert(methods.includes(method), 'Unknown publication method');
      const value = copy(body); // Snapshot before any asynchronous authorization or storage.
      await permit(method);
      if (method === 'head') {
        assert(same(value, {}), 'Unexpected publication head input');
        const state = await owner.reconcile(); await permit(method);
        return copy({ head: state.head, attempts: state.attempts.filter(item => item.identity.attemptId === selected.attemptId
          && (ordered || item.identity.coordinatorEpoch === context.coordinatorEpoch)).map(item => ({ identity: item.identity })) });
      }
      if (method === 'admit') {
        assert(admissionMatches(value) && value.deadlineAt === context.deadlineAt && (!admitted || same(admitted, value.identity)),
          'Publication admission differs from approved context');
        const result = await owner.admitAttempt(value); admitted = value.identity; admittedPolicy = value.generationPolicy;
        await permit(method); return copy(result);
      }
      assert(admitted, 'Publication attempt has not been admitted');
      if (method === 'cancel') {
        assert(same(value, { attemptId: selected.attemptId, coordinatorEpoch: coordinatorEpoch() }),
          'Cancellation differs from admitted attempt');
        const result = await owner.cancel(value.attemptId, value.coordinatorEpoch);
        await permit(method); return copy(result);
      }
      const batch = method === 'publish-batch';
      const publications = batch ? value.publications : [value.publication], evidence = batch ? value.evidence : [value.evidence];
      assert(Array.isArray(publications) && publications.length > 0 && Array.isArray(evidence) && evidence.length === publications.length
        && publications.every((publication, index) => publication?.attemptId === selected.attemptId && publication.coordinatorEpoch === coordinatorEpoch()
          && Number.isSafeInteger(publication.sequence) && publication.sequence >= 0
          && publication.sequence < sequenceLimit() && Array.isArray(evidence[index])), 'Publication differs from admitted attempt');
      const receipts = copy(batch ? await owner.publishBatch(publications, { evidence })
        : [await owner.publish(publications[0], { evidence: evidence[0] })]);
      assert(Array.isArray(receipts) && receipts.length === publications.length && receipts.every((receipt, index) =>
        receipt.conversationId === selected.threadId && receipt.writerEpoch === context.publisherEpoch
        && receipt.attemptId === selected.attemptId && receipt.coordinatorEpoch === coordinatorEpoch()
        && receipt.sequence === publications[index].sequence && receipt.publicationDigest === publications[index].publicationDigest),
      'Durable publication receipt identity mismatch');
      await permit(method);
      // Duplicate delivery reuses the same projection promise. A failed projection
      // cannot be acknowledged or regenerated; the host reconciles saved history.
      // A batch is projected once, from its last durable record.
      const last = receipts.length - 1;
      let projected = projections.get(receipts[last].publicationDigest);
      if (!projected) {
        const fresh = publications.filter(publication => publication.sequence >= count);
        const text = fresh.map(publication => publication.delta?.text ?? '').join('');
        assert(fresh.every(publication => typeof (publication.delta?.text ?? '') === 'string')
          && content.length + text.length <= maxOutputCharacters, 'Published output exceeds entry budget');
        assert(fresh.length > 0 && fresh[0].sequence === count, 'Published projection sequence mismatch');
        const publication = publications[last];
        projected = Promise.resolve().then(async () => {
          await permit(method);
          await onPublished(copy({ publication, receipt: receipts[last], evidence: evidence[last] }));
          content += text; count += fresh.length;
          terminal = publication.schema === 'doppler.admission-publication/v1' || publication.successor?.terminal === true;
        });
        projections.set(receipts[last].publicationDigest, projected);
      }
      await projected; await permit(method); return batch ? { receipts } : receipts[0];
  };
  return Object.freeze({
    async close({ cancel = false } = {}) {
      closed = true;
      await Promise.allSettled([...pending]);
      if (cancel && admitted) {
        if (!cancellation) cancellation = Promise.resolve().then(() => owner.cancel(selected.attemptId, coordinatorEpoch()));
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
