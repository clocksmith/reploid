/**
 * The Computers pane as a view record: the account, your computers, the public network and this computer.
 * Framework-free and DOM-free. Every line is composed from the decisions the vanilla pane used
 * (network-controls.js, contribution-models.js, fleet-account-view.js, private-computers-view.js,
 * computer-preferences-view.js, service-credit-text.js), so both interfaces state the same facts.
 * Nothing here grants, admits or changes anything; the host does.
 */
import { projectNetworkPeers } from '../../ui/pool-home/network-controls.js';
import { computerLabel } from '../../ui/pool-home/computer-labels.js';
import { hardwareText } from '../../ui/pool-home/execution-ribbon.js';
import { preparationStatus } from '../../ui/pool-home/model-preparation.js';
import { projectProduction, modelSupplyText, suggestedModelId } from '../../ui/pool-home/contribution-models.js';
import { fleetAccountText, fleetStarterText } from '../../ui/pool-home/fleet-account-view.js';
import { hasBrowserModelOrigin, modelVariantLabel } from '../../ui/components/model-select.js';
import { sameModelVariant } from '../../ui/pool-home/model-providers.js';

export { creditAccounts, accountText, creditActivity } from '../../ui/pool-home/service-credit-text.js';

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString() : 'Not reported';
const gib = value => Number.isFinite(value) ? `${(value / 1024 ** 3).toFixed(1)} GiB` : 'Not reported';
const PEER_IDENTITY = /^peer:[a-f0-9]{24}$/;
const CONNECTION_PATH_LABELS = { relayed: 'Relayed', direct: 'Direct' };

/** The service-credit account (host/fleet-account.js), as Computers › Your account states it. */
export function projectFleetAccount(port) {
  const state = port?.state?.();
  if (!state?.available) return { available: false };
  const account = state.account;
  const pairing = state.pairing;
  return {
    available: true,
    busy: !!state.busy,
    signedIn: !!state.signedIn,
    hasAccount: !!account,
    status: state.busy ? 'Working…' : !state.signedIn ? 'Not signed in' : !account ? 'Signed in · no account yet' : fleetAccountText(account),
    starter: account ? fleetStarterText(account) : '',
    computers: (account?.computers || []).map(row => ({ id: row.participantId, name: row.name || 'Computer',
      status: `${row.fingerprint}${row.revokedAt ? ' · removed' : ''}`, removable: !row.revokedAt })),
    activityKey: account ? `${account.credits.balance}:${account.credits.held}` : '',
    error: state.error || '',
    pairing: pairing ? {
      state: pairing.state,
      code: pairing.code || '····-····',
      command: pairing.command || `npx reploid join ${pairing.code}`,
      computer: pairing.computer?.name || 'Waiting for the computer…',
      fingerprint: pairing.computer?.fingerprint || '—',
      status: state.error ? state.error : ({ open: 'Waiting for the computer…', claimed: 'Check the fingerprint on that computer, then confirm.',
        confirmed: 'Paired. Start its host, then choose Use for answers.', expired: 'This code expired. Close and make a new one.',
        cancelled: 'Cancelled.' }[pairing.state] || ''),
      canConfirm: !state.busy && pairing.state === 'claimed',
      confirmed: pairing.state === 'confirmed'
    } : null
  };
}

/** The paired desktop's line under "Connect a desktop" (owner-pairing-view.js). */
export function ownerPairingStatus(current) {
  if (!current) return 'Not paired';
  if (current.status === 'pairing') return `Waiting for desktop confirmation on ${current.hostLabel}…`;
  if (current.status === 'online') {
    const path = current.transportPath ? ` · ${current.transportPath}` : '';
    const model = current.readyModel ? ` · ${current.readyModel}` : '';
    return `Paired with ${current.hostLabel} · Online${path}${model}`;
  }
  if (current.status === 'offline') return `${current.hostLabel} · Offline`;
  return 'Not paired';
}

