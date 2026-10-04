/** Shared network controls consume host snapshots; they never grant permission on render. */
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const renderSharingControls = () => `<p class="network-sharing-summary" data-tab-sharing-summary role="status">No models shared by this tab</p>
        <label>Model to share <select class="pool-input" data-contribution-model aria-label="Model to share"></select></label>
        <details class="pool-disclosure"><summary>Compute <span data-contrib-label>Not sharing</span></summary>
          <div class="chat-contribution-controls"><p data-contribution-limits></p><p data-contribution-progress role="status" hidden></p>
            <label><input type="checkbox" data-contribution-consent> Run peers’ public prompts on this device</label>
            <button class="btn pool-button btn-ghost" type="button" data-toggle-contribution>Start sharing</button></div></details>
        <details class="pool-disclosure"><summary>Model files <span data-file-contribution-label>Not sharing</span></summary>
          <div class="chat-contribution-controls"><p>Cache this model and its selected adapter (up to 3 GiB), and distribute up to 4 GiB to peers. This does not share conversations or enable compute.</p><p data-file-progress role="status" hidden></p>
            <label><input type="checkbox" data-file-contribution-consent> Allow file storage and distribution</label>
            <button class="btn pool-button btn-ghost" type="button" data-toggle-file-contribution>Start sharing files</button></div></details>`;

export function projectNetworkPeers(state) {
  const network = state.network || {};
  const own = new Set([network.consumer?.peerId, network.supplier?.peerId]);
  const peers = new Map();
  for (const snapshot of [network.consumer, network.supplier]) for (const peer of snapshot?.peers || []) {
    if (own.has(peer.peerId)) continue;
    const capability = network.partitionPeers?.find(item => item.transportId === peer.peerId);
    const partition = capability?.available ? capability.description : null;
    const offered = partition?.offer;
    const name = state.models?.find(model => model.id === offered?.id)?.name || offered?.id;
    peers.set(peer.peerId, { id: peer.peerId, model: name || peer.model || 'No model offered',
      status: offered ? (partition.index == null ? 'Waiting for placement' : `Partition ${partition.index + 1} · ${partition.phase}`)
        : peer.role === 'provider' ? (peer.executionPhase || 'Offered') : 'Connected' });
  }
  return [...peers.values()];
}

function renderPeerRows(list, state) {
  const rows = projectNetworkPeers(state), key = JSON.stringify(rows);
  if (list.dataset.projection === key) return;
  list.dataset.projection = key;
  list.innerHTML = rows.length ? rows.map(peer => `<li class="network-peer-row"><div><strong>Peer ${escape(peer.id.slice(0, 8))}</strong><span>${escape(peer.model)}</span></div><span class="network-status">${escape(peer.status)}</span></li>`).join('')
    : '<li class="network-empty">No peers connected yet</li>';
}

