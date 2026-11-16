/** Bind the conversation view to its host-owned session and independent drafts. */
import { readPrivacyControls, updatePrivacyControls } from './privacy-controls.js';
import workProfile from '../../config/work-profile.json' with { type: 'json' };
import { bindControlHelp } from '../components/control-help.js';
import { bindWorkspaceNavigation } from './workspace-navigation.js';
import { updateContextIndicator } from './context-indicator.js';
import { withComputerLabels } from './computer-labels.js';
import { interfaceIcon } from '../components/interface-icons.js';
import { createConversationList } from './conversation-list.js';
import { updateModelSelect, bindModelChoices, isSharedModelChoice, modelExecutionState, modelVariantLabel, unavailableModelChoice } from '../components/model-select.js';
import { bindNetworkInspector } from './network-inspector.js';
import { bindDrawer } from '../components/drawer.js';
import { renderAttachments, createTextAttachmentReader } from '../components/attachments.js';
import { bindDisclosure } from '../components/disclosure.js';
import { bindDialog } from '../components/dialog.js';
import { createMessageList } from './message-list.js';
import { bindHistoryHandover } from './history-handover-view.js';
import { bindProductionControls } from './contribution-models.js';
import { canDownloadModelHere, updateConversationModelPicker } from './conversation-model-picker.js';
export { renderConversationWorkspace } from './conversation-view.js';

const busyAcquisition = state => state.acquisition?.phase === 'downloading';
const selectable = model => ['ready', 'busy', 'cached', 'loading', 'preparing'].includes(model.availability);

