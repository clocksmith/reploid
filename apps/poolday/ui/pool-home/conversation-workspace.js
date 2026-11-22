/** Bind the conversation view to its host-owned session and independent drafts. */
import { createExecutionPolicy } from '../../../../shared/vendor/reploid/chat/execution-policy.js';
import { describeCircleHost, parseCircleInviteUrl } from '../../host/circle-invites.js';
import { allowsOpenPlaintext, readPrivacyControls, showPrivacyChoices, updatePrivacyControls } from './privacy-controls.js';
import workProfile from '../../config/work-profile.json' with { type: 'json' };
import { bindControlHelp } from '../components/control-help.js';
import { bindWorkspaceNavigation } from './workspace-navigation.js';
import { updateContextIndicator } from './context-indicator.js';
import { withComputerLabels } from './computer-labels.js';
import { interfaceIcon } from '../components/interface-icons.js';
import { createConversationList } from './conversation-list.js';
import { hasBrowserModelOrigin, isDownloadableBaseModel, updateModelSelect, bindModelChoices, modelVariantKey, modelExecutionState, modelVariantLabel, unavailableModelChoice } from '../components/model-select.js';
import { bindNetworkInspector } from './network-inspector.js';
import { bindDrawer } from '../components/drawer.js';
import { renderAttachments, createTextAttachmentReader } from '../components/attachments.js';
import { bindDisclosure } from '../components/disclosure.js';
import { bindDialog } from '../components/dialog.js';
import { createMessageList } from './message-list.js';
import { bindHistoryHandover } from './history-handover-view.js';
import { bindProductionControls } from './contribution-models.js';
import { webSearchRecipient } from './web-search-settings.js';
import { canDownloadModelHere, localFitText, recoverySharedModel, updateConversationModelPicker } from './conversation-model-picker.js';
import { escapeHtml } from '../components/attachments.js';
import { remotePermissionText, remotePermissionWording } from './remote-permission.js';
export { renderConversationWorkspace } from './conversation-view.js';

const busyAcquisition = state => state.acquisition?.phase === 'downloading';
const modelKey = model => model?.selectionId || model?.id;
const modelIdentity = model => JSON.stringify([modelKey(model), model?.identity, (model?.adapters || []).map(adapter => adapter.identity)]);
const selectable = model => ['ready', 'busy', 'cached', 'loading', 'preparing'].includes(model.availability);