/** Your private computers (host/private-computers.js): one row per enrolled computer with its reported facts. */
export function projectPrivateComputers(fleet) {
  if (!fleet) return { available: false };
  return {
    available: true,
    connected: !!fleet.connected,
    hasRequester: !!fleet.requester,
    status: fleet.connected ? `${fleet.computers.filter(row => row.online).length} online · via ${fleet.requester.name}` : fleet.connecting ? 'Connecting…' : 'Not connected',
    error: fleet.error || '',
    activityKey: JSON.stringify((fleet.computers || []).map(row => [row.id, row.activeRequests ?? 0, row.queuedRequests ?? 0])),
    computers: (fleet.computers || []).map(row => {
      const online = fleet.connected && row.online;
      const queued = row.queuedRequests > 0 ? ` · ${row.queuedRequests} queued` : '';
      const status = !online ? 'Offline' : row.requester && !row.resident ? `Online · requester${queued}`
        : row.activeRequests > 0 ? `Serving${queued}` : row.preparing ? 'Loading'
          : row.preferences?.enabled === false ? 'Paused' : row.resident ? 'Ready' : row.requester ? 'Online · requester' : 'Online · no model loaded';
      const model = fleet.models?.find(item => item.identity === row.resident?.modelIdentity);
      const facts = [
        ['Model', online && row.resident ? model?.name || row.resident.modelIdentity : 'None reported'],
        ['Role', online && row.resident ? row.resident.mode === 'partition' ? `Split model · stage ${row.resident.stageIndex + 1}` : 'Whole model' : row.requester ? 'Requester' : 'No active role'],
        ['Active work', online ? row.queuedRequests > 0 ? `${row.activeRequests ?? 0} active · ${row.queuedRequests} queued` : String(row.activeRequests ?? 'Not reported') : 'Unknown']
      ];
      if (online && Number.isFinite(row.resident?.gpuBytes)) {
        const threads = Number.isSafeInteger(row.resident?.cachedContexts) && row.resident.cachedContexts > 0
          ? ` · ${row.resident.cachedContexts} cached ${row.resident.cachedContexts === 1 ? 'thread' : 'threads'}` : '';
        facts.push(['Resident GPU use', gib(row.resident.gpuBytes) + threads]);
      }
      facts.push(['Available GPU budget', online ? gib(row.freeGpuBytes) : 'Unknown'], ['Available system memory', online ? gib(row.freeHostBytes) : 'Unknown']);
      return { id: row.id, name: row.name, status, tone: !online ? 'unavailable' : row.preparing || row.preferences?.enabled === false ? 'pending' : 'ready', facts };
    })
  };
}

function connectionView(network, peers) {
  const discoveryState = network.introductionState ?? network.consumer?.connectionState;
  const active = network.connecting || ['connected', 'connecting', 'retrying', 'awaiting-introduction'].includes(discoveryState);
  const surviving = !active && network.consumer?.connectionState === 'connected';
  const privateScope = network.discoveryScope === 'private';
  const label = network.connecting || discoveryState === 'connecting' ? 'Connecting…'
    : discoveryState === 'awaiting-introduction' ? privateScope ? 'Needs an invitation' : 'Discovering computers…'
      : discoveryState === 'retrying' ? 'Reconnecting…' : active ? 'Discovery connected' : surviving ? 'Discovery interrupted' : 'Disconnected';
  const detail = network.connecting || discoveryState === 'connecting' ? 'Connection requested. Waiting for network discovery.'
    : discoveryState === 'awaiting-introduction' ? privateScope ? 'Open an invitation from another computer to continue.' : 'Looking for a public computer. You can also review a local model download.'
      : discoveryState === 'retrying' ? 'Discovery interrupted. Retrying; existing computer connections may still work.'
        : surviving ? 'Existing peer connections may still work. Retry discovery to find other computers.'
          : active ? (peers.length ? '' : 'Waiting for other computers to join.')
            : 'Connect to discover computers. Model readiness is reported separately.';
  return { on: !!active || surviving, label, detail, privateScope };
}

