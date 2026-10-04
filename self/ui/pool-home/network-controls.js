/** Shared network controls consume host snapshots; they never grant permission on render. */
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const renderConnectionControl = () => `<div class="network-sharing-row">
  <div><strong>Network connection</strong><span data-connection-label>Disconnected</span></div>
  <button class="network-switch" type="button" role="switch" aria-label="Connect to network" aria-checked="false" data-mesh-connect><span></span></button>
</div>`;

export const renderSharingControls = () => `<p class="network-sharing-summary" data-tab-sharing-summary role="status">No models shared by this tab</p>
        <label>Model to share <select class="pool-input" data-contribution-model aria-label="Model to share"></select></label>
        <div class="network-sharing-row">
          <div><strong>Share compute <span data-contrib-label>Not sharing</span></strong>
            <p>Run peers’ public prompts on this device.</p><p data-contribution-limits></p>
            <p data-contribution-progress role="status" hidden></p></div>
          <button class="network-switch" type="button" role="switch" aria-label="Share compute" aria-checked="false" data-toggle-contribution><span></span></button>
        </div>
        <div class="network-sharing-row">
          <div><strong>Share model files <span data-file-contribution-label>Not sharing</span></strong>
            <p>Store up to 3 GiB and send up to 4 GiB to peers. Conversations are not shared.</p>
            <p data-file-progress role="status" hidden></p></div>
          <button class="network-switch" type="button" role="switch" aria-label="Share model files" aria-checked="false" data-toggle-file-contribution><span></span></button>
        </div>`;

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
  let actionError = '';
  const act = operation => {
    actionError = ''; render(session.getState());
    return Promise.resolve().then(operation).catch(cause => {
      if (controller.signal.aborted) return;
      actionError = cause.message; render(session.getState());
    });
  };
  const render = state => {
    const catalogModels = state.models || [], keyFor = model => model?.selectionId || model?.id;
    const prepared = catalogModels.find(model => !model.partition && model.id === state.defaultModel?.id
      && ['ready', 'busy'].includes(state.defaultModel?.availability));
    const contributionKey = contributionSelect.value || keyFor(prepared || catalogModels.find(model => !model.partition));
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
    connectControl.setAttribute('aria-checked', String(!!activeDiscovery));
    find('[data-connection-label]').textContent = network.connecting || discoveryState === 'connecting' ? 'Connecting…'
      : discoveryState === 'retrying' ? 'Reconnecting…' : activeDiscovery ? 'Connected' : 'Disconnected';
    const message = find('[data-network-message]');
    message.textContent = network.error || actionError || (network.connecting ? 'Connecting…' : ''); message.hidden = !message.textContent;
    find('[data-contrib-label]').textContent = network.stopping ? 'Stopping' : network.sharing
      ? ({ loading: 'Loading', ready: 'Ready', executing: 'Executing', failed: 'Failed' }[network.contribution?.phase] || 'Sharing') : 'Not sharing';
    find('[data-toggle-contribution]').setAttribute('aria-checked', String(!!network.sharing));
    find('[data-toggle-contribution]').disabled = !!network.stopping;
    find('[data-contribution-limits]').textContent = network.limits ? network.limits.maxInboundJobs + (network.limits.maxInboundJobs === 1 ? ' request' : ' requests') + ' at a time · ' + network.limits.maxOutputTokens + ' output tokens per request' : '';
    const progress = network.contribution?.progress;
    const progressText = typeof progress === 'string' ? progress : progress?.message || progress?.stage || progress?.phase || '';
    const progressNode = find('[data-contribution-progress]');
    progressNode.textContent = network.contribution?.error || progressText;
    progressNode.hidden = !progressNode.textContent;
    const sharingFiles = network.files?.sharing || network.files?.preparing;
    find('[data-file-contribution-label]').textContent = network.files?.error || (network.files?.preparing ? 'Preparing' : sharingFiles ? 'Sharing' : 'Not sharing');
    find('[data-file-progress]').textContent = network.files?.progress?.message || '';
    find('[data-file-progress]').hidden = !find('[data-file-progress]').textContent;
    find('[data-toggle-file-contribution]').setAttribute('aria-checked', String(!!sharingFiles));
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
  on('[data-toggle-contribution]', 'click', () => act(async () => {
    const network = session.getState().network, enable = !network?.sharing;
    if (enable && network?.paused) await session.connect();
    // Switching on explicitly grants this resource; render and discovery never do.
    return session.setSharing(enable, contributionSelect.value, enable);
  }));
  on('[data-toggle-file-contribution]', 'click', () => act(async () => {
    const network = session.getState().network, files = network?.files;
    const enable = !(files?.sharing || files?.preparing);
    if (enable && network?.paused) await session.connect();
    return session.setFileSharing(enable, contributionSelect.value, enable);
  }));
  return () => { controller.abort(); unsubscribe(); };
}
