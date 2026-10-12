/** Durable conversation publication. Doppler validates model/cursor contracts;
 * the host authenticates commits and supplies a genuinely transactional store. */
import defaults from './publication-policy.json' with { type: 'json' };

const reject = message => { throw Object.assign(new Error(message), { code: 'PUBLICATION_REJECTED' }); };
const assert = (ok, message) => { if (!ok) reject(message); };
const copy = value => structuredClone(value);
const epoch = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const initial = () => ({ schema: 'reploid.publication-history/v1', writerEpoch: null, head: null, attempts: [], records: [] });

export function createConversationPublication({ conversationId, writerEpoch, store, doppler,
  authenticateCommit, authorize, policy = defaults, now = Date.now }) {
  assert(typeof conversationId === 'string' && conversationId && conversationId.length <= 256 && epoch(writerEpoch), 'Invalid publication owner identity');
  assert(store?.schema === 'reploid.transactional-chat-store/v1' && typeof store.transact === 'function'
    && typeof store.read === 'function', 'Transactional history adapter required');
  for (const method of ['metadataDigest', 'validateResidentAttemptIdentity', 'canonicalGenerationIdentity', 'validateExecutionPublication']) {
    assert(typeof doppler?.[method] === 'function', `Canonical Doppler contract required: ${method}`);
  }
  assert(typeof authenticateCommit === 'function' && typeof authorize === 'function', 'Current authorization and authenticated commit ports required');
  const limits = copy(policy);
  assert(Object.keys(limits).length === 2 && ['maxAttempts', 'maxPublications'].every(key =>
    Number.isSafeInteger(limits[key]) && limits[key] > 0), 'Invalid publication retention bounds');
  let fenced = false;
  const permission = (action, attempt = null) => assert(authorize({ conversationId, writerEpoch, action, attempt }) === true, 'Publication authority revoked');
  const historyFor = value => {
    const history = value ?? initial();
    assert(history.schema === 'reploid.publication-history/v1' && Array.isArray(history.attempts)
      && Array.isArray(history.records) && history.attempts.length <= limits.maxAttempts
      && history.records.length <= limits.maxPublications, 'Invalid durable publication history');
    return history;
  };
  const write = async reduce => {
    assert(!fenced, 'Publication storage is fenced; reconcile its durable head');
    try {
      return await store.transact(conversationId, value => {
        const history = historyFor(value);
        return { state: history, result: reduce(history) };
      });
    } catch (error) {
      if (error.code !== 'PUBLICATION_REJECTED') fenced = true;
      throw error;
    }
  };
  const writer = history => assert(history.writerEpoch === writerEpoch, 'Stale publication writer epoch');
  const findAttempt = (history, attemptId, coordinatorEpoch) => {
    const found = history.attempts.find(item => item.identity.attemptId === attemptId
      && item.identity.coordinatorEpoch === coordinatorEpoch);
    assert(found, 'Unknown publication attempt'); return found;
  };
  const key = value => JSON.stringify([value.coordinatorEpoch, value.attemptId, value.sequence]);
  return Object.freeze({
    async claimWriter(expectedEpoch) {
      assert(expectedEpoch === null || epoch(expectedEpoch), 'Invalid previous writer epoch');
      return write(history => {
        permission('writer');
        if (history.writerEpoch === writerEpoch) return { writerEpoch, head: history.head };
        assert(history.writerEpoch === expectedEpoch, 'Writer takeover raced another writer');
        for (const attempt of history.attempts) if (attempt.status === 'live') attempt.status = 'interrupted';
        history.writerEpoch = writerEpoch;
        return { writerEpoch, head: history.head };
      });
    },
    async admitAttempt({ identity, generationPolicy, executionIdentity, vocabSize, deadlineAt }) {
      const attempt = doppler.validateResidentAttemptIdentity(identity);
      const generation = doppler.canonicalGenerationIdentity(generationPolicy, executionIdentity, vocabSize);
      assert(attempt.publisherEpoch === writerEpoch && attempt.generationId === generation.generationId,
        'Attempt generation or publisher binding mismatch');
      assert(Number.isSafeInteger(deadlineAt) && deadlineAt > now(), 'Finite future attempt deadline required');
      const binding = { identity: attempt, generationPolicy: generation.policy, executionIdentity, vocabSize, deadlineAt };
      const digest = doppler.metadataDigest('reploid.publication-admission/v1', binding);
      return write(history => {
        writer(history); permission('admit', attempt);
        const prior = history.attempts.find(item => item.identity.attemptId === attempt.attemptId
          && item.identity.coordinatorEpoch === attempt.coordinatorEpoch);
        if (prior) { assert(prior.digest === digest, 'Attempt admission collision'); return copy(prior); }
        assert(history.attempts.length < limits.maxAttempts && history.records.length < limits.maxPublications,
          'Publication history is full; admission must drain');
        assert(!history.attempts.some(item => item.status === 'live'), 'Conversation already has a live publication attempt');
        const admitted = { ...binding, digest, status: 'live', nextSequence: 0, cursor: null };
        history.attempts.push(admitted); return copy(admitted);
      });
    },
    async publish(input) {
      assert(!fenced, 'Publication storage is fenced; reconcile its durable head');
      // Bound and fingerprint before copying the message or authenticating it.
      const { publicationDigest, ...body } = input;
      assert(publicationDigest === doppler.metadataDigest(body.schema, body), 'Publication fingerprint mismatch');
      const publication = copy(input);
      const saved = historyFor(await store.read(conversationId));
      writer(saved);
      const admitted = findAttempt(saved, publication.attemptId, publication.coordinatorEpoch);
      permission('publish', admitted.identity);
      const prior = saved.records.find(record => key(record.publication) === key(publication));
      if (prior) assert(prior.publication.publicationDigest === publicationDigest, 'Publication key collision');
      else doppler.validateExecutionPublication(publication, admitted.identity,
        admitted.generationPolicy, admitted.vocabSize, admitted.cursor);
      // Transport signatures keep their existing canonicalization. The immutable
      // authentication digest locates evidence owned by that authenticated port.
      for (const ack of publication.acknowledgments) {
        const stage = admitted.identity.stages.find(item => item.stageId === ack.stageId);
        assert(await authenticateCommit(copy(ack), copy(stage), copy(admitted.identity)) === true,
          'Unauthenticated stage commit');
      }
      return write(history => {
        writer(history);
        const current = findAttempt(history, publication.attemptId, publication.coordinatorEpoch);
        permission('publish', current.identity);
        const duplicate = history.records.find(record => key(record.publication) === key(publication));
        if (duplicate) {
          assert(duplicate.publication.publicationDigest === publicationDigest, 'Publication key collision');
          return copy(duplicate.receipt);
        }
        assert(current.status === 'live' && now() <= current.deadlineAt, 'Publication attempt is cancelled, retired or expired');
        assert(publication.sequence === current.nextSequence && publication.previousPublicationDigest === history.head,
          'Publication sequence or durable head mismatch');
        const validated = doppler.validateExecutionPublication(publication, current.identity,
          current.generationPolicy, current.vocabSize, current.cursor);
        assert(history.records.length < limits.maxPublications, 'Publication history is full');
        const receipt = { schema: 'reploid.publication-receipt/v1', conversationId, writerEpoch,
          index: history.records.length, coordinatorEpoch: publication.coordinatorEpoch, attemptId: publication.attemptId,
          sequence: publication.sequence, publicationDigest };
        receipt.receiptDigest = doppler.metadataDigest(receipt.schema, receipt);
        history.records.push({ publication: validated, receipt });
        history.head = publicationDigest;
        current.cursor = validated.successor; current.nextSequence++;
        if (validated.successor.terminal) current.status = 'completed';
        return copy(receipt);
      });
    },
    async cancel(attemptId, coordinatorEpoch) {
      return write(history => {
        writer(history);
        const attempt = findAttempt(history, attemptId, coordinatorEpoch);
        permission('cancel', attempt.identity);
        if (attempt.status === 'live') attempt.status = 'cancelled';
        return { status: attempt.status, head: history.head };
      });
    },
    async reconcile() {
      permission('read');
      const history = historyFor(await store.read(conversationId));
      permission('read'); writer(history);
      fenced = false;
      return copy(history);
    },
    async readPublished(afterIndex) {
      assert(!fenced, 'Publication storage is fenced; reconcile its durable head');
      assert(Number.isSafeInteger(afterIndex) && afterIndex >= -1, 'Invalid delivery cursor');
      const history = historyFor(await store.read(conversationId));
      const records = history.records.filter(item => item.receipt.index > afterIndex);
      for (const record of records) permission('replay', findAttempt(history,
        record.publication.attemptId, record.publication.coordinatorEpoch).identity);
      return copy(records);
    },
  });
}