/** The roster rows, filtered to one model's serving computers when a filter is set (network-controls.js renderPeerRows). */
function peerRows(state, filter, names) {
  const rows = projectNetworkPeers(state).filter(peer => !filter || (peer.executionType === 'whole-model' && !peer.blocked
    && (!filter.model || peer.modelId === filter.model.id && peer.modelIdentity === filter.model.identity) && filter.providers.includes(peer.id)));
  const byLabel = new Map();
  for (const peer of rows) {
    const label = computerLabel(state, peer.id);
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push(peer.id);
  }
  const views = rows.map(peer => {
    const label = computerLabel(state, peer.id), same = byLabel.get(label);
    let suffix = 6;
    while (suffix < peer.id.length && same.some(id => id !== peer.id && id.slice(-suffix) === peer.id.slice(-suffix))) suffix++;
    const serving = ['ready', 'executing', 'loading', 'preparing'].includes(peer.phase);
    const participant = state.computerIdentities?.get(peer.id) || '';
    const identity = PEER_IDENTITY.test(participant) ? participant : '';
    const contribution = peer.contribution;
    return {
      id: peer.id,
      name: same.length > 1 ? `${label} · connection ${peer.id.slice(-suffix)}` : label,
      status: peer.status,
      tone: ['ready', 'executing'].includes(peer.phase) ? 'ready'
        : ['loading', 'preparing', 'connecting', 'connected', 'waiting'].includes(peer.phase) ? 'pending' : 'unavailable',
      phase: peer.phase || 'connected',
      state: peer.state,
      model: peer.model,
      hardware: hardwareText(peer.hardware),
      detail: serving && peer.phase === 'ready' ? (peer.partitionIndex === null ? '' : peer.detail) : peer.detail,
      progress: peer.progress ? { value: peer.progress.value, max: peer.progress.max } : null,
      quiet: !serving,
      blocked: peer.blocked === true,
      identity,
      localName: identity ? names?.[identity] ?? '' : '',
      blockNote: peer.blocked !== true ? 'Stops your requests on this device. It can still see the network.'
        : identity && state.blockedComputers?.has(identity) ? 'Blocked on this device. It can still see the network.'
          : 'This connection only. An unverified computer may reconnect unblocked.',
      connection: [
        ['Connection', CONNECTION_PATH_LABELS[peer.connectionPath] || 'Not observed'],
        ['Identity', peer.authenticated ? 'Authenticated' : 'Not observed'],
        ['Execution', peer.partitionIndex === null ? peer.executionType === 'whole-model' ? 'Whole model' : 'Not reported' : `Stage ${peer.partitionIndex + 1}`]
      ],
      usage: [
        ['Input tokens', count(contribution?.inputTokens)],
        ['Output tokens', count(contribution?.outputTokens)],
        ['Served receipts', count(contribution?.served)],
        ['Consumed receipts', count(contribution?.consumed)]
      ],
      ids: [['Connection ID', peer.id], ['Attempt ID', peer.attemptId || 'Not reported'], ['Model ID', peer.modelIdentity || 'Not reported']]
    };
  });
  // Serving computers first; order within each group follows discovery.
  return [...views.filter(row => !row.quiet), ...views.filter(row => row.quiet)];
}

