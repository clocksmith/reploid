/** Durable conversation publication. Doppler validates canonical model/cursor
 * contracts; ordinary ordered routes publish their final-stage steps through the
 * same transaction owner. The host authenticates commits and supplies a
 * genuinely transactional store. */
import defaults from './publication-policy.json' with { type: 'json' };
import { ORDERED_PUBLICATION_ATTEMPT_SCHEMA, ORDERED_PUBLICATION_SCHEMA, validateOrderedPublicationAttempt,
  validateOrderedGenerationBounds, validateOrderedPublication } from '../mesh/partitions/partition-ordered-publication.js';

const reject = message => { throw Object.assign(new Error(message), { code: 'PUBLICATION_REJECTED' }); };
const assert = (ok, message) => { if (!ok) reject(message); };
const copy = value => structuredClone(value);
const epoch = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const initial = () => ({ schema: 'reploid.publication-history/v1', writerEpoch: null, head: null, attempts: [], records: [] });

export function createConversationPublication({ conversationId, writerEpoch, store, doppler,
  authenticateCommit, authorize, requireCommitEvidence = false, policy = defaults, now = Date.now }) {
  assert(typeof conversationId === 'string' && conversationId && conversationId.length <= 256 && epoch(writerEpoch), 'Invalid publication owner identity');
  assert(store?.schema === 'reploid.transactional-chat-store/v1' && typeof store.transact === 'function'
    && typeof store.read === 'function', 'Transactional history adapter required');
  assert(typeof doppler?.metadataDigest === 'function', 'Publication digest contract required: metadataDigest');
  // Canonical decoding is one record contract, not a precondition of the writer.
  const canonicalContract = () => {
    for (const method of ['validateResidentAttemptIdentity', 'canonicalGenerationIdentity',
      'validateExecutionPublication', 'validateAdmissionPublication']) {
      assert(typeof doppler[method] === 'function', `Canonical Doppler contract required: ${method}`);
    }
  };
  const orderedAttempt = identity => identity?.schema === ORDERED_PUBLICATION_ATTEMPT_SCHEMA;
  assert(typeof authenticateCommit === 'function' && typeof authorize === 'function', 'Current authorization and authenticated commit ports required');
  assert(typeof requireCommitEvidence === 'boolean', 'Invalid commit evidence policy');
  const limits = copy(policy);
  assert(Object.keys(limits).length === 2 && ['maxAttempts', 'maxPublications'].every(key =>
    Number.isSafeInteger(limits[key]) && limits[key] > 0), 'Invalid publication retention bounds');
  let fenced = false;
  const read = async () => {
    try { return await store.read(conversationId); }
    catch (error) { fenced = true; throw error; }
  };
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
  const admissionOnly = value => value.schema === 'doppler.admission-publication/v1';
  const validatePublication = (value, attempt) => {
    if (orderedAttempt(attempt.identity)) {
      assert(value?.schema === ORDERED_PUBLICATION_SCHEMA, 'Publication kind differs from its admitted attempt');
      return validateOrderedPublication(value, attempt.identity, attempt.generationPolicy, attempt.vocabSize,
        attempt.cursor, doppler.metadataDigest);
    }
    assert(value?.schema !== ORDERED_PUBLICATION_SCHEMA, 'Publication kind differs from its admitted attempt');
    canonicalContract();
    if (admissionOnly(value)) {
      assert(attempt.cursor === null && attempt.nextSequence === 0, 'Admission-only publication cannot follow execution');
      return doppler.validateAdmissionPublication(value, attempt.identity, attempt.generationPolicy, attempt.vocabSize);
    }
    return doppler.validateExecutionPublication(value, attempt.identity,
      attempt.generationPolicy, attempt.vocabSize, attempt.cursor);
  };
  const evidenceRequired = attempt => requireCommitEvidence || attempt.requireCommitEvidence === true;
  const fingerprint = publication => {
    const { publicationDigest, ...body } = publication;
    assert(publicationDigest === doppler.metadataDigest(body.schema, body), 'Publication fingerprint mismatch');
  };
  const boundEvidence = (publication, attempt, supplied) => {
    const acknowledgments = admissionOnly(publication) ? [] : publication.acknowledgments;
    if (supplied === undefined && !evidenceRequired(attempt)) return undefined;
    const evidence = supplied ?? (admissionOnly(publication) ? [] : undefined);
    assert(Array.isArray(evidence) && evidence.length === acknowledgments.length, 'Exact stage evidence required');
    doppler.metadataDigest('reploid.publication-evidence/v1', evidence);
    const remaining = [...evidence];
    const ordered = acknowledgments.map(ack => {
      const index = remaining.findIndex(item => item?.schema === 'reploid.partition-stage-evidence/v1'
        && doppler.metadataDigest(item.schema, item) === ack.authenticationDigest);
      assert(index >= 0, 'Stage evidence does not match acknowledgment');
      return remaining.splice(index, 1)[0];
    });
    return copy(ordered);
  };
  const authenticate = async (publication, attempt, evidence) => {
    for (const [index, ack] of (admissionOnly(publication) ? [] : publication.acknowledgments).entries()) {
      const stage = attempt.identity.stages.find(item => item.stageId === ack.stageId);
      assert(await authenticateCommit(copy(ack), copy(stage), copy(attempt.identity), copy(evidence?.[index])) === true,
        'Unauthenticated stage commit');
    }
  };
  const checkRetained = async (history, records) => {
    for (const record of records) {
      const publication = record.publication;
      const attempt = findAttempt(history, publication.attemptId, publication.coordinatorEpoch);
      permission('replay', attempt.identity);
      if (!evidenceRequired(attempt) && record.evidence === undefined && record.evidenceDigest === undefined) continue;
      fingerprint(publication);
      assert(Array.isArray(record.evidence), 'Missing retained stage evidence');
      const evidence = boundEvidence(publication, attempt, record.evidence);
      assert(record.evidenceDigest === doppler.metadataDigest('reploid.publication-evidence/v1', evidence),
        'Retained stage evidence fingerprint mismatch');
      const prior = history.records.find(item => item.publication.attemptId === publication.attemptId
        && item.publication.coordinatorEpoch === publication.coordinatorEpoch
        && item.publication.sequence === publication.sequence - 1);
      validatePublication(publication, { ...attempt, cursor: prior?.publication.successor ?? null, nextSequence: publication.sequence });
      const { receiptDigest, ...receipt } = record.receipt;
      assert(receiptDigest === doppler.metadataDigest(receipt.schema, receipt)
        && receipt.publicationDigest === publication.publicationDigest && receipt.conversationId === conversationId
        && receipt.writerEpoch === attempt.identity.publisherEpoch && receipt.coordinatorEpoch === publication.coordinatorEpoch
        && receipt.attemptId === publication.attemptId && receipt.sequence === publication.sequence,
      'Retained publication receipt mismatch');
      await authenticate(publication, attempt, evidence);
      permission('replay', attempt.identity);
    }
  };
  return Object.freeze({
    requiresCommitEvidence: requireCommitEvidence,
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
      let attempt, admittedPolicy;
      if (orderedAttempt(identity)) {
        attempt = validateOrderedPublicationAttempt(identity);
        admittedPolicy = validateOrderedGenerationBounds(generationPolicy);
        assert(attempt.publisherEpoch === writerEpoch && executionIdentity === attempt.generationDigest
          && Number.isSafeInteger(vocabSize) && vocabSize > 0, 'Attempt generation or publisher binding mismatch');
      } else {
        canonicalContract();
        attempt = doppler.validateResidentAttemptIdentity(identity);
        const generation = doppler.canonicalGenerationIdentity(generationPolicy, executionIdentity, vocabSize);
        assert(attempt.publisherEpoch === writerEpoch && attempt.generationId === generation.generationId,
          'Attempt generation or publisher binding mismatch');
        admittedPolicy = generation.policy;
      }
      assert(Number.isSafeInteger(deadlineAt) && deadlineAt > now(), 'Finite future attempt deadline required');
      const binding = { identity: attempt, generationPolicy: admittedPolicy, executionIdentity, vocabSize, deadlineAt,
        ...(requireCommitEvidence ? { requireCommitEvidence: true } : {}) };
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
    async publish(input, { evidence: suppliedEvidence } = {}) {
      assert(!fenced, 'Publication storage is fenced; reconcile its durable head');
      // Bound and fingerprint before copying the message or authenticating it.
      doppler.metadataDigest('reploid.publication-input/v1', input);
      fingerprint(input);
      const publication = copy(input), publicationDigest = publication.publicationDigest;
      if (suppliedEvidence !== undefined) {
        assert(Array.isArray(suppliedEvidence), 'Stage evidence must be an array');
        doppler.metadataDigest('reploid.publication-evidence/v1', suppliedEvidence);
      }
      const evidenceSnapshot = copy(suppliedEvidence);
      const saved = historyFor(await read());
      writer(saved);
      const admitted = findAttempt(saved, publication.attemptId, publication.coordinatorEpoch);
      permission('publish', admitted.identity);
      const prior = saved.records.find(record => key(record.publication) === key(publication));
      if (prior) assert(prior.publication.publicationDigest === publicationDigest, 'Publication key collision');
      else validatePublication(publication, admitted);
      const evidence = boundEvidence(publication, admitted, evidenceSnapshot === undefined ? prior?.evidence : evidenceSnapshot);
      const evidenceDigest = evidence === undefined ? undefined : doppler.metadataDigest('reploid.publication-evidence/v1', evidence);
      if (prior) {
        assert(prior.evidenceDigest === evidenceDigest, 'Publication evidence collision');
        await checkRetained(saved, [prior]);
      }
      await authenticate(publication, admitted, evidence);
      return write(history => {
        writer(history);
        const current = findAttempt(history, publication.attemptId, publication.coordinatorEpoch);
        permission('publish', current.identity);
        const duplicate = history.records.find(record => key(record.publication) === key(publication));
        if (duplicate) {
          assert(duplicate.publication.publicationDigest === publicationDigest, 'Publication key collision');
          assert(duplicate.evidenceDigest === evidenceDigest, 'Publication evidence collision');
          return copy(duplicate.receipt);
        }
        assert(current.status === 'live' && now() <= current.deadlineAt, 'Publication attempt is cancelled, retired or expired');
        assert(publication.sequence === current.nextSequence && publication.previousPublicationDigest === history.head,
          'Publication sequence or durable head mismatch');
        const validated = validatePublication(publication, current);
        assert(history.records.length < limits.maxPublications, 'Publication history is full');
        const receipt = { schema: 'reploid.publication-receipt/v1', conversationId, writerEpoch,
          index: history.records.length, coordinatorEpoch: publication.coordinatorEpoch, attemptId: publication.attemptId,
          sequence: publication.sequence, publicationDigest };
        receipt.receiptDigest = doppler.metadataDigest(receipt.schema, receipt);
        history.records.push({ publication: validated, receipt,
          ...(evidence === undefined ? {} : { evidence, evidenceDigest }) });
        history.head = publicationDigest;
        current.nextSequence++;
        if (admissionOnly(validated)) current.status = 'completed';
        else {
          current.cursor = validated.successor;
          if (validated.successor.terminal) current.status = 'completed';
        }
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
      const history = historyFor(await read());
      permission('read'); writer(history);
      await checkRetained(history, history.records);
      permission('read');
      fenced = false;
      return copy(history);
    },
    async readPublished(afterIndex) {
      assert(!fenced, 'Publication storage is fenced; reconcile its durable head');
      assert(Number.isSafeInteger(afterIndex) && afterIndex >= -1, 'Invalid delivery cursor');
      permission('read');
      const history = historyFor(await read());
      permission('read');
      const records = history.records.filter(item => item.receipt.index > afterIndex);
      await checkRetained(history, records);
      permission('read');
      return copy(records);
    },
  });
}
