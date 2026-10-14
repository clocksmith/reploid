// Read-only observation of existing host owners, adapted from
// artifacts/signed-host-opener-20261012/requester-return-control/reploid-requester-custody-observation.mjs.
// Nothing here substitutes served source, calls a mutating host method or clicks.
// A missing owner throws: absence is never reported as zero.

// Weight paths exactly as the precedent requester harness (run.mjs:35). Configured
// model-file patterns can only add to this set.
export const WEIGHT_PATH = /\/(piece-[a-f0-9]+\.bin|shard[^/]*\.(bin|safetensors))(\?|$)/;

export function compilePatterns(sources) { return sources.map(source => new RegExp(source)); }
export function classifyRequest(url, patterns) {
  let pathname;
  try { pathname = new URL(url).pathname; } catch { return { weight: false, modelFile: false, pathname: null }; }
  const weight = WEIGHT_PATH.test(pathname);
  return { weight, modelFile: weight || patterns.some(pattern => pattern.test(pathname)), pathname };
}
export function rangeBytes(header) {
  const match = /^bytes=(\d+)-(\d+)$/.exec(header || '');
  return match ? Number(match[2]) - Number(match[1]) + 1 : null;
}

async function withHost(page, project) {
  const c = await page.context().newCDPSession(page);
  const own = async objectId => (await c.send('Runtime.getProperties', { objectId, ownProperties: true })).result;
  async function scopeVar(functionObjectId, name) {
    const result = await c.send('Runtime.getProperties', { objectId: functionObjectId });
    const scopes = result.internalProperties?.find(item => item.name === '[[Scopes]]');
    if (!scopes) return null;
    for (const row of (await own(scopes.value.objectId)).filter(item => /^\d+$/.test(item.name))) {
      if (/Global/.test(row.value.description)) continue;
      const found = (await own(row.value.objectId)).find(item => item.name === name);
      if (found?.value?.objectId) return found.value;
    }
    return null;
  }
  // Closure variables of an owner are visible from any of its function-valued properties.
  async function methodScopeVar(object, name) {
    for (const method of (await own(object.objectId)).filter(item => item.value?.type === 'function')) {
      const found = await scopeVar(method.value.objectId, name);
      if (found) return found;
    }
    return null;
  }
  async function read(object, functionDeclaration) {
    const result = await c.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || 'Host observation failed');
    return result.result.value;
  }
  try {
    // self/ui/pool-home/network-controls.js:163 binds this listener inside bindNetworkControls(container, session).
    const listener = (await c.send('Runtime.evaluate', {
      expression: 'getEventListeners(document.querySelector("[data-toggle-contribution]")).click[0].listener',
      includeCommandLineAPI: true
    })).result;
    if (!listener?.objectId) throw Error('Host session listener unavailable');
    const session = await scopeVar(listener.objectId, 'session');
    if (!session) throw Error('Host session observation unavailable');
    return await project({ session, scopeVar, methodScopeVar, read });
  } finally { await c.detach(); }
}

/** Conversation owner state and drafts (self/host/chat-session.js:139,180). Requester independence is
 * the per-profile peer identity: the product route never sets REPLOID_INSTANCE_ID (only
 * self/kernel/boot.js:160 does), so a per-tab instance id is not observed. */
export function observeChat(page) {
  return withHost(page, ({ session, read }) => read(session, `function() {
    const state = this.getState();
    if (!Array.isArray(state.threads) || typeof this.getDraft !== 'function') throw Error('Chat owner unavailable');
    return {
      schema: 'reploid.chat-owner-observation/v1', source: 'existing host getState/getDraft',
      storageMode: Object.hasOwn(state, 'ephemeralExecutions') ? 'transactional' : 'legacy',
      threads: state.threads, selectedId: state.selectedId, runningIds: state.runningIds, storageError: state.storageError,
      drafts: Object.fromEntries([null, ...state.threads.map(thread => thread.id)].map(id => [id ?? 'new', this.getDraft(id)])),
      requesterPeerId: state.network?.consumer?.peerId ?? null
    };
  }`));
}