export function bindConversationWorkspace(root, session, { getInviteUrl, viewState = {}, inspector: sharedInspector, webSearch = null, search = null, historyHandover = null } = {}) {
  const container = root.querySelector('[data-chat-workspace]');
  if (!container || !session) return () => {};
  const surface = container.closest('.pool-home');
  const find = selector => container.querySelector(selector) || surface?.querySelector(selector);
  const controller = new AbortController(), options = { signal: controller.signal };
  const input = find('[data-composer-input]'), modelSelect = find('[data-active-model-select]');
  const detachHelp = bindControlHelp(container);
  const inspector = sharedInspector || bindNetworkInspector(container, session, { getInviteUrl, webSearch, search });
  const nextModelChoices = bindModelChoices(find('[data-next-model]'), { onInspectProviders(selectionId, variantKey) {
    const model = session.getState().models?.find(item => modelKey(item) === selectionId && modelVariantKey(item) === variantKey);
    if (!model || !model.providerIds?.length || !inspector.openModelComputers) return;
    picker.close();
    inspector.openModelComputers(model, find('[data-open-model]'));
  } });
  let archived = false, renameId = null, chosenModel = viewState.chosenModel || null, pickerModel = null, pickerLocation = 'auto';
  let changingModel = false, pickerTouched = false, recoverySelection = null, pickerRevision = 0;
  let files = [], composerRevision = 0, queuedSend = null, queueHasText = false;
  const attachmentReader = createTextAttachmentReader({
    getFiles: () => files,
    onLoaded: async loaded => { files.push(...loaded); composerRevision++; await saveDraft(); showFiles(); },
    onPending: () => { if (!controller.signal.aborted) render(session.getState()); },
    limits: { maxFiles: workProfile.files.maxInputs, maxFileBytes: workProfile.files.maxFileBytes,
      maxTotalBytes: workProfile.files.maxInputBytes, extensions: ['txt', 'md', 'json', 'js', 'ts', 'html', 'css'] }
  });
  let contextPrompt = viewState.contextPrompt || null;
  let executionLocation = viewState.executionLocation || 'auto';
  const localPolicy = createExecutionPolicy();
  const explicitPrivacy = state => (state.activeThread ? state.activeThread.privacy : viewState.privacy) ?? localPolicy;
  const currentPolicy = explicitPrivacy;
  const privacyNode = find('[data-privacy-dialog]'), privacyTrigger = find('[data-open-privacy]');
  const privacyDialog = bindDialog(privacyNode);
  let sendAfterDestination = false, pickerChoice = null;
  /** Which computer the current policy sends to: this device, the paired or invited computer, contributors, or named IDs. */
  const destinationKey = state => {
    const policy = explicitPrivacy(state), locked = lockedDestination(state);
    return policy.placement === 'local-only' || policy.recipients.kind === 'none' ? 'device'
      : policy.recipients.kind === 'open' ? 'contributors'
        : locked && policy.recipients.ids.length === 1 && policy.recipients.ids[0] === locked.id ? 'desktop' : 'named';
  };
  let editingThread, applyingPrivacy = false;
  const effectiveLocation = state => {
    const thread = state.activeThread, privacy = explicitPrivacy(state);
    return thread?.permissions?.sharingScope === 'local' || privacy.placement === 'local-only' || privacy.recipients?.kind === 'none'
      ? 'local' : thread?.permissions?.executionLocation ?? executionLocation;
  };
  // A host invite link names the only computer that may read this visitor's prompts. Read it once, keep it
  // in this view, and take the token out of the address bar so a reload or shared tab cannot reuse it.
  if (viewState.guestInvite === undefined) {
    let invite = null;
    try { invite = parseCircleInviteUrl(globalThis.location?.href || ''); } catch { invite = null; }
    viewState.guestInvite = invite;
    if (invite) { try { const { history: h, location: l } = globalThis; h.replaceState(h.state, '', l.pathname + l.search); } catch { /* keep going */ } }
  }
  /** The one computer a new conversation is locked to: an invite's host, else the paired online desktop. */
  const lockedDestination = state => {
    const owner = state.ownerPairing, invite = viewState.guestInvite, guest = state.guestAccess;
    const modelId = model => typeof model === 'string' ? model : model?.id ?? null;
    if (owner?.status === 'online' && owner.hostParticipantId && !invite) {
      return { id: owner.hostParticipantId, label: owner.hostLabel, readyModel: modelId(owner.readyModel), status: 'online', guest: false };
    }
    // An invite link, or a computer this device already joined as a guest: only that host may receive prompts.
    if (invite || guest?.hostParticipantId) {
      const id = invite?.hostPeerId || guest.hostParticipantId, same = guest?.hostParticipantId === id;
      return { id, label: describeCircleHost(invite?.hostLabel || guest?.hostLabel, id).hostLabel,
        readyModel: same ? modelId(guest.readyModel) : null, status: same ? guest.status : 'invited', guest: true };
    }
    return null;
  };
  // A locked destination is the default for a new conversation: only that computer may receive the prompt,
  // and the composer picks the model it reports ready. A manual policy choice wins, except over an invite.
  const applyPairedDesktopDefault = state => {
    const destination = lockedDestination(state);
    if (state.activeThread || !destination || (viewState.privacyTouched && !destination.guest)) return;
    const current = viewState.privacy;
    if (current?.recipients?.kind !== 'named' || current.recipients.ids.length !== 1 || current.recipients.ids[0] !== destination.id) {
      viewState.privacy = createExecutionPolicy({ placement: 'network-allowed',
        recipients: { kind: 'named', ids: [destination.id] }, computation: 'plaintext' });
      if (executionLocation === 'local') executionLocation = viewState.executionLocation = 'auto';
    }
    if (!chosenModel && destination.readyModel) {
      const model = (state.models || []).find(item => item.id === destination.readyModel || modelKey(item) === destination.readyModel);
      if (model) chosenModel = viewState.chosenModel = model;
    }
  };
  const pairedDesktopSummary = state => {
    const destination = lockedDestination(state), privacy = explicitPrivacy(state);
    if (!destination || privacy.recipients?.kind !== 'named' || privacy.recipients.ids.length !== 1
      || privacy.recipients.ids[0] !== destination.id) return null;
    return `Sending to ${destination.label}. Its operator can read your prompt.`;
  };
  const recoveryAlternative = state => recoverySharedModel(state, modelSelect.value,
    effectiveLocation(state), explicitPrivacy(state));
  const matchesRecovery = state => {
    const candidate = recoveryAlternative(state);
    return candidate && modelIdentity(candidate) === modelIdentity(recoverySelection);
  };
  viewState.positions ??= new Map(); viewState.seen ??= new Map();
  const threads = createConversationList(find('[data-thread-list]'), viewState.seen, { getSources: session.getDocumentSources });
  const messages = createMessageList(find('[data-message-stream]'), { getSources: session.getDocumentSources, positions: viewState.positions, scrollContainer: find('[data-chat-transcript]') });
  let activeProgress = null, progressVisible = true, answerBusy = false;
  const stopVisibility = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    const entry = entries.find(item => item.target === activeProgress);
    if (!entry) return;
    progressVisible = entry.isIntersecting && entry.intersectionRatio >= 1;
    find('[data-composer-stop]').hidden = !answerBusy || progressVisible;
  }, { root: find('[data-chat-transcript]'), threshold: 1 }) : null;
  const actions = find('[data-conversation-actions]');
  const actionsPanel = bindDisclosure({ root: actions, trigger: actions.querySelector('summary'), panel: actions.querySelector('div'), native: true });
  const railToggle = find('[data-toggle-thread-rail]');
  let workspaceNavigation = null, applyingView = false;
  const threadsDialogNode = find('[data-threads-dialog]');
  const leftDrawer = bindDrawer(threadsDialogNode, { side: 'left', markRoot: find('[data-thread-rail-brand]') });
  const allowBoth = () => (globalThis.innerWidth || 0) >= 1200;
  const rightView = () => ({ participants: 'computers' }[inspector.section?.()] || inspector.section?.());
  const setThreads = (open, reflect = true) => {
    if (open && !allowBoth()) { const previous = applyingView; applyingView = true; inspector.close?.({ restoreFocus: false }); applyingView = previous; }
    viewState.threadsOpen = open; container.toggleAttribute('data-threads-open', open);
    railToggle?.setAttribute('aria-expanded', String(open));
    leftDrawer.setOpen(open);
    if (!open) actionsPanel.setOpen(false);
    if (reflect && !applyingView) workspaceNavigation?.reflect(inspector.isOpen?.() ? rightView() : open ? 'threads' : 'chat', { threads: open });
    if (open) (find('[data-thread-item-id][aria-current="true"]') || find('[data-thread-item-id]') || find('[data-new-thread]')).focus({ preventScroll: true });
  };
  const detachHandover = bindHistoryHandover(container, historyHandover);
  const detachInspector = inspector.onOpen?.(section => {
    if (!allowBoth()) setThreads(false, false);
    if (!applyingView) workspaceNavigation?.reflect(section === 'participants' ? 'computers' : section, { threads: viewState.threadsOpen });
  });
  const detachInspectorClose = inspector.onClose?.(() => { if (!applyingView) workspaceNavigation?.reflect(viewState.threadsOpen ? 'threads' : 'chat'); });
  const production = bindProductionControls(container, session, { inspector });
  setThreads(false);

  find('[data-close-threads]').addEventListener('click', () => { setThreads(false); railToggle?.focus(); }, options);
  onResize();
  function onResize() {
    resizeInput();
    if (!allowBoth() && viewState.threadsOpen && inspector.isOpen?.()) setThreads(false);
    const surface = container.closest('.pool-home');
    if (surface) {
      const height = globalThis.visualViewport?.height || globalThis.innerHeight;
      surface.style.setProperty('--pool-param-workspace-height', `${height}px`);
      // Mobile keyboards may resize only visualViewport; CSS height queries stay unchanged.
      surface.toggleAttribute('data-chat-compact', height <= 600);
    }
  }
  globalThis.addEventListener('resize', onResize, options);
  globalThis.visualViewport?.addEventListener('resize', onResize, options);
  const drafts = new Map();
  const persisted = session.getDraft?.(session.getState().selectedId);
  if (persisted) { input.value = persisted.text; files = persisted.files; }
  const saveDraft = () => {
    const value = { text: input.value, files };
    drafts.set(selectedId, structuredClone(value)); return session.saveDraft?.(selectedId, value);
  };
  let selectedId = session.getState().selectedId, submitting = false;
  // While another tab holds the history, the handover notice replaces its refusal.
  const history = session.getState().history;
  const refusal = history?.mode === 'refused' && historyHandover ? history.reason : null;
  const error = cause => {
    const node = find('[data-chat-error]'), text = String(cause?.message || cause || '');
    node.textContent = refusal && text.includes(refusal) ? '' : text; node.hidden = !node.textContent;
  };
  const act = operation => Promise.resolve().then(operation).catch(error);
  const after = (pending, next) => pending?.then ? pending.then(next) : next();
  const observe = pending => pending?.catch?.(error);
  const on = (selector, event, callback) => find(selector)?.addEventListener(event, callback, options);
  // Send and Retry authorize their selected tools; no separate approval dialog.
  const searchToggle = find('[data-search-toggle]');
  const setSearch = on => { const active = on && !searchToggle.hidden; searchToggle.setAttribute('aria-pressed', String(active)); find('[data-web-search-on]').hidden = !active; };
  const searching = () => searchToggle.getAttribute('aria-pressed') === 'true';
  // Resolve the selected built-in or device route before applying personal MCP settings.
  const searchRouteNow = () => session.preferredSearchRoute?.() ?? undefined;
  const deviceSearchOn = () => session.preferredSearchRoute?.() === 'device-search';
  const prepareSearch = async (model, sharingScope, route = searchRouteNow(), location = executionLocation, query = input.value) => {
    const request = await session.searchPermissionRequest({ model, sharingScope, executionLocation: location, signal: controller.signal, ...(route ? { route } : {}) });
    return { ...request, query, source: 'send' };
  };
  function resizeInput() {
    input.style.removeProperty('--pool-param-composer-height');
    input.style.setProperty('--pool-param-composer-height', Math.min(Math.max(44, input.scrollHeight), Math.max(72, (globalThis.visualViewport?.height || globalThis.innerHeight || 800) * 0.22)) + 'px');
  }
  // Rail changes alter the input width without a window resize.
  let inputWidth = input.getBoundingClientRect().width;
  const inputResize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    const width = input.getBoundingClientRect().width;
    if (!controller.signal.aborted && width !== inputWidth) { inputWidth = width; resizeInput(); }
  }) : null;
  inputResize?.observe(input);
  const refreshStartingPrompts = () => {
    const state = session.getState(), thread = state.activeThread;
    const prompts = find('[data-starting-prompts]');
    prompts.hidden = container.hasAttribute('data-compact') || !!(thread?.messages.length || thread?.closed
      || (state.runningIds || []).includes(thread?.id) || state.comparisonPhase);
    prompts.inert = !!(input.value.trim() || files.length);
    prompts.toggleAttribute('data-draft', prompts.inert);
  };
  const showFiles = () => { refreshStartingPrompts(); resizeInput(); renderAttachments(find('[data-attachments-preview]'), files); find('[data-attachment-help]').hidden = !files.length; };
  const downloadableHere = (model, state) => canDownloadModelHere(model, state, !!inspector.downloadModel);
  function pinDraftModel(state) {
    if (state.selectedId == null && !chosenModel && !viewState.draftModel) {
      viewState.draftModel = state.models?.find(model => modelKey(model) === modelSelect.value);
    }
  }
  function queueScope(state, model) {
    const privacy = explicitPrivacy(state);
    return JSON.stringify([state.selectedId, modelIdentity(model), effectiveLocation(state), privacy,
      state.remoteNetworkId, state.remoteAnswersEnabled, state.activeThread?.permissions, contextPrompt,
      state.activeThread?.systemContext, searching(), composerRevision, input.value]);
  }
  function canWaitForPublicModel(state, model, location) {
    const privacy = explicitPrivacy(state);
    const pinned = state.activeThread?.model || chosenModel || viewState.draftModel;
    return !!model?.identity && (!pinned?.identity || modelIdentity(model) === modelIdentity(pinned)) && !model.partition && !model.fleet && location !== 'local'
      && (!state.activeThread || location === 'network') && allowsOpenPlaintext(privacy)
      && !searching() && !attachmentReader.pending
      && !state.storageError && !state.activeThread?.closed && !state.comparisonPhase
      && !(state.runningIds || []).includes(state.selectedId) && !submitting
      && ['observed', 'searching'].includes(state.discoveryPhase);
  }
  function readyForQueuedSend(state, intent) {
    const model = state.models?.find(item => modelKey(item) === modelSelect.value);
    return !controller.signal.aborted && canWaitForPublicModel(state, model, effectiveLocation(state))
      && queueScope(state, model) === intent.scope && model.networkAvailability === 'ready'
      && model.reachableProviderIds?.length > 0;
  }
  function renderQueuedSend(state, model, location, usable, busy, preparing) {
    const button = find('[data-queue-send]'), cancel = find('[data-cancel-queued-send]');
    const permitted = !busy && canWaitForPublicModel(state, model, location);
    if (queuedSend && (!permitted || queuedSend.scope !== queueScope(state, model))) queuedSend = null;
    queueHasText = !!input.value.trim();
    // Send itself queues while computers are still being found; there is no separate button for it.
    button.hidden = true;
    cancel.hidden = !queuedSend;
    const status = find('[data-model-status]');
    if (!queuedSend) return;
    status.hidden = false;
    status.textContent = `Waiting for a computer running ${modelVariantLabel(model)}…`;
    const intent = queuedSend;
    if (!intent.scheduled && readyForQueuedSend(state, intent)) {
      intent.scheduled = true;
      queueMicrotask(() => {
        intent.scheduled = false;
        if (queuedSend === intent && readyForQueuedSend(session.getState(), intent)) submitDraft(intent);
      });
    }
  }
  let fitRequest, fitKey, fitInfo;
  const updatePicker = snapshot => {
    // The pressed computer row follows the sheet's run location (a finished download switches it to this device).
    if (pickerLocation === 'local') pickerChoice = 'device';
    else if (pickerLocation === 'network' && pickerChoice === 'device') pickerChoice = null;
    pickerModel = updateConversationModelPicker({ find, choices: nextModelChoices,
      state: snapshot.computerLabels ? snapshot : withComputerLabels(snapshot, session),
      model: pickerModel, location: pickerLocation, touched: pickerTouched, changing: changingModel,
      selectedId: modelSelect.value, localOnly: !!snapshot.activeThread && (explicitPrivacy(snapshot).placement === 'local-only'
        || explicitPrivacy(snapshot).recipients.kind === 'none'),
      canDownload: !!inspector.downloadModel, destination: pickerChoice || destinationKey(snapshot),
      locked: lockedDestination(snapshot) });
    const node = find('[data-local-fit]');
    const showLocalFit = pickerModel?.source && !pickerModel.partition && !pickerModel.fleet
      && (hasBrowserModelOrigin(pickerModel) || pickerModel.localCached || pickerModel.localReady);
    const key = showLocalFit && find('[data-model-details]').open ? modelIdentity(pickerModel) : null;
    if (fitKey !== key) {
      fitRequest?.abort(); fitInfo = null; fitKey = key;
      if (key && session.getLocalModelFit) {
        const request = fitRequest = new AbortController();
        session.getLocalModelFit(pickerModel, { signal: request.signal }).then(info => {
          if (!request.signal.aborted && !controller.signal.aborted) {
            fitInfo = info; node.textContent = localFitText(pickerModel, info, { cached: pickerModel.localCached });
          }
        }).catch(() => {});
      }
    }
    node.textContent = showLocalFit ? localFitText(pickerModel, fitInfo, { cached: pickerModel.localCached }) : '';
    node.hidden = !node.textContent;
    if (attachmentReader.pending || recoverySelection && !matchesRecovery(snapshot)) find('[data-change-model]').disabled = true;
  };
  const render = snapshot => {
    const state = withComputerLabels(snapshot, session);
    if (controller.signal.aborted) return;
    applyPairedDesktopDefault(state);
    if (selectedId !== state.selectedId) {
      pickerRevision++;
      drafts.set(selectedId, { text: input.value, files }); selectedId = state.selectedId; attachmentReader.reset();
      const draft = drafts.get(selectedId) || session.getDraft?.(selectedId); input.value = draft?.text || ''; files = draft?.files || []; showFiles();
    }
    const thread = state.activeThread, catalogModels = state.models || [], runningIds = state.runningIds || [];
    const keyFor = model => model?.selectionId || model?.id;
    if (!thread && !input.value.trim() && !files.length && !attachmentReader.pending) viewState.draftModel = null;
    const pinnedModel = thread?.model || chosenModel || viewState.draftModel;
    const models = catalogModels.filter(model => keyFor(model) !== keyFor(pinnedModel)
      || !pinnedModel?.identity || modelIdentity(model) === modelIdentity(pinnedModel));
    if (pinnedModel && !models.some(model => keyFor(model) === keyFor(pinnedModel))) models.push(unavailableModelChoice(pinnedModel));
    const location = effectiveLocation(state);
    const defaultModel = state.defaultModels?.[location] || state.defaultModel;
    const current = keyFor(pinnedModel)
      || keyFor(models.find(model => keyFor(model) === keyFor(defaultModel) && selectable(model)))
      || keyFor(models.find(selectable)) || keyFor(models[0]);
    updateModelSelect(modelSelect, models, { value: current, showAvailability: true, grouped: true, preferNetwork: location !== 'local' });
    modelSelect.value = current || ''; modelSelect.disabled = !models.length; modelSelect.hidden = !!thread;
    const selectedModel = catalogModels.find(model => keyFor(model) === current
      && (!pinnedModel?.identity || modelIdentity(model) === modelIdentity(pinnedModel)));
    if (!thread && !chosenModel && !viewState.draftModel && (input.value.trim() || files.length)) viewState.draftModel = selectedModel;
    const execution = modelExecutionState(selectedModel, location);
    const prepareHere = location === 'local' && selectedModel?.localCached === true;
    const usable = explicitPrivacy(state).computation === 'plaintext' && (execution.usable || prepareHere);
    find('[data-composer-field]').dataset.executionSource = execution.source;
    const modelStatus = find('[data-model-status]');
    const localPreparing = state.localModel?.phase === 'loading';
    const requestedModel = selectedModel || pinnedModel || models.find(model => keyFor(model) === current)
      || catalogModels.find(model => keyFor(model) === current)
      || catalogModels.find(model => keyFor(model) === keyFor(state.defaultModel))
      || catalogModels[0];
    const remotePreparing = (state.network?.partitionPeers || []).some(peer => peer.available
      && peer.description?.phase === 'loading' && catalogModels.some(model => model.id === peer.description.offer?.id
        && model.identity === peer.description.offer?.identity)
      && (!requestedModel || requestedModel.id === peer.description.offer?.id
        && requestedModel.identity === peer.description.offer?.identity));
    const selectedPreparing = catalogModels.some(model => keyFor(model) === current
      && ['loading', 'preparing'].includes(model.availability));
    const preparing = localPreparing || remotePreparing || selectedPreparing;
    const acquiring = state.acquisition?.phase === 'downloading';
    const phase = state.discoveryPhase;
    const exhausted = phase === 'observed' || phase === 'interrupted' || phase === 'paused';
    const canAcquire = !!session.downloadLocalModel && !state.localDownloadIssue && !usable && !localPreparing && !busyAcquisition(state)
      && location !== 'network' && !requestedModel?.fleet && isDownloadableBaseModel(requestedModel) && (exhausted || location === 'local');
    const acquisition = state.acquisition;
    const acquisitionText = find('[data-acquisition-status]');
    acquisitionText.textContent = acquiring ? acquisition.progress?.message || 'Checking model files.'
      : ['failed', 'cancelled'].includes(acquisition?.phase) ? acquisition.error : '';
    if (acquiring && execution.source === 'network' && execution.status === 'ready') {
      acquisitionText.textContent += ' Network model ready.';
    }
    acquisitionText.hidden = !acquisitionText.textContent;
    const meter = find('[data-acquisition-progress]');
    meter.hidden = !acquiring;
    if (acquisition?.progress?.totalBytes && acquisition.progress.receivedBytes !== null) {
      meter.max = acquisition.progress.totalBytes; meter.value = acquisition.progress.receivedBytes;
    } else meter.removeAttribute('value');
    find('[data-cancel-download]').hidden = !acquiring;
    find('[data-download-local]').hidden = !canAcquire || !!thread?.closed;
    find('[data-download-local]').textContent = ['failed', 'cancelled'].includes(acquisition?.phase) ? 'Retry download' : 'Review local download';
    const busy = runningIds.includes(thread?.id) || !!state.comparisonPhase;
    const privacy = explicitPrivacy(state);
    const policy = currentPolicy(state);
    privacyTrigger.disabled = busy || !!thread?.closed;
    const locked = lockedDestination(state);
    const destinationName = { device: 'This device', contributors: 'Contributors', desktop: locked?.label, named: 'Named computers' }[destinationKey(state)];
    const privacyTitle = 'Answer on: ' + destinationName + (busy ? ' · Available after this answer' : '');
    privacyTrigger.title = privacyTitle;
    privacyTrigger.setAttribute('aria-label', privacyTitle);
    const resetNotice = find('[data-execution-settings-reset]');
    resetNotice.hidden = thread?.executionSettingsReset !== true;
    const networkOptIn = find('[data-review-network-execution]');
    // Send asks where to run when it needs to, so this prompt only stays for an existing local-only thread.
    networkOptIn.hidden = !thread || busy || usable || preparing || acquiring || !!thread?.closed || (policy.placement !== 'local-only' && policy.recipients.kind !== 'none');
    if (privacyNode.open && (privacyTrigger.disabled || editingThread !== state.selectedId)) privacyDialog.close();
    const shared = !busy && !usable && !preparing && !thread?.closed && !acquiring
      ? recoverySharedModel(state, current, location, privacy) : null;
    const review = find('[data-review-shared-model]');
    review.hidden = !shared;
    review.dataset.selectionId = shared ? keyFor(shared) : '';
    review.dataset.identity = shared ? modelIdentity(shared) : '';
    review.textContent = shared ? `Review ${modelVariantLabel(shared)}` : '';

    let statusText = '';
    if (!busy) {
      if (state.history?.mode === 'refused' && historyHandover) statusText = '';
      else if (thread?.closed) statusText = 'Restore this thread to continue.';
      else if (usable) {
        if (execution.source === 'network') {
          statusText = execution.status === 'busy' ? 'Waiting for capacity.' : '';
        } else if (execution.status === 'cached') statusText = 'Model downloaded.';
      } else if (preparing) statusText = state.localModel?.progress?.message || 'Model preparing…';
      // A paired desktop that cannot be reached: name it and say what brings it back. Nothing here can wake it.
      // It outranks the generic local message unless the person deliberately chose this device or paused the network.
      else if (state.ownerPairing?.status === 'offline' && state.ownerPairing.hostLabel && pickerChoice !== 'device'
        && phase !== 'paused' && phase !== 'searching') {
        statusText = `${state.ownerPairing.hostLabel} is offline. Open Reploid on ${state.ownerPairing.hostLabel}.`;
      } else if (location === 'local') statusText = state.localModel?.error || state.localDownloadIssue || 'Model unavailable here.';
      else if (phase === 'paused') statusText = 'Network paused.';
      else if (phase === 'interrupted') statusText = 'Connection interrupted.';
      else if (phase === 'searching') statusText = 'Finding computers…';
      else if (phase === 'observed') statusText = state.network?.connectionFailure?.peerId
        ? 'A peer connection failed. No eligible computer found for this model.'
        : 'No eligible computer found for this model.';
      else statusText = 'Model unavailable.';
      if (!usable && location !== 'local' && state.localDownloadIssue && !shared && !canAcquire && exhausted) {
        statusText += ' ' + state.localDownloadIssue;
      }
    }
    if (!busy && searching() && !thread?.closed && !state.storageError) {
      const personal = webSearch?.enabled() ? webSearch.state() : null;
      const recipient = webSearchRecipient({ personalRecipient: personal?.url ? personal.recipient : null,
        route: searchRouteNow(), provider: search?.state?.().provider });
      statusText = [statusText, recipient ? `Web search sends your question to ${recipient}.`
        : 'Web search recipient is not confirmed.'].filter(Boolean).join(' ');
    }
    const disclosure = find('[data-prompt-disclosure]');
    disclosure.hidden = !!thread?.closed;
    const pairedSummary = pairedDesktopSummary(state);
    if (policy.computation !== 'plaintext') disclosure.textContent = 'The required computation mode is unavailable.';
    else if (policy.recipients.kind === 'none' && !usable) disclosure.textContent = 'Nothing leaves this device.';
    else if (location === 'local' || execution.usable && execution.source === 'local') disclosure.textContent = 'Nothing leaves this device.';
    else if (pairedSummary) disclosure.textContent = pairedSummary;
    else if (policy.recipients.kind === 'named') disclosure.textContent = 'Named computers can read your prompt.';
    else if (selectedModel?.partition) disclosure.textContent = 'Computers on this route can read the input for their own stages.';
    else if (usable) disclosure.textContent = 'The answering computer can read your prompt.';
    else disclosure.textContent = 'A network provider could read your prompt.';
    modelStatus.textContent = statusText;
    modelStatus.hidden = !statusText;
    renderQueuedSend(state, selectedModel, location, usable, busy, preparing);
    const answerLimit = find('[data-answer-limit]');
    const detailModel = find('[data-model-picker]').open ? pickerModel : requestedModel;
    const cells = state.answerLimits?.find(entry => entry.selectionId === keyFor(detailModel || {}))?.cells || [];
    const bounds = [...new Map(cells.map(cell => [cell.maxPromptTokens + '/' + cell.maxAnswerTokens, cell])).values()]
      .sort((a, b) => a.maxPromptTokens - b.maxPromptTokens);
    const configuredAnswerTokens = catalogModels.find(model => model.id === detailModel?.id && !model.partition)?.generation?.maxTokens;
    answerLimit.textContent = bounds.length ? 'Route limits: ' + bounds.map(cell =>
      `${cell.maxAnswerTokens} answer tokens for up to ${cell.maxPromptTokens} input tokens`).join('; ')
      + '. Input includes conversation history. Answers reaching the limit are incomplete.'
      : Number.isSafeInteger(configuredAnswerTokens) ? `Answer limit: ${configuredAnswerTokens} tokens. Answers reaching the limit are incomplete.` : '';
    answerLimit.hidden = !answerLimit.textContent;
    const retry = find('[data-retry-connection]');
    retry.textContent = phase === 'observed' ? 'Search again' : phase === 'paused' ? 'Reconnect' : 'Retry connection';
    retry.setAttribute('aria-label', retry.textContent);
    retry.hidden = busy || usable || preparing || location === 'local' || !exhausted || !!thread?.closed;
    find('[data-model-control]').hidden = !models.length;
    find('[data-open-model]').dataset.activity = execution.status === 'ready' ? 'ready' : 'idle';
    find('[data-picker-thread-note]').hidden = !thread;
    const activeModel = selectedModel || pinnedModel || models.find(model => keyFor(model) === current)
      || catalogModels.find(model => keyFor(model) === current) || requestedModel;
    find('[data-model-caption]').hidden = !!activeModel;
    // The selector names where the answer runs and with which model; availability is a separate dot and the status line.
    const lockedHost = lockedDestination(state), destination = destinationKey(state);
    const runsHere = destination === 'device' || location === 'local' || execution.usable && execution.source === 'local';
    const computerName = runsHere ? 'This device' : destination === 'desktop' ? lockedHost?.label
      : destination === 'named' ? 'Named computers' : selectedModel?.fleet ? execution.label : 'Contributors';
    const availability = execution.usable ? 'ready' : preparing || phase === 'searching' ? 'waiting' : 'unavailable';
    const availabilityText = { ready: 'Ready', waiting: preparing ? 'Loading' : 'Finding computers', unavailable: 'Unavailable' }[availability];
    const dot = find('[data-composer-availability]');
    dot.dataset.availability = availability;
    dot.classList.toggle('pool-dot-open', availability === 'unavailable');
    dot.classList.toggle('pool-dot-pulse', availability === 'waiting');
    const modelDigest = activeModel ? `${computerName} · ${modelVariantLabel(activeModel)}` : '';
    find('[data-composer-model-name]').textContent = activeModel ? modelVariantLabel(activeModel) : '';
    find('[data-composer-model-source]').textContent = activeModel ? computerName : '';
    find('[data-open-model]').setAttribute('aria-label', modelDigest ? `Answer on ${modelDigest}, ${availabilityText}` : 'Answer on');
    find('[data-open-model]').title = 'Answer on';
    // The box names who receives the message, using the selector's own label; status stays on the dot and status line.
    input.placeholder = !activeModel ? 'Message…' : computerName === 'Contributors' ? 'Message a contributor…' : `Message ${computerName}…`;
    updateContextIndicator(container, state, session);
    threads.update(state.threads || [], state.selectedId, { archived, models: state.models });
    const emptyList = find('[data-thread-empty]');
    emptyList.hidden = !!find('[data-thread-list] [data-thread-item-id]');
    emptyList.textContent = archived ? 'No archived chats.' : 'No chats yet.';
    refreshStartingPrompts();
    find('[data-production-surface]').hidden = container.hasAttribute('data-compact');
    production.update(state);
    const contextControls = find('[data-context-controls]');
    contextControls.hidden = !session.previewContextPrompt;
    if (session.previewContextPrompt) {
      const context = thread?.systemContext || session.previewContextPrompt(thread ? {} : contextPrompt || {}, thread?.model || requestedModel);
      find('[data-context-enabled]').checked = context.metadata.enabled;
      find('[data-context-cap]').value = String(context.metadata.maxWords);
      find('[data-context-enabled]').disabled = busy || !!thread?.closed;
      find('[data-context-cap]').disabled = busy || !!thread?.closed || !context.metadata.enabled;
      find('[data-context-count]').textContent = `${context.metadata.wordCount}/${context.metadata.maxWords} context words. Replies are not limited by this setting.`;
      find('[data-context-preview]').textContent = context.content || 'Off. No app context is added.';
    }
    find('[data-composer-send]').hidden = busy;
    // An invite link offers one action: join that computer. Until it is joined, nothing can be sent anywhere.
    const invite = viewState.guestInvite, guest = state.guestAccess, joinButton = find('[data-join-host]');
    const inviteJoined = !!invite && guest?.joined && guest.hostParticipantId === invite.hostPeerId;
    const joiningHost = !!invite && guest?.status === 'joining';
    joinButton.hidden = !invite || inviteJoined || joiningHost;
    if (invite) joinButton.textContent = `Join ${describeCircleHost(invite.hostLabel, invite.hostPeerId).hostLabel}`;
    if (invite && !inviteJoined) {
      const status = find('[data-model-status]');
      status.hidden = false;
      status.textContent = joiningHost ? `Connecting to ${guest.hostLabel}…` : guest?.error || 'Invited. Join to send messages to this computer.';
    }
    const queueable = !busy && !usable && state.discoveryPhase === 'searching' && canWaitForPublicModel(state, selectedModel, location);
    // With no choice made yet and nothing runnable here, Send asks where to run once instead of staying off.
    const askFirst = !thread && !busy && !usable && !queueable && viewState.privacy === undefined && !viewState.privacyTouched && !lockedDestination(state);
    find('[data-composer-send]').disabled = attachmentReader.pending || !(usable || queueable || askFirst) || !!thread?.closed || !!state.storageError
      || (!!invite && !inviteJoined);

    find('[data-conversation-download]').hidden = !thread?.messages.length;
    find('[data-composer-field]').dataset.activity = 'idle';
    messages.update(thread, { usable: usable && !thread?.closed, busy, state });
    answerBusy = busy;
    const progress = find('.is-assistant [data-execution-activity][data-active]');
    if (progress !== activeProgress) {
      stopVisibility?.disconnect(); activeProgress = progress; progressVisible = !!progress;
      if (progress) stopVisibility?.observe(progress);
    }
    // Keep Stop reachable when the reader scrolls away from the active answer.
    find('[data-composer-stop]').hidden = !busy || !!progress && progressVisible;

    if (find('[data-model-picker]').open) updatePicker(state);
    error(state.storageError || '');

    const pendingApproval = thread?.attempts?.find(item => item.status === 'approval' && item.approval?.permissionNeed);
    let consentDialog = container.querySelector('[data-remote-permission]');
    if (!pendingApproval) {
      consentDialog?.remove();
    } else {
      const need = pendingApproval.approval.permissionNeed;
      const recipientLabel = pendingApproval.approval.recipientIdentity || need.routeId || 'another computer';
      const copy = remotePermissionText(need);
      const key = `${pendingApproval.id}:${pendingApproval.approval.id}:${recipientLabel}`;
      if (!consentDialog) {
        consentDialog = container.ownerDocument.createElement('dialog');
        consentDialog.className = 'pool-dialog pool-stack pool-gap-sm';
        consentDialog.dataset.remotePermission = '';
        consentDialog.setAttribute('open', '');
        container.append(consentDialog);
      }
      if (consentDialog.dataset.approvalKey !== key) {
        consentDialog.dataset.approvalKey = key;
        consentDialog.innerHTML = `<h2 class="pool-subheading">Send to another computer?</h2>`
          + `<p class="pool-body">${escapeHtml(copy.what)}</p>`
          + `<p class="pool-small pool-muted">Recipient identity: <code>${escapeHtml(recipientLabel)}</code></p>`
          + `<div class="pool-row pool-gap-sm">`
          + `<button class="pool-button btn-primary" type="button" data-remote-permission-allow>Allow this computer</button>`
          + `<button class="pool-button btn-ghost" type="button" data-remote-permission-decline>Cancel</button>`
          + `</div>`;
      }
    }
  };
  container.addEventListener('click', event => {
    const allowBtn = event.target.closest?.('[data-remote-permission-allow]');
    const declineBtn = event.target.closest?.('[data-remote-permission-decline]');
    if (!allowBtn && !declineBtn) return;
    const thread = session.getState().activeThread;
    const pending = thread?.attempts?.find(item => item.status === 'approval' && item.approval?.permissionNeed);
    if (!pending) return;
    if (allowBtn) {
      const need = pending.approval.permissionNeed;
      void act(() => session.grantRemotePermission(need, { wording: remotePermissionWording(need) }));
    } else {
      void act(() => session.approve(thread.id, pending.id, pending.approval.id, false));
    }
  }, options);
  const unsubscribe = session.subscribe(render);
  const refreshSearchToggle = () => { searchToggle.hidden = !(search?.available() || deviceSearchOn() || webSearch?.enabled()); if (searchToggle.hidden) setSearch(false); };
  const unsubscribeSearch = search && session.searchPermissionRequest ? search.subscribe(refreshSearchToggle) : () => {};
  if (search && search.state().state === 'unknown') void search.refresh();
  on('[data-search-toggle]', 'click', () => { queuedSend = null; setSearch(!searching()); render(session.getState()); });
  const webSearchOn = find('[data-web-search-on]');
  const unsubscribeWebSearch = webSearch ? webSearch.subscribe(state => {
    refreshSearchToggle();
    if (webSearchOn) setSearch(state.enabled && (!!state.url || !!search?.available() || deviceSearchOn()));
    render(session.getState());
  }) : () => {};
  const changeContext = () => {
    const selection = { enabled: find('[data-context-enabled]').checked, maxWords: Number(find('[data-context-cap]').value) };
    try {
      const threadId = session.getState().selectedId;
      if (threadId) observe(session.setContextPrompt(threadId, selection));
      else { contextPrompt = selection; viewState.contextPrompt = selection; render(session.getState()); }
    } catch (failure) { error(failure.message); }
  };
  find('[data-context-enabled]').addEventListener('change', changeContext, options);
  find('[data-context-cap]').addEventListener('change', changeContext, options);
  showFiles();
  const renameDialog = bindDialog(find('[data-rename-dialog]'));
  const picker = bindDialog(find('[data-model-picker]'));
  const openPicker = (event, alternative = null) => {
    pickerRevision++;
    queuedSend = null;
    recoverySelection = alternative;
    pickerTouched = !!alternative;
    const state = session.getState();
    inspector.close?.({ restoreFocus: false });
    pickerModel = alternative || (state.models || []).find(model => (model.selectionId || model.id) === modelSelect.value)
      || state.activeThread?.model || chosenModel || state.defaultModel || null;
    pickerLocation = alternative ? 'network' : effectiveLocation(state);
    find('[data-picker-title]').textContent = 'Answer on';
    // The pressed row is where this chat would actually run now ('auto' runs a stored model on this device).
    pickerChoice = alternative ? 'contributors' : modelExecutionState(pickerModel, pickerLocation).source === 'local' ? 'device' : null;
    updatePicker(state);
    picker.open(find('[data-next-model]'), event.currentTarget);
    render(state);
    nextModelChoices.focus();
  };
  // One model control opens the bounded model/source choice.
  on('[data-model-details]', 'toggle', () => { if (find('[data-model-picker]').open) updatePicker(session.getState()); });
  on('[data-open-model]', 'click', openPicker);
  on('[data-review-shared-model]', 'click', event => {
    const state = session.getState(), alternative = recoveryAlternative(state);
    if (alternative && modelKey(alternative) === event.currentTarget.dataset.selectionId
      && modelIdentity(alternative) === event.currentTarget.dataset.identity) openPicker(event, alternative);
    else render(state);
  });
  on('[data-model-picker-close]', 'click', () => { sendAfterDestination = false; picker.close(); });
  on('[data-model-picker]', 'close', () => render(session.getState()));
  // A route radio under the providers selects that route of the highlighted variant.
  on('[data-model-picker]', 'change', event => {
    const route = event.target.closest?.('[data-model-route-choice]');
    if (!route || route.disabled) return;
    const next = find('[data-next-model]');
    next.value = route.value; next.dispatchEvent(new Event('change', { bubbles: true }));
  });
  on('[data-next-model]', 'change', () => {
    pickerRevision++;
    if (modelKey(recoverySelection) !== find('[data-next-model]').value) recoverySelection = null;
    pickerTouched = true;
    pickerModel = (session.getState().models || []).find(model => (model.selectionId || model.id) === find('[data-next-model]').value) || pickerModel;
    updatePicker(session.getState());
    render(session.getState());
    if (!arrowBrowsing && pickerModel && modelExecutionState(pickerModel, pickerLocation).usable && !recoverySelection) commitPickerChoice();
  });
  // Arrow keys move through models without committing; a tap, click or Enter applies the highlighted one.
  let arrowBrowsing = false;
  on('[data-model-picker]', 'keydown', event => {
    arrowBrowsing = event.key.startsWith('Arrow');
    if (event.key === 'Enter' && event.target.matches?.('.chat-model-choice input[type=radio]')) { event.preventDefault(); commitPickerChoice(); }
  });
  on('[data-model-picker]', 'pointerdown', () => { arrowBrowsing = false; });
  on('[data-composer-input]', 'input', () => { composerRevision++; resizeInput(); refreshStartingPrompts();
    if (input.value.trim()) pinDraftModel(session.getState());
    if (queuedSend || queueHasText !== !!input.value.trim()) { queuedSend = null; render(session.getState()); }
    try { observe(saveDraft()); } catch (cause) { error(cause); } });
  on('[data-starting-prompts]', 'click', event => {
    const button = event.target.closest('[data-starting-prompt]');
    if (!button || find('[data-starting-prompts]').hidden || find('[data-starting-prompts]').inert) return;
    input.value = button.textContent;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  });
  const newThread = () => after(saveDraft(), () => after(session.select(null), () => { inspector.close?.({ restoreFocus: false }); chosenModel = null; viewState.chosenModel = null; archived = false; find('[data-show-archived]').setAttribute('aria-pressed', 'false'); find('[data-show-active]').setAttribute('aria-pressed', 'true'); actionsPanel.setOpen(false); setThreads(false); render(session.getState()); input.focus(); }));
  on('[data-new-thread]', 'click', () => { queuedSend = null; try { observe(newThread()); } catch (cause) { error(cause); } });
  on('[data-active-model-select]', 'change', () => { chosenModel = (session.getState().models || []).find(model => (model.selectionId || model.id) === modelSelect.value); viewState.chosenModel = chosenModel; render(session.getState()); input.focus(); });
  on('[data-switch-local]', 'click', () => {
    if (changingModel || attachmentReader.pending || pickerLocation !== 'network') return;
    const state = session.getState();
    const model = state.models?.find(item => modelIdentity(item) === modelIdentity(pickerModel));
    if (!model || modelExecutionState(model, 'network').usable) { updatePicker(state); return; }
    const stageLocal = () => {
      const current = session.getState();
      const stored = current.models?.find(item => modelIdentity(item) === modelIdentity(model));
      if (!modelExecutionState(stored, 'local').usable) return;
      pickerModel = stored; pickerTouched = true; pickerLocation = 'local'; updatePicker(current);
      find('[data-change-model]').focus();
    };
    if (modelExecutionState(model, 'local').usable) stageLocal();
    else if (downloadableHere(model, state) && !busyAcquisition(state)) {
      const revision = ++pickerRevision, scope = queueScope(state, model);
      inspector.downloadModel(modelKey(model), find('[data-switch-local]'), {
        isCurrent(id) {
          const current = session.getState();
          return !controller.signal.aborted && find('[data-model-picker]').open && pickerRevision === revision
            && pickerLocation === 'network' && id === modelKey(model) && queueScope(current, model) === scope
            && !current.activeThread?.closed && !(current.runningIds || []).includes(current.selectedId)
            && current.models?.some(item => modelIdentity(item) === modelIdentity(model));
        },
        onStored: stageLocal
      });
    }
  });
  // Done, or tapping a model or computer that can answer now, commits the sheet and returns to the draft.
  const resumeAfterChoice = () => { if (sendAfterDestination) { sendAfterDestination = false; submitDraft(); } };
  function commitPickerChoice() {
    if (changingModel || attachmentReader.pending) return;
    const next = find('[data-next-model]').value;
    const state = session.getState();
    if (recoverySelection && !matchesRecovery(state)) { updatePicker(state); return; }
    const model = (state.models || []).find(model => (model.selectionId || model.id) === next && (modelExecutionState(model, pickerLocation).usable || pickerLocation === 'local' && state.activeThread?.permissions?.sharingScope === 'local' && isDownloadableBaseModel(model) && !state.localDownloadIssue));
    if (!model) {
      const wanted = (state.models || []).find(item => (item.selectionId || item.id) === next);
      if (pickerLocation !== 'network' && wanted && downloadableHere(wanted, state)) {
        picker.close();
        inspector.downloadModel(next, find('[data-open-model]'));
        return;
      }
      updatePicker(session.getState()); return;
    }
    const privacy = explicitPrivacy(state);
    // A computer tapped in this sheet decides the location, even before its policy change has been saved.
    const location = pickerChoice === 'device' ? 'local' : pickerChoice ? 'network'
      : privacy?.placement === 'local-only' ? 'local' : pickerLocation;
    const origin = selectedId, revision = composerRevision;
    changingModel = true; updatePicker(state);
    void act(async () => {
      try {
        if (controller.signal.aborted || selectedId !== origin || composerRevision !== revision) return;
        if (state.activeThread && (state.activeThread.model.selectionId || state.activeThread.model.id) === next) {
          await session.setExecutionLocation(state.activeThread.id, location);
          picker.close(); input.focus(); resumeAfterChoice(); return;
        }
        // New threads share a single draft slot until their first send. If it is
        // already occupied, give this switch its own thread before copying the draft.
        const pendingDraft = { text: input.value, files: structuredClone(files) };
        await saveDraft();
        if (controller.signal.aborted || selectedId !== origin || composerRevision !== revision) return;
        if (recoverySelection && !matchesRecovery(session.getState())) return;
        let destination = origin;
        if (origin != null) {
          const existing = drafts.get(null) || session.getDraft?.(null);
          if (existing?.text || existing?.files.length) {
            destination = await session.createThread({ model, executionLocation: location,
              sharingScope: location === 'local' ? 'local' : 'mesh', privacy });
          } else {
            await session.select(null);
            destination = null;
          }
          if (controller.signal.aborted || selectedId !== destination || composerRevision !== revision) return;
          input.value = pendingDraft.text;
          files = pendingDraft.files;
          showFiles();
          await saveDraft();
          if (controller.signal.aborted || selectedId !== destination) return;
        }
        viewState.privacy = privacy;
        chosenModel = model; viewState.chosenModel = chosenModel;
        executionLocation = location;
        viewState.executionLocation = executionLocation;
        modelSelect.value = next; picker.close(); render(session.getState()); input.focus();
        resumeAfterChoice();
      } finally {
        changingModel = false;
        if (!controller.signal.aborted) render(session.getState());
      }
    });
  }
  on('[data-change-model]', 'click', commitPickerChoice);
  on('[data-retry-connection]', 'click', event => {
    queuedSend = null; render(session.getState());
    const button = event.currentTarget;
    button.disabled = true;
    const retryDeadline = setTimeout(() => { if (!controller.signal.aborted) button.disabled = false; }, 8000);
    void Promise.resolve().then(() => session.connect()).catch(cause => error(cause.message))
      .finally(() => { clearTimeout(retryDeadline); if (!controller.signal.aborted) button.disabled = false; });
  });
  on('[data-download-local]', 'click', event => {
    const state = session.getState();
    const model = state.activeThread?.model || (state.models || []).find(item => (item.selectionId || item.id) === modelSelect.value) || chosenModel || state.defaultModel;
    inspector.downloadModel?.(model?.id, event.currentTarget);
  });
  on('[data-cancel-download]', 'click', () => session.cancelModelDownload());
  const showThreads = showArchived => {
    archived = showArchived; find('[data-show-archived]').setAttribute('aria-pressed', String(archived));
    find('[data-show-active]').setAttribute('aria-pressed', String(!archived));
    actionsPanel.setOpen(false); render(session.getState());
    setThreads(true);
    (find('[data-thread-item-id]') || find('[data-new-thread]')).focus();
  };
  on('[data-show-archived]', 'click', () => showThreads(true));
  on('[data-show-active]', 'click', () => showThreads(false));
  on('[data-rename-cancel]', 'click', () => renameDialog.close());
  on('[data-rename-form]', 'submit', event => { event.preventDefault(); void act(async () => { await session.renameThread(renameId, find('[data-thread-name]').value); renameDialog.close(); }); });
  on('[data-thread-list]', 'click', event => {
    const rename = event.target.closest('[data-rename-thread]');
    if (rename) {
      renameId = rename.dataset.threadId; const thread = session.getState().threads.find(item => item.id === renameId);
      find('[data-thread-name]').value = thread.title || thread.purpose || thread.messages.find(message => message.role === 'user')?.content || 'New thread';
      rename.closest('details').open = false; renameDialog.open(find('[data-thread-name]'), rename.closest('details').querySelector('summary')); return;
    }
    const archive = event.target.closest('[data-archive-thread]');
    if (archive) {
      void act(async () => { await saveDraft();
        if (archived) { archived = false; find('[data-show-archived]').setAttribute('aria-pressed', 'false'); find('[data-show-active]').setAttribute('aria-pressed', 'true'); await session.restoreThread(archive.dataset.threadId); }
        else await session.archiveThread(archive.dataset.threadId);
        (find('[data-thread-item-id][aria-current="true"]') || find('[data-new-thread]')).focus();
      }); return;
    }
    const button = event.target.closest('[data-thread-item-id]'); if (button) { queuedSend = null; try { observe(after(saveDraft(), () => { const selected = session.select(button.dataset.threadItemId); inspector.close?.({ restoreFocus: false }); setThreads(false); return selected; })); } catch (cause) { error(cause); } } });
  on('[data-context-indicator]', 'click', event => inspector.open?.('conversation', event.currentTarget));
  const openExecutionPolicy = trigger => {
    if (submitting || applyingPrivacy) return;
    const state = session.getState();
    queuedSend = null;
    render(state);
    if (privacyTrigger.disabled) return;
    editingThread = state.selectedId;
    updatePrivacyControls(privacyNode, currentPolicy(state));
    privacyDialog.open(privacyNode.querySelector('[data-privacy-placement]'), trigger);
  };
  // One "Answer on" sheet: each row applies on tap. The detailed policy dialog stays under More options.
  // The model sheet is the one place to choose the computer and the model. Rows apply on tap.
  const openDestination = (trigger, { forSend = false } = {}) => {
    if (privacyTrigger.disabled) return;
    sendAfterDestination = forSend;
    openPicker({ currentTarget: trigger });
    find('[data-picker-title]').textContent = forSend ? 'Where should this run?' : 'Answer on';
  };
  const destinationPolicy = (key, state) => {
    const locked = lockedDestination(state);
    return key === 'device' ? localPolicy
      : key === 'desktop' && locked ? createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: [locked.id] }, computation: 'plaintext' })
        : createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] }, computation: 'plaintext' });
  };
  // A new chat's destination changes at once, so Done right after a computer tap commits the new choice.
  const applyDraftDestination = key => {
    viewState.privacyTouched = true;
    viewState.privacy = destinationPolicy(key, session.getState());
    executionLocation = viewState.executionLocation = key === 'device' ? 'local' : 'network';
  };
  const applyDestination = async key => {
    const state = session.getState(), privacy = destinationPolicy(key, state);
    viewState.privacyTouched = true;
    if (state.activeThread) {
      await session.setExecutionPrivacy(state.activeThread.id, privacy);
      await session.setExecutionLocation(state.activeThread.id, key === 'device' ? 'local' : 'network');
    } else {
      viewState.privacy = privacy;
      executionLocation = viewState.executionLocation = key === 'device' ? 'local' : 'network';
    }
  };
  on('[data-join-host]', 'click', () => {
    const invite = viewState.guestInvite;
    if (!invite || !session.guestJoin) return;
    void session.guestJoin.join({ hostPeerId: invite.hostPeerId, token: invite.token, hostLabel: invite.hostLabel, roomId: invite.roomId })
      // Joined: the token is spent; this device now remembers the host, not the link.
      .then(() => { viewState.guestInvite = null; render(session.getState()); input.focus(); })
      .catch(() => render(session.getState()));
  });
  on('[data-open-privacy]', 'click', event => { if (find('[data-model-picker]').open) picker.close(); openExecutionPolicy(event.currentTarget); });
  on('[data-review-network-execution]', 'click', event => openDestination(event.currentTarget, { forSend: true }));
  on('[data-privacy-controls]', 'change', event => {
    if (event.target.matches('[data-privacy-recipient-mode], [data-privacy-placement]')) showPrivacyChoices(privacyNode);
  });
  on('[data-privacy-cancel]', 'click', () => privacyDialog.close());
  on('[data-privacy-apply]', 'click', async () => {
    const state = session.getState();
    if (!privacyNode.open || applyingPrivacy || submitting || editingThread !== state.selectedId || privacyTrigger.disabled) return;
    const apply = find('[data-privacy-apply]');
    applyingPrivacy = apply.disabled = true;
    try {
      const privacy = readPrivacyControls(privacyNode);
      viewState.privacyTouched = true;
      if (state.activeThread) {
        await session.setExecutionPrivacy(state.activeThread.id, privacy);
        if (privacy.placement === 'network-allowed' && privacy.recipients.kind !== 'none'
          && state.activeThread.permissions?.executionLocation === 'local') await session.setExecutionLocation(state.activeThread.id, 'auto');
      } else {
        viewState.privacy = privacy;
        if (privacy.placement === 'network-allowed' && privacy.recipients.kind !== 'none' && executionLocation === 'local') {
          executionLocation = viewState.executionLocation = 'auto';
        }
      }
      if (privacyNode.open) privacyDialog.close();
      render(session.getState());
    } catch (cause) {
      const notice = find('[data-privacy-error]');
      notice.textContent = cause.message;
      notice.hidden = false;
    } finally { applyingPrivacy = apply.disabled = false; }
  });
  on('[data-execution-location]', 'click' , event => {
    const button = event.target.closest('[data-execution-choice]');
    if (!button || button.disabled || button.getAttribute('aria-pressed') === 'true') return;
    const choice = button.dataset.executionChoice;
    pickerTouched = true;
    pickerRevision++; pickerLocation = choice === 'local' ? 'local' : 'network';
    pickerChoice = choice === 'local' ? 'device' : choice === 'desktop' ? 'desktop' : 'contributors';
    if (!session.getState().activeThread) applyDraftDestination(pickerChoice);
    updatePicker(session.getState());
    void act(async () => {
      if (session.getState().activeThread) await applyDestination(pickerChoice);
      // The sheet stays open on the new computer so its model list can be checked; a model tap closes it.
      const state = session.getState();
      render(state); if (find('[data-model-picker]').open) updatePicker(state);
    });
  });
  on('[data-queue-send]', 'click', () => {
    const state = session.getState(), location = effectiveLocation(state);
    const model = state.models?.find(item => modelKey(item) === modelSelect.value);
    if (!input.value.trim() || state.discoveryPhase !== 'searching' || !canWaitForPublicModel(state, model, location)
      || modelExecutionState(model, location).usable) return;
    queuedSend = { scope: queueScope(state, model), scheduled: false };
    render(state);
  });
  on('[data-cancel-queued-send]', 'click', () => { queuedSend = null; render(session.getState()); });
  on('[data-composer-form]', 'submit', event => { event.preventDefault(); submitDraft(); });
  function submitDraft(intent = null) {
    const draftText = input.value, content = draftText.trim(), state = session.getState();
    if (!content || attachmentReader.pending || submitting || (state.runningIds || []).includes(state.selectedId)) return;
    if (intent ? !readyForQueuedSend(state, intent) : find('[data-composer-send]').disabled) return;
    const model = state.models.find(item => (item.selectionId || item.id) === modelSelect.value);
    if (!intent && !state.activeThread && viewState.privacy === undefined && !viewState.privacyTouched && !lockedDestination(state)
      && !modelExecutionState(model, effectiveLocation(state)).usable
      && !(state.discoveryPhase === 'searching' && canWaitForPublicModel(state, model, effectiveLocation(state)))) {
      openDestination(find('[data-composer-send]'), { forSend: true });
      return;
    }
    if (!intent && state.discoveryPhase === 'searching' && !modelExecutionState(model, effectiveLocation(state)).usable
      && canWaitForPublicModel(state, model, effectiveLocation(state))) {
      queuedSend = { scope: queueScope(state, model), scheduled: false };
      render(state);
      return;
    }
    const pinned = state.activeThread?.model || chosenModel || viewState.draftModel;
    if (!model || pinned?.identity && modelIdentity(model) !== modelIdentity(pinned)) return;
    const location = intent ? 'network' : effectiveLocation(state);
    const searched = searching();
    if (searched && files.length) { error("Search-backed answers don't include files. Remove the files or turn off search for this answer."); return; }
    queuedSend = null;
    submitting = true;
    const revision = composerRevision, origin = state.selectedId, attachments = files.map(file => ({ ...file }));
    const dispatch = async () => {
      try {
        const sharingScope = location === 'local' ? 'local' : 'mesh';
        const target = state.activeThread || { model, permissions: { sharingScope, executionLocation: location } };
        const personalSearch = searched && webSearch?.enabled() && !!webSearch.state().url;
        const allowed = searched && !personalSearch ? await prepareSearch(target.model, target.permissions?.sharingScope, searchRouteNow(), location, content) : null;
        const created = state.selectedId || session.createThread({ model, sharingScope, executionLocation: location, privacy: explicitPrivacy(state), contextPrompt: contextPrompt || undefined });
        const threadId = typeof created?.then === 'function' ? await created : created;
        if (selectedId === threadId) {
          const current = composerRevision === revision ? { text: draftText, files: attachments } : drafts.get(origin);
          if (current) { input.value = current.text; files = current.files; showFiles(); }
        }
        if (intent) {
          const latest = session.getState();
          const current = latest.models?.find(item => modelKey(item) === modelKey(model));
          if (controller.signal.aborted || composerRevision !== revision || selectedId !== threadId
            || latest.remoteNetworkId !== state.remoteNetworkId || latest.remoteAnswersEnabled !== state.remoteAnswersEnabled
            || !['observed', 'searching'].includes(latest.discoveryPhase)
            || latest.activeThread?.permissions?.executionLocation !== 'network' || searching()
            || !allowsOpenPlaintext(latest.activeThread?.privacy)
            || modelIdentity(current) !== modelIdentity(model)
            || current?.networkAvailability !== 'ready' || !current.reachableProviderIds?.length) {
            if (!controller.signal.aborted && selectedId === threadId && composerRevision === revision) await saveDraft();
            return;
          }
        }
        // An allowed search answer uses the search route; otherwise, with web search on, the send opts into the MCP server.
        const completion = session.send(threadId, content, attachments, ...(allowed ? [{ search: allowed }]
          : personalSearch ? [{ retrieval: {} }] : []));
        if (allowed) setSearch(false);
        // A second call cannot begin while asynchronous admission is pending.
        completion.catch(() => {});
        if (completion.admitted) await completion.admitted;
        if (composerRevision === revision && selectedId === threadId) {
          if (origin == null) await session.saveDraft?.(null, null);
          await session.saveDraft?.(threadId, null);
          if (composerRevision === revision && selectedId === threadId) {
            input.value = ''; resizeInput(); files = [];
            if (origin == null) { drafts.delete(null); viewState.draftModel = null; }
            drafts.delete(threadId); showFiles();
          }
        }
        submitting = false; await completion;
      } finally { submitting = false; }
    };
    void dispatch().catch(error);
  }
  on('[data-composer-input]', 'keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); find('[data-composer-form]').requestSubmit(); }
  });
  on('[data-composer-stop]', 'click', () => act(() => session.cancel(session.getState().selectedId)));
  on('[data-message-stream]', 'click', event => {
    if (event.target.closest('[data-answer-stop]')) { act(() => session.cancel(session.getState().selectedId)); return; }
    const receipt = event.target.closest('[data-execution-trigger]');
    if (receipt) { const row = receipt.closest('[data-message-id]'); const message = session.getState().activeThread?.messages.find(item => item.id === row?.dataset.messageId); if (message?.attemptId) inspector.inspectAttempt?.(message.attemptId, receipt); return; }
    const copyError = event.target.closest('[data-copy-error]');
    if (copyError) act(async () => {
      const attempt = session.getState().activeThread?.attempts.find(item => item.id === copyError.dataset.copyError);
      if (attempt?.error) { await navigator.clipboard.writeText(attempt.error); copyError.title = 'Copied'; copyError.setAttribute('aria-label', 'Copied'); }
    });
    const copy = event.target.closest('[data-copy-message], [data-copy-code]');
    if (copy) act(async () => {
      const row = copy.closest('[data-message-id]');
      const content = copy.hasAttribute('data-copy-code') ? copy.parentElement.querySelector('code').textContent
        : session.getState().activeThread.messages.find(message => message.id === row.dataset.messageId).content;
      await navigator.clipboard.writeText(content);
      if (copy.hasAttribute('data-copy-message')) {
        copy.innerHTML = interfaceIcon('check');
        copy.setAttribute('aria-label', 'Copied'); copy.title = 'Copied';
      } else copy.textContent = 'Copied';
    });
    const button = event.target.closest('[data-retry-attempt]');
    if (button && !button.disabled) act(async () => {
      const thread = session.getState().activeThread;
      // Retry starts a fresh search bound to the current tool and execution identities.
      const failed = thread.attempts.find(item => item.id === button.dataset.retryAttempt);
      if (!session.searchRetryNeedsPermission?.(failed)) return session.retry(thread.id, button.dataset.retryAttempt);
      const allowed = await prepareSearch(thread.model, failed.request?.permissions?.sharingScope ?? thread.permissions?.sharingScope, failed.request?.retrieval?.route, failed.request?.permissions?.executionLocation ?? 'auto', failed.request?.retrieval?.query || '');
      if (allowed) return session.retry(thread.id, button.dataset.retryAttempt, { search: allowed });
    });
  });
  on('[data-composer-files]', 'click', () => { find('[data-attachment-help]').hidden = false; });
  on('[data-composer-files]', 'focus', () => { find('[data-attachment-help]').hidden = false; });
  on('[data-composer-files]', 'change', event => {
    const chosen = [...event.target.files]; event.target.value = '';
    if (chosen.length) pinDraftModel(session.getState());
    observe(attachmentReader.enqueue(chosen));
  });
  on('[data-attachments-preview]', 'click', event => { const button = event.target.closest('[data-remove-file]'); if (button) { files.splice(Number(button.dataset.removeFile), 1); composerRevision++; void act(async () => { await saveDraft(); showFiles(); }); } });
  on('[data-conversation-download]', 'click', () => act(() => {
    const text = session.exportConversation(selectedId);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'reploid-conversation.md';
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }));
  on('[data-message-stream]', 'click', event => {
    const link = event.target.closest('[data-source-reference]');
    if (!link) return;
    const target = document.getElementById(link.getAttribute('href').slice(1));
    if (target) { event.preventDefault(); target.closest('details').open = true; target.focus(); target.scrollIntoView({ block: 'nearest' }); }
  });
  workspaceNavigation = bindWorkspaceNavigation(container, (view, routeState) => {
    applyingView = true;
    try {
      setThreads(view === 'threads' || !!routeState?.threads, false);
      if (['settings', 'computers', 'conversation'].includes(view)) {
        inspector.open(view === 'computers' ? 'participants' : view, find(`[data-workspace-view="${view}"]`));
      } else inspector.close?.({ restoreFocus: false });
    } finally { applyingView = false; }
  });
  container.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.defaultPrevented && !event.target.closest('dialog[open]') && container.hasAttribute('data-threads-open')) {
      event.preventDefault(); setThreads(false); railToggle?.focus();
    }
  }, options);
  workspaceNavigation.restore();
  return () => {
    try { observe(saveDraft()); } catch (cause) { error(cause); }
    inputResize?.disconnect(); stopVisibility?.disconnect();
    detachHelp(); nextModelChoices.dispose();
    production.dispose();
    detachInspector?.(); leftDrawer.dispose();
    messages.dispose(); threads.dispose(); actionsPanel.dispose(); workspaceNavigation.dispose(); detachInspectorClose?.(); picker.dispose(); privacyDialog.dispose(); renameDialog.dispose();
    const surface = container.closest('.pool-home');
    surface?.style.removeProperty('--pool-param-workspace-height');
    surface?.removeAttribute('data-chat-compact');
    controller.abort(); fitRequest?.abort(); detachHandover(); attachmentReader.close(); unsubscribe(); unsubscribeWebSearch(); unsubscribeSearch(); if (!sharedInspector) inspector.dispose?.();
    find('[data-composer-field]').dataset.activity = 'idle';
    find('[data-open-model]').dataset.activity = 'idle';
  };
}
