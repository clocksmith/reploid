/**
 * @fileoverview Host chat session connecting createChatWorkspace to Doppler WebGPU
 * and Poolday peer execution. Manages multithreaded conversations, persistent scopes,
 * fair device scheduling, and truthful execution placement.
 */
import { createChatWorkspace, createRemotePermission, createSearchPermission, remotePermissionCovers, remotePermissionNeed,
  searchPermissionWording, validPermissionWording, validateRemotePermission } from '../vendor/reploid/chat/index.js';
import { createReploidDopplerRuntimeService } from '../infrastructure/doppler-runtime-service.js';
import { ROUTE_ENVELOPE_POLICY } from '../vendor/reploid/mesh/partitions/partition-route-envelope.js';
import { createChatExecution } from './chat-execution.js';
import { createRemoteAccessPreference } from './chat-remote-permission.js';
import { projectChatCatalog, projectChatPlacements, selectAvailableChatModel } from './chat-view.js';
import { createChatDrafts } from './chat-drafts.js';
import { createChatContext } from './chat-context.js';
import { attachmentInput, comparisonInput, comparisonSources, comparisonExport, COMPARISON_CHECK } from './document-comparison.js';
import { readonlyView } from './readonly-view.js';
import profile from '../config/work-profile.json' with { type: 'json' };
import { LOCAL_DOPPLER_MODELS } from '../config/doppler-local-models.js';
import { openCanonicalChatHistory } from './chat-history.js';
export { openChatHistory } from './chat-history.js';

const copy = value => structuredClone(value);
const assert = (ok, message) => { if (!ok) throw new Error(message); };

const STORAGE_KEY = 'reploid.chat-workspace:v1';
/** The stable local owner of this browser profile's conversations. Ordinary and
 * requester-owned transactional history share it, so saved history migrates
 * unchanged; each attempt separately binds the authenticated requester peer. */
export const LOCAL_HISTORY_IDENTITY = Object.freeze({ meshId: 'reploid-local-mesh', participantId: 'local-user' });
// Only published output enters a transactional history.
const publishable = (publication, model) => publication === 'canonical' ? !!(model.partition && model.canonical)
  : model.partition?.schema === 'reploid.partition-selection/v2';
// Remote contributor permissions, including revoked ones (the latest MAX_PERMISSIONS records).
const PERMISSION_KEY = 'reploid.remote-permissions:v1', MAX_PERMISSIONS = 16;
function loadPermissions(storage) {
  try {
    const rows = JSON.parse(storage?.getItem?.(PERMISSION_KEY) ?? '[]');
    return Array.isArray(rows) ? rows.flatMap(row => { try { return [validateRemotePermission(row)]; } catch { return []; } }).slice(-MAX_PERMISSIONS) : [];
  } catch { return []; } // Unreadable storage holds no permission: nothing is sent until granted again.
}

// Requesters and contributors use one artifact catalog.
export const CANONICAL_CHAT_MODELS = LOCAL_DOPPLER_MODELS;
/** The retrieval route for search-backed answers under the per-answer search permission (product-session.js). */
export const SEARCH_ROUTE = 'search';
/** The device-side route (device-search.js): the person's own search tool and on-device page fetches, under the same
 * per-answer permission. Not offered until its search service has approved wording. */
export const DEVICE_SEARCH_ROUTE = 'device-search';
export const CONTRIBUTOR_SEARCH_ROUTE = 'contributor-search';