/** Network, compute contribution and file contribution state (chat-session.js:125; work-swarm.js:64-70). */
export function observeNetwork(page) {
  return withHost(page, ({ session, read }) => read(session, `function() {
    const network = this.getState().network;
    if (!network) throw Error('Network owner unavailable');
    return { sharing: network.sharing, stopping: network.stopping, paused: network.paused, error: network.error,
      unsettledOwners: network.unsettledOwners, consumerPeerId: network.consumer?.peerId ?? null,
      contribution: network.contribution ?? null, files: network.files ?? null };
  }`));
}

/** Custody state and receipts from the file owner (work-swarm.js:317; work-model-files.js:70-76,447). */
export function observeCustody(page) {
  return withHost(page, async ({ session, methodScopeVar, scopeVar, read }) => {
    const swarm = await methodScopeVar(session, 'swarm');
    if (!swarm) throw Error('Swarm observation unavailable');
    const files = await methodScopeVar(swarm, 'modelFiles');
    if (!files || files.subtype === 'null') throw Error('Custody observation unavailable');
    return read(files, 'function(){return {state:this.getState(),receipts:this.getReceipts()};}');
  });
}

/** Whether this tab owns its profile's peer connection. A refused tab has no consumer identity,
 * shows the single-owner lock error (self/host/work-peer-offers.js:20-21) and has no custody owner,
 * because work-swarm.js:165 stops before createModelFiles. Absence is reported, never thrown. */
export async function observeConnectionOwner(page) {
  const network = await observeNetwork(page);
  let custodyOwner = true;
  try { await observeCustody(page); }
  catch (error) { if (/^(Swarm|Custody) observation unavailable$/.test(error.message)) custodyOwner = false; else throw error; }
  return { consumerPeerId: network.consumerPeerId, error: network.error || null, custodyOwner,
    filesSharing: !!network.files?.sharing, filesPreparing: !!network.files?.preparing };
}

/** Offered verified inventory and the custody identity peers acquire from
 * (exchange.js:22 offered, exchange.js:2 identity). No public host accessor exists. */
export function observeOffer(page) {
  return withHost(page, async ({ session, methodScopeVar, read }) => {
    const swarm = await methodScopeVar(session, 'swarm');
    const files = swarm && await methodScopeVar(swarm, 'modelFiles');
    const exchange = files && files.subtype !== 'null' && await methodScopeVar(files, 'exchange');
    if (!exchange || exchange.subtype === 'null') throw Error('Custody exchange observation unavailable');
    const offered = await methodScopeVar(exchange, 'offered'), identity = await methodScopeVar(exchange, 'identity');
    if (!offered || !identity) throw Error('Offered inventory observation unavailable');
    return { offered: await read(offered, 'function(){return structuredClone(this);}'),
      transportId: await read(identity, 'function(){return this.peerId;}') };
  });
}

/** The app's own ordered-participation resolver (self/host/product-context.js:11-22) for this instance. */
export async function observeOrderedParticipation(page) {
  return page.evaluate(async () => {
    try {
      const [{ getOrderedParticipation }, { getCurrentReploidStorage }] = await Promise.all([
        import('/host/product-context.js'), import('/instance.js')]);
      const value = getOrderedParticipation(getCurrentReploidStorage());
      return value === null ? null : { stage: value.stage };
    } catch (error) { return { error: String(error?.message || error) }; }
  });
}

/** The served route admission limit (self/config/partition-policy.json limits). */
export async function servedPartitionLimit(context, origin, policyPath) {
  const response = await context.request.get(new URL(policyPath, origin).href);
  if (!response.ok()) throw Error('Served partition policy unavailable');
  const value = (await response.json())?.limits?.maxConcurrentAttempts;
  if (!Number.isSafeInteger(value) || value <= 0) throw Error('Served partition policy lacks a concurrency limit');
  return value;
}
