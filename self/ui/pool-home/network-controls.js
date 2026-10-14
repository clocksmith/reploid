import { computerLabel, withComputerLabels } from './computer-labels.js';
import { updateModelSelect } from '../components/model-select.js';
/** Shared network controls consume host snapshots; they never grant permission on render. */
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const renderConnectionControl = () => `<div class="network-sharing-row">
  <div><strong>Network connection</strong><span data-connection-label>Disconnected</span></div>
  <button class="network-switch" type="button" role="switch" aria-label="Connect to network" aria-checked="false" data-mesh-connect><span></span></button>
</div>`;

export const renderSharingControls = () => `<div class="network-sharing-row">
          <div><strong>Help peers connect</strong><p>Forward invitations without sharing conversations, model files, or compute.</p></div>
          <button class="network-switch" type="button" role="switch" aria-label="Help peers connect" aria-checked="false" data-toggle-introductions><span></span></button>
        </div><p class="network-sharing-summary" data-tab-sharing-summary role="status" hidden></p>
        <label>Model to share <select class="pool-input" data-contribution-model aria-label="Model to share"></select></label>
        <div class="network-sharing-row">
          <div><strong>Help answer requests <span data-contrib-label>Not sharing</span></strong>
            <p>Run peers’ public prompts on this device.</p><p data-contribution-limits></p>
            <p data-contribution-progress role="status" hidden></p>
            <button type="button" class="pool-button" data-retry-contribution-stop hidden>Retry stopping</button></div>
          <button class="network-switch" type="button" role="switch" aria-label="Help answer requests" aria-checked="false" data-toggle-contribution><span></span></button>
        </div>
        <div class="network-sharing-row">
          <div><strong>Store and share model files <span data-file-contribution-label>Not sharing</span></strong>
            <p>Share verified model files independently of answering requests.</p>
            <label>File participation <select class="pool-input" data-file-mode aria-label="File participation">
              <option value="cached-only">Cached only</option><option value="bounded-acquisition">Bounded acquisition</option>
              <option value="full-model">Full-model seeding</option></select></label>
            <label data-file-download-label hidden>Total download allowance (MiB)
              <input class="pool-input" data-file-download type="number" min="1" step="1" aria-label="Total download allowance in MiB"></label>
            <p data-file-download-policy>No downloads in cached-only mode. Acquiring modes charge metadata and failed attempts; restarting does not renew the allowance.</p><p data-file-limits></p>
            <p data-file-progress role="status" hidden></p></div>
          <button class="network-switch" type="button" role="switch" aria-label="Store and share model files" aria-checked="false" data-toggle-file-contribution><span></span></button>
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
      phase: partition?.phase || null, partitionIndex: partition?.index ?? null,
      status: offered ? (partition.index == null ? 'Waiting for placement' : `Partition ${partition.index + 1} · ${partition.phase}`)
        : peer.role === 'provider' ? (peer.executionPhase || 'Offered') : 'Connected' });
  }
  return [...peers.values()];
}

function renderPeerRows(list, state) {
  const rows = projectNetworkPeers(state), key = JSON.stringify(rows.map(peer => [peer, computerLabel(state, peer.id)]));
  if (list.dataset.projection === key) return;
  list.dataset.projection = key;
  const expanded = new Set([...list.querySelectorAll('details[open]')].map(node => node.dataset.peerIdentity));
  list.innerHTML = rows.length ? rows.map(peer => {
    const status = ({ loading: 'Preparing', ready: 'Ready', executing: 'Working', failed: 'Unavailable', waiting: 'Waiting', stopping: 'Stopping' })[peer.phase] || peer.status;
    return `<li class="network-peer-row" data-peer-phase="${escape(peer.phase || 'connected')}"><div><strong>${escape(computerLabel(state, peer.id))}</strong><span>${escape(peer.model)}</span>
      <details data-peer-identity="${escape(peer.id)}"${expanded.has(peer.id) ? ' open' : ''}><summary>Details</summary><p>${escape(peer.status)}</p><code>${escape(peer.id)}</code></details></div><span class="network-status">${escape(status)}</span></li>`;
  }).join('') : '<li class="network-empty">No computers connected yet</li>';
  const summary = list.parentElement.querySelector('[data-peer-readiness]');
  if (summary) summary.textContent = `${rows.filter(peer => peer.phase === 'ready').length} ready · ${rows.filter(peer => peer.phase === 'executing').length} working · ${rows.filter(peer => peer.phase === 'failed').length} unavailable`;

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
  const render = snapshot => {
    const state = withComputerLabels(snapshot, session);
    const catalogModels = state.models || [], keyFor = model => model?.selectionId || model?.id;
    const prepared = catalogModels.find(model => !model.partition && model.id === state.defaultModel?.id
      && ['ready', 'busy'].includes(state.defaultModel?.availability));
    const contributionKey = contributionSelect.value || keyFor(prepared || catalogModels.find(model => !model.partition));
    updateModelSelect(contributionSelect, catalogModels.filter(model => !model.partition), { value: contributionKey });
    const network = state.network || {}, peers = projectNetworkPeers(state);
    find('[data-toggle-introductions]')?.setAttribute('aria-checked', String(!!network.introductionAssistance));
    find('[data-mesh-invite]').hidden = network.discoveryScope !== 'private';
    contributionSelect.disabled = !!network.sharing || !!network.stopping || !!network.files?.sharing || !!network.files?.preparing;
    for (const node of container.querySelectorAll('[data-mesh-peers]')) node.textContent = peers.length + (peers.length === 1 ? ' computer' : ' computers');
    renderPeerRows(find('[data-insp-device-list]'), state);
    const discoveryState = network.consumer?.connectionState;
    const activeDiscovery = network.connecting || ['connected', 'connecting', 'retrying', 'awaiting-introduction'].includes(discoveryState);
    const connectControl = find('[data-mesh-connect]');
    connectControl.disabled = false;
    connectControl.dataset.disconnect = String(!!activeDiscovery);
    connectControl.setAttribute('aria-checked', String(!!activeDiscovery));
    find('[data-connection-label]').textContent = network.connecting || discoveryState === 'connecting' ? 'Connecting…'
      : discoveryState === 'awaiting-introduction' ? 'Needs an invitation'
      : discoveryState === 'retrying' ? 'Reconnecting…' : activeDiscovery ? 'Connected' : 'Disconnected';
    const message = find('[data-network-message]');
    message.textContent = network.error || actionError || ''; message.hidden = !message.textContent;
    const cleanupPending = network.contribution?.unsettledOwners > 0;
    find('[data-contrib-label]').textContent = network.stopping ? 'Stopping' : cleanupPending ? 'Cleanup not confirmed' : network.sharing
      ? ({ loading: 'Loading', ready: 'Ready', executing: 'Executing', failed: 'Failed' }[network.contribution?.phase] || 'Sharing') : 'Not sharing';
    find('[data-toggle-contribution]').setAttribute('aria-checked', String(!!network.sharing));
    find('[data-toggle-contribution]').disabled = !!network.stopping || cleanupPending;
    find('[data-retry-contribution-stop]').hidden = !cleanupPending;
    find('[data-retry-contribution-stop]').disabled = !!network.stopping;
    find('[data-contribution-limits]').textContent = network.limits ? network.limits.maxInboundJobs + (network.limits.maxInboundJobs === 1 ? ' request' : ' requests') + ' at a time · ' + network.limits.maxOutputTokens + ' output tokens per request' : '';
    const progress = network.contribution?.progress;
    const progressText = typeof progress === 'string' ? progress : progress?.message || progress?.stage || progress?.phase || '';
    const progressNode = find('[data-contribution-progress]');
    progressNode.textContent = network.contribution?.error || progressText;
    progressNode.hidden = !progressNode.textContent;
    const fileLimits = network.files?.limits;
    const gib = bytes => (bytes / 1073741824).toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' GiB';
    find('[data-file-limits]').textContent = fileLimits
      ? `Store up to ${gib(fileLimits.storedBytes)} · Send up to ${gib(fileLimits.supplyBytes)}` : 'Limits will be shown when file sharing is prepared.';
    const sharingFiles = network.files?.sharing || network.files?.preparing || network.files?.stopping;
    const modeSelect = find('[data-file-mode]'), downloadInput = find('[data-file-download]');
    if (modeSelect) {
      modeSelect.disabled = !!sharingFiles;
      if (fileLimits?.maxDownloadBytes) downloadInput.max = fileLimits.maxDownloadBytes / 1048576;
      if (!downloadInput.value && fileLimits?.downloadBytes) downloadInput.value = fileLimits.downloadBytes / 1048576;
      find('[data-file-download-label]').hidden = modeSelect.value === 'cached-only';
      downloadInput.disabled = !!sharingFiles || !!network.files?.acquisitionBudget;
      // Full-model seeding states its whole download and storage before it is switched on.
      if (modeSelect.value === 'full-model') {
        const seeding = network.files?.seedingBytes?.[contributionSelect.value];
        find('[data-file-limits]').textContent += Number.isSafeInteger(seeding)
          ? ` · Full-model seeding downloads and keeps ${gib(seeding)} on this device and needs an allowance of at least ${Math.ceil(seeding / 1048576).toLocaleString()} MiB`
          : ' · The full-model size is checked against your allowance when seeding starts';
      }
      if (network.files?.acquisitionBudget) {
        downloadInput.value = network.files.acquisitionBudget.maxBytes / 1048576;
        find('[data-file-limits]').textContent += ` · Download allowance used ${gib(network.files.acquisitionBudget.reservedBytes)} of ${gib(network.files.acquisitionBudget.maxBytes)}`;
      }
    }
    find('[data-file-contribution-label]').textContent = network.files?.error || (network.files?.stopping ? 'Stopping' : network.files?.preparing ? 'Preparing' : sharingFiles ? 'Sharing' : 'Not sharing');
    find('[data-file-progress]').textContent = network.files?.progress?.message || '';
    find('[data-file-progress]').hidden = !find('[data-file-progress]').textContent;
    find('[data-toggle-file-contribution]').setAttribute('aria-checked', String(!!sharingFiles));
    find('[data-toggle-file-contribution]').disabled = !!network.files?.stopping;
    const contribution = network.contribution || {};
    const sharedId = contribution.modelId || contribution.descriptor?.modelId;
    const sharedName = catalogModels.find(model => model.id === sharedId)?.name || sharedId;
    const sharing = [];
    if (network.sharing || network.stopping) sharing.push((sharedName || 'Selected model')
      + (contribution.partition ? ' · partition compute' : ' · compute'));
    if (sharingFiles) sharing.push((network.files?.model?.name || network.files?.model?.id || 'Model files') + ' · files');
    find('[data-tab-sharing-summary]').textContent = sharing.join(' / ');
    find('[data-tab-sharing-summary]').hidden = !sharing.length;
  };
  const unsubscribe = session.subscribe(render);
  on('[data-mesh-connect]', 'click', () => {
    const disconnect = find('[data-mesh-connect]').dataset.disconnect === 'true';
    return act(() => disconnect ? session.disconnect() : session.connect());
  });
  on('[data-mesh-invite]', 'click', () => act(async () => {
    if (!getInviteUrl) throw new Error('Mesh invitation is unavailable');
    await navigator.clipboard.writeText(getInviteUrl());
    const node = find('[data-network-message]'); node.textContent = 'Invite copied'; node.hidden = false;
  }));
  on('[data-toggle-introductions]', 'click', () => act(() =>
    session.setIntroductionAssistance(!session.getState().network?.introductionAssistance)));
  on('[data-toggle-contribution]', 'click', () => act(async () => {
    const network = session.getState().network, enable = !network?.sharing;
    if (enable && network?.paused) await session.connect();
    // Switching on explicitly grants this resource; render and discovery never do.
    return session.setSharing(enable, contributionSelect.value, enable);
  }));
  on('[data-retry-contribution-stop]', 'click', () => act(() =>
    session.setSharing(false, contributionSelect.value, false)));
  on('[data-file-mode]', 'change', () => render(session.getState()));
  on('[data-toggle-file-contribution]', 'click', () => act(async () => {
    const network = session.getState().network, files = network?.files;
    const enable = !(files?.sharing || files?.preparing);
    if (enable && network?.paused) await session.connect();
    const mode = find('[data-file-mode]')?.value || 'cached-only';
    return session.setFileSharing(enable, contributionSelect.value, enable, {
      mode, ...(mode !== 'cached-only' ? { downloadBytes: Number(find('[data-file-download]')?.value) * 1048576 } : {})
    });
  }));
  return () => { controller.abort(); unsubscribe(); };
}
