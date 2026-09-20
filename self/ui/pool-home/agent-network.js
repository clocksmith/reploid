/** Read-only projection of host-owned agents. Advertisements never imply execution. */
export function projectAgents(work, swarm = {}, selectedModelId) {
  const active = work.records?.find(row => work.busy && row.id === work.activeId);
  const model = work.models?.find(item => item.id === (active?.modelId || selectedModelId));
  const rows = [{ id: 'local', name: 'Your agent', model: active?.modelName || model?.name || 'Choose a model',
    location: active?.execution?.peerId ? 'Peer ' + active.execution.peerId.slice(0, 8)
      : model?.provider === 'gemini' ? 'Cloud' : active && !active.execution ? 'Scheduling' : 'This device',
    state: active?.status === 'loading' ? 'Preparing model' : active ? (work.pendingApproval ? 'Awaiting approval' : work.activity || 'Working')
      : work.available === false ? 'Model unavailable' : model ? 'Idle · model selected' : 'No model selected' }];
  for (const thread of work.records || []) {
    if (thread.id === active?.id || !work.runningIds?.includes(thread.id)) continue;
    rows.push({ id: thread.id, name: thread.goal, model: thread.modelName,
      location: thread.execution?.peerId ? 'Peer ' + thread.execution.peerId.slice(0, 8)
        : thread.execution?.kind === 'local-scoped-session' ? 'This device' : 'Scheduling',
      state: work.approvalThreadIds?.includes(thread.id) ? 'Awaiting approval' : thread.status });
  }
  const seen = new Set([swarm.consumer?.peerId, swarm.supplier?.peerId]);
  for (const snapshot of [swarm.consumer, swarm.supplier]) for (const peer of snapshot?.peers || []) {
    if (seen.has(peer.peerId)) continue;
    seen.add(peer.peerId);
    rows.push({ id: peer.peerId, name: 'Peer ' + peer.peerId.slice(0, 8), model: peer.model || 'No model offered',
      location: snapshot.transport === 'webrtc' ? 'WebRTC peer' : 'Same browser',
      state: peer.role === 'provider' ? 'Available offer' : 'Connected agent' });
  }
  for (const offer of work.peerModels || []) {
    if (!offer.available) continue;
    rows.push({ id: 'pack:' + offer.providerId + ':' + offer.modelId + ':' + offer.operation,
      name: 'Peer ' + String(offer.providerId).slice(0, 8), model: offer.modelId,
      location: 'Peer · ' + offer.operation, state: 'Compatible operation offered' });
  }
  for (const [index, helper] of (active?.helpers || []).entries()) {
    rows.push({ id: helper.id, name: 'Helper ' + (index + 1), model: active.modelName,
      location: helper.location, state: helper.status + ': ' + helper.goal });
  }
  return rows;
}

export function refreshAgentNetwork(root, work, swarm = {}) {
  const list = root.querySelector('[data-agent-list]');
  if (!list) return;
  const rows = projectAgents(work, swarm, root.querySelector('[data-work-model]')?.value);
  // Keep focus and scroll stable when polling unchanged advertisements.
  const identity = JSON.stringify(rows);
  if (list.dataset.projection === identity) return;
  list.dataset.projection = identity;
  list.replaceChildren(...rows.map(row => {
    const item = document.createElement('li'); item.className = 'pool-agent-row'; item.dataset.agentId = row.id;
    const name = document.createElement('strong'); name.textContent = row.name;
    const model = document.createElement('span'); model.textContent = row.model + ' · ' + row.location;
    const status = document.createElement('small'); status.textContent = row.state;
    item.append(name, model, status); return item;
  }));
}

export const renderAgentNetwork = ({ footer = '' } = {}) => `
  <section class="pool-agent-network" id="reploid-agents" aria-label="Agents and models">
    <div class="pool-network-heading"><h2 class="type-h2">Agents</h2>
      <button class="btn btn-ghost" type="button" data-swarm-invite>Invite</button></div>
    <ul class="pool-agent-list" data-agent-list></ul>
    <div data-swarm-peers hidden></div>
    <div class="pool-network-heading">
      <p class="pool-control-help" data-swarm-status role="status">No peers connected.</p>
      <button class="btn btn-ghost" type="button" data-swarm-connect>Connect peers</button>
    </div>
    <p data-swarm-invitation hidden></p>
    <details class="pool-contribution pool-work-secondary" data-contribution-panel>
      <summary>Contribution <span class="type-caption" data-contribution-status>Not sharing</span></summary>
      <div class="pool-work-drawer-body">
        <p class="pool-control-help" data-contribution-model></p>
        <p class="pool-control-help" data-contribution-limits></p>
        <button class="btn btn-ghost" type="button" data-swarm-stop hidden>Stop sharing</button>
        <div data-contribution-settings>
        <div class="pool-work-drawer-body">
          <label class="pool-consent-row"><input type="checkbox" data-swarm-consent>
            <span>Run other agents’ public prompts on this device.</span></label>
          <button class="btn btn-primary" type="button" data-swarm-share>Start sharing</button>
          <p class="pool-control-help">Model loads on request. Each peer runs a whole request; models are not split across GPUs.</p>
        </div>
        </div>
      </div>
    </details>
    ${footer}
  </section>`;