/** "This computer": what it shares, what it recorded and how far its preparation got (network-controls.js). */
function deviceView(state, network) {
  const usage = state.computerUsage;
  const cleanupPending = network.contribution?.unsettledOwners > 0;
  const tokenText = value => value && value.available !== false ? `${value.outputTokens.toLocaleString()}${value.unmeasured ? ' + unmeasured' : ''}` : '—';
  const breakdown = usage?.consumedBySource;
  let scope = `Output tokens from up to the latest ${usage?.supplied?.limit ?? 200} recorded requests in each direction.`;
  if (usage?.consumed?.available && breakdown) scope += ` Used here: ${tokenText(breakdown.local)} local · ${tokenText(breakdown.network)} network`
    + (breakdown.unknown.requests ? ` · ${tokenText(breakdown.unknown)} unknown placement.` : '.');
  const hardware = network.contribution?.hardware || state.localModel?.hardware;
  const id = network.supplier?.peerId || network.consumer?.peerId;
  const progress = network.contribution?.progress;
  const progressText = network.contribution?.phase === 'loading' ? preparationStatus(progress).detail
    : typeof progress === 'string' ? progress : progress?.message || progress?.stage || progress?.phase || '';
  const sharingFiles = network.files?.sharing || network.files?.preparing || network.files?.stopping;
  const contribution = network.contribution || {};
  const sharedId = contribution.modelId || contribution.descriptor?.modelId;
  const sharedName = (state.models || []).find(model => model.id === sharedId)?.name || sharedId;
  const summary = [];
  if (network.sharing || network.stopping) summary.push((sharedName || 'Selected model') + (contribution.partition ? ' · partition compute' : ' · compute'));
  if (sharingFiles) summary.push((network.files?.model?.name || network.files?.model?.id || 'Model files') + ' · files');
  return {
    summary: cleanupPending ? '· Cleanup not confirmed'
      : network.stopping ? '· Stopping' : network.contribution?.phase === 'loading' ? '· ' + preparationStatus(network.contribution.progress).status
        : network.contribution?.phase === 'executing' ? '· Working' : network.sharing ? '· ' + (network.contribution?.phase === 'ready' ? 'Ready' : 'Sharing')
          : network.computeEnabled ? '· Enabled · not serving' : '· Paused',
    localComputer: [id ? computerLabel(state, id) : null, hardwareText(hardware) ? `Reported GPU: ${hardwareText(hardware)}` : 'GPU not reported'].filter(Boolean).join(' · '),
    supplied: usage?.supplied?.available ? tokenText(usage.supplied) : '—',
    consumed: tokenText(usage?.consumed),
    usageScope: scope,
    usageError: usage?.error || '',
    sharingSummary: summary.join(' / '),
    computeOn: network.computeEnabled ?? !!network.sharing,
    computeLabel: network.stopping ? 'Stopping' : cleanupPending ? 'Cleanup not confirmed' : network.sharing
      ? (network.contribution?.phase === 'loading' ? preparationStatus(network.contribution.progress).status
        : ({ ready: 'Ready', executing: 'Working', failed: 'Failed', waiting: 'Waiting for another contributor' }[network.contribution?.phase] || 'Sharing'))
      : network.computeEnabled ? 'On · waiting for a downloaded model' : 'Not sharing',
    computeDisabled: !!network.stopping || cleanupPending,
    retryStop: cleanupPending,
    retryStopDisabled: !!network.stopping,
    progress: network.contribution?.error || progressText,
    introductions: !!network.introductionAssistance,
    limits: network.limits ? 'Serving limits: ' + network.limits.maxInboundJobs + (network.limits.maxInboundJobs === 1 ? ' request' : ' requests')
      + ' at a time · ' + network.limits.maxOutputTokens + ' output tokens per request' : ''
  };
}

const number = value => Number.isFinite(value) && value >= 0 ? value.toLocaleString() : '—';
const bytes = value => Number.isFinite(value) && value >= 0
  ? value < 1048576 ? `${number(value)} B` : `${(value / 1048576).toFixed(1)} MB` : '—';
const downloadSize = value => value >= 1e9 ? `${(value / 1e9).toFixed(1)} GB ↓` : `${Math.ceil(value / 1e6)} MB ↓`;

/** Whole models (and catalog adapters) this device could share: stored here, or downloadable from their origin. */
export const shareableModels = state => (state.models || []).filter(model => !model.partition && model.provider === 'doppler' && model.source
  && (model.localReady || model.localCached || hasBrowserModelOrigin(model)));

