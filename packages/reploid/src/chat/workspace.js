/** Conversation state only. Execution, trust and transport are explicit host ports. */
import { partitionActivity } from '../mesh/partitions/partition-summary.js';
import { canonicalPartitionJson } from '../mesh/partitions/partition-contract.js';
import { ORDERED_PUBLICATION_ATTEMPT_SCHEMA } from '../mesh/partitions/partition-ordered-publication.js';
import defaults from './policy.json' with { type: 'json' };
import { disclosureRecipients, disclosureScope, matchingThreadGrant, validateThreadGrants } from './thread-grants.js';
import { remotePermissionCovers, remotePermissionNeed } from './remote-permission.js';
import { createRetrieval } from '../retrieval/retrieval.js';
import { interruptRetrievalRecord, retrievalFailureMessage } from '../retrieval/sources.js';

const copy = value => structuredClone(value);
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const activeStatuses = new Set(['queued', 'loading', 'executing', 'approval', 'cancelling']);
// Disclosures whose durable output the requester's transaction owner publishes.
const publishedDisclosures = new Set(['partition-activations-and-tokens', 'ordered-partition-activations-and-tokens']);
const DISCLOSURE_MISMATCH = 'Peer disclosure does not match the selected model and verified recipients';

// participantId owns history. requesterIdentity is the host-authenticated peer identity that execution
// binds into ordered requester disclosure; null until authenticated. Hosts whose participant is that peer keep the default.
// remotePermissions, when supplied, returns the host's stored remote contributor permissions
// (remote-permission.js); every remote disclosure then requires one that covers it.
// retrieval, when supplied, holds the host's search provider and optional passage extractor and support
// checker (retrieval/); a request opts in per send. Retrieved sources travel inside the request's messages,
// so the same disclosure authorization covers them, and nothing is dispatched when retrieval fails.
export function createChatWorkspace({ meshId, participantId, store, execute, requesterIdentity = () => participantId,
  remotePermissions = null, networkId = () => meshId, retrieval = null, policy = defaults, now = Date.now, id = () => crypto.randomUUID() }) {
  assert(typeof meshId === 'string' && meshId && typeof participantId === 'string' && participantId, 'Mesh and participant identities required');
  assert(typeof store?.load === 'function' && typeof store?.save === 'function' && typeof execute === 'function'
    && typeof requesterIdentity === 'function' && (remotePermissions === null || typeof remotePermissions === 'function')
    && typeof networkId === 'function' && (retrieval === null || typeof retrieval === 'object'), 'Workspace host ports required');
  const retriever = retrieval === null ? null : createRetrieval({ ...retrieval, now });
  const covering = need => need && (remotePermissions?.() || []).find(permission => remotePermissionCovers(permission, need)) || null;
  // The authorization cites the permission and names the verified route this attempt is dispatched to.
  const permitted = (scope, preview, permission) => ({ kind: 'permission', grantId: null, permissionId: permission.id,
    peerId: preview.peerId, ...copy(scope), source: 'permission', recipients: disclosureRecipients(scope, preview),
    expiresAt: preview.executionTimeoutMs === undefined ? preview.expiresAt : now() + preview.executionTimeoutMs });
  const requester = () => {
    const value = requesterIdentity();
    assert(value === null || typeof value === 'string' && value, 'Invalid requester identity');
    return value;
  };
  for (const name of ['maxThreads', 'maxThreadGrants', 'maxMessagesPerThread', 'maxMessageCharacters', 'maxResponseCharacters', 'maxConcurrentAttempts', 'attemptTimeoutMs']) {
    assert(Number.isSafeInteger(policy[name]) && policy[name] > 0, `Invalid ${name}`);
  }
  assert(policy.attemptTimeoutMs <= 2147483647, 'Attempt timeout exceeds timer range');
  const transactional = store.mode === 'transactional';
  if (transactional) assert(['assertCurrentWriter', 'publication', 'project'].every(name => typeof store[name] === 'function'),
    'Transactional workspace publication ports required');
  const pendingSaves = new Set();
  const limits = copy(policy);
  const validateSystemContext = value => {
    if (value == null) return null;
    assert(typeof value === 'object' && !Array.isArray(value)
      && typeof value.content === 'string' && value.content.length <= limits.maxMessageCharacters
      && value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata), 'Invalid system context');
    assert(JSON.stringify(value).length <= limits.maxMessageCharacters, 'System context exceeds conversation allowance');
    return copy(value);
  };
  let closed = false, selectedId = null, storageError = null;
  const listeners = new Set(), runs = new Map();
  const loaded = store.load();
  assert(!loaded || loaded.schema === 'reploid.chat-workspace/v1'
    && loaded.meshId === meshId && loaded.participantId === participantId && Array.isArray(loaded.threads), 'Stored workspace identity mismatch');
  const threads = copy(loaded?.threads || []);
  let durableThreads = copy(threads);
  assert(threads.length <= limits.maxThreads && new Set(threads.map(thread => thread.id)).size === threads.length, 'Invalid stored threads');
  const loadedRequester = threads.length ? requester() : null;
  for (const thread of threads) {
    assert(typeof thread.id === 'string' && Array.isArray(thread.messages) && Array.isArray(thread.attempts)
      && Array.isArray(thread.members) && thread.messages.length <= limits.maxMessagesPerThread, 'Invalid stored conversation');
    thread.grants ??= [];
    thread.systemContext = validateSystemContext(thread.systemContext);
    validateThreadGrants(thread.grants, thread.id, meshId, limits.maxThreadGrants, loadedRequester);
    for (const attempt of thread.attempts) if (activeStatuses.has(attempt.status)) {
      attempt.status = 'interrupted'; attempt.error = 'Connection interrupted. Retry starts a new attempt.';
      attempt.approval = null; attempt.finishedAt = now();
      if (attempt.retrieval) attempt.retrieval = interruptRetrievalRecord(attempt.retrieval, attempt.finishedAt);
      const message = thread.messages.find(item => item.id === attempt.responseId);
      if (message) message.status = 'interrupted';
    }
  }
  const snapshot = () => copy({ schema: 'reploid.chat-workspace/v1', meshId, participantId,
    selectedId, threads: transactional || storageError ? durableThreads : threads, runningIds: [...runs.keys()], storageError,
    ...(transactional ? { ephemeralExecutions: [...runs.keys()].flatMap(threadId => {
      const attempt = threads.find(thread => thread.id === threadId)?.attempts.at(-1);
      return attempt && activeStatuses.has(attempt.status) ? [{ threadId, attemptId: attempt.id, status: attempt.status,
        approval: attempt.approval, execution: attempt.execution }] : [];
    }) } : {}),
    limits: { maxThreads: limits.maxThreads, maxMessageCharacters: limits.maxMessageCharacters } });
  const notify = () => { for (const listener of listeners) {
    try { listener(snapshot()); } catch (error) { console.error('[ChatWorkspace] listener failed', error); }
  } };
  const persist = () => {
    assert(!storageError, `History storage failed: ${storageError}`);
    try {
      const saved = copy({ schema: 'reploid.chat-workspace/v1', meshId, participantId, threads });
      const result = store.save(saved);
      if (transactional) {
        const operation = Promise.resolve(result).then(() => {
          durableThreads = copy(saved.threads); notify();
        }, error => {
          storageError = String(error.message || error);
          for (const run of runs.values()) run.controller.abort(error);
          notify(); throw error;
        });
        pendingSaves.add(operation);
        operation.then(() => pendingSaves.delete(operation), () => pendingSaves.delete(operation));
        return operation;
      }
      if (result && typeof result.then === 'function') {
        Promise.resolve(result).catch(() => {});
        throw new Error('Legacy history store must complete synchronously');
      }
      durableThreads = copy(saved.threads);
    } catch (error) {
      storageError = String(error.message || error);
      // Unknown storage outcomes fence every writer until the host reloads and
      // reconciles storage. Cancellation retains execution ownership until its
      // normal settlement; it cannot make the failed candidate visible.
      for (const run of runs.values()) run.controller.abort(error);
      throw error;
    }
    finally { if (!transactional || storageError) notify(); }
  };
  const current = () => { assert(!closed, 'Workspace is closed'); assert(!storageError, `History storage failed: ${storageError}`); };
  const find = threadId => { const thread = threads.find(item => item.id === threadId); assert(thread, 'Conversation not found'); return thread; };
  const text = value => {
    assert(typeof value === 'string' && value.trim() && value.length <= limits.maxMessageCharacters, 'Message is empty or exceeds the conversation limit');
    return value;
  };
  const modelIdentity = value => {
    assert(value && typeof value.id === 'string' && value.id && typeof value.name === 'string'
      && /^sha256:[a-f0-9]{64}$/.test(value.identity), 'Select an identified model');
    assert(value.adapters === undefined || Array.isArray(value.adapters)
      && value.adapters.every(adapter => /^sha256:[a-f0-9]{64}$/.test(adapter.identity)), 'Select identified adapters');
    return copy(value);
  };
  const start = (thread, request, userMessageId, retryOf = null, select = true, authorizeDisclosure = null) => {
    current();
    assert(authorizeDisclosure === null || typeof authorizeDisclosure === 'function', 'Invalid disclosure authorization port');
    assert(!runs.has(thread.id), 'This conversation already has an active response');
    assert(runs.size < limits.maxConcurrentAttempts, 'Concurrent conversation limit reached');
    assert(thread.messages.length < limits.maxMessagesPerThread, 'Conversation history limit reached');
    assert(!request.retrieval || retriever, 'Retrieval is not configured');
    const controller = new AbortController();
    // publicationMode 'canonical' is the persisted marker for requester-published output, from either
    // canonical two-stage or ordinary ordered records; it does not mean canonical decoding. Saved
    // histories already hold this value, so it is kept rather than renamed.
    const attempt = { id: id(), threadId: thread.id, userMessageId, responseId: id(), retryOf,
      status: 'queued', createdAt: now(), finishedAt: null, error: null, approval: null,
      execution: null, authorization: null, ...(transactional ? { publicationMode: 'canonical' } : {}), request: copy(request),
      systemContext: copy(retryOf ? thread.attempts.find(item => item.id === retryOf)?.systemContext ?? null : thread.systemContext),
      // Each attempt retrieves afresh; a retry never reuses another attempt's sources.
      ...(request.retrieval ? { retrieval: retriever.pending(request.retrieval, now()) } : {}) };
    const response = { id: attempt.responseId, attemptId: attempt.id, role: 'assistant', content: '', status: 'queued' };
    thread.attempts.push(attempt); thread.messages.push(response);
    const run = { controller, approval: null, completion: null, nextSequence: 0 };
    runs.set(thread.id, run);
    if (select) selectedId = thread.id;
    let admitted;
    try { admitted = persist(); }
    catch (error) { runs.delete(thread.id); thread.attempts.pop(); thread.messages.pop(); throw error; }
    const matches = envelope => envelope?.threadId === thread.id && envelope?.attemptId === attempt.id;
    const live = () => !controller.signal.aborted && runs.get(thread.id) === run;
    const startTimer = () => setTimeout(() => controller.abort(new Error('Response timed out. Retry starts a new attempt.')), limits.attemptTimeoutMs);
    let timer = startTimer();
    const aborted = () => {
      attempt.status = 'cancelling'; response.status = 'cancelling'; attempt.approval = null;
      run.approval?.(false); run.approval = null; notify();
    };
    controller.signal.addEventListener('abort', aborted, { once: true });
    run.completion = (async () => {
      let publication = null, dispatched = request;
      try {
        if (transactional) await admitted;
        controller.signal.throwIfAborted();
        if (request.retrieval) {
          // Provenance is durable before any source text can be disclosed; failure dispatches nothing.
          attempt.retrieval = await retriever.retrieve(attempt.retrieval, controller.signal);
          await persist(); controller.signal.throwIfAborted();
          assert(attempt.retrieval.outcome === 'retrieved', retrievalFailureMessage(attempt.retrieval));
          dispatched = await retriever.dispatch(request, attempt.retrieval);
        }
        if (transactional) await store.assertCurrentWriter();
        publication = transactional ? await store.publication(thread.id) : undefined;
        const result = await execute(copy({ ...dispatched, threadId: thread.id, attemptId: attempt.id,
          meshId, participantId }), {
          signal: controller.signal,
          authorizationExpiresAt: () => live() ? attempt.authorization?.expiresAt ?? null : null,
          ...(transactional ? { publication, publisherEpoch: store.writerEpoch,
            async onPublished(record) {
              controller.signal.throwIfAborted();
              const projection = await store.project(thread.id, attempt.id, record);
              controller.signal.throwIfAborted();
              assert(live() && matches(projection), 'Publication projection is no longer current');
              assert(projection.content.length <= limits.maxResponseCharacters, 'Published response exceeds conversation limit');
              response.content = projection.content; response.publicationDigests = copy(projection.publicationDigests);
              response.status = 'streaming'; attempt.status = 'executing';
              run.publicationTerminal = projection.terminal;
              await persist(); controller.signal.throwIfAborted();
            } } : {}),
          onDelta(envelope) {
            if (!live() || !matches(envelope)) return;
            assert(!transactional, 'Canonical response requires its saved publication');
            assert(Number.isSafeInteger(envelope.sequence) && envelope.sequence >= 0, 'Invalid response sequence');
            if (envelope.sequence < run.nextSequence) return;
            assert(envelope.sequence === run.nextSequence, 'Response stream has a gap');
            assert(typeof envelope.text === 'string', 'Invalid response delta');
            assert(response.content.length + envelope.text.length <= limits.maxResponseCharacters, 'Response exceeds the conversation limit');
            run.nextSequence++;
            response.content += envelope.text; response.status = 'streaming'; attempt.status = 'executing'; persist();
          },
          onActivity(envelope) {
            // Ephemeral execution metadata only; never persisted and never output text.
            assert(live() && matches(envelope) && attempt.status === 'executing', 'Late or unbound execution activity');
            const activity = partitionActivity(envelope, attempt.execution?.identity, run.activity, true);
            run.activity = activity;
            attempt.execution = { ...attempt.execution, stepSummary: copy(activity.stepSummary) };
            notify();
          },
          onState(envelope) {
            if (!live() || !matches(envelope)) return;
            assert(['queued', 'loading', 'executing'].includes(envelope.status), 'Invalid execution state');
            attempt.status = envelope.status; attempt.execution = copy(envelope.execution || null); notify();
          },
          async requestApproval(preview) {
            controller.signal.throwIfAborted();
            assert(matches(preview) && typeof preview.id === 'string' && preview.id
              && typeof preview.peerId === 'string' && preview.peerId && Number.isFinite(preview.expiresAt)
              && preview.expiresAt > now(), 'Invalid conversation disclosure');
            assert(preview.executionTimeoutMs === undefined || Number.isSafeInteger(preview.executionTimeoutMs)
              && preview.executionTimeoutMs > 0 && preview.executionTimeoutMs <= limits.attemptTimeoutMs,
            'Invalid execution authorization window');
            assert(!run.approval, 'An approval is already pending');
            const scope = disclosureScope(request, preview, requester()), grant = matchingThreadGrant(thread.grants, scope);
            if (transactional) assert(publishedDisclosures.has(scope?.disclosure), 'Canonical disclosure requires exact verified partition recipients');
            if (attempt.authorization?.kind === 'permission') {
              assert(scope && attempt.authorization.peerId === preview.peerId && Object.keys(scope).every(key =>
                JSON.stringify(attempt.authorization[key]) === JSON.stringify(scope[key])),
              'Execution recipients changed. Retry starts a new authorized attempt.');
              return live() && attempt.authorization.expiresAt > now();
            }
            if (authorizeDisclosure) {
              assert(scope, 'Peer disclosure does not match the selected model and verified recipients');
              if (attempt.authorization?.source === 'send') {
                assert(attempt.authorization.peerId === preview.peerId && Object.keys(scope).every(key =>
                  JSON.stringify(attempt.authorization[key]) === JSON.stringify(scope[key])),
                'Execution recipients changed. Retry starts a new authorized attempt.');
                return live() && attempt.authorization.expiresAt > now();
              }
              // The host authorizes exactly what is sent, including any retrieved sources.
              const accepted = authorizeDisclosure({ request: copy({ ...dispatched, threadId: thread.id, attemptId: attempt.id,
                ...(attempt.retrieval ? { retrieval: attempt.retrieval } : {}) }), preview: copy(preview) });
              if (accepted !== true || !live() || preview.expiresAt <= now()) return false;
              attempt.authorization = { kind: 'once', grantId: null, peerId: preview.peerId,
                ...copy(scope), source: 'send', expiresAt: preview.expiresAt };
              await persist(); controller.signal.throwIfAborted();
              return true;
            }
            if (grant) {
              attempt.authorization = { kind: 'thread-grant', grantId: grant.id, peerId: preview.peerId, ...copy(scope) };
              await persist(); controller.signal.throwIfAborted();
              return true;
            }
            // Unverified partition recipients are never offered; with a permission port, no unverified recipient is.
            assert(scope || !request.model.partition && !remotePermissions, DISCLOSURE_MISMATCH);
            const need = remotePermissions ? remotePermissionNeed({ networkId: networkId(), sharingScope: request.permissions.sharingScope,
              disclosure: scope.disclosure, model: request.model }) : null, permission = covering(need);
            if (permission) {
              attempt.authorization = permitted(scope, preview, permission);
              await persist(); controller.signal.throwIfAborted();
              return live() && preview.expiresAt > now();
            }
            // Outside every stored permission: nothing is sent until one covers it (resumePermitted) or it is declined.
            attempt.status = 'approval';
            attempt.approval = { ...copy(preview), reusable: !!scope, ...(need ? { permissionNeed: need } : {}) };
            clearTimeout(timer);
            return new Promise(resolve => {
              const expiry = setTimeout(() => finish(false), Math.min(limits.attemptTimeoutMs, preview.expiresAt - now()));
              const finish = accepted => {
                clearTimeout(expiry); run.approval = null; attempt.approval = null;
                if (live()) timer = startTimer();
                if (live()) attempt.status = 'queued'; notify(); resolve(accepted);
              };
              run.approval = finish; notify();
            });
          }
        });
        controller.signal.throwIfAborted();
        assert(matches(result) && result.modelId === request.model.id
          && result.modelIdentity === request.model.identity
          && JSON.stringify(result.adapterIdentities) === JSON.stringify((request.model.adapters || []).map(adapter => adapter.identity)), 'Response identity mismatch');
        assert(typeof result.content === 'string'
          && result.content.length <= limits.maxResponseCharacters, 'Invalid completed response');
        assert(transactional ? run.publicationTerminal === true && result.content === response.content
          : !response.content || result.content === response.content, 'Completed response differs from its stream');
        if (transactional) await store.assertCurrentWriter();
        response.content = result.content;
        attempt.execution = copy(result.execution || attempt.execution);
        assert(!['max-tokens', 'length', 'context-limit'].includes(attempt.execution?.stopReason),
          'The answer reached its generation limit and is incomplete. Its partial text is preserved; retry starts a new attempt.');
        assert(transactional || result.content.trim(), 'Invalid completed response');
        // Mechanical citation evidence for the finished answer. A stop during checking leaves the rest unverified.
        if (attempt.retrieval) attempt.retrieval = { ...attempt.retrieval,
          verification: await retriever.verify(result.content, attempt.retrieval, controller.signal) };
        response.status = 'completed'; attempt.status = 'completed';
      } catch (error) {
        let cancelled = controller.signal.aborted;
        if (transactional && cancelled && publication) {
          try {
            const saved = await publication.reconcile();
            const durableAttempt = saved.attempts.find(item => item.identity.attemptId === attempt.id);
            cancelled = !durableAttempt || durableAttempt.status === 'cancelled';
            // A commit can race cancellation before its projection: settle the
            // live view to exactly the verified durable records of this attempt.
            const records = saved.records.filter(record => record.publication.attemptId === attempt.id);
            const content = records.map(record => record.publication.delta?.text ?? '').join('');
            if (content.length <= limits.maxResponseCharacters) {
              response.content = content; response.publicationDigests = records.map(record => record.publication.publicationDigest);
            }
          } catch { cancelled = false; } // Unknown storage is not confirmed cancellation.
        }
        attempt.status = cancelled ? 'cancelled' : 'failed';
        attempt.error = String((controller.signal.reason || error)?.message || error);
        response.status = attempt.status;
      } finally {
        clearTimeout(timer); controller.signal.removeEventListener('abort', aborted);
        run.approval?.(false); attempt.approval = null; attempt.finishedAt = now();
        runs.delete(thread.id); await persist();
      }
      return copy(attempt);
    })();
    if (transactional) Object.defineProperty(run.completion, 'admitted', { value: admitted, enumerable: false });
    return run.completion;
  };
  if (loaded) { const initialSave = persist(); initialSave?.catch(() => {}); }
  return Object.freeze({
    getState: snapshot,
    authorizePublication({ conversationId, writerEpoch, action, attempt: identity }) {
      if (!transactional || writerEpoch !== store.writerEpoch || !['admit', 'publish', 'cancel'].includes(action)
        || !identity || identity.publisherEpoch !== writerEpoch
        || identity.schema !== ORDERED_PUBLICATION_ATTEMPT_SCHEMA && identity.requesterId !== participantId) return false;
      const thread = threads.find(item => item.id === conversationId), attempt = thread?.attempts.find(item => item.id === identity.attemptId);
      if (!attempt || attempt.publicationMode !== 'canonical') return false;
      // Stopping an admitted attempt remains permitted after disclosure expires.
      if (action === 'cancel') return !storageError;
      const run = runs.get(conversationId);
      if (closed || storageError || !run || run.controller.signal.aborted || thread.attempts.at(-1) !== attempt) return false;
      const saved = durableThreads.find(item => item.id === conversationId)?.attempts.find(item => item.id === attempt.id);
      const auth = saved?.authorization;
      if (!auth || auth.modelIdentity !== attempt.request.model.identity) return false;
      if (identity.schema === ORDERED_PUBLICATION_ATTEMPT_SCHEMA) {
        // Ordered recipients are the complete approved route, bound to the
        // authenticated requester identity saved with the authorization.
        try {
          if (auth.disclosure !== 'ordered-partition-activations-and-tokens' || identity.threadId !== conversationId
            || identity.requesterId !== auth.requesterIdentity
            || canonicalPartitionJson(identity.route) !== canonicalPartitionJson(auth.route)) return false;
        } catch { return false; }
      } else if (auth.disclosure !== 'partition-activations-and-tokens' || identity.stages?.[0]?.participantId !== auth.participantA
        || identity.stages?.[1]?.participantId !== auth.recipientIdentity) return false;
      if (auth.kind === 'thread-grant') return thread.grants.some(grant => grant.id === auth.grantId && grant.revokedAt === null);
      // Revoking a permission stops new disclosures only; an admitted answer continues until stopped.
      return ['once', 'permission'].includes(auth.kind) && auth.expiresAt > now();
    },
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    createThread({ model, purpose = '', members = [], permissions = {}, systemContext = null }) {
      current(); assert(threads.length < limits.maxThreads, 'Conversation limit reached');
      assert(typeof purpose === 'string' && purpose.length <= limits.maxMessageCharacters, 'Invalid conversation purpose');
      assert(Array.isArray(members) && members.every(member => typeof member === 'string' && member), 'Invalid conversation members');
      const thread = { id: id(), model: modelIdentity(model), purpose, systemContext: validateSystemContext(systemContext), members: [...new Set([participantId, ...members])],
        permissions: copy(permissions), grants: [], messages: [], attempts: [], closed: false, createdAt: now() };
      threads.push(thread); selectedId = thread.id; const saved = persist();
      return transactional ? saved.then(() => thread.id) : thread.id;
    },
    select(threadId) { current(); if (threadId !== null) find(threadId); selectedId = threadId; notify(); },
    setSystemContext(threadId, value) {
      current(); const thread = find(threadId);
      assert(!thread.closed && !runs.has(threadId), 'Change context only in an open idle conversation');
      const previous = thread.systemContext;
      thread.systemContext = validateSystemContext(value);
      try { return persist(); } catch (error) { thread.systemContext = previous; notify(); throw error; }
    },
    renameThread(threadId, title) { current(); assert(typeof title === 'string' && title.trim() && title.length <= limits.maxMessageCharacters, 'Invalid conversation title'); find(threadId).title = title.trim(); return persist(); },
    closeThread(threadId) { current(); find(threadId).closed = true; if (selectedId === threadId) selectedId = null; return persist(); },
    reopenThread(threadId) { current(); find(threadId).closed = false; selectedId = threadId; return persist(); },
    /** `retrieval` opts this request into search-backed answering: `{ query?, limits? }`, the query defaulting to the message. */
    send(threadId, content, { select = true, authorizeDisclosure = null, retrieval = null } = {}) {
      current(); const thread = find(threadId);
      assert(!thread.closed && !runs.has(threadId), 'Open an idle conversation before sending');
      assert(runs.size < limits.maxConcurrentAttempts && thread.messages.length + 2 <= limits.maxMessagesPerThread, 'Conversation allowance reached');
      assert(retrieval === null || retriever, 'Retrieval is not configured');
      const searched = retrieval === null ? null : retriever.request(retrieval, text(content));
      const message = { id: id(), role: 'user', content: text(content), status: 'completed' };
      thread.messages.push(message);
      const completedUsers = new Set(thread.attempts.filter(attempt => attempt.status === 'completed').map(attempt => attempt.userMessageId));
      const messages = thread.messages.filter(item => item.status === 'completed'
        && (item.role === 'assistant' || completedUsers.has(item.id) || item.id === message.id))
        .map(({ role, content }) => ({ role, content }));
      const system = [thread.systemContext?.content, thread.purpose].filter(Boolean).join('\n\n');
      if (system) messages.unshift({ role: 'system', content: system });
      try { return start(thread, { model: thread.model, permissions: thread.permissions, members: thread.members, messages,
        ...(searched ? { retrieval: searched } : {}) }, message.id, null, select, authorizeDisclosure); }
      catch (error) { thread.messages.pop(); throw error; }
    },
    retry(threadId, attemptId, { authorizeDisclosure = null } = {}) {
      current(); const thread = find(threadId), attempt = thread.attempts.at(-1);
      assert(!thread.closed && attempt?.id === attemptId && ['cancelled', 'failed', 'interrupted'].includes(attempt.status), 'Only the latest interrupted or unsuccessful response can be retried');
      return start(thread, attempt.request, attempt.userMessageId, attempt.id, true, authorizeDisclosure);
    },
    approve(threadId, attemptId, previewId, accepted, { remember = false } = {}) {
      current(); const thread = find(threadId), attempt = thread.attempts.at(-1), run = runs.get(threadId);
      assert(attempt?.id === attemptId && attempt.approval?.id === previewId && run?.approval, 'Approval no longer matches this attempt');
      assert(!run.deciding, 'Approval is already being recorded');
      if (accepted !== true) { run.controller.abort(new Error('Disclosure declined')); return; }
      // With a permission port, only a stored permission authorizes remote disclosure (resumePermitted).
      assert(!remotePermissions, 'Remote disclosure requires the remote contributor permission');
      const allowed = accepted === true && attempt.approval.expiresAt > now() && !run.controller.signal.aborted;
      if (allowed) {
        const scope = disclosureScope(attempt.request, attempt.approval, requester());
        let grant = null;
        if (remember) {
          assert(scope, 'Reusable disclosure requires a verified recipient and exact execution identity');
          assert(thread.grants.length < limits.maxThreadGrants, 'Conversation grant limit reached');
          grant = { id: id(), meshId, threadId, ...scope, createdAt: now(), revokedAt: null };
          thread.grants.push(grant);
        }
        attempt.authorization = { kind: remember ? 'thread-grant' : 'once', grantId: grant?.id || null,
          peerId: attempt.approval.peerId, recipientIdentity: attempt.approval.recipientIdentity || null,
          ...copy(scope), source: 'approval', recipients: disclosureRecipients(scope, attempt.approval), expiresAt: attempt.approval.expiresAt };
        run.deciding = true;
        const fail = error => { if (grant) thread.grants.pop(); attempt.authorization = null; run.approval?.(false); run.deciding = false; throw error; };
        try {
          const saved = persist();
          if (transactional) return saved.then(() => {
            run.deciding = false;
            run.approval?.(allowed && !run.controller.signal.aborted && attempt.approval?.expiresAt > now());
          }, fail);
          run.deciding = false;
        } catch (error) { return fail(error); }
      }
      if (!run.approval) return; // A state observer may have revoked the grant or cancelled.
      run.approval(allowed && !run.controller.signal.aborted);
    },
    /** Continues every waiting attempt that a stored permission now covers; others stay waiting and send nothing. */
    resumePermitted() {
      current(); const resumed = [];
      for (const thread of threads) {
        const attempt = thread.attempts.at(-1), run = runs.get(thread.id), permission = covering(attempt?.approval?.permissionNeed);
        if (!permission || !run?.approval || run.deciding || run.controller.signal.aborted || attempt.approval.expiresAt <= now()) continue;
        const scope = disclosureScope(attempt.request, attempt.approval, requester());
        if (!scope) continue;
        attempt.authorization = permitted(scope, attempt.approval, permission); run.deciding = true;
        const settle = () => { run.deciding = false; run.approval?.(!run.controller.signal.aborted && attempt.approval?.expiresAt > now()); };
        const fail = error => { attempt.authorization = null; run.deciding = false; run.approval?.(false); throw error; };
        try {
          const saved = persist();
          resumed.push(transactional ? saved.then(settle, fail) : (settle(), undefined));
        } catch (error) { fail(error); }
      }
      return transactional ? Promise.all(resumed).then(() => resumed.length) : resumed.length;
    },
    revokeGrant(threadId, grantId) {
      assert(!closed, 'Workspace is closed');
      const thread = find(threadId), grant = thread.grants.find(item => item.id === grantId);
      assert(grant, 'Conversation grant not found');
      if (grant.revokedAt !== null) return;
      grant.revokedAt = now();
      const attempt = thread.attempts.at(-1), run = runs.get(threadId);
      if (attempt?.authorization?.grantId === grantId) run?.controller.abort(new Error('Conversation grant revoked'));
      return persist();
    },
    cancel(threadId) { const run = runs.get(threadId); run?.controller.abort(new Error('Response stopped')); return run?.completion || Promise.resolve(); },
    async close() {
      closed = true;
      const pending = [...runs.values()];
      for (const run of pending) run.controller.abort(new Error('Workspace closed'));
      await Promise.allSettled(pending.map(run => run.completion));
      const saved = await Promise.allSettled([...pendingSaves]); listeners.clear();
      if (transactional && (saved.some(row => row.status === 'rejected') || storageError)) throw new Error(`History storage failed: ${storageError}`);
    }
  });
}
