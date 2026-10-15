import { publicPreparationProgress } from '../../vendor/reploid/mesh/preparation-progress.js';
import { computerLabel, withComputerLabels } from './computer-labels.js';
import { updateModelSelect } from '../components/model-select.js';
/** Shared network controls consume host snapshots; they never grant permission on render. */
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const renderConnectionControl = () => `<div class="network-sharing-row">
  <div><strong class="pool-small">Network connection</strong><span class="pool-small pool-muted" data-connection-label>Disconnected</span></div>
  <button class="network-switch pool-switch" type="button" role="switch" aria-label="Connect to network" aria-checked="false" data-mesh-connect><span></span></button>
</div>`;

export const renderSharingControls = () => `<div class="pool-stack pool-gap-lg">
  <div class="pool-stack pool-gap-xs"><h3 class="pool-subheading">Contribute</h3>
    <p class="pool-small pool-muted">Choose what this device shares. You don’t need to download a model to ask questions.</p></div>
  <p class="pool-small" data-tab-sharing-summary role="status" hidden></p>
  <div class="network-sharing-row">
    <div class="pool-stack pool-gap-xs"><strong>Answer requests</strong>
      <p class="pool-muted">Download a model and run others’ public prompts.</p>
      <span class="pool-small pool-muted" data-contrib-label>Not sharing</span>
      <p data-contribution-progress role="status" hidden></p>
      <button type="button" class="pool-button" data-retry-contribution-stop hidden>Retry stopping</button></div>
    <button class="network-switch pool-switch" type="button" role="switch" aria-label="Help answer requests" aria-checked="false" data-toggle-contribution><span></span></button>
  </div>
  <div class="network-sharing-row">
    <div class="pool-stack pool-gap-xs"><strong>Share model files</strong>
      <p class="pool-muted">Let others download files stored on this device.</p>
      <span class="pool-small pool-muted" data-file-contribution-label>Not sharing</span>
      <p data-file-progress role="status" hidden></p></div>
    <button class="network-switch pool-switch" type="button" role="switch" aria-label="Store and share model files" aria-checked="false" data-toggle-file-contribution><span></span></button>
  </div>
  <details class="pool-disclosure"><summary>Model and limits</summary><div class="pool-stack pool-gap-md">
    <label>Model<select class="pool-input" data-contribution-model aria-label="Model to share"></select></label>
    <p data-contribution-limits></p>
    <label>Files to share<select class="pool-input" data-file-mode aria-label="File participation">
      <option value="cached-only">Already downloaded</option><option value="bounded-acquisition">Download within a limit</option>
      <option value="full-model">Download the full model</option></select></label>
    <label data-file-download-label hidden>Total download allowance (MiB)
      <input class="pool-input" data-file-download type="number" min="1" step="1" aria-label="Total download allowance in MiB"></label>
    <p class="pool-muted" data-file-download-policy>No downloads in cached-only mode. Acquiring modes charge metadata and failed attempts; restarting does not renew the allowance.</p>
    <p data-file-limits></p>
  </div></details>
  <details class="pool-disclosure"><summary>Connection assistance</summary><div class="network-sharing-row">
    <div><strong>Help peers connect</strong><p class="pool-muted">Forward invitations without sharing conversations, model files, or compute.</p></div>
    <button class="network-switch pool-switch" type="button" role="switch" aria-label="Help peers connect" aria-checked="false" data-toggle-introductions><span></span></button>
  </div></details>
</div>`;

function preparationStatus(progress) {
  const step = publicPreparationProgress(progress);
  if (!step) return { status: 'Preparing', detail: 'Preparing the model; this computer has not reported the current step.' };
  const count = step.totalBytes ? ` ${Math.floor(step.receivedBytes / step.totalBytes * 100)}% of the current file.` : '';
  const labels = {
    downloading: ['Downloading', 'Downloading model files.' + count],
    receiving: ['Receiving files', 'Receiving model files from another computer.' + count],
    cached: ['Loading cache', 'Loading model files already stored on this computer.'],
    pipelines: ['Preparing GPU', 'Preparing GPU pipelines' + (step.total ? `: ${step.prepared} of ${step.total}.` : '.')],
    loading: ['Preparing', 'Loading the model into memory.']
  };
  const [status, detail] = labels[step.kind];
  return { status, detail };
}