/** The production block of "Contribute this computer" (contribution-models.js), with each shareable model's row. */
function productionView(state, sizes) {
  const last = projectProduction(state);
  const preparing = ['loading', 'connecting'].includes(last.phase);
  const models = shareableModels(state);
  const observed = state.discoveryPhase === 'observed', suggestion = suggestedModelId(models, { observed });
  const issue = state.localDownloadIssue || '';
  const rows = models.map(model => {
    const id = model.selectionId || model.id, size = sizes?.get(id);
    const detail = model.localReady ? 'Ready' : model.localCached ? 'Downloaded' : Number.isSafeInteger(size?.sizeBytes) ? downloadSize(size.sizeBytes) : '';
    const supply = [id === suggestion ? 'Suggested' : '', modelSupplyText(model, { observed })].filter(Boolean).join(' · ');
    return { id, name: model.name || model.id, status: [supply, detail, issue].filter(Boolean).join(' · '), disabled: !!issue,
      needsSize: !model.localCached && !model.localReady && !issue, label: issue || (model.localReady || model.localCached ? 'Share this model'
        : size?.error ? 'Check download size and retry' : 'Review download and sharing') };
  });
  const hasOutput = last.completed > 0 || last.outputTokens > 0 || last.suppliedBytes > 0;
  const hasCompute = !!state.network?.sharing || last.completed > 0 || last.outputTokens > 0;
  return {
    attention: preparing || !!last.error || last.cancellationPending,
    error: last.error || '',
    local: last.phase === 'loading' ? [] : last.local.map(model => `${model.name || model.id} · ${model.localReady || state.network?.contribution?.ready
      && model.id === state.network.contribution.modelId ? 'Prepared' : 'Downloaded'}`),
    work: !last.active || preparing ? '' : last.phase === 'executing' ? 'Working on a request' : 'Waiting for requests',
    metrics: preparing || !(last.active || hasOutput) ? [] : [
      ...(hasCompute ? [['Tokens produced', number(last.outputTokens)], ['Requests served', number(last.completed)]] : []),
      ...(state.network?.files?.enabled || last.suppliedBytes > 0 ? [['Files sent', bytes(last.suppliedBytes)]] : [])
    ],
    progress: last.progress ? { message: last.progress.message || '', value: Number.isFinite(last.progress.received) && last.progress.total > 0 ? last.progress.received : null,
      max: Number.isFinite(last.progress.received) && last.progress.total > 0 ? last.progress.total : null } : null,
    settlement: !!last.cancellationPending,
    setup: !(last.configured || last.active || preparing),
    changeModel: (last.configured || last.active) && rows.length > 0,
    models: rows,
    empty: rows.length ? '' : issue && !last.configured ? 'Local inference unavailable' : 'No models available',
    emptyTitle: issue && !last.configured ? issue : '',
    selection: last.selection || null,
    history: {
      count: last.history.records.length ? String(last.history.records.length) : '',
      status: last.history.error || (last.history.records.length ? `Latest ${last.history.records.length} saved executions` : 'No saved executions yet'),
      records: last.history.records.map(row => ({ id: `${row.modelId}:${row.completedAt}`, model: (state.models || []).find(model => model.id === row.modelId)?.name || row.modelId,
        at: new Date(row.completedAt).toLocaleString(), tokens: row.outputTokens === null ? 'Token count unavailable' : `${number(row.outputTokens)} tokens` }))
    }
  };
}

/** The GPU check (host/computer-preferences.js), as computer-preferences-view.js words it. */
export function projectDiagnostic(view) {
  if (!view) return { available: false };
  const comparison = view.comparison;
  const hardware = hardwareText(view.latest?.hardware);
  return {
    available: true,
    busy: !!view.busy,
    measuring: view.operation === 'gpu',
    canSave: !view.busy && !!view.canSave,
    baselineStored: !!view.baselineStored,
    error: view.error || '',
    baseline: view.baselineAt ? `Baseline saved: ${view.baselineAt}`
      : view.baselineStored ? 'Saved baseline could not be validated. Clear it or replace it after a new check.' : 'No baseline saved.',
    hardware: hardware ? `Reported GPU for this check: ${hardware}` : '',
    result: view.operation === 'gpu' ? 'Measuring this device…'
      : view.latest?.status === 'unavailable' ? `GPU check unavailable: ${view.latest.reason}`
        : view.baselineFromCurrent ? 'Baseline saved from this measurement. Run another check to compare.'
          : view.latest?.status === 'measured' ? comparison.distance !== null
            ? `Comparison uncertain. Distance ${comparison.distance.toFixed(4)}; observed variability ${comparison.variability.toFixed(4)}. Recognition thresholds have not been established.`
            : 'Measurement complete. Save a baseline to compare a later check. This is not proof of GPU identity.'
          : 'No measurement yet.'
  };
}

/**
 * The whole pane from one labelled chat state. `filter` is { model } from Answer on's computer count; `sizes` maps a
 * shareable model's selection to its checked download size; `names` are this device's local computer names.
 */