export function createChatSession({
  storage = globalThis.localStorage,
  service = createReploidDopplerRuntimeService(),
  peers = null,
  swarm = null,
  partitions = null,
  scheduler = null,
  resolveLocalSource,
  canonicalHistory = null,
  bindPublicationAuthorization = null,
  // History owner. Ordered disclosure binds requesterIdentity, the host's authenticated swarm peer;
  // omitted, the workspace uses participantId, so this placeholder can never verify one.
  participantId = LOCAL_HISTORY_IDENTITY.participantId,
  requesterIdentity,
  meshId = LOCAL_HISTORY_IDENTITY.meshId,
  // How this session saves history: transactional (canonical or ordered publication),
  // ordinary, or refused because another tab owns it. Reported in state as-is.
  history = null,
  models = CANONICAL_CHAT_MODELS,
  // Search provider, optional passage extractor and support checker (vendor/reploid/retrieval). None is
  // composed by default, so retrieval-backed requests are refused until a qualified provider is supplied.
  retrieval = null,
  // Spending for partition attempts (earning/attempts.js); none unless the host configures an earning client.
  earning = null,
  now = Date.now,
  id = () => crypto.randomUUID()
} = {}) {
  const store = canonicalHistory || {
    load() {
      try {
        const raw = storage?.getItem ? storage.getItem(STORAGE_KEY) : null;
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    save(data) {
      if (storage?.setItem) {
        storage.setItem(STORAGE_KEY, JSON.stringify(data));
      }
    }
  };

  const historyState = Object.freeze(copy(history ?? (canonicalHistory
    ? { mode: 'transactional', publication: 'canonical', reason: null } : { mode: 'ordinary', publication: null, reason: null })));
  // Catalog identity is resolved once; discovery snapshots cannot mutate it.
  models = copy(models);
  const comparisons = new Map();
  const listeners = new Set();
  let closed = false, closing = null;
  const assertOpen = () => assert(!closed, 'Chat session is closed');

  let peerModels = [];
  let cachedModels = [];
  const isCached = model => !model.partition && !model.adapters?.length
    && cachedModels.some(item => item.id === model.id && item.identity === model.identity);
  let discovering = false;
  let remotePermissions = loadPermissions(storage);
  // The room this session's swarm joins; without a swarm, the history mesh.
  const currentNetwork = () => swarm?.getNetworkId?.() || meshId;
  const remoteAccess = createRemoteAccessPreference({ storage, currentNetwork, getPermissions: () => remotePermissions });
  const savePermissions = next => {
    storage?.setItem?.(PERMISSION_KEY, JSON.stringify(next));
    remotePermissions = next;
  };

  const execution = createChatExecution({ service, swarm, partitions, scheduler, models, earning, resolveLocalSource, isCached,
    getModels: () => [...models, ...peerModels, ...(partitions?.getModels() || [])], profile, onChange: () => notifyAll() });

  const workspace = createChatWorkspace({
    meshId,
    participantId,
    requesterIdentity,
    // Every remote disclosure needs a stored permission that covers it; see remote-permission.js.
    remotePermissions: () => remoteAccess.enabled() ? remotePermissions : [],
    // Permissions are bound to the network (room) they were granted on.
    networkId: currentNetwork,
    retrieval,
    store,
    execute: execution.execute,
    now,
    id
  });
  bindPublicationAuthorization?.(workspace.authorizePublication);
  function allowConfiguredRemote(threadId) {
    if (!remoteAccess.enabled()) return;
    const thread = workspace.getState().threads.find(item => item.id === threadId);
    if (!thread) return;
    const { model, permissions } = thread;
    const disclosure = execution.remoteDisclosure(model, permissions?.sharingScope, permissions?.executionLocation);
    if (!disclosure) return;
    const known = getCatalogModels().find(item => item.id === model.id && item.identity === model.identity);
    assert(known, 'Choose a catalog model before allowing remote contributors');
    const need = remotePermissionNeed({ networkId: currentNetwork(), sharingScope: permissions.sharingScope, disclosure, model });
    if (remotePermissions.some(permission => remotePermissionCovers(permission, need))) return;
    const permission = createRemotePermission({ id: crypto.randomUUID(), need, catalog: [],
      wording: remoteAccess.wording, grantedAt: now() });
    savePermissions([...remotePermissions, permission].slice(-MAX_PERMISSIONS));
  }
  const allowances = workspace.getState().limits;
  const drafts = createChatDrafts({ storage: canonicalHistory ? { getItem: () => canonicalHistory.drafts } : storage,
    persist: canonicalHistory ? raw => canonicalHistory.saveDrafts(raw) : null, key: `${STORAGE_KEY}:drafts`, maxThreads: allowances.maxThreads,
    maxCharacters: allowances.maxMessageCharacters, maxFiles: profile.files.maxInputs,
    maxFileBytes: profile.files.maxFileBytes, maxInputBytes: profile.files.maxInputBytes });

  // A search-answer route, offered only when its search service has approved permission wording and any one-time
  // configuration consent its host declares (`available`) is in force.
  const isSearchRoute = name => retrieval?.routes?.[name]?.permission === 'search-answer';
  const searchRoute = (name = SEARCH_ROUTE) => {
    const route = isSearchRoute(name) ? retrieval.routes[name] : null;
    return route && searchPermissionWording(route.provider?.searchProvider) && (route.available?.() ?? true) ? route : null;
  };
  /** Contributors that may receive this answer: none when it runs here, else the verified route's stages or the
   * catalog's ready providers for this model. Execution must stay within them or the passages are not sent. */
  const listedContributors = (model, sharingScope, executionLocation) => {
    if (!execution.remoteDisclosure(model, sharingScope, executionLocation)) return [];
    const key = item => item.selectionId || item.id;
    const known = getCatalogModels().find(item => key(item) === key(model) && item.identity === model.identity) || model;
    if (known.partition?.route) return [...new Set(known.partition.route.stages.map(stage => stage.participantId))];
    if (known.partition?.participantA) return [known.partition.participantA, known.partition.participantB].filter(Boolean);
    return [...new Set(known.providerIds || [])];
  };
  const searchGrant = (threadId, query, search, name = SEARCH_ROUTE) => {
    const route = searchRoute(name);
    assert(route, 'Search is not available');
    assert(search && Array.isArray(search.recipients), 'Allow search for this answer first');
    const searchServer = route.provider.searchServer ?? null;
    const searchPeer = route.provider.searchPeer ?? null;
    assert((search.searchPeer ?? null) === searchPeer, 'The search contributor changed after search was allowed. Nothing was sent. Retry asks again.');
    assert((search.searchServer ?? null) === searchServer, 'The search server changed after search was allowed. Nothing was sent. Retry asks again.');
    return createSearchPermission({ id: id(), networkId: currentNetwork(), threadId, searchProvider: route.provider.searchProvider,
      searchServer, searchPeer, query: String(query).trim(), recipients: search.recipients, wording: search.wording, grantedAt: now() });
  };

  const getCatalogModels = () => copy(projectChatCatalog({
    models: [...models, ...peerModels], peers: swarm?.getState?.().consumer?.peers || [],
    partitionModels: partitions?.getModels() || []
  }).map(model => {
    model = { ...model, networkAvailability: model.availability };
    const local = execution.getLocalState();
    if (canonicalHistory && !publishable(historyState.publication, model)) return { ...model, availability: 'unavailable', localReady: false };
    if (model.partition) return { ...model, localReady: false, localCached: false };
    return local?.ready && local.modelIdentity === model.identity && !(model.adapters?.length)
      ? { ...model, availability: 'ready', localReady: true }
      : isCached(model) ? { ...model, availability: 'cached', localCached: true } : model;
  }));

  const notifyAll = () => {
    if (closed) return;
    const st = getSessionState();
    for (const listener of listeners) {
      try { listener(st); } catch (e) { console.error('[ChatSession] listener error', e); }
    }
  };

  const getSessionState = () => {
    const wsState = workspace.getState();
    // Only active execution metadata is ephemeral. Text and terminal states
    // remain the committed workspace projection supplied above.
    for (const view of wsState.ephemeralExecutions || []) {
      const attempt = wsState.threads.find(thread => thread.id === view.threadId)?.attempts.find(item => item.id === view.attemptId);
      if (attempt) Object.assign(attempt, { persistedStatus: attempt.status, ephemeral: true,
        status: view.status, approval: view.approval, execution: view.execution });
    }
    const activeThread = wsState.threads.find(t => t.id === wsState.selectedId) || null;
    const catalog = getCatalogModels();
    const preferred = candidates => candidates.find(model => model.id === profile.defaultModelId) || candidates[0];
    const defaultModels = Object.fromEntries(['auto', 'local', 'network'].map(location =>
      [location, selectAvailableChatModel(catalog, profile.chatModelPreference, location)]));
    return readonlyView({
      ...wsState,
      closed,
      activeThread,
      comparisonPhase: comparisons.get(wsState.selectedId)?.phase || null,
      models: catalog,
      answerLimits: catalog.filter(model => model.partition).map(model => ({
        selectionId: model.selectionId || model.id,
        cells: ROUTE_ENVELOPE_POLICY.routes.find(row => row.modelIdentity === model.identity
          && row.planId === model.partition.planId)?.cells || []
      })).filter(entry => entry.cells.length),
      defaultModels,
      defaultModel: defaultModels.auto || preferred(catalog) || null,
      discovering,
      localModel: execution.getLocalState(),
      network: copy({ ...(swarm?.getState?.() || { sharing: false, consumer: null }), files: swarm?.getFileState?.() || null }),
      scheduler: execution.getState(),
      placements: projectChatPlacements(wsState.threads),
      history: historyState,
      remotePermissions: copy(remotePermissions), remoteNetworkId: currentNetwork(), remoteAnswersEnabled: remoteAccess.enabled()
    });
  };

  // Re-emit workspace updates
  const unsubscribeWorkspace = workspace.subscribe(() => {
    notifyAll();
  });

  const unsubscribePartitions = partitions?.subscribe(notifyAll);

  return Object.freeze({
    getState: getSessionState,
    subscribe(listener) {
      assertOpen();
      listeners.add(listener);
      listener(getSessionState());
      return () => listeners.delete(listener);
    },
    refreshNetwork: notifyAll,
    setCachedModels(available) {
      if (closed) return;
      cachedModels = models.filter(model => available.some(item => item.id === model.id && item.identity === model.identity))
        .map(({ id, identity }) => ({ id, identity }));
      notifyAll();
    },
    previewContextPrompt(selection, model = getSessionState().defaultModel) {
      return createChatContext(selection, model, models);
    },
    setContextPrompt(threadId, selection) {
      assertOpen();
      const thread = workspace.getState().threads.find(item => item.id === threadId);
      assert(thread, 'Conversation not found');
      return workspace.setSystemContext(threadId, createChatContext(selection, thread.model, models));
    },
    async prepareLocalModel(modelId) {
      assertOpen();
      const model = models.find(item => item.id === modelId);
      assert(model, 'Choose a catalog model');
      try { await execution.prepareLocal(model); } finally { notifyAll(); }
    },
    async getModelDownload(modelId, { signal } = {}) {
      assertOpen();
      const model = models.find(item => item.id === modelId);
      assert(model?.source, 'Choose a catalog model');
      const file = model.source.files.find(item => item.role === 'model-manifest');
      const response = await fetch(file.url ? new URL(file.url, location.href) : new URL(file.path, model.source.baseUrl), { signal });
      assert(response.ok, 'Could not check the model download');
      const bytes = await response.arrayBuffer();
      assert(bytes.byteLength === file.sizeBytes, 'Model manifest size mismatch');
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
      assert('sha256:' + hash === model.identity, 'Model manifest identity mismatch');
      const manifest = JSON.parse(new TextDecoder().decode(bytes));
      assert(manifest.modelId === model.id && Array.isArray(manifest.shards), 'Model manifest is incomplete');
      const sizeBytes = manifest.shards.reduce((total, shard) => total + shard.size, 0)
        + model.source.files.filter(item => item.role !== 'model-piece-index').reduce((total, item) => total + item.sizeBytes, 0);
      assert(Number.isSafeInteger(sizeBytes) && sizeBytes > 0, 'Model download size is unavailable');
      return { id: model.id, name: model.name, sizeBytes };
    },
    getDraft: drafts.get,
    saveDraft(threadId, value) { assertOpen(); return drafts.save(threadId, value); },
    getDocumentSources: comparisonSources,
    exportConversation(threadId) {
      assertOpen();
      return comparisonExport(workspace.getState().threads.find(thread => thread.id === threadId));
    },
    compareDocuments(threadId, question, files) {
      assertOpen();
      assert(!comparisons.has(threadId), 'This comparison is already running');
      const input = comparisonInput(question, files);
      allowConfiguredRemote(threadId);
      const controller = new AbortController(), operation = { controller, phase: 'comparing' };
      comparisons.set(threadId, operation);
      return (async () => { try {
        const draft = await workspace.send(threadId, input);
        if (draft.status !== 'completed' || controller.signal.aborted) return draft;
        operation.phase = 'checking'; notifyAll();
        return await workspace.send(threadId, COMPARISON_CHECK, { select: false });
      } finally { comparisons.delete(threadId); notifyAll(); } })();
    },
    createThread({ model = getSessionState().defaultModel, purpose = '', sharingScope = 'mesh', executionLocation = 'auto', contextPrompt } = {}) {
      assertOpen();
      assert(model, 'Model required to create thread');
      assert(['auto', 'local', 'network'].includes(executionLocation), 'Invalid execution location');
      assert(executionLocation !== 'local' || !model.partition, 'This model requires network execution');
      return workspace.createThread({
        model,
        purpose,
        systemContext: createChatContext(contextPrompt, model, models),
        permissions: { sharingScope: executionLocation === 'local' ? 'local' : executionLocation === 'network' ? 'mesh' : sharingScope, executionLocation }
      });
    },
    setExecutionLocation(threadId, location) { assertOpen(); return workspace.setExecutionLocation(threadId, location); },
    select(threadId) {
      assertOpen();
      workspace.select(threadId);
    },
    // Remote disclosure waits in the workspace's 'approval' state until approve() records the displayed recipients.
    // `retrieval: { query?, limits? }` opts this request into retrieval; the query defaults to the typed text,
    // never to attachment contents. `search: { route?, wording, recipients }` is the per-answer search permission as
    // shown and allowed (route defaults to SEARCH_ROUTE): the typed text goes to the search service and nothing else
    // from the conversation is sent.
    send(threadId, content, attachments = [], { retrieval = null, search = null } = {}) {
      assertOpen();
      assert(threadId, 'threadId required');
      assert(Array.isArray(attachments) && attachments.length <= profile.files.maxInputs, 'Too many attachments');
      let total = 0;
      attachments.forEach(file => {
        assert(typeof file.name === 'string' && typeof file.text === 'string', 'Invalid text attachment');
        const bytes = new TextEncoder().encode(file.text).byteLength;
        total += bytes;
        assert(bytes <= profile.files.maxFileBytes, 'Attachment exceeds the file allowance');
      });
      assert(total <= profile.files.maxInputBytes, 'Attachments exceed the input allowance');
      assert(retrieval === null || retrieval && typeof retrieval === 'object', 'Invalid retrieval request');
      if (search) {
        assert(retrieval === null, 'Choose search or web search for this answer, not both');
        assert(!attachments.length, "Search-backed answers don't include files. Remove the files or turn off search for this answer.");
        const route = search.route ?? SEARCH_ROUTE;
        return workspace.send(threadId, content, { retrieval: { route, query: content },
          searchPermission: searchGrant(threadId, content, search, route) });
      }
      allowConfiguredRemote(threadId);
      return workspace.send(threadId, attachmentInput(content, attachments),
        retrieval ? { retrieval: { ...retrieval, query: retrieval.query ?? content } } : undefined);
    },
    /** The approved wording and listed contributors to show before a search-backed answer on `route`; throws when
     * that route is unavailable (no approved wording, or its configuration consent is not in force). */
    searchPermissionRequest({ model, sharingScope = 'mesh', executionLocation = 'auto', route: name = SEARCH_ROUTE }) {
      assertOpen();
      const route = searchRoute(name);
      assert(route, 'Search is not available');
      assert(model, 'Choose a model first');
      const recipients = listedContributors(model, sharingScope, executionLocation);
      assert(recipients.length || !execution.remoteDisclosure(model, sharingScope, executionLocation), 'No execution contributors are available for this answer');
      return { route: name, searchProvider: route.provider.searchProvider, searchServer: route.provider.searchServer ?? null, ...(route.provider.searchPeer ? { searchPeer: route.provider.searchPeer } : {}),
        wording: searchPermissionWording(route.provider.searchProvider), recipients };
    },
    /** The search-answer route a new search-backed answer uses: the person's own search server when they set one up
     * in Settings and it is on, otherwise the server's Brave route; null when neither is offered. */
    preferredSearchRoute: () => searchRoute(DEVICE_SEARCH_ROUTE) ? DEVICE_SEARCH_ROUTE : searchRoute(CONTRIBUTOR_SEARCH_ROUTE) ? CONTRIBUTOR_SEARCH_ROUTE : searchRoute(SEARCH_ROUTE) ? SEARCH_ROUTE : null,
    /** Whether retrying this attempt needs a fresh per-answer search permission. */
    searchRetryNeedsPermission: attempt => isSearchRoute(attempt?.request?.retrieval?.route),
    cancel(threadId) {
      assertOpen();
      comparisons.get(threadId)?.controller.abort();
      return workspace.cancel(threadId);
    },
    cancelAll() {
      assertOpen();
      for (const operation of comparisons.values()) operation.controller.abort();
      const state = workspace.getState();
      for (const tid of state.runningIds) {
        workspace.cancel(tid);
      }
    },
    retry(threadId, attemptId, { search = null } = {}) {
      assertOpen();
      const attempt = workspace.getState().threads.find(thread => thread.id === threadId)?.attempts.find(item => item.id === attemptId);
      if (!search && !isSearchRoute(attempt?.request?.retrieval?.route)) allowConfiguredRemote(threadId);
      return workspace.retry(threadId, attemptId, search ? { searchPermission: searchGrant(threadId, attempt?.request?.retrieval?.query ?? '',
        search, attempt?.request?.retrieval?.route ?? SEARCH_ROUTE) } : undefined);
    },
    approve(threadId, attemptId, previewId, accepted, options) {
      assertOpen();
      return workspace.approve(threadId, attemptId, previewId, accepted, options);
    },
    revokeGrant(threadId, grantId) { assertOpen(); return workspace.revokeGrant(threadId, grantId); },
    /** The permission a request for this model and sharing scope still needs, or null (runs here or already covered). */
    remotePermissionNeeded({ model, sharingScope = 'mesh', executionLocation = 'auto' }) {
      const disclosure = model && execution.remoteDisclosure(model, sharingScope, executionLocation);
      if (!disclosure) return null;
      const need = remotePermissionNeed({ networkId: currentNetwork(), sharingScope, disclosure, model });
      return remoteAccess.enabled() ? null : need;
    },
    /** Stores the one-time permission for `need` and the verified catalog, recording the `wording` the person was
     * shown, then continues waiting attempts it covers. */
    async grantRemotePermission(need, { wording } = {}) {
      assertOpen();
      const model = getCatalogModels().find(item => item.identity === need?.modelIdentity && item.id === need?.modelId);
      assert(model && Array.isArray(need.adapterIdentities) && need.adapterIdentities.every(identity => (model.adapters || [])
        .some(adapter => adapter.identity === identity)), 'Choose a catalog model before allowing remote contributors');
      assert(validPermissionWording(wording), 'Record the permission wording that was shown');
      const permission = createRemotePermission({ id: crypto.randomUUID(), need, catalog: models, wording, grantedAt: now() });
      savePermissions([...remotePermissions, permission].slice(-MAX_PERMISSIONS));
      remoteAccess.set(true);
      try { await workspace.resumePermitted(); } finally { notifyAll(); }
      return copy(permission);
    },
    /** Stops new remote disclosures under this permission. Answers already admitted continue until stopped. */
    revokeRemotePermission(permissionId) {
      assertOpen();
      assert(remotePermissions.some(permission => permission.id === permissionId), 'Remote permission not found');
      remoteAccess.set(false);
      // Fail closed: this session stops using it even if saving the revocation fails.
      remotePermissions = remotePermissions.map(permission => permission.id === permissionId && permission.revokedAt === null
        ? { ...permission, revokedAt: now() } : permission);
      try { storage?.setItem?.(PERMISSION_KEY, JSON.stringify(remotePermissions)); } finally { notifyAll(); }
    },
    setRemoteAnswersEnabled(enabled) {
      assertOpen();
      try {
        remoteAccess.set(enabled);
        if (!enabled) {
          remotePermissions = remotePermissions.map(permission => permission.networkId === currentNetwork() && permission.revokedAt === null
            ? { ...permission, revokedAt: now() } : permission);
          savePermissions(remotePermissions);
        }
      } finally { notifyAll(); }
    },
    renameThread(threadId, title) { assertOpen(); return workspace.renameThread(threadId, title); },
    archiveThread(threadId) { assertOpen(); return workspace.closeThread(threadId); },
    restoreThread(threadId) { assertOpen(); return workspace.reopenThread(threadId); },
    closeThread(threadId) {
      assertOpen();
      comparisons.get(threadId)?.controller.abort();
      const saved = workspace.closeThread(threadId);
      if (canonicalHistory) return Promise.resolve(saved).then(() => drafts.save(threadId, null));
      drafts.save(threadId, null);
    },
    async discoverPeers() {
      assertOpen();
      if (!peers || discovering) return;
      discovering = true;
      notifyAll();
      try {
        const found = await peers.discover();
        if (!closed && Array.isArray(found)) {
          peerModels = copy(found).map(m => ({
            ...m,
            identity: m.identity,
            provider: 'doppler'
          }));
        }
      } catch (e) {
        console.warn('[ChatSession] Peer discovery failed', e);
      } finally {
        discovering = false;
        notifyAll();
      }
    },
    async connect() {
      assertOpen();
      assert(swarm?.connect, 'Peer connection is unavailable');
      try { await swarm.connect(); } finally { notifyAll(); }
    },
    async disconnect() {
      assertOpen();
      assert(swarm?.disconnect, 'Peer disconnection is unavailable');
      try { await swarm.disconnect(); } finally { notifyAll(); }
    },
    setIntroductionAssistance(enabled) {
      if (!swarm) throw new Error('Network unavailable');
      swarm.allowIntroductions(enabled);
    },
    async setSharing(enabled, selectionId, approved) {
      assertOpen();
      assert(swarm, 'Contribution is unavailable');
      try {
        if (enabled) {
          assert(approved === true, 'Approve public prompt execution before sharing');
          const model = getCatalogModels().find(item => (item.selectionId || item.id) === selectionId);
          assert(model, 'Select a catalog model before contributing');
          await swarm.share(model.id, true, model.adapters || []);
        } else await swarm.stop();
      } finally { notifyAll(); }
    },
    async setFileSharing(enabled, selectionId, approved, controls) {
      assertOpen();
      assert(swarm?.shareFiles, 'File contribution is unavailable');
      try {
        if (!enabled) { await swarm.stopFiles(); return; }
        assert(approved === true, 'Approve file distribution separately from compute');
        const model = getCatalogModels().find(item => (item.selectionId || item.id) === selectionId);
        assert(model, 'Select a catalog model before distributing files');
        await swarm.shareFiles(model, true, controls);
      } finally { notifyAll(); }
    },
    close() {
      if (closing) return closing;
      closed = true;
      for (const operation of comparisons.values()) operation.controller.abort();
      discovering = false;
      closing = Promise.resolve().then(async () => {
        const failures = [];
        for (const owner of [workspace, execution, drafts, canonicalHistory]) {
          try { await owner?.close(); } catch (error) { failures.push(error); }
        }
        unsubscribeWorkspace(); unsubscribePartitions?.(); listeners.clear();
        if (failures.length) throw new AggregateError(failures, 'Chat session cleanup failed');
      });
      return closing;
    }
  });
}

/** Opt-in async composition. Opening history never dispatches a request. */
export async function openCanonicalChatSession({ canonical, ...options }) {
  assert(canonical && options.meshId && options.participantId, 'Canonical session requires explicit persistent identity');
  const storage = options.storage ?? globalThis.localStorage;
  let authorizeExecution = () => false;
  const history = await openCanonicalChatHistory({ ...canonical, meshId: options.meshId, participantId: options.participantId,
    legacy: { workspace: storage?.getItem?.(STORAGE_KEY) ?? null, drafts: storage?.getItem?.(`${STORAGE_KEY}:drafts`) ?? null },
    authorizeExecution: scope => authorizeExecution(scope) });
  try {
    return createChatSession({ ...options, storage, canonicalHistory: history,
      bindPublicationAuthorization: authorize => { authorizeExecution = authorize; } });
  } catch (error) { await history.close(); throw error; }
}