export function projectNetworkPeers(state) {
  const network = state.network || {};
  const own = new Set([network.consumer?.peerId, network.supplier?.peerId]);
  const peers = new Map();
  for (const snapshot of [network.consumer, network.supplier]) for (const peer of snapshot?.peers || []) {
    if (own.has(peer.peerId)) continue;
    const capability = network.partitionPeers?.find(item => item.transportId === peer.peerId);
    const description = capability?.available ? capability.description : null;
    const partition = description && (description.offer || description.assignment || description.models?.length || description.phase !== 'idle') ? description : null;
    const offered = partition?.offer || partition?.assignment || partition?.models?.[0];
    const modelId = offered?.id || offered?.modelId || peer.model;
    const model = state.models?.find(item => item.id === modelId)?.name || modelId || 'No model offered';
    const index = partition?.index ?? offered?.index ?? null;
    let phase = partition?.phase || peer.readiness || null;
    const capacity = partition?.capacity;
    if (phase === 'ready' && capacity?.active > 0) phase = 'executing';
    else if (phase === 'ready' && (capacity?.availableSlots ?? peer.availableSlots) === 0) phase = 'busy';
    let status = 'Connected', detail = 'Connected to the network; not offering model execution.';
    if (phase === 'loading') ({ status, detail } = preparationStatus(partition?.preparation || peer.preparation));
    else if (phase === 'waiting') {
      status = index === null ? 'Needs contributor' : 'Awaiting route';
      detail = index === null ? 'Connected. Waiting for another contributor before assigning a model stage.'
        : 'Connected. Waiting for the other model stages to form a complete route.';
    } else if (phase === 'ready') {
      status = 'Ready'; detail = partition ? 'Model stage prepared; a complete route is required to answer.' : 'Model loaded and ready to answer.';
    } else if (phase === 'executing') { status = 'Working'; detail = 'Answering a request.'; }
    else if (phase === 'busy') { status = 'At capacity'; detail = 'Model loaded; all request slots are occupied.'; }
    else if (phase === 'failed') { status = 'Failed'; detail = 'Model preparation or execution failed on this computer.'; }
    else if (phase === 'stopping') { status = 'Stopping'; detail = 'Finishing cleanup before releasing resources.'; }
    else if (modelId) { status = 'Status unknown'; detail = 'Connected, but model readiness has not been reported.'; }
    peers.set(peer.peerId, { id: peer.peerId, model, phase, partitionIndex: index, status, detail });
  }
  return [...peers.values()];
}

function renderPeerRows(list, state) {
  const rows = projectNetworkPeers(state), key = JSON.stringify(rows.map(peer => [peer, computerLabel(state, peer.id)]));
  if (list.dataset.projection === key) return;
  list.dataset.projection = key;
  const expanded = new Set([...list.querySelectorAll('details[open]')].map(node => node.dataset.peerIdentity));
  list.innerHTML = rows.length ? rows.map(peer => {
    const status = peer.status;
    return `<li class="network-peer-row" data-peer-phase="${escape(peer.phase || 'connected')}"><div><strong class="pool-small">${escape(computerLabel(state, peer.id))}</strong><span class="pool-small pool-muted">${escape(peer.model)}</span><p class="pool-small pool-muted">${escape(peer.detail)}</p>
      <details data-peer-identity="${escape(peer.id)}"${expanded.has(peer.id) ? ' open' : ''}><summary>Details</summary><p>${escape(peer.partitionIndex === null ? peer.status : `Model stage ${peer.partitionIndex + 1} · ${peer.status}`)}</p><code>${escape(peer.id)}</code></details></div><span class="network-status pool-chip${peer.phase === 'ready' ? ' pool-dot' : ''}${peer.phase === 'failed' ? ' pool-muted' : ''}">${escape(status)}</span></li>`;
  }).join('') : '<li class="network-empty pool-small pool-muted">No computers connected yet</li>';
  const summary = list.parentElement.querySelector('[data-peer-readiness]');
  if (summary) summary.textContent = `${rows.filter(peer => peer.phase === 'ready').length} ready · ${rows.filter(peer => peer.phase === 'executing').length} working · ${rows.filter(peer => peer.phase === 'failed').length} unavailable`;

}

export function bindNetworkControls(container, session, { getInviteUrl, requestContribution } = {}) {
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
      ? (network.contribution?.phase === 'loading' ? preparationStatus(network.contribution.progress).status
        : ({ ready: 'Ready', executing: 'Working', failed: 'Failed', waiting: 'Waiting for another contributor' }[network.contribution?.phase] || 'Sharing')) : 'Not sharing';
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
    if (enable) {
      if (!requestContribution) throw new Error('Review the model download before contributing');
      return requestContribution(contributionSelect.value, find('[data-toggle-contribution]'));
    }
    return session.setSharing(false, contributionSelect.value, false);
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