export function projectComputers(state, { filter = null, sizes = null, names } = {}) {
  const network = state.network || {};
  const allPeers = projectNetworkPeers(state);
  // A filter names a model ({ model }: its current providers) or the computers Answer on counted ({ providerIds, label }).
  const current = filter?.model && (state.models || []).find(row => !row.partition && !row.fleet
    && (row.selectionId || row.id) === (filter.model.selectionId || filter.model.id) && sameModelVariant(row, filter.model));
  const providers = filter?.model ? current?.providerIds || [] : filter?.providerIds || [];
  const peers = peerRows(state, filter ? { model: filter.model ?? null, providers } : null, names);
  const phase = state => peers.filter(peer => peer.phase === state).length;
  const quiet = peers.filter(peer => peer.quiet).length;
  return {
    connection: connectionView(network, allPeers),
    filterLabel: filter ? 'Computers for ' + (filter.model ? modelVariantLabel(filter.model) : filter.label) : '',
    readiness: [`${plural(phase('ready') + phase('executing'), 'computer')} ready`, phase('executing') ? `${phase('executing')} working` : '',
      phase('failed') ? `${phase('failed')} unavailable` : ''].filter(Boolean).join(' · '),
    peers,
    empty: peers.length ? '' : filter ? 'No computer offers this model right now. Show all computers to choose another.'
      : 'No computers are connected yet. They appear here as they join; this device can still answer.',
    quiet: quiet ? { show: `Show ${plural(quiet, 'other')} (connecting or idle)`, hide: `Hide ${plural(quiet, 'other')}` } : null,
    networkIssue: network.discoveryScope !== 'private' && /invit/i.test(network.error || '') ? 'Public discovery could not connect. Retry the connection.' : network.error || '',
    privateComputers: projectPrivateComputers(state.privateComputers),
    ownerPairing: state.ownerPairing ? { status: ownerPairingStatus(state.ownerPairing), paired: !!state.ownerPairing.paired, busy: state.ownerPairing.status === 'pairing',
      error: state.ownerPairing.error || '' } : null,
    device: deviceView(state, network),
    production: productionView(state, sizes)
  };
}

/** The network line under the pane: a discovery error, else whether the relay is unreachable. */
export { relayUnavailableReason } from '../../../../shared/capabilities/communication/library-adapter.js';
export const RELAY_UNAVAILABLE_TEXT = 'The relay service is unreachable. New connections are direct only, so some computers may not be reachable.';

/** Local names and blocks for verified computers, applied to the labels every view uses (computer-labels.js). */
export { withComputerLabels, setComputerNames, setBlockedComputers } from '../../ui/pool-home/computer-labels.js';

/** Specialized model jobs (operation-sharing.js): the approved models, the declared limits and the status line. */
import poolConfig from '../../../../shared/pool/pool-config.json' with { type: 'json' };
import { listPoolModels } from '../../../../shared/pool/model-contract.js';
import { validateOperationModel } from '../../../../shared/pool/operation-model.js';

export const operationModels = () => listPoolModels({ enabledOnly: true }).filter(model => validateOperationModel(model).ok);
export const operationLimitsText = () => {
  const { operationParticipation: config } = poolConfig;
  return `Declared limits: ${config.resources.concurrency} simultaneous job; ${config.resources.gpuBudgetBytes / 1073741824} GiB GPU allowance; `
    + `${config.maxModelArtifactBytes / 1073741824} GiB maximum model download.`;
};
export const operationStatusText = state => state.error || ({
  idle: 'Not sharing', starting: 'Preparing the operation offer',
  sharing: 'Offering ' + state.modelId + '. Jobs load the exact model when needed.',
  stopping: 'Stopping participation and releasing owned work'
})[state.phase];
/** The participation request for an approved model or an imported descriptor file's text. */
export async function operationSelection({ modelId = '', file = null } = {}) {
  if (modelId) {
    const model = operationModels().find(item => item.modelId === modelId);
    if (!model) throw new Error('This capability is no longer admitted');
    return { model };
  }
  if (!file || file.size > poolConfig.operationParticipation.maxConfigurationBytes) throw new Error('Choose a smaller model descriptor');
  const value = JSON.parse(await file.text());
  return value.schema === 'reploid.document-models/v1' ? { configuration: value } : { model: value };
}
