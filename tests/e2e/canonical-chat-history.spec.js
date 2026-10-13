import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.route('http://127.0.0.1:5199/**', async route => {
    const name = new URL(route.request().url()).pathname;
    if (name === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>History transactions</title>' });
    if (name.startsWith('/doppler/') && process.env.DOPPLER_SOURCE_ROOT) {
      return route.fulfill({ contentType: name.endsWith('.json') ? 'application/json' : 'text/javascript',
        body: await readFile(process.env.DOPPLER_SOURCE_ROOT + '/src/' + name.slice('/doppler/'.length)) });
    }
    if (!['/host/chat-history.js', '/core/verification-worker.js', '/core/vendor/acorn.js'].includes(name)
      && !name.startsWith('/vendor/reploid/')) return route.abort();
    return route.fulfill({ contentType: name.endsWith('.json') ? 'application/json' : 'text/javascript', body: await readFile('self' + name) });
  });
  await page.goto('http://127.0.0.1:5199/');
});

test('canonical publication races and unknown receipts reconcile through actual IndexedDB', async ({ page }) => {
  test.skip(!process.env.DOPPLER_SOURCE_ROOT, 'Explicit Doppler source checkout required; accepted package stays unchanged');
  const generationPolicy = JSON.parse(await readFile(process.env.DOPPLER_SOURCE_ROOT + '/tests/fixtures/canonical-generation-policy.json', 'utf8'));
  const result = await page.evaluate(async generationPolicy => {
    const [{ openChatHistory }, { createConversationPublication }, doppler] = await Promise.all([
      import('/host/chat-history.js'), import('/vendor/reploid/chat/workspace-publication.js'), import('/doppler/partitions.js'),
    ]);
    const options = { name: 'canonical-publication-' + crypto.randomUUID(), maxConversations: 1,
      maxConversationBytes: 1000000, openTimeoutMs: 1000 };
    const a = await openChatHistory(options), b = await openChatHistory(options);
    const hash = 'sha256:' + 'a'.repeat(64), other = 'sha256:' + 'b'.repeat(64), epoch = '0'.repeat(32);
    const generation = doppler.canonicalGenerationIdentity(generationPolicy, hash, 100);
    const stage = { stageId: hash, participantId: 'p', participantEpoch: epoch, deviceEpoch: epoch, residentId: 'r', partitionIndex: 0, executionId: hash };
    const identity = { schema: 'doppler.resident-attempt/v2', attemptId: 'cancel-first', requesterId: 'q', inputDigest: hash,
      authorizationScope: hash, routeId: hash, generationId: generation.generationId, coordinatorEpoch: epoch,
      publisherEpoch: epoch, routeKind: 'two-stage-layer', stages: [stage, { ...stage, stageId: other, partitionIndex: 1 }] };
    const makePublication = attempt => {
      const value = { schema: 'doppler.execution-publication/v2', attemptId: attempt.attemptId, coordinatorEpoch: epoch,
        attemptDigest: doppler.residentAttemptDigest(attempt), sequence: 0, expectedRevision: null, baseCursorId: null,
        previousPublicationDigest: null, acceptedTokenIds: [3], tokenRange: { start: 0, end: 1 },
        successor: doppler.bootstrapResidentCursor([1, 2], 3, generationPolicy, 100, generation.generationId),
        delta: { text: 'saved', outputDigest: hash }, stoppingOutcome: null };
      value.decisionId = doppler.residentPublicationDecisionDigest(value);
      value.acknowledgments = attempt.stages.map(item => ({ schema: 'doppler.stage-commit/v1', stageId: item.stageId,
        attemptDigest: value.attemptDigest, sequence: 0, baseCursorId: null, decisionId: value.decisionId,
        successorCursorId: value.successor.cursorId, participantEpoch: epoch, deviceEpoch: epoch,
        residentId: item.residentId, authenticationDigest: hash }));
      return { ...value, publicationDigest: doppler.metadataDigest(value.schema, value) };
    };
    const ownerOptions = { conversationId: 'thread', writerEpoch: epoch, doppler, authorize: () => true,
      authenticateCommit: async () => true, now: () => 10 };
    let release, entered;
    const hold = new Promise(resolve => { release = resolve; }), waiting = new Promise(resolve => { entered = resolve; });
    const publisher = createConversationPublication({ ...ownerOptions, store: a,
      authenticateCommit: async () => { entered(); await hold; return true; } });
    const canceller = createConversationPublication({ ...ownerOptions, store: b });
    await publisher.claimWriter(null);
    const admission = attempt => ({ identity: attempt, generationPolicy, executionIdentity: hash, vocabSize: 100, deadlineAt: 1000 });
    await publisher.admitAttempt(admission(identity));
    const publishing = publisher.publish(makePublication(identity)).then(() => 'wrong', error => error.message);
    await waiting; await canceller.cancel(identity.attemptId, epoch); release();
    const cancelled = await publishing;
    const visibleAfterCancel = (await publisher.readPublished(-1)).length;
    const next = { ...identity, attemptId: 'publish-first' };
    await publisher.admitAttempt(admission(next));
    const publication = makePublication(next);
    // Lose the response after the real transaction commits. Recovery must read
    // that same record; no model or sampler is called by reconciliation.
    const uncertain = createConversationPublication({ ...ownerOptions, store: { ...a,
      async transact(...args) { await a.transact(...args); throw Error('lost commit response'); } } });
    const unknown = await uncertain.publish(publication).then(() => 'wrong', error => error.message);
    const fenced = await uncertain.readPublished(-1).then(() => false, () => true);
    const reconciled = await uncertain.reconcile();
    const receipts = await Promise.all([publisher.publish(publication), canceller.publish(publication)]);
    await publisher.cancel(next.attemptId, epoch);
    await a.close(); await b.close();
    const reopened = await openChatHistory(options), history = await reopened.read('thread'); await reopened.close();
    return { cancelled, visibleAfterCancel, unknown, fenced, records: reconciled.records.length,
      receipts, durableRecords: history.records.length, text: history.records[0].publication.delta.text };
  }, generationPolicy);
  expect(result.cancelled).toContain('cancelled'); expect(result.visibleAfterCancel).toBe(0);
  expect(result.unknown).toBe('lost commit response'); expect(result.fenced).toBe(true);
  expect(result.records).toBe(1); expect(result.durableRecords).toBe(1); expect(result.text).toBe('saved');
  expect(result.receipts[0]).toEqual(result.receipts[1]);
});