export function bindNetworkControls(container, session, { getInviteUrl } = {}) {
  const find = selector => container.querySelector(selector);
  const controller = new AbortController(), options = { signal: controller.signal };
  const contributionSelect = find('[data-contribution-model]');
  const on = (selector, event, callback) => find(selector)?.addEventListener(event, callback, options);
  const act = operation => Promise.resolve().then(operation).catch(cause => {
    const node = find('[data-network-message]'); node.textContent = cause.message; node.hidden = false;
  });
  const render = state => {
    const catalogModels = state.models || [], keyFor = model => model?.selectionId || model?.id;
    const contributionKey = contributionSelect.value || keyFor(state.defaultModel);
    const contributionCatalog = JSON.stringify(catalogModels.filter(model => !model.partition).map(model => [keyFor(model), model.name]));
    if (contributionSelect.dataset.catalog !== contributionCatalog) {
      contributionSelect.innerHTML = catalogModels.filter(model => !model.partition)
        .map(model => `<option value="${escape(keyFor(model))}">${escape(model.name)}</option>`).join('');
      contributionSelect.dataset.catalog = contributionCatalog;
      if ([...contributionSelect.options].some(option => option.value === contributionKey)) contributionSelect.value = contributionKey;
    }
    const network = state.network || {}, peers = network.consumer?.peers || network.supplier?.peers || [];
    find('[data-mesh-invite]').hidden = network.discoveryScope !== 'private';
    contributionSelect.disabled = !!network.sharing || !!network.stopping || !!network.files?.sharing || !!network.files?.preparing;
    find('[data-mesh-peers]').textContent = peers.length + (peers.length === 1 ? ' peer' : ' peers');
    renderPeerRows(find('[data-insp-device-list]'), state);
    const discoveryState = network.consumer?.connectionState;
    const activeDiscovery = network.connecting || ['connected', 'connecting', 'retrying'].includes(discoveryState);
    const connectControl = find('[data-mesh-connect]');
    connectControl.disabled = false;
    connectControl.dataset.disconnect = String(!!activeDiscovery);
    connectControl.textContent = activeDiscovery ? 'Disconnect' : network.error ? 'Retry' : 'Connect';
    const message = find('[data-network-message]');
    message.textContent = network.error || (network.connecting ? 'Connecting…' : ''); message.hidden = !message.textContent;
    find('[data-contrib-label]').textContent = network.stopping ? 'Stopping' : network.sharing
      ? ({ loading: 'Loading', ready: 'Ready', executing: 'Executing', failed: 'Failed' }[network.contribution?.phase] || 'Sharing') : 'Not sharing';
    find('[data-toggle-contribution]').textContent = network.sharing ? 'Stop sharing' : 'Start sharing';
    find('[data-toggle-contribution]').disabled = !!network.stopping;
    find('[data-contribution-consent]').disabled = !!network.sharing || !!network.stopping;
    find('[data-contribution-limits]').textContent = network.limits ? network.limits.maxInboundJobs + ' request at a time · ' + network.limits.maxOutputTokens + ' output tokens per request' : '';
    const progress = network.contribution?.progress;
    const progressText = typeof progress === 'string' ? progress : progress?.message || progress?.stage || progress?.phase || '';
    const progressNode = find('[data-contribution-progress]');
    progressNode.textContent = network.contribution?.error || progressText;
    progressNode.hidden = !progressNode.textContent;
    const sharingFiles = network.files?.sharing || network.files?.preparing;
    find('[data-file-contribution-label]').textContent = network.files?.error || (network.files?.preparing ? 'Preparing' : sharingFiles ? 'Sharing' : 'Not sharing');
    find('[data-file-progress]').textContent = network.files?.progress?.message || '';
    find('[data-file-progress]').hidden = !find('[data-file-progress]').textContent;
    find('[data-file-contribution-consent]').disabled = !!sharingFiles;
    find('[data-toggle-file-contribution]').textContent = sharingFiles ? 'Stop sharing files' : 'Start sharing files';
    const contribution = network.contribution || {};
    const sharedId = contribution.modelId || contribution.descriptor?.modelId;
    const sharedName = catalogModels.find(model => model.id === sharedId)?.name || sharedId;
    const sharing = [];
    if (network.sharing || network.stopping) sharing.push((sharedName || 'Selected model')
      + (contribution.partition ? ' · partition compute' : ' · compute'));
    if (sharingFiles) sharing.push((network.files?.model?.name || network.files?.model?.id || 'Model files') + ' · files');
    find('[data-tab-sharing-summary]').textContent = sharing.length ? sharing.join(' / ') : 'No models shared by this tab';
  };
  const unsubscribe = session.subscribe(render);
  on('[data-mesh-connect]', 'click', () => act(() => find('[data-mesh-connect]').dataset.disconnect === 'true'
    ? session.disconnect() : session.connect()));
  on('[data-mesh-invite]', 'click', () => act(async () => {
    if (!getInviteUrl) throw new Error('Mesh invitation is unavailable');
    await navigator.clipboard.writeText(getInviteUrl());
    const node = find('[data-network-message]'); node.textContent = 'Invite copied'; node.hidden = false;
  }));
  on('[data-toggle-contribution]', 'click', () => act(() => session.setSharing(!session.getState().network?.sharing, contributionSelect.value, find('[data-contribution-consent]').checked)));
  on('[data-toggle-file-contribution]', 'click', () => act(() => {
    const files = session.getState().network?.files;
    return session.setFileSharing(!(files?.sharing || files?.preparing), contributionSelect.value, find('[data-file-contribution-consent]').checked);
  }));
  return () => { controller.abort(); unsubscribe(); };
}
