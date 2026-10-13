// Read-only CDP observation of existing host owners; no served-source substitution.
async function observeOwner(page, project) {
  const c = await page.context().newCDPSession(page);
  const props = async value => (await c.send('Runtime.getProperties', { objectId: value.objectId, ownProperties: true })).result;
  async function scope(value, name) {
    const result = await c.send('Runtime.getProperties', { objectId: value.objectId });
    const scopes = result.internalProperties?.find(item => item.name === '[[Scopes]]');
    if (!scopes) return null;
    for (const row of (await props(scopes.value)).filter(item => /^\d+$/.test(item.name))) {
      if (/Global/.test(row.value.description)) continue;
      const found = (await props(row.value)).find(item => item.name === name);
      if (found) return found.value;
    }
    return null;
  }
  try {
    const fn = (await c.send('Runtime.evaluate', {
      expression: 'getEventListeners(document.querySelector("[data-toggle-contribution]")).click[0].listener',
      includeCommandLineAPI: true
    })).result;
    const session = await scope(fn, 'session');
    if (!session) throw Error('Requester session observation unavailable');
    return await project({ c, session, props, scope });
  } finally { await c.detach(); }
}

export async function observeRequesterCustody(page) {
  return observeOwner(page, async ({ c, session, props, scope }) => {
    let swarm;
    for (const method of (await props(session)).filter(item => item.value?.type === 'function')) {
      swarm = await scope(method.value, 'swarm');
      if (swarm) break;
    }
    if (!swarm) throw Error('Requester swarm observation unavailable');
    const getFiles = (await props(swarm)).find(item => item.name === 'getFileState')?.value;
    const files = getFiles && await scope(getFiles, 'modelFiles');
    if (!files || files.subtype === 'null') throw Error('Requester custody observation unavailable');
    const result = await c.send('Runtime.callFunctionOn', {
      objectId: files.objectId,
      functionDeclaration: 'function(){return {state:this.getState(),receipts:this.getReceipts()};}',
      returnByValue: true
    });
    if (result.exceptionDetails || !result.result.value) throw Error('Requester custody observation failed');
    return result.result.value;
  });
}

export async function observeRequesterChat(page) {
  return observeOwner(page, async ({ c, session }) => {
    const result = await c.send('Runtime.callFunctionOn', {
      objectId: session.objectId,
      functionDeclaration: `function() {
        const state = this.getState();
        if (!Array.isArray(state.threads) || typeof this.getDraft !== 'function') throw Error('Chat owner unavailable');
        return {
          schema: 'reploid.chat-owner-observation/v1',
          source: 'existing host getState/getDraft',
          storageMode: Object.hasOwn(state, 'ephemeralExecutions') ? 'transactional' : 'legacy',
          threads: state.threads, selectedId: state.selectedId, runningIds: state.runningIds,
          storageError: state.storageError,
          drafts: Object.fromEntries([null, ...state.threads.map(thread => thread.id)]
            .map(id => [id ?? 'new', this.getDraft(id)]))
        };
      }`,
      returnByValue: true
    });
    if (result.exceptionDetails || !result.result.value) throw Error('Requester chat observation failed');
    return result.result.value;
  });
}