export function bindConversationWorkspace(root, session, { getInviteUrl, viewState = {}, inspector: sharedInspector, webSearch = null, search = null, historyHandover = null } = {}) {
  const container = root.querySelector('[data-chat-workspace]');
  if (!container || !session) return () => {};
  const surface = container.closest('.pool-home');
  const find = selector => container.querySelector(selector) || surface?.querySelector(selector);
  const controller = new AbortController(), options = { signal: controller.signal };
  const input = find('[data-composer-input]'), modelSelect = find('[data-active-model-select]');
  const detachHelp = bindControlHelp(container);
  const nextModelChoices = bindModelChoices(find('[data-next-model]'));
  const inspector = sharedInspector || bindNetworkInspector(container, session, { getInviteUrl, webSearch, search });
  let archived = false, renameId = null, chosenModel = viewState.chosenModel || null, pickerModel = null, pickerLocation = 'auto';
  let changingModel = false, pickerTouched = false;
  let files = [], composerRevision = 0;
  const attachmentReader = createTextAttachmentReader({
    getFiles: () => files,
    onLoaded: async loaded => { files.push(...loaded); composerRevision++; await saveDraft(); showFiles(); },
    onPending: () => { if (!controller.signal.aborted) render(session.getState()); },
    limits: { maxFiles: workProfile.files.maxInputs, maxFileBytes: workProfile.files.maxFileBytes,
      maxTotalBytes: workProfile.files.maxInputBytes, extensions: ['txt', 'md', 'json', 'js', 'ts', 'html', 'css'] }
  });
  let contextPrompt = viewState.contextPrompt || null;
  let executionLocation = viewState.executionLocation || 'auto';
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
  // A message sent before any computer has been found is kept and sent the moment a model can answer.
  let queuedSend = false;
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
  // The person's own search server when it is set up and on, otherwise the server's Brave route.
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
  const updatePicker = snapshot => {
    pickerModel = updateConversationModelPicker({ find, choices: nextModelChoices,
      state: snapshot.computerLabels ? snapshot : withComputerLabels(snapshot, session),
      model: pickerModel, location: pickerLocation, touched: pickerTouched, changing: changingModel,
      selectedId: modelSelect.value, privacy: viewState.privacy, canDownload: !!inspector.downloadModel });
  };
  const render = snapshot => {
    const state = withComputerLabels(snapshot, session);
    if (controller.signal.aborted) return;
    if (selectedId !== state.selectedId) {
      drafts.set(selectedId, { text: input.value, files }); selectedId = state.selectedId; attachmentReader.reset();
      const draft = drafts.get(selectedId) || session.getDraft?.(selectedId); input.value = draft?.text || ''; files = draft?.files || []; showFiles();
    }
    const thread = state.activeThread, catalogModels = state.models || [], runningIds = state.runningIds || [];
    const keyFor = model => model?.selectionId || model?.id;
    const models = [...catalogModels];
    if (!thread && chosenModel && !models.some(model => keyFor(model) === keyFor(chosenModel))) {
      models.push(catalogModels.find(model => keyFor(model) === keyFor(chosenModel)) || unavailableModelChoice(chosenModel));
    }
    if (thread && !models.some(model => keyFor(model) === keyFor(thread.model))) {
      models.push(catalogModels.find(model => keyFor(model) === keyFor(thread.model)) || unavailableModelChoice(thread.model));
    }
    const location = thread?.permissions?.sharingScope === 'local' ? 'local' : thread?.permissions?.executionLocation ?? executionLocation;
    const defaultModel = state.defaultModels?.[location] || state.defaultModel;
    const current = keyFor(thread?.model) || keyFor(chosenModel)
      || keyFor(models.find(model => keyFor(model) === keyFor(defaultModel) && selectable(model)))
      || keyFor(models.find(selectable)) || keyFor(models[0]);
    updateModelSelect(modelSelect, models, { value: current, showAvailability: true, grouped: true, preferNetwork: location !== 'local' });
    modelSelect.value = current || ''; modelSelect.disabled = !models.length; modelSelect.hidden = !!thread;
    const selectedModel = catalogModels.find(model => keyFor(model) === current);
    const execution = modelExecutionState(selectedModel, location);
    const prepareHere = location === 'local' && selectedModel?.localCached === true;
    const usable = execution.usable || prepareHere;
    find('[data-composer-field]').dataset.executionSource = execution.source;
    const modelStatus = find('[data-model-status]');
    const networkState = state.network?.consumer?.connectionState;
    const localPreparing = state.localModel?.phase === 'loading';
    const requestedModel = selectedModel || thread?.model || chosenModel || models.find(model => keyFor(model) === current)
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
    const exhausted = state.peerDiscoveryTimedOut === true;
    const canAcquire = !!session.downloadLocalModel && !state.localDownloadIssue && !usable && !localPreparing && !busyAcquisition(state)
      && location !== 'network' && !requestedModel?.fleet && !!requestedModel?.source && !requestedModel?.partition && !requestedModel?.adapters?.length && (exhausted || location === 'local');
    const acquisition = state.acquisition;
    const acquisitionText = find('[data-acquisition-status]');
    acquisitionText.textContent = acquiring ? acquisition.progress?.message || 'Checking model files.'
      : ['failed', 'cancelled'].includes(acquisition?.phase) ? acquisition.error + ' Retry reuses verified files where supported.' : '';
    if (acquiring && usable) acquisitionText.textContent += ' Network capacity is available; you can send now or cancel this download.';
    acquisitionText.hidden = !acquisitionText.textContent;
    const meter = find('[data-acquisition-progress]');
    meter.hidden = !acquiring;
    if (acquisition?.progress?.totalBytes && acquisition.progress.receivedBytes !== null) {
      meter.max = acquisition.progress.totalBytes; meter.value = acquisition.progress.receivedBytes;
    } else meter.removeAttribute('value');
    find('[data-cancel-download]').hidden = !acquiring;
    find('[data-download-local]').hidden = !canAcquire || !!thread?.closed;
    find('[data-download-local]').textContent = ['failed', 'cancelled'].includes(acquisition?.phase) ? 'Retry download' : 'Download model';
    const busy = runningIds.includes(thread?.id) || !!state.comparisonPhase;
    // One status line under the composer explains a disabled Send, including before
    // the first attempt, without adding another panel.
    const statusText = busy ? '' : thread?.closed ? 'Restore this thread to continue.'
      : prepareHere && !execution.usable ? 'Send prepares this model on this device.'
      : state.localModel?.error && !usable ? 'Model preparation failed: ' + state.localModel.error
      : !usable && (selectedModel || models.find(model => keyFor(model) === current))?.adapters?.length && location !== 'local' ? 'No computer serves this adapter now. The base model is not used instead.'
      : !usable && location === 'network' ? 'No shared computer can answer with this model right now.'
      : !usable && location === 'local' ? 'Download this model to run it on this device.'
      : !usable && exhausted ? state.localDownloadIssue || (requestedModel?.partition || requestedModel?.adapters?.length
        ? 'This model has no available shared route.' : 'This model is unavailable. Choose a shared model or download it.')
      : !usable && current && !preparing && catalogModels.some(model => ['ready', 'busy', 'cached'].includes(model.availability))
        ? 'Choose an available model.'
      : !usable ? preparing ? state.localModel?.progress?.message || 'Model preparing…' : state.network?.paused ? 'Reconnect to continue.'
        : state.network?.connecting || ['connecting', 'retrying'].includes(networkState) ? 'Finding capacity…'
        : state.peerDiscoveryTimedOut === false ? 'Finding computers…' : 'Model unavailable.' : '';
    if (queuedSend && (exhausted || thread?.closed)) queuedSend = false;
    if (queuedSend && usable && !busy) { queuedSend = false; queueMicrotask(() => { if (!controller.signal.aborted) find('[data-composer-form]').requestSubmit(); }); }
    // A busy contributor still answers later; that notice takes the line only when nothing blocks Send.
    modelStatus.textContent = queuedSend ? 'Finding a computer. Your message sends as soon as one is ready.' : statusText || (!busy && location === 'network' && selectedModel?.networkAvailability === 'busy'
      ? 'Contributors are busy. Sending waits for capacity.' : '');
    modelStatus.hidden = !modelStatus.textContent; modelStatus.title = modelStatus.textContent;
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
    find('[data-retry-connection]').title = statusText;
    find('[data-model-control]').hidden = !models.length;
    find('[data-open-model]').dataset.activity = execution.status === 'ready' ? 'ready' : 'idle';
    find('[data-picker-thread-note]').hidden = !thread;
    const activeModel = selectedModel || thread?.model || chosenModel || models.find(model => keyFor(model) === current)
      || catalogModels.find(model => keyFor(model) === current) || requestedModel;
    find('[data-model-caption]').hidden = !!activeModel;
    const modelDigest = activeModel ? `${modelVariantLabel(activeModel)} · ${execution.label}` : '';
    find('[data-composer-model-name]').textContent = activeModel ? modelVariantLabel(activeModel) : '';
    find('[data-composer-model-source]').textContent = activeModel ? ` · ${execution.usable ? execution.source === 'local' ? 'This device' : activeModel.fleet ? 'Private computers' : 'Public network' : execution.status === 'loading' || execution.status === 'preparing' ? 'Loading' : 'Unavailable'}` : '';
    find('[data-open-model]').title = modelDigest ? `Choose model: ${modelDigest}` : 'Choose model';
    find('[data-open-model]').setAttribute('aria-label', modelDigest ? `Choose model: ${modelDigest}` : 'Choose model');
    updateContextIndicator(container, state, session);
    threads.update(state.threads || [], state.selectedId, { archived, models: state.models });
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
    find('[data-retry-connection]').hidden = busy || usable || location === 'local' || !state.network?.paused && !state.network?.error && !['failed', 'disconnected'].includes(networkState) && !(exhausted && (state.network?.connecting || ['connecting', 'retrying'].includes(networkState))); find('[data-composer-send]').disabled = attachmentReader.pending || !usable || !!thread?.closed || !!state.storageError;
    // Once a model can answer, the waiting message sends as if Send were pressed again.

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

  };
  const unsubscribe = session.subscribe(render);
  const refreshSearchToggle = () => { searchToggle.hidden = !(search?.available() || deviceSearchOn() || webSearch?.enabled()); if (searchToggle.hidden) setSearch(false); };
  const unsubscribeSearch = search && session.searchPermissionRequest ? search.subscribe(refreshSearchToggle) : () => {};
  if (search && search.state().state === 'unknown') void search.refresh();
  on('[data-search-toggle]', 'click', () => setSearch(!searching()));
  const webSearchOn = find('[data-web-search-on]');
  const unsubscribeWebSearch = webSearch ? webSearch.subscribe(state => {
    refreshSearchToggle();
    if (webSearchOn) setSearch(state.enabled && (!!state.url || !!search?.available() || deviceSearchOn()));
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
  const openPicker = event => {
    pickerTouched = false;
    const state = session.getState();
    inspector.close?.({ restoreFocus: false });
    find('[data-current-model-description]').textContent = state.activeThread?.model.name || '';
    pickerModel = (state.models || []).find(model => (model.selectionId || model.id) === modelSelect.value)
      || state.activeThread?.model || chosenModel || state.defaultModel || null;
    pickerLocation = state.activeThread?.permissions?.sharingScope === 'local' ? 'local' : state.activeThread?.permissions?.executionLocation ?? executionLocation;
    updatePicker(state);
    picker.open(find('[data-next-model]'), event.currentTarget);
    render(state);
    nextModelChoices.focus();
  };
  // One model control opens the bounded model/source choice.
  on('[data-open-model]', 'click', openPicker);
  on('[data-model-picker-close]', 'click', () => picker.close());
  on('[data-model-picker]', 'close', () => render(session.getState()));
  // A route radio under the providers selects that route of the highlighted variant.
  on('[data-model-picker]', 'change', event => {
    const route = event.target.closest?.('[data-model-route-choice]');
    if (!route || route.disabled) return;
    const next = find('[data-next-model]');
    next.value = route.value; next.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // A pointer click on a model that can answer now is the whole choice: it is applied without a second
  // confirming click. Keyboard movement between choices still only previews, and a model that needs a
  // download keeps its explicit button.
  find('[data-model-picker]').addEventListener('click', event => {
    if (!event.detail || !event.target.closest?.('label[data-choice-key]')) return;
    setTimeout(() => { const button = find('[data-change-model]');
      if (!controller.signal.aborted && find('[data-model-picker]').open && !button.disabled && button.textContent === 'Use model') button.click(); }, 0);
  }, { signal: controller.signal });
  on('[data-next-model]', 'change', () => {
    pickerTouched = true;
    pickerModel = (session.getState().models || []).find(model => (model.selectionId || model.id) === find('[data-next-model]').value) || pickerModel;
    if (pickerLocation !== 'local' && !modelExecutionState(pickerModel, pickerLocation).usable) pickerLocation = isSharedModelChoice(pickerModel) ? 'network' : 'auto';
    updatePicker(session.getState());
    render(session.getState());
  });
  on('[data-composer-input]', 'input', () => { composerRevision++; resizeInput(); refreshStartingPrompts(); try { observe(saveDraft()); } catch (cause) { error(cause); } });
  on('[data-starting-prompts]', 'click', event => {
    const button = event.target.closest('[data-starting-prompt]');
    if (!button || find('[data-starting-prompts]').hidden || find('[data-starting-prompts]').inert) return;
    input.value = button.textContent;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  });
  const newThread = () => after(saveDraft(), () => after(session.select(null), () => { inspector.close?.({ restoreFocus: false }); chosenModel = null; viewState.chosenModel = null; archived = false; find('[data-show-archived]').setAttribute('aria-pressed', 'false'); find('[data-show-active]').setAttribute('aria-pressed', 'true'); actionsPanel.setOpen(false); setThreads(false); render(session.getState()); input.focus(); }));
  on('[data-new-thread]', 'click', () => { try { observe(newThread()); } catch (cause) { error(cause); } });
  on('[data-active-model-select]', 'change', () => { chosenModel = (session.getState().models || []).find(model => (model.selectionId || model.id) === modelSelect.value); viewState.chosenModel = chosenModel; render(session.getState()); input.focus(); });
  on('[data-change-model]', 'click', () => {
    if (changingModel) return;
    const next = find('[data-next-model]').value;
    const state = session.getState();
    const model = (state.models || []).find(model => (model.selectionId || model.id) === next && (modelExecutionState(model, pickerLocation).usable || pickerLocation === 'local' && state.activeThread?.permissions?.sharingScope === 'local' && !!model.source && !model.partition && !state.localDownloadIssue));
    if (!model) {
      const wanted = (state.models || []).find(item => (item.selectionId || item.id) === next);
      if (wanted && downloadableHere(wanted, state)) { const opener = find('[data-model-control]'); picker.close(); inspector.downloadModel(next, opener); return; }
      updatePicker(session.getState()); return;
    }
    const location = pickerLocation;
    changingModel = true; updatePicker(state);
    void act(async () => {
      try {
        if (state.activeThread && (state.activeThread.model.selectionId || state.activeThread.model.id) === next) {
          await session.setExecutionLocation(state.activeThread.id, location);
          picker.close(); input.focus(); return;
        }
        const pendingDraft = input.value || files.length ? { text: input.value, files: [...files] } : null;
        await newThread();
        if (controller.signal.aborted) return;
        if (pendingDraft) {
          input.value = pendingDraft.text;
          files = pendingDraft.files;
          await saveDraft();
          showFiles();
        }
        chosenModel = model; viewState.chosenModel = chosenModel;
        executionLocation = location;
        viewState.executionLocation = executionLocation;
        modelSelect.value = next; picker.close(); render(session.getState()); input.focus();
      } finally {
        changingModel = false;
        if (!controller.signal.aborted) render(session.getState());
      }
    });
  });
  on('[data-retry-connection]', 'click', event => {
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
    const button = event.target.closest('[data-thread-item-id]'); if (button) { try { observe(after(saveDraft(), () => { const selected = session.select(button.dataset.threadItemId); inspector.close?.({ restoreFocus: false }); setThreads(false); return selected; })); } catch (cause) { error(cause); } } });
  on('[data-context-indicator]', 'click', event => inspector.open?.('conversation', event.currentTarget));
  on('[data-privacy-profile]', 'change', event => {
    find('[data-privacy-recipients-label]').hidden = event.target.value !== 'restricted';
  });
  on('[data-privacy-apply]', 'click', () => {
    void act(async () => {
      const privacy = readPrivacyControls(find('[data-privacy-controls]'));
      const state = session.getState();
      if (state.activeThread) await session.setExecutionPrivacy(state.activeThread.id, privacy);
      else viewState.privacy = privacy;
      updatePrivacyControls(find('[data-privacy-controls]'), privacy, false);
    });
  });
  on('[data-execution-location]', 'click' , event => {
    const button = event.target.closest('[data-execution-choice]');
    if (!button || button.disabled || button.getAttribute('aria-pressed') === 'true') return;
    pickerTouched = true;
    pickerLocation = button.dataset.executionChoice;
    updatePicker(session.getState());
  });
  on('[data-composer-form]', 'submit', event => {
    event.preventDefault();
    const content = input.value.trim(), state = session.getState();
    if (!content || attachmentReader.pending || submitting || (state.runningIds || []).includes(state.selectedId)) return;
    {
      const chosen = state.models.find(item => (item.selectionId || item.id) === modelSelect.value);
      const where = state.activeThread?.permissions?.sharingScope === 'local' ? 'local' : state.activeThread?.permissions?.executionLocation ?? executionLocation;
      const waitingForDiscovery = state.peerDiscoveryTimedOut === false && !state.network?.paused && where !== 'local'
        && !modelExecutionState(state.activeThread?.model && state.models.find(item => (item.selectionId || item.id) === (state.activeThread.model.selectionId || state.activeThread.model.id)) || chosen, where).usable;
      if (waitingForDiscovery) { queuedSend = true; render(state); return; }
    }
    if (find('[data-composer-send]').disabled) return;
    const searched = searching();
    if (searched && files.length) { error("Search-backed answers don't include files. Remove the files or turn off search for this answer."); return; }
    submitting = true;
    const revision = composerRevision, origin = state.selectedId, attachments = files.map(file => ({ ...file }));
    act(async () => {
      try {
        const model = state.models.find(item => (item.selectionId || item.id) === modelSelect.value);
        const location = state.activeThread?.permissions?.sharingScope === 'local' ? 'local' : state.activeThread?.permissions?.executionLocation ?? executionLocation;
        const sharingScope = location === 'local' ? 'local' : 'mesh';
        const target = state.activeThread || { model, permissions: { sharingScope, executionLocation: location } };
        const personalSearch = searched && webSearch?.enabled() && !!webSearch.state().url;
        const allowed = searched && !personalSearch ? await prepareSearch(target.model, target.permissions?.sharingScope, searchRouteNow(), location, content) : null;
        const threadId = state.selectedId || await session.createThread({ model, sharingScope, executionLocation: location, privacy: viewState.privacy ?? null, contextPrompt: contextPrompt || undefined });
        if (selectedId === threadId) {
          const current = composerRevision === revision ? { text: content, files: attachments } : drafts.get(origin);
          if (current) { input.value = current.text; files = current.files; showFiles(); }
        }
        // An allowed search answer uses the search route; otherwise, with web search on, the send opts into the MCP server.
        const completion = session.send(threadId, content, attachments, ...(allowed ? [{ search: allowed }]
          : personalSearch ? [{ retrieval: {} }] : []));
        if (allowed) setSearch(false);
        // A second call cannot begin while asynchronous admission is pending.
        completion.catch(() => {});
        if (completion.admitted) await completion.admitted;
        if (composerRevision === revision && selectedId === threadId) {
          await session.saveDraft?.(null, null); await session.saveDraft?.(threadId, null);
          if (composerRevision === revision && selectedId === threadId) {
            input.value = ''; resizeInput(); files = []; drafts.delete(null); drafts.delete(threadId); showFiles();
          }
        }
        submitting = false; await completion;
      } finally { submitting = false; }
    });
  });
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
      if (['settings', 'computers', 'conversation'].includes(view)) inspector.open(view === 'computers' ? 'participants' : view);
      else inspector.close?.({ restoreFocus: false });
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
    messages.dispose(); threads.dispose(); actionsPanel.dispose(); workspaceNavigation.dispose(); detachInspectorClose?.(); picker.dispose(); renameDialog.dispose();
    const surface = container.closest('.pool-home');
    surface?.style.removeProperty('--pool-param-workspace-height');
    surface?.removeAttribute('data-chat-compact');
    controller.abort(); detachHandover(); attachmentReader.close(); unsubscribe(); unsubscribeWebSearch(); unsubscribeSearch(); if (!sharedInspector) inspector.dispose?.();
    find('[data-composer-field]').dataset.activity = 'idle';
    find('[data-open-model]').dataset.activity = 'idle';
  };
}