test('two connections serialize atomic history updates, retain aborted heads and enforce admission', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const { openChatHistory } = await import('/host/chat-history.js');
    const options = { name: 'canonical-history-' + crypto.randomUUID(), maxConversations: 1, maxConversationBytes: 1000, openTimeoutMs: 1000 };
    const a = await openChatHistory(options), b = await openChatHistory(options);
    await a.transact('thread', () => ({ state: { count: 0, events: [] }, result: null }));
    const committed = await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? a : b).transact('thread', state => {
      state.count++; state.events.push(index);
      return { state, result: state.count };
    })));
    const before = await b.read('thread');
    let rejected = 0;
    for (const reducer of [
      state => { state.count = 100; throw Error('injected reducer failure'); },
      async state => ({ state: { count: 100 }, result: null }),
      state => ({ state: { content: 'x'.repeat(2000) }, result: null }),
    ]) {
      try { await a.transact('thread', reducer); } catch { rejected++; }
    }
    const after = await b.read('thread');
    try { await b.transact('extra', () => ({ state: {}, result: null })); } catch { rejected++; }
    const last = a.transact('thread', state => { state.count++; return { state, result: state.count }; });
    await a.close();
    const closedCommit = await last;
    await b.close();
    const restored = await openChatHistory(options), durable = await restored.read('thread');
    await restored.close();
    return { committed, before, after, rejected, closedCommit, durable };
  });
  expect(results.committed.sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  expect(results.before.count).toBe(12);
  expect(results.after).toEqual(results.before);
  expect(results.rejected).toBe(4);
  expect(results.closedCommit).toBe(13);
  expect(results.durable.count).toBe(13);
});

test('Verification Worker accepts the transactional adapter', async ({ page }) => {
  const snapshot = { '/host/chat-history.js': await readFile('self/host/chat-history.js', 'utf8'),
    '/vendor/reploid/adapters/browser.js': await readFile('packages/reploid/src/adapters/browser.js', 'utf8'),
    '/vendor/reploid/chat/workspace-publication.js': await readFile('packages/reploid/src/chat/workspace-publication.js', 'utf8') };
  const result = await page.evaluate(snapshot => new Promise((resolve, reject) => {
    const worker = new Worker('/core/verification-worker.js');
    const timer = setTimeout(() => { worker.terminate(); reject(Error('Verification timeout')); }, 10000);
    worker.onmessage = event => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
    worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(Error(event.message)); };
    worker.postMessage({ type: 'VERIFY', snapshot });
  }), snapshot);
  expect(result.errors).toEqual([]);
  expect(result.passed).toBe(true);
});

test('signed canonical evidence survives actual IndexedDB closure and rejects retained corruption', async ({ page }) => {
  test.skip(!process.env.DOPPLER_SOURCE_ROOT, 'Explicit source contract required; accepted pin unchanged');
  const policy = JSON.parse(await readFile(process.env.DOPPLER_SOURCE_ROOT + '/tests/fixtures/canonical-generation-policy.json', 'utf8'));
  const observed = await page.evaluate(async policy => {
    const [{ openChatHistory }, { createConversationPublication }, runtime, { createSigningIdentity },
      { createPartitionStageCommitAuthority, verifyPartitionStageCommit }, { createResidentTargetState },
      { createResidentOutputState }, { createBundledIncrementalDecoder }] = await Promise.all([
      import('/host/chat-history.js'), import('/vendor/reploid/chat/workspace-publication.js'), import('/doppler/partitions.js'),
      import('/vendor/reploid/artifacts/identity.js'), import('/vendor/reploid/mesh/partitions/partition-stage-commit.js'),
      import('/doppler/inference/resident-target-state.js'), import('/doppler/inference/resident-output-state.js'),
      import('/doppler/inference/tokenizers/bundled/incremental-decoder.js'),
    ]);
    const hash = 'sha256:' + 'a'.repeat(64), epoch = '0'.repeat(32);
    const keys = await Promise.all([0, 1].map(() => createSigningIdentity({ algorithm: 'ECDSA' })));
    const stages = keys.map((key, i) => ({ stageId: 'sha256:' + String(i).repeat(64), participantId: key.peerId,
      participantEpoch: epoch, deviceEpoch: epoch, residentId: 'r' + i, partitionIndex: i, executionId: hash }));
    const generation = runtime.canonicalGenerationIdentity(policy, hash, 100);
    const attempt = { schema: 'doppler.resident-attempt/v2', attemptId: 'a', requesterId: 'q',
      inputDigest: runtime.tokenDigest([1, 2], 100, 64), authorizationScope: hash, routeId: hash,
      generationId: generation.generationId, coordinatorEpoch: epoch, publisherEpoch: epoch, routeKind: 'two-stage-layer', stages };
    const decoder = () => createBundledIncrementalDecoder({ tokenForId: id => String(id), byteLevel: false,
      byteDecoder: new Map(), wordPiece: false, splitEveryCharacter: false, wordPiecePrefix: '##' });
    const target = createResidentTargetState([1, 2], policy, 100, generation.generationId,
      createResidentOutputState(decoder(), decoder(), policy, 100));
    const logits = new Float32Array(100).fill(-Infinity); logits[3] = 0;
    const transition = target.bootstrap(logits);
    const authorities = keys.map((identity, i) => createPartitionStageCommitAuthority({ runtime, identity, stage: stages[i] }));
    const commits = await Promise.all(authorities.map(a => a.sign({ attempt, sequence: 0, baseCursorId: null, transition })));
    const body = { schema: 'doppler.execution-publication/v2', attemptId: attempt.attemptId, coordinatorEpoch: epoch,
      attemptDigest: runtime.residentAttemptDigest(attempt), sequence: 0, expectedRevision: null, previousPublicationDigest: null,
      baseCursorId: null, decisionId: commits[0].acknowledgment.decisionId, acceptedTokenIds: transition.acceptedTokenIds,
      tokenRange: transition.tokenRange, successor: transition.successor, delta: { text: transition.delta, outputDigest: transition.outputDigest },
      stoppingOutcome: transition.successor.stopReason, acknowledgments: commits.map(c => c.acknowledgment) };
    const publication = { ...body, publicationDigest: runtime.metadataDigest(body.schema, body) };
    const options = { name: 'canonical-evidence-' + crypto.randomUUID(), maxConversations: 1,
      maxConversationBytes: 1000000, openTimeoutMs: 1000 };
    const ownerOptions = { conversationId: 'thread', writerEpoch: epoch, doppler: runtime, authorize: () => true,
      requireCommitEvidence: true, authenticateCommit: (acknowledgment, stage, attempt, evidence) =>
        verifyPartitionStageCommit({ runtime, acknowledgment, stage, attempt, evidence }) };
    let store = await openChatHistory(options);
    const first = createConversationPublication({ ...ownerOptions, store });
    await first.claimWriter(null); await first.admitAttempt({ identity: attempt, generationPolicy: policy,
      executionIdentity: hash, vocabSize: 100, deadlineAt: Date.now() + 60000 });
    const evidence = commits.map(c => c.evidence);
    const receipt = await first.publish(publication, { evidence });
    await store.close(); authorities.forEach(a => a.close()); keys.length = 0;
    store = await openChatHistory(options);
    const restarted = createConversationPublication({ ...ownerOptions, requireCommitEvidence: false, store });
    const duplicate = await restarted.publish(publication), [saved] = await restarted.readPublished(-1);
    await store.transact('thread', state => {
      state.records[0].evidence[0].signature = 'bad'; return { state, result: null };
    });
    const corruptionRejected = await restarted.readPublished(-1).then(() => false, () => true);
    await store.close();
    return { receipt, duplicate, savedEvidence: saved.evidence, evidence,
      text: saved.publication.delta.text, expectedText: transition.delta, corruptionRejected };
  }, policy);
  expect(observed.duplicate).toEqual(observed.receipt);
  expect(observed.savedEvidence).toEqual(observed.evidence);
  expect(observed.text).toBe(observed.expectedText);
  expect(observed.corruptionRejected).toBe(true);
});
