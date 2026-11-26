/**
 * The conversation workspace without markup: drafts, the "Answer on" choice, "Who can read it", the queued Send,
 * the reviewed download, threads and the transcript, as one snapshot plus the commands that change them. It is the
 * former vanilla workspace binding with the DOM taken out, so every decision is
 * the one the vanilla page made: it calls the same decision functions and keeps the same state. The session
 * (host/chat-session.js) owns threads, execution, admission and settlement; this owns only what the person has
 * staged on the page.
 *
 * Cost per notification grows with the active thread's new output, not with how many threads exist: the thread
 * list projects a few fields per thread, and each message keeps its projection until its own record changes.
 */
import { createExecutionPolicy, executionRequirementsFor, validateExecutionPolicy } from '../../../../shared/vendor/reploid/chat/execution-policy.js';
import { PROTECTION_DISPLAY, SPLIT_DISPLAY, splitReadersLine } from '../../../../shared/vendor/reploid/inference/protections.js';
import { locationForRoute } from '../execution-route.js';
import { describeCircleHost, parseCircleInviteUrl } from '../circle-invites.js';
import {
  allowsOpenPlaintext, conversationRoute, namedPrivacyPreset, presetForPolicy, policyForPreset, presetDisclosure
} from '../../ui/pool-home/privacy-controls.js';
import { ownDevicesChoice, protectionChoices, routeChoices, startingLocalModel, sharingOptionChoices } from '../../ui/pool-home/choice-availability.js';
import { withComputerLabels } from '../../ui/pool-home/computer-labels.js';
import { projectThreadContext } from '../../ui/pool-home/context-indicator.js';
import {
  hasBrowserModelOrigin, isDownloadableBaseModel, modelExecutionState, modelVariantLabel, unavailableModelChoice, modelFacts
} from '../../ui/components/model-select.js';
import { createTextAttachmentReader } from '../../ui/components/attachments.js';
import { routeAlternatives } from '../../ui/pool-home/route-alternatives.js';
import { webSearchRecipient } from '../../ui/pool-home/web-search-settings.js';
import {
  canDownloadModelHere, contributorBlock, describeAnswerChoice, localFitText, locationForModel, modelForLocation, recoverySharedModel
} from '../../ui/pool-home/conversation-model-picker.js';
import { adapterAvailability, adapterEvidence, describeModelChoice } from '../../ui/pool-home/model-adapters.js';
import { ADAPTER_GUIDE_URL, projectModelRoutes } from '../../ui/pool-home/model-providers.js';
import { remotePermissionText, remotePermissionWording } from '../../ui/pool-home/remote-permission.js';
import { answerChoiceOf, findAnswerChoice, readAnswerChoice, writeAnswerChoice } from '../../ui/pool-home/answer-choice.js';
import { projectModelChoices } from './model-choices.js';
import { createTranscript } from './transcript.js';
import workProfile from '../../config/work-profile.json' with { type: 'json' };
import chatPrompts from '../../config/chat-prompts.json' with { type: 'json' };

const busyAcquisition = state => state.acquisition?.phase === 'downloading';
const modelKey = model => model?.selectionId || model?.id;
const modelIdentity = model => JSON.stringify([modelKey(model), model?.identity, (model?.adapters || []).map(adapter => adapter.identity)]);
const selectable = model => ['ready', 'busy', 'cached', 'loading', 'preparing'].includes(model.availability);

/** Up to `count` distinct prompts drawn at random from `prompts` (a partial Fisher-Yates shuffle over a copy). */
export function pickStartingPrompts(prompts, random = Math.random, count = 3) {
  const pool = [...new Set((prompts || []).filter(text => typeof text === 'string' && text.trim()))];
  const draw = () => Math.max(0, Math.min(0.999999999, Number(random()) || 0));
  const picked = [];
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    const j = i + Math.floor(draw() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
    picked.push(pool[i]);
  }
  return picked;
}

/** The quoted ceiling for a priced route, shown before Send. A free route, or one with no accepted terms, states nothing. */
export const creditCapText = model => {
  const maximum = model?.creditCap?.maximum, spendable = model?.creditCap?.spendable;
  if (!(Number.isSafeInteger(maximum) && maximum > 0)) return '';
  const quote = `This answer costs at most ${maximum.toLocaleString()} service credit${maximum === 1 ? '' : 's'}.`;
  return Number.isSafeInteger(spendable) && spendable < maximum
    ? `${quote} Your account can cover ${Math.max(0, spendable).toLocaleString()} now, so this would be refused before anything is sent. Serving answers for others earns more.`
    : quote;
};

export const ATTACHMENT_HELP = `TXT, Markdown, JSON, JS, TS, HTML and CSS. Up to ${workProfile.files.maxInputs}, ${workProfile.files.maxFileBytes / 1024} KB each, ${workProfile.files.maxInputBytes / 1024} KB total.`;
export const ATTACHMENT_ACCEPT = '.txt,.md,.json,.js,.ts,.html,.css';
const THREAD_LABELS = { queued: 'Queued', loading: 'Loading', executing: 'Generating', approval: 'Permission needed', cancelled: 'Stopped',
  cancelling: 'Stopping', failed: 'Failed', interrupted: 'Interrupted', disconnected: 'Disconnected', recovering: 'Recovering' };
const ATTENTION = new Set(['queued', 'loading', 'recovering', 'cancelling', 'approval', 'failed', 'interrupted', 'disconnected']);
const activityTime = thread => thread.attempts.at(-1)?.finishedAt ?? thread.attempts.at(-1)?.createdAt ?? thread.createdAt;

/** Relative time of the last activity: now, minutes, hours or days. */
export function relativeTime(timestamp, now) {
  if (!Number.isFinite(timestamp)) return '';
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

const shortIdentity = identity => typeof identity === 'string' ? identity.slice(0, 15) + '…' : '';
/** The highlighted adapter's purpose, evaluation and availability, as the vanilla sheet's adapter details state them. */
function projectAdapterDetails(state, model) {
  const adapter = model?.adapters?.length === 1 ? model.adapters[0] : null;
  if (!adapter) return null;
  const purpose = adapter.purpose, evidence = adapterEvidence(state, adapter);
  const base = (state.models || []).find(item => !item.partition && !item.adapters?.length && item.id === model.id && item.identity === model.identity);
  return {
    title: `${adapter.name || adapter.id} · ${adapter.manifest?.version ? `v${adapter.manifest.version}` : 'Version not declared'}`,
    purpose: purpose?.statement ? `Purpose: ${purpose.statement}` : 'Purpose not declared',
    evidence: `Evaluation: ${evidence.text}`, evidenceStatus: evidence.status,
    availability: adapterAvailability(state, model).text,
    identities: `For ${base?.name || model.id} ${shortIdentity(model.identity)} · Adapter ${shortIdentity(adapter.identity)}`
  };
}

export function createConversationController(session, {
  storage = null, webSearch = null, search = null, historyHandover = null, canDownload = typeof session?.downloadLocalModel === 'function',
  viewState = {}, href = () => globalThis.location?.href || '', forgetInvite = () => {}, now = () => Date.now(),
  random = Math.random, clipboard = text => globalThis.navigator?.clipboard?.writeText(text), onProjectMessage = null
} = {}) {
  const listeners = new Set();
  let disposed = false, snapshot = null, sessionState = session.getState();
  const notify = () => { if (disposed) return; snapshot = project(); for (const listener of listeners) listener(); };

  // ---- view state: what the person has staged on this page (the vanilla page's viewState and closures) ----
  let archived = false, chosenModel = viewState.chosenModel || null, pickerModel = null, pickerLocation = 'auto';
  let changingModel = false, pickerTouched = false, recoverySelection = null, pickerRevision = 0, pickerModelImplied = false;
  // Whether the chosen model came with a computer or a default (it then follows availability) or the person picked
  // it (it stays, and is never replaced for them), and whether the sheet's staged model is such a pick.
  let chosenAuto = !!viewState.chosenAuto, pickerPicked = false;
  const setChosen = (model, automatic = false) => {
    chosenModel = viewState.chosenModel = model || null; chosenAuto = viewState.chosenAuto = !!model && automatic;
  };
  let files = [], composerRevision = 0, queuedSend = null, draftText = '', currentKey = '';
  let contextPrompt = viewState.contextPrompt || null;
  let executionLocation = viewState.executionLocation || 'auto';
  let errorText = '', searchOn = false, submitting = false, applyingPrivacy = false, editingThread;
  let sendAfterDestination = false, pickerChoice = null, stagedDestination = null;
  let sheet = { open: false, title: 'Answer on' };
  // "Who can read it?": the staged protection, route and own-devices choice; they apply only with Apply.
  let privacyDialog = { open: false, protection: null, route: null, ownDevices: false, editable: true, error: '' };
  let rename = { open: false, id: null, value: '' };
  let download = null;
  let attachmentHelp = false, focus = { target: null, seq: 0 };
  // Up to three distinct starters, chosen at random from the set and kept for this view's life so nothing moves.
  const startingPrompts = pickStartingPrompts(chatPrompts, random);
  const startingPrompt = startingPrompts[0] || '';
  const localPolicy = createExecutionPolicy();
  const openPolicy = () => createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] }, computation: 'plaintext' });
  const requestFocus = target => { focus = { target, seq: focus.seq + 1 }; };

  let rememberedChoice = chosenModel ? null : readAnswerChoice(storage), provisionalChoice = false;
  if (rememberedChoice?.route && viewState.privacy === undefined && !viewState.privacyTouched) {
    const device = rememberedChoice.route === 'device';
    viewState.privacy = device ? localPolicy : openPolicy();
    if (!device) viewState.privacyPreset = 'standard';
    executionLocation = viewState.executionLocation = device ? 'local' : 'network';
  }
  const rememberChoice = (model, privacy, location, picked) => writeAnswerChoice(storage, model,
    location === 'local' || privacy?.placement === 'local-only' ? 'device' : privacy?.recipients?.kind === 'open' ? 'contributors' : null, picked);
  const storedHere = model => !model.partition && !model.fleet && (model.localReady || model.localCached || model.availability === 'cached');
  const publicAnswers = model => !model.fleet && !model.partition && modelExecutionState(model, 'network').usable;
  const openDefault = openPolicy();
  /**
   * A visitor who has chosen nothing asks the public network: no computer, model or permission is a step before
   * the first Send. It holds while computers are being found or one can answer, and only while this device stores
   * no model, network answers are on and no paired desktop or invite names the computer. The composer states the
   * computer, the model and who can read the prompt before Send. With nobody to answer, the draft stays on this device.
   */
  const automaticContributors = state => !state.activeThread && viewState.privacy === undefined && !viewState.privacyTouched
    && state.remoteAnswersEnabled !== false && !lockedDestination(state) && !(state.models || []).some(storedHere)
    && (state.discoveryPhase === 'searching' || (state.models || []).some(publicAnswers));
  const explicitPrivacy = state => (state.activeThread ? state.activeThread.privacy : viewState.privacy)
    ?? (automaticContributors(state) ? openDefault : localPolicy);
  /** Such a visitor's Send, pressed while computers are being found, waits for whichever model turns up: none is named yet. */
  const waitsForAnyModel = state => automaticContributors(state) && (!chosenModel || chosenAuto);

  const lockedDestination = state => {
    const owner = state.ownerPairing, invite = viewState.guestInvite, guest = state.guestAccess;
    const modelId = model => typeof model === 'string' ? model : model?.id ?? null;
    if (owner?.status === 'online' && owner.hostParticipantId && !invite) {
      return { id: owner.hostParticipantId, label: owner.hostLabel, readyModel: modelId(owner.readyModel), status: 'online', guest: false };
    }
    if (invite || guest?.hostParticipantId) {
      const id = invite?.hostPeerId || guest.hostParticipantId, same = guest?.hostParticipantId === id;
      return { id, label: describeCircleHost(invite?.hostLabel || guest?.hostLabel, id).hostLabel,
        readyModel: same ? modelId(guest.readyModel) : null, status: same ? guest.status : 'invited', guest: true };
    }
    return null;
  };
  const destinationKey = state => {
    const policy = explicitPrivacy(state), locked = lockedDestination(state);
    return policy.placement === 'local-only' || policy.recipients.kind === 'none' ? 'device'
      : policy.recipients.kind === 'open' ? 'contributors'
        : locked && policy.recipients.ids.length === 1 && policy.recipients.ids[0] === locked.id ? 'desktop' : 'named';
  };
  const pairedDesktop = state => lockedDestination(state) ?? (state.ownerPairing?.hostParticipantId
    ? { id: state.ownerPairing.hostParticipantId, label: state.ownerPairing.hostLabel || 'your desktop', status: state.ownerPairing.status } : null);
  // The paired desktop, the conversation's model and its execution location: what the dialog and the chip need to name
  // the route a request sends.
  const presetContext = state => ({ desktop: state.ownerPairing?.hostParticipantId
    ? { id: state.ownerPairing.hostParticipantId, label: state.ownerPairing.hostLabel || 'your desktop' } : null,
  model: state.activeThread?.model ?? chosenModel ?? null,
  location: state.activeThread?.permissions?.executionLocation ?? executionLocation });
  const ownDevicesOf = context => context?.desktop?.id ? [context.desktop.id] : [];
  const requirementsOf = policy => { try { return executionRequirementsFor(policy); } catch { return null; } };
  const stageCount = model => new Set(model?.partition?.route?.stages?.map(stage => stage.participantId)
    ?? [model?.partition?.participantA, model?.partition?.participantB].filter(Boolean)).size;
  /** The dialog's rows, lines and notes for what is staged (privacy-controls.js showPrivacyChoices, without markup). */
  const projectPrivacy = state => {
    const context = presetContext(state), { editable } = privacyDialog;
    const protection = privacyDialog.protection ?? 'plaintext', route = privacyDialog.route ?? 'auto';
    const own = ownDevicesChoice({ desktop: context.desktop?.label ?? null, route, editable, checked: privacyDialog.ownDevices });
    const split = protection === 'plaintext' && (route === 'split' || route === 'split-local-edges');
    const preset = route === 'local' || own.checked ? 'own-devices' : 'standard';
    return {
      open: privacyDialog.open, editable, error: privacyDialog.error, applying: applyingPrivacy,
      protection: privacyDialog.protection, route: privacyDialog.route, ownDevices: own.checked,
      protections: protectionChoices({ editable, value: protection }).map(({ value, title, status, disabled }) => ({ value, title, status, disabled })),
      routes: routeChoices({ model: context.model, canRunHere: true, editable, value: route }).map(({ value, title, status, disabled }) => ({ value, title, status, disabled })),
      ownDevicesOption: { value: own.value, title: own.title, status: own.status, disabled: own.disabled },
      splitNote: !split ? '' : route === 'split-local-edges' ? SPLIT_DISPLAY['requester-edges'].line : splitReadersLine(stageCount(context.model)),
      preset, note: presetDisclosure(preset, { desktop: route === 'local' ? null : context.desktop?.label ?? null }),
      // Both statements stay in the page, the chosen one shown, as the vanilla dialog keeps them.
      notes: Object.fromEntries(['standard', 'own-devices'].map(name => [name, presetDisclosure(name, { desktop: route === 'local' ? null : context.desktop?.label ?? null })]))
    };
  };
  const currentRoute = state => {
    const key = destinationKey(state), ids = explicitPrivacy(state).recipients?.ids;
    return key === 'named' && ids?.length === 1 && ids[0] === state.ownerPairing?.hostParticipantId ? 'desktop' : key;
  };
  const effectiveLocation = state => {
    if (automaticContributors(state)) return 'network';
    const thread = state.activeThread, privacy = explicitPrivacy(state);
    return thread?.permissions?.sharingScope === 'local' || privacy.placement === 'local-only' || privacy.recipients?.kind === 'none'
      ? 'local' : thread?.permissions?.executionLocation ?? executionLocation;
  };
  // A host invite link names the only computer that may read this visitor's prompts. Read once; the token leaves the address bar.
  if (viewState.guestInvite === undefined) {
    let invite = null;
    try { invite = parseCircleInviteUrl(href()); } catch { invite = null; }
    viewState.guestInvite = invite;
    if (invite) { try { forgetInvite(); } catch { /* keep going */ } }
  }
  const blockFor = state => contributorBlock({ guest: !!lockedDestination(state)?.guest, activeThread: !!state.activeThread,
    privacy: explicitPrivacy(state), preset: viewState.privacyPreset });
  const applyPairedDesktopDefault = state => {
    const destination = lockedDestination(state);
    if (state.activeThread || !destination || (viewState.privacyTouched && !destination.guest)) return;
    const current = viewState.privacy;
    if (current?.recipients?.kind !== 'named' || current.recipients.ids.length !== 1 || current.recipients.ids[0] !== destination.id) {
      viewState.privacy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: [destination.id] }, computation: 'plaintext' });
      if (executionLocation === 'local') executionLocation = viewState.executionLocation = 'auto';
    }
    if (!chosenModel && destination.readyModel) {
      const model = (state.models || []).find(item => item.id === destination.readyModel || modelKey(item) === destination.readyModel);
      if (model) setChosen(model, true);
    }
  };
  const choiceAvailable = (model, state) => {
    const execution = modelExecutionState(model, effectiveLocation(state));
    return execution.usable || ['loading', 'preparing'].includes(execution.status);
  };
  const choiceWaitOver = state => state.peerDiscoveryTimedOut === true && state.discoveryPhase === 'observed';
  const applyRememberedChoice = state => {
    if (state.activeThread) return;
    if (rememberedChoice && !chosenModel && !viewState.draftModel) {
      // Only a pick names a model for a later visit; any other record has already given its computer above.
      const model = rememberedChoice.picked ? findAnswerChoice(rememberedChoice, state.models) : null;
      if (model) { setChosen(model); provisionalChoice = true; rememberedChoice = null; }
      else if (!rememberedChoice.picked || choiceWaitOver(state)) rememberedChoice = null;
    }
    if (!provisionalChoice) return;
    const current = chosenModel && findAnswerChoice(answerChoiceOf(chosenModel), state.models);
    if (current && choiceAvailable(current, state)) { setChosen(current); provisionalChoice = false; }
    // A pick that nothing serves after the wait stays the choice: the composer says it is unavailable and Send
    // stays off until the person chooses another model. It is never replaced for them.
    else if (!chosenModel || choiceWaitOver(state)) provisionalChoice = false;
  };
  const withChoiceWait = state => provisionalChoice && !state.activeThread && state.discoveryPhase === 'observed' && !choiceWaitOver(state)
    ? { ...state, discoveryPhase: 'searching' } : state;
  const pairedDesktopSummary = state => {
    const destination = lockedDestination(state), privacy = explicitPrivacy(state);
    if (!destination || privacy.recipients?.kind !== 'named' || privacy.recipients.ids.length !== 1
      || privacy.recipients.ids[0] !== destination.id) return null;
    return `Sending to ${destination.label}. Its operator can read your prompt.`;
  };
  const recoveryAlternative = state => recoverySharedModel(state, currentKey, effectiveLocation(state), explicitPrivacy(state));
  const matchesRecovery = state => {
    const candidate = recoveryAlternative(state);
    return candidate && modelIdentity(candidate) === modelIdentity(recoverySelection);
  };

  viewState.positions ??= new Map(); viewState.seen ??= new Map();
  const transcript = createTranscript({ onProject: onProjectMessage });
  const drafts = new Map();
  let selectedId = sessionState.selectedId;
  const persisted = session.getDraft?.(selectedId);
  if (persisted) { draftText = persisted.text; files = persisted.files; }
  const attachmentReader = createTextAttachmentReader({
    getFiles: () => files,
    onLoaded: async loaded => { files.push(...loaded); composerRevision++; await saveDraft(); notify(); },
    onPending: () => notify(),
    limits: { maxFiles: workProfile.files.maxInputs, maxFileBytes: workProfile.files.maxFileBytes,
      maxTotalBytes: workProfile.files.maxInputBytes, extensions: ['txt', 'md', 'json', 'js', 'ts', 'html', 'css'] }
  });
  const saveDraft = () => {
    const value = { text: draftText, files };
    drafts.set(selectedId, structuredClone(value)); return session.saveDraft?.(selectedId, value);
  };
  const history = sessionState.history;
  const refusal = history?.mode === 'refused' && historyHandover ? history.reason : null;
  const error = cause => {
    const text = String(cause?.message || cause || '');
    errorText = refusal && text.includes(refusal) ? '' : text;
    notify();
  };
  const act = operation => Promise.resolve().then(operation).catch(error);
  const after = (pending, next) => pending?.then ? pending.then(next) : next();
  const observe = pending => pending?.catch?.(error);
  const searchRouteNow = () => session.preferredSearchRoute?.() ?? undefined;
  const deviceSearchOn = () => session.preferredSearchRoute?.() === 'device-search';
  const searchAvailable = () => !!(search?.available() || deviceSearchOn() || webSearch?.enabled());
  const searching = () => searchOn && searchAvailable();
  const prepareSearch = async (model, sharingScope, route = searchRouteNow(), location = executionLocation, query = draftText) => {
    const request = await session.searchPermissionRequest({ model, sharingScope, executionLocation: location, ...(route ? { route } : {}) });
    return { ...request, query, source: 'send' };
  };
  const downloadableHere = (model, state) => canDownloadModelHere(model, state, canDownload);
  function pinDraftModel(state) {
    // Not during the discovery wait of a visitor who chose nothing: see the pin in project().
    if (automaticContributors(state) && !choiceWaitOver(state)) return;
    if (state.selectedId == null && !chosenModel && !viewState.draftModel) {
      viewState.draftModel = state.models?.find(model => modelKey(model) === currentKey);
    }
  }
  function queueScope(state, model) {
    const privacy = explicitPrivacy(state);
    return JSON.stringify([state.selectedId, waitsForAnyModel(state) ? 'automatic' : modelIdentity(model), effectiveLocation(state), privacy,
      state.remoteNetworkId, state.remoteAnswersEnabled, state.activeThread?.permissions, contextPrompt,
      state.activeThread?.systemContext, searching(), composerRevision, draftText]);
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
    const model = state.models?.find(item => modelKey(item) === currentKey);
    return !disposed && canWaitForPublicModel(state, model, effectiveLocation(state))
      && queueScope(state, model) === intent.scope && model.networkAvailability === 'ready'
      && model.reachableProviderIds?.length > 0;
  }

  // ---- the projection: the vanilla render(), producing a record instead of DOM writes ----
  let fitRequest, fitKey, fitInfo, sendDisabled = true, clock = null;
  function projectSheet(snapshotState) {
    if (pickerLocation === 'local') pickerChoice = 'device';
    else if (!pickerChoice || pickerChoice === 'device') pickerChoice = 'contributors';
    const state = snapshotState.computerLabels ? snapshotState : withComputerLabels(snapshotState, session);
    const block = blockFor(state), locked = lockedDestination(state);
    if (pickerModelImplied && pickerLocation === 'network' && pickerChoice === 'contributors' && !block) {
      const current = state.models?.find(model => modelKey(model) === modelKey(pickerModel)) || pickerModel;
      pickerModel = modelForLocation(state.models, current, 'network', { state, canDownload });
      if (modelKey(pickerModel) !== modelKey(current)) pickerPicked = false;
    }
    if (!pickerTouched) pickerModel = (state.models || []).find(model => modelKey(model) === currentKey) || pickerModel;
    const models = [...(state.models || [])];
    const selected = (state.models || []).find(model => modelKey(model) === modelKey(pickerModel));
    if (pickerModel && !models.some(model => modelKey(model) === modelKey(pickerModel))) models.push(selected || unavailableModelChoice(pickerModel));
    const side = pickerLocation === 'local' ? 'local' : 'network';
    const pressed = side === 'local' ? 'local' : pickerChoice === 'desktop' && locked ? 'desktop' : 'network';
    const runsHere = model => modelExecutionState(model, 'local').usable, runsOnNetwork = model => modelExecutionState(model, 'network').usable;
    const lockedComputers = changingModel || !!state.activeThread?.closed || (state.runningIds || []).includes(state.selectedId);
    const computerState = choice => {
      if (choice === 'desktop') return { online: 'Ready', pairing: 'Connecting…', joining: 'Connecting…', connecting: 'Connecting…', offline: 'Offline', invited: 'Tap Join' }[locked?.status] || 'Not connected';
      if (choice === 'local') return runsHere(selected) ? 'Ready' : selected && canDownloadModelHere(selected, state, canDownload) ? 'Download needed' : 'Runs stored models';
      if (block === 'own-devices') return 'Off · Only your devices';
      if (runsOnNetwork(selected)) return 'Ready';
      if ((state.models || []).some(runsOnNetwork)) return 'Not serving this model';
      return state.discoveryPhase === 'searching' ? 'Finding computers…' : 'None available';
    };
    const computers = [
      { choice: 'local', title: 'This device' },
      ...(locked ? [{ choice: 'desktop', title: locked.label }] : []),
      ...(locked?.guest ? [] : [{ choice: 'network', title: 'Contributors' }])
    ].map(row => ({ ...row, status: computerState(row.choice), checked: row.choice === pressed, disabled: lockedComputers }));
    const outcome = describeAnswerChoice(selected || (pickerModel ? unavailableModelChoice(pickerModel) : null), side,
      { state, block, canDownload, choice: pressed === 'desktop' ? 'desktop' : null, locked, sending: sendAfterDestination, implied: pickerModelImplied });
    const keep = { local: 'No model is stored on this device.',
      shared: state.discoveryPhase === 'searching' ? 'Finding computers…' : 'No contributor shares a model right now.' };
    const sections = projectModelChoices(models, { value: modelKey(pickerModel), grouped: true, preferNetwork: false, variants: true, compact: true,
      location: side === 'local' ? 'local' : 'auto', describe: describeModelChoice(state), keep, inspectable: true, disabled: changingModel });
    const detailModel = selected || pickerModel;
    const disclosure = pickerLocation === 'local' ? 'Nothing leaves this device.'
      : pickerChoice === 'desktop' && locked ? `Sending to ${locked.label}. Its operator can read your prompt.`
        : block ? 'Nothing leaves this device unless you choose Use contributors.'
          : pickerModel?.partition ? 'Computers on this route can read the input for their own stages.'
            : pickerModel?.fleet ? 'The answering computer in your private pool can read your prompt.'
              : 'The answering computer can read your prompt.';
    const showLocalFit = pickerModel?.source && !pickerModel.partition && !pickerModel.fleet
      && (hasBrowserModelOrigin(pickerModel) || pickerModel.localCached || pickerModel.localReady);
    const key = showLocalFit && sheet.detailsOpen ? modelIdentity(pickerModel) : null;
    if (fitKey !== key) {
      fitRequest?.abort(); fitInfo = null; fitKey = key;
      if (key && session.getLocalModelFit) {
        const request = fitRequest = new AbortController(), model = pickerModel;
        session.getLocalModelFit(model, { signal: request.signal }).then(info => {
          if (!request.signal.aborted && !disposed) { fitInfo = info; notify(); }
        }).catch(() => {});
      }
    }
    const changeDisabled = changingModel || !outcome.action || attachmentReader.pending || (!!recoverySelection && !matchesRecovery(state));
    return {
      open: true, title: sheet.title, computers, disclosure, threadNote: !!state.activeThread, sections,
      selectedKey: modelKey(pickerModel),
      outcome: { issue: outcome.issue || '', action: outcome.action || '', label: outcome.label, disabled: changeDisabled },
      facts: detailModel ? describeModelChoice(state)(detailModel).facts || modelFacts(detailModel) : '',
      localFit: showLocalFit ? localFitText(pickerModel, fitInfo, { cached: pickerModel.localCached }) : '',
      routes: detailModel ? projectModelRoutes(state, detailModel).map(({ selectionId, type, status }) => ({ selectionId, type, status })) : [],
      adapter: projectAdapterDetails(state, detailModel), adapterGuide: ADAPTER_GUIDE_URL,
      detailsOpen: !!sheet.detailsOpen
    };
  }

  function project() {
    let state = withComputerLabels(sessionState, session);
    applyPairedDesktopDefault(state);
    applyRememberedChoice(state);
    state = withChoiceWait(state);
    if (selectedId !== state.selectedId) {
      pickerRevision++;
      drafts.set(selectedId, { text: draftText, files }); selectedId = state.selectedId; attachmentReader.reset();
      const draft = drafts.get(selectedId) || session.getDraft?.(selectedId); draftText = draft?.text || ''; files = draft?.files || [];
    }
    const thread = state.activeThread, catalogModels = state.models || [], runningIds = state.runningIds || [];
    if (!thread && !draftText.trim() && !files.length && !attachmentReader.pending) viewState.draftModel = null;
    // An automatic choice follows availability: when its model is no longer served or stored and another one is,
    // the composer moves to that one before Send, so the model it names is the model that answers.
    if (!thread && state.defaultModels?.[effectiveLocation(state)] && !lockedDestination(state)) {
      const served = model => { const item = findAnswerChoice(answerChoiceOf(model), catalogModels); return !!item && choiceAvailable(item, state); };
      if (viewState.draftModel && !chosenModel && !served(viewState.draftModel)) viewState.draftModel = null;
      if (chosenModel && chosenAuto && !provisionalChoice && !served(chosenModel)) setChosen(null);
    }
    const pinnedModel = thread?.model || chosenModel || viewState.draftModel;
    const models = catalogModels.filter(model => modelKey(model) !== modelKey(pinnedModel)
      || !pinnedModel?.identity || modelIdentity(model) === modelIdentity(pinnedModel));
    if (pinnedModel && !models.some(model => modelKey(model) === modelKey(pinnedModel))) models.push(unavailableModelChoice(pinnedModel));
    const location = effectiveLocation(state);
    const defaultModel = state.defaultModels?.[location] || state.defaultModel;
    const freshVisitor = !thread && viewState.privacy === undefined && !viewState.privacyTouched && !lockedDestination(state);
    const downloadable = model => canDownloadModelHere(model, state, canDownload);
    const servedDownload = models.find(model => modelExecutionState(model, 'network').usable && downloadable(model));
    const localStart = !pinnedModel && location === 'local'
      ? startingLocalModel(models, { defaultModel: servedDownload || defaultModel, canDownloadHere: downloadable }) : null;
    const current = modelKey(pinnedModel) || modelKey(localStart)
      || modelKey(models.find(model => modelKey(model) === modelKey(defaultModel) && selectable(model)))
      || modelKey(models.find(selectable))
      // While computers are being found for a visitor who chose nothing, a queued Send needs a whole model to wait on.
      || (automaticContributors(state) ? modelKey(models.find(model => modelKey(model) === modelKey(defaultModel))) : undefined)
      || modelKey(models[0]);
    currentKey = current || '';
    const selectedModel = catalogModels.find(model => modelKey(model) === current
      && (!pinnedModel?.identity || modelIdentity(model) === modelIdentity(pinnedModel)));
    const execution = modelExecutionState(selectedModel, location);
    // A typed draft keeps the model it was written for, once computers are known: nothing is pinned while they are
    // being found. For a visitor who chose nothing that lasts the whole bounded discovery wait, so the model is the
    // preferred one among the computers that answered in it, not whichever advertised first.
    if (!thread && !chosenModel && !viewState.draftModel && (draftText.trim() || files.length)
      && !(freshVisitor && state.discoveryPhase === 'searching' && !execution.usable)
      && !(automaticContributors(state) && !choiceWaitOver(state))) viewState.draftModel = selectedModel;
    const prepareHere = location === 'local' && selectedModel?.localCached === true;
    const usable = explicitPrivacy(state).computation === 'plaintext' && (execution.usable || prepareHere);
    const localPreparing = state.localModel?.phase === 'loading';
    const requestedModel = selectedModel || pinnedModel || models.find(model => modelKey(model) === current)
      || catalogModels.find(model => modelKey(model) === current)
      || catalogModels.find(model => modelKey(model) === modelKey(state.defaultModel))
      || catalogModels[0];
    const remotePreparing = (state.network?.partitionPeers || []).some(peer => peer.available
      && peer.description?.phase === 'loading' && catalogModels.some(model => model.id === peer.description.offer?.id
        && model.identity === peer.description.offer?.identity)
      && (!requestedModel || requestedModel.id === peer.description.offer?.id
        && requestedModel.identity === peer.description.offer?.identity));
    const selectedPreparing = catalogModels.some(model => modelKey(model) === current && ['loading', 'preparing'].includes(model.availability));
    const preparing = localPreparing || remotePreparing || selectedPreparing;
    const acquiring = state.acquisition?.phase === 'downloading';
    const phase = state.discoveryPhase;
    const exhausted = phase === 'observed' || phase === 'interrupted' || phase === 'paused';
    const publicCanAnswer = freshVisitor && (modelExecutionState(selectedModel, 'network').usable
      || catalogModels.some(model => !model.fleet && !model.partition && modelExecutionState(model, 'network').usable));
    const canAcquire = !!session.downloadLocalModel && !state.localDownloadIssue && !usable && !localPreparing && !busyAcquisition(state)
      && location !== 'network' && !requestedModel?.fleet && isDownloadableBaseModel(requestedModel)
      && !publicCanAnswer && (phase === 'observed' || (location === 'local' && (!freshVisitor || exhausted)));
    const acquisition = state.acquisition;
    let acquisitionText = acquiring ? acquisition.progress?.message || 'Checking model files.'
      : ['failed', 'cancelled'].includes(acquisition?.phase) ? acquisition.error || '' : '';
    if (acquiring && execution.source === 'network' && execution.status === 'ready') acquisitionText += ' Network model ready.';
    const progress = !acquiring ? null : acquisition?.progress?.totalBytes && acquisition.progress.receivedBytes !== null
      ? { value: acquisition.progress.receivedBytes, max: acquisition.progress.totalBytes } : { value: null, max: null };
    const busy = runningIds.includes(thread?.id) || !!state.comparisonPhase;
    const privacy = explicitPrivacy(state);
    const privacyDisabled = busy || !!thread?.closed;
    const named = namedPrivacyPreset(privacy, presetContext(state));
    if (privacyDialog.open && (privacyDisabled || editingThread !== state.selectedId)) privacyDialog = { ...privacyDialog, open: false };
    const shared = !busy && !usable && !preparing && !thread?.closed && !acquiring ? recoverySharedModel(state, current, location, privacy) : null;
    let statusText = '';
    if (!busy) {
      if (state.history?.mode === 'refused' && historyHandover) statusText = '';
      else if (thread?.closed) statusText = 'Restore this thread to continue.';
      else if (usable) {
        if (execution.source === 'network') statusText = execution.status === 'busy' ? 'Waiting for capacity.' : creditCapText(selectedModel);
        else if (execution.status === 'cached') statusText = 'Model downloaded.';
      } else if (preparing) statusText = state.localModel?.progress?.message || 'Model preparing…';
      else if (state.ownerPairing?.status === 'offline' && state.ownerPairing.hostLabel && pickerChoice !== 'device'
        && phase !== 'paused' && phase !== 'searching') {
        statusText = `${state.ownerPairing.hostLabel} is offline. Open Reploid on ${state.ownerPairing.hostLabel}.`;
      } else if (freshVisitor && phase === 'searching') statusText = 'Finding computers…';
      else if (location === 'local') statusText = state.localModel?.error || state.localDownloadIssue
        || (publicCanAnswer ? 'Not on this device. A public computer can answer.' : 'Model unavailable here.');
      else if (phase === 'paused') statusText = 'Network paused.';
      else if (phase === 'interrupted') statusText = 'Connection interrupted.';
      else if (phase === 'searching') statusText = 'Finding computers…';
      else if (phase === 'observed') statusText = state.network?.connectionFailure?.peerId
        ? 'A peer connection failed. No eligible computer found for this model.' : 'No eligible computer found for this model.';
      else statusText = 'Model unavailable.';
      if (!usable && location !== 'local' && state.localDownloadIssue && !shared && !canAcquire && exhausted) statusText += ' ' + state.localDownloadIssue;
    }
    if (!busy && searching() && !thread?.closed && !state.storageError) {
      const personal = webSearch?.enabled() ? webSearch.state() : null;
      const recipient = webSearchRecipient({ personalRecipient: personal?.url ? personal.recipient : null, route: searchRouteNow(), provider: search?.state?.().provider });
      statusText = [statusText, recipient ? `Web search sends your question to ${recipient}.` : 'Web search recipient is not confirmed.'].filter(Boolean).join(' ');
    }
    const pairedSummary = pairedDesktopSummary(state);
    const disclosure = privacy.computation !== 'plaintext' ? 'The required computation mode is unavailable.'
      : privacy.recipients.kind === 'none' && !usable ? 'Nothing leaves this device.'
        : location === 'local' || execution.usable && execution.source === 'local' ? 'Nothing leaves this device.'
          : pairedSummary ? pairedSummary
            : privacy.recipients.kind === 'named' ? 'Named computers can read your prompt.'
              : selectedModel?.partition ? 'Computers on this route can read the input for their own stages.'
                : usable ? 'The answering computer can read your prompt.' : 'A network provider could read your prompt.';
    // The queued Send: it waits for a computer running this model while discovery runs, and lapses when that can't happen.
    const permitted = !busy && canWaitForPublicModel(state, selectedModel, location);
    if (queuedSend && (!permitted || queuedSend.scope !== queueScope(state, selectedModel))) queuedSend = null;
    if (queuedSend) {
      statusText = waitsForAnyModel(state) ? 'Finding computers…' : `Waiting for a computer running ${modelVariantLabel(selectedModel)}…`;
      const intent = queuedSend;
      if (!intent.scheduled && readyForQueuedSend(state, intent)) {
        intent.scheduled = true;
        queueMicrotask(() => {
          intent.scheduled = false;
          if (queuedSend === intent && readyForQueuedSend(withChoiceWait(sessionState), intent)) submitDraft(intent);
        });
      }
    }
    const detailModel = sheet.open ? pickerModel : requestedModel;
    const cells = state.answerLimits?.find(entry => entry.selectionId === modelKey(detailModel || {}))?.cells || [];
    const bounds = [...new Map(cells.map(cell => [cell.maxPromptTokens + '/' + cell.maxAnswerTokens, cell])).values()].sort((a, b) => a.maxPromptTokens - b.maxPromptTokens);
    const configuredAnswerTokens = catalogModels.find(model => model.id === detailModel?.id && !model.partition)?.generation?.maxTokens;
    const answerLimit = bounds.length ? 'Route limits: ' + bounds.map(cell => `${cell.maxAnswerTokens} answer tokens for up to ${cell.maxPromptTokens} input tokens`).join('; ')
      + '. Input includes conversation history. Answers reaching the limit are incomplete.'
      : Number.isSafeInteger(configuredAnswerTokens) ? `Answer limit: ${configuredAnswerTokens} tokens. Answers reaching the limit are incomplete.` : '';
    const activeModel = selectedModel || pinnedModel || models.find(model => modelKey(model) === current)
      || catalogModels.find(model => modelKey(model) === current) || requestedModel;
    const lockedHost = lockedDestination(state), destination = destinationKey(state);
    const runsHereNow = destination === 'device' || location === 'local' || execution.usable && execution.source === 'local';
    const findingFirst = freshVisitor && !(thread?.model || chosenModel) && phase === 'searching' && !execution.usable;
    const computerName = runsHereNow ? 'This device' : destination === 'desktop' ? lockedHost?.label
      : destination === 'named' ? 'Named computers' : selectedModel?.fleet ? execution.label : 'Contributors';
    const availability = execution.usable ? 'ready' : preparing || phase === 'searching' ? 'waiting' : 'unavailable';
    const availabilityText = { ready: 'Ready', waiting: preparing ? 'Loading' : 'Finding computers', unavailable: 'Unavailable' }[availability];
    const modelDigest = findingFirst ? '' : activeModel ? `${computerName} · ${modelVariantLabel(activeModel)}` : '';
    // An invite link offers one action: join that computer. Until it is joined, nothing can be sent anywhere.
    const invite = viewState.guestInvite, guest = state.guestAccess;
    const inviteJoined = !!invite && guest?.joined && guest.hostParticipantId === invite.hostPeerId;
    const joiningHost = !!invite && guest?.status === 'joining';
    let statusHidden = !statusText || !!acquisitionText;
    if (queuedSend) statusHidden = false;
    if (acquisitionText && !queuedSend) statusHidden = true;
    if (invite && !inviteJoined) {
      statusHidden = false; acquisitionText = '';
      statusText = joiningHost ? `Connecting to ${guest.hostLabel}…` : guest?.error || 'Invited. Join to send messages to this computer.';
    }
    const nextActions = [
      ['join', !!invite && !inviteJoined && !joiningHost],
      ['cancel-download', acquiring],
      ['cancel-queued', !!queuedSend],
      ['review-shared', !!shared],
      ['network-opt-in', !busy && !usable && !preparing && !acquiring && !thread?.closed
        && (publicCanAnswer || (!!thread && (privacy.placement === 'local-only' || privacy.recipients.kind === 'none')))],
      ['download-local', !busy && canAcquire && !thread?.closed],
      ['retry', !busy && !usable && !preparing && location !== 'local' && exhausted && !thread?.closed]
    ];
    const nextAction = nextActions.find(([, eligible]) => eligible)?.[0] ?? null;
    const queueable = !busy && !usable && state.discoveryPhase === 'searching' && canWaitForPublicModel(state, selectedModel, location);
    const askFirst = !thread && !busy && !usable && !queueable && viewState.privacy === undefined && !viewState.privacyTouched && !lockedDestination(state);
    sendDisabled = attachmentReader.pending || !(usable || queueable || askFirst) || !!thread?.closed || !!state.storageError || (!!invite && !inviteJoined);
    const pendingApproval = thread?.attempts?.find(item => item.status === 'approval' && item.approval?.permissionNeed);
    const startingHidden = !!(thread?.messages.length || thread?.closed || runningIds.includes(thread?.id) || state.comparisonPhase);
    const searchVisible = searchAvailable();
    const composer = {
      draft: draftText, files: files.map(file => ({ name: file.name, size: file.size ?? file.text?.length ?? 0 })), attachmentsPending: attachmentReader.pending,
      attachmentHelp: attachmentHelp || files.length > 0, attachmentHelpText: ATTACHMENT_HELP,
      placeholder: !activeModel || findingFirst ? 'Message…' : computerName === 'Contributors' ? 'Message a contributor…' : `Message ${computerName}…`,
      send: { visible: !busy, disabled: sendDisabled },
      // Stop stays reachable when the reader scrolls away from the active answer; the transcript row has its own.
      stop: { visible: busy },
      chip: {
        visible: models.length > 0, caption: !activeModel, findingFirst,
        // The selection the composer would send with now (the vanilla page's hidden model select).
        selectionId: current || null,
        source: findingFirst ? '' : activeModel ? computerName : '',
        name: findingFirst ? 'Finding computers…' : activeModel ? modelVariantLabel(activeModel) : '',
        availability, label: modelDigest ? `Answer on ${modelDigest}, ${availabilityText}` : findingFirst ? 'Answer on, Finding computers' : 'Answer on',
        activity: execution.status === 'ready' ? 'ready' : 'idle', executionSource: execution.source
      },
      // The chip beside "Answer on" always names the thread's protection (and "Your devices" when it runs only there).
      privacy: { label: `Who can read it: ${named.label}`, caption: named.label, disabled: privacyDisabled },
      search: { visible: searchVisible, pressed: searching() },
      status: { text: statusHidden ? '' : statusText },
      acquisition: { text: acquisitionText, progress },
      nextAction,
      nextLabels: {
        join: invite ? `Join ${describeCircleHost(invite.hostLabel, invite.hostPeerId).hostLabel}` : 'Join',
        reviewShared: shared ? `Review ${modelVariantLabel(shared)}` : '',
        downloadLocal: ['failed', 'cancelled'].includes(acquisition?.phase) ? 'Retry download' : 'Review local download',
        retry: phase === 'observed' ? 'Search again' : phase === 'paused' ? 'Reconnect' : 'Retry connection',
        retryPending: !!retryPending
      },
      disclosure: thread?.closed ? '' : disclosure,
      routeAlternatives: routeAlternatives({ current: currentRoute(state), model: requestedModel, desktop: pairedDesktop(state), busy,
        closed: !!thread?.closed, searching: phase === 'searching', fresh: freshVisitor }),
      executionSettingsReset: thread?.executionSettingsReset === true,
      startingPrompt: startingHidden || !startingPrompt ? null
        : { text: startingPrompt, texts: startingPrompts, inert: !!(draftText.trim() || files.length) },
      error: errorText || state.storageError || '',
      answerLimit
    };
    const threadsAll = state.threads || [];
    const recent = item => item.attempts.at(-1)?.createdAt ?? item.createdAt ?? 0;
    const time = now();
    const threads = threadsAll.filter(item => !!item.closed === archived).sort((a, b) => recent(b) - recent(a)).map(item => {
      const attempt = item.attempts.at(-1), status = attempt?.status || '';
      const completion = `${attempt?.id || ''}:${status}`;
      if (item.id === state.selectedId) viewState.seen.set(item.id, completion);
      const label = status === 'completed' ? viewState.seen.get(item.id) === completion ? 'Complete' : 'New answer' : THREAD_LABELS[status] || status;
      const firstInput = item.messages.find(message => message.role === 'user')?.content;
      const sources = firstInput && session.getDocumentSources?.(firstInput);
      const title = item.title || item.purpose || (sources ? sources.question.split('\n')[0] : firstInput) || 'New thread';
      const summary = label || item.model?.name || 'New thread';
      const timestamp = activityTime(item);
      return { id: item.id, title, summary, current: item.id === state.selectedId, monogram: Array.from(title.trim())[0]?.toUpperCase() || 'N',
        working: status === 'executing', unread: label === 'New answer', attention: ATTENTION.has(status),
        time: Number.isFinite(timestamp) ? relativeTime(timestamp, time) : '', timestamp: Number.isFinite(timestamp) ? timestamp : null,
        // How much of the model's advertised context the last answer used, when the record says.
        context: (({ percent, text }) => percent === null ? null : { percent: Math.round(percent), text })(projectThreadContext(item, catalogModels)) };
    });
    // Ages ("3m") move on while threads are listed, without any other change; nothing ticks with no threads.
    if (threads.some(item => item.time) && !clock && !disposed) clock = setInterval(notify, 60000);
    else if (!threads.some(item => item.time) && clock) { clearInterval(clock); clock = null; }
    const messageRows = transcript.update(thread, { usable: usable && !thread?.closed, busy, state, getSources: session.getDocumentSources });
    return Object.freeze({
      selectedId: state.selectedId, threadClosed: !!thread?.closed, busy, hasMessages: !!thread?.messages.length,
      composer,
      sheet: sheet.open ? projectSheet(state) : { open: false },
      privacy: projectPrivacy(state),
      rename: { ...rename },
      download: download ? { ...download } : null,
      remotePermission: pendingApproval ? {
        key: `${pendingApproval.id}:${pendingApproval.approval.id}`,
        title: 'Send to another computer?', what: remotePermissionText(pendingApproval.approval.permissionNeed).what,
        recipient: pendingApproval.approval.recipientIdentity || pendingApproval.approval.permissionNeed.routeId || 'another computer'
      } : null,
      threads: { archived, items: threads, empty: archived ? 'No archived threads.' : 'No threads yet.' },
      messages: messageRows,
      canExport: !!thread?.messages.length,
      draftContext: contextPrompt,
      focus
    });
  }

  // ---- commands ----
  function submitDraft(intent = null) {
    const content = draftText.trim(), state = withChoiceWait(sessionState), original = draftText;
    if (!content || attachmentReader.pending || submitting || (state.runningIds || []).includes(state.selectedId)) return;
    if (intent ? !readyForQueuedSend(state, intent) : sendDisabled) return;
    const model = state.models.find(item => modelKey(item) === currentKey);
    if (!intent && !state.activeThread && viewState.privacy === undefined && !viewState.privacyTouched && !lockedDestination(state)
      && !modelExecutionState(model, effectiveLocation(state)).usable
      && !(state.discoveryPhase === 'searching' && canWaitForPublicModel(state, model, effectiveLocation(state)))) {
      openDestination({ forSend: true });
      return;
    }
    if (!intent && state.discoveryPhase === 'searching' && !modelExecutionState(model, effectiveLocation(state)).usable
      && canWaitForPublicModel(state, model, effectiveLocation(state))) {
      queuedSend = { scope: queueScope(state, model), scheduled: false };
      notify();
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
          const current = composerRevision === revision ? { text: original, files: attachments } : drafts.get(origin);
          if (current) { draftText = current.text; files = current.files; notify(); }
        }
        if (intent) {
          const latest = sessionState;
          const current = latest.models?.find(item => modelKey(item) === modelKey(model));
          if (disposed || composerRevision !== revision || selectedId !== threadId
            || latest.remoteNetworkId !== state.remoteNetworkId || latest.remoteAnswersEnabled !== state.remoteAnswersEnabled
            || !['observed', 'searching'].includes(latest.discoveryPhase)
            || latest.activeThread?.permissions?.executionLocation !== 'network' || searching()
            || !allowsOpenPlaintext(latest.activeThread?.privacy)
            || modelIdentity(current) !== modelIdentity(model)
            || current?.networkAvailability !== 'ready' || !current.reachableProviderIds?.length) {
            if (!disposed && selectedId === threadId && composerRevision === revision) await saveDraft();
            return;
          }
        }
        const completion = session.send(threadId, content, attachments, ...(allowed ? [{ search: allowed }] : personalSearch ? [{ retrieval: {} }] : []));
        if (allowed) searchOn = false;
        completion.catch(() => {});
        if (completion.admitted) await completion.admitted;
        if (composerRevision === revision && selectedId === threadId) {
          if (origin == null) await session.saveDraft?.(null, null);
          await session.saveDraft?.(threadId, null);
          if (composerRevision === revision && selectedId === threadId) {
            draftText = ''; files = [];
            if (origin == null) { drafts.delete(null); viewState.draftModel = null; }
            drafts.delete(threadId);
          }
        }
        submitting = false; notify(); await completion;
      } finally { submitting = false; notify(); }
    };
    notify();
    void dispatch().catch(error);
  }

  const openPicker = (alternative = null) => {
    pickerRevision++;
    queuedSend = null;
    recoverySelection = alternative;
    pickerTouched = !!alternative;
    pickerModelImplied = false;
    const state = sessionState;
    // The sheet opens on the current model. It is a pick only if the person picked it earlier, or picks one here.
    pickerPicked = !state.activeThread && !!chosenModel && !chosenAuto;
    pickerModel = alternative || (state.models || []).find(model => modelKey(model) === currentKey)
      || state.activeThread?.model || chosenModel || state.defaultModel || null;
    const key = destinationKey(state);
    pickerLocation = alternative ? 'network'
      : key === 'device' || modelExecutionState(pickerModel, effectiveLocation(state)).source === 'local' ? 'local' : 'network';
    pickerChoice = pickerLocation === 'local' ? 'device' : alternative || key === 'device' ? 'contributors' : key;
    stagedDestination = null;
    sheet = { open: true, title: 'Answer on', detailsOpen: false };
    requestFocus('sheet');
  };
  const openDestination = ({ forSend = false } = {}) => {
    if (privacyDisabledNow()) return;
    sendAfterDestination = forSend;
    openPicker();
    sheet = { ...sheet, title: forSend ? 'Where should this run?' : 'Answer on' };
    notify();
  };
  const privacyDisabledNow = () => {
    const state = sessionState, thread = state.activeThread;
    return (state.runningIds || []).includes(thread?.id) || !!state.comparisonPhase || !!thread?.closed;
  };
  const closePicker = () => { sheet = { open: false, title: 'Answer on' }; fitRequest?.abort(); fitKey = null; requestFocus('answer-on'); notify(); };
  const desktopRecipient = state => lockedDestination(state)?.id ?? state.ownerPairing?.hostParticipantId ?? null;
  const destinationPolicy = (key, state) => {
    if (key === 'device') return localPolicy;
    if (key !== 'desktop') return openPolicy();
    const recipient = desktopRecipient(state);
    if (!recipient) throw new Error('That desktop is no longer available. Nothing was changed.');
    return createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: [recipient] }, computation: 'plaintext' });
  };
  const applyDraftDestination = key => {
    viewState.privacyTouched = true;
    viewState.privacy = destinationPolicy(key, sessionState);
    executionLocation = viewState.executionLocation = key === 'device' ? 'local' : 'network';
  };
  const applyDestination = async key => {
    const state = sessionState, privacy = destinationPolicy(key, state);
    viewState.privacyTouched = true;
    if (state.activeThread) {
      await session.setExecutionPrivacy(state.activeThread.id, privacy);
      await session.setExecutionLocation(state.activeThread.id, key === 'device' ? 'local' : 'network');
    } else {
      viewState.privacy = privacy;
      executionLocation = viewState.executionLocation = key === 'device' ? 'local' : 'network';
    }
  };
  const resumeAfterChoice = () => { if (sendAfterDestination) { sendAfterDestination = false; submitDraft(); } };
  function commitPickerChoice() {
    if (changingModel || attachmentReader.pending) return;
    const next = modelKey(pickerModel), picked = pickerPicked;
    const state = sessionState;
    if (recoverySelection && !matchesRecovery(state)) { notify(); return; }
    const model = (state.models || []).find(item => modelKey(item) === next && (modelExecutionState(item, pickerLocation).usable
      || pickerLocation === 'local' && state.activeThread?.permissions?.sharingScope === 'local' && isDownloadableBaseModel(item) && !state.localDownloadIssue));
    if (!model) {
      const wanted = (state.models || []).find(item => modelKey(item) === next);
      if (pickerLocation !== 'network' && wanted && downloadableHere(wanted, state)) { sheet = { open: false, title: 'Answer on' }; openDownload(next); return; }
      notify(); return;
    }
    const staged = stagedDestination && stagedDestination !== destinationKey(state) ? stagedDestination : null;
    if (staged && !state.activeThread) applyDraftDestination(staged);
    const privacy = staged ? destinationPolicy(staged, state) : explicitPrivacy(state);
    const location = pickerChoice === 'device' ? 'local' : pickerChoice ? 'network' : privacy?.placement === 'local-only' ? 'local' : pickerLocation;
    const origin = selectedId, revision = composerRevision;
    changingModel = true; notify();
    void act(async () => {
      try {
        if (disposed || selectedId !== origin || composerRevision !== revision) return;
        if (state.activeThread && modelKey(state.activeThread.model) === next) {
          if (staged) await applyDestination(staged);
          await session.setExecutionLocation(state.activeThread.id, location);
          closePicker(); requestFocus('composer'); resumeAfterChoice(); return;
        }
        const pendingDraft = { text: draftText, files: structuredClone(files) };
        await saveDraft();
        if (disposed || selectedId !== origin || composerRevision !== revision) return;
        if (recoverySelection && !matchesRecovery(sessionState)) return;
        let destination = origin;
        if (origin != null) {
          const existing = drafts.get(null) || session.getDraft?.(null);
          if (existing?.text || existing?.files.length) {
            destination = await session.createThread({ model, executionLocation: location, sharingScope: location === 'local' ? 'local' : 'mesh', privacy });
          } else {
            await session.select(null);
            destination = null;
          }
          if (disposed || selectedId !== destination || composerRevision !== revision) return;
          draftText = pendingDraft.text; files = pendingDraft.files;
          await saveDraft();
          if (disposed || selectedId !== destination) return;
        }
        viewState.privacy = privacy;
        setChosen(model, !picked); rememberedChoice = null; provisionalChoice = false;
        executionLocation = location; viewState.executionLocation = executionLocation;
        rememberChoice(model, privacy, location, picked);
        closePicker(); requestFocus('composer');
        resumeAfterChoice();
      } finally {
        changingModel = false; stagedDestination = null;
        notify();
      }
    });
  }
  const runAnswerAction = action => {
    if (changingModel || attachmentReader.pending) return;
    const state = sessionState;
    if (action === 'commit') { commitPickerChoice(); return; }
    if (action === 'download') { downloadHere(); return; }
    if (action !== 'use-contributors' && action !== 'use-device') { notify(); return; }
    pickerRevision++; pickerTouched = true;
    if (action === 'use-device') { pickerLocation = 'local'; pickerChoice = 'device'; stagedDestination = null; }
    else { viewState.privacyPreset = 'standard'; pickerLocation = 'network'; pickerChoice = 'contributors'; stagedDestination = 'contributors'; }
    const kept = pickerModel;
    pickerModel = modelForLocation(state.models, pickerModel, pickerLocation, { state, canDownload });
    if (modelKey(pickerModel) !== modelKey(kept)) pickerPicked = false;
    pickerModelImplied = true;
    commitPickerChoice();
  };
  // Download to this device from the sheet. From Contributors the sheet stays open and moves to this device once
  // stored; from this device the reviewed download opens in its own dialog.
  const downloadHere = () => {
    if (changingModel || attachmentReader.pending) return;
    const state = sessionState;
    const model = state.models?.find(item => modelIdentity(item) === modelIdentity(pickerModel));
    if (!model || !downloadableHere(model, state) || busyAcquisition(state)) { notify(); return; }
    if (pickerLocation !== 'network') { sheet = { open: false, title: 'Answer on' }; openDownload(modelKey(model)); return; }
    const revision = ++pickerRevision, scope = queueScope(state, model);
    openDownload(modelKey(model), {
      keepSheet: true,
      isCurrent(id) {
        const current = sessionState;
        return !disposed && sheet.open && pickerRevision === revision && pickerLocation === 'network' && id === modelKey(model)
          && queueScope(current, model) === scope && !current.activeThread?.closed && !(current.runningIds || []).includes(current.selectedId)
          && current.models?.some(item => modelIdentity(item) === modelIdentity(model));
      },
      onStored() {
        const current = sessionState;
        const stored = current.models?.find(item => modelIdentity(item) === modelIdentity(model));
        if (!modelExecutionState(stored, 'local').usable) return;
        pickerModel = stored; pickerTouched = true; pickerModelImplied = false; pickerLocation = 'local'; stagedDestination = null;
        requestFocus('sheet-commit'); notify();
      }
    });
  };

  // ---- the reviewed download (the vanilla model setup dialog in its local mode) ----
  let downloadRequest = null, downloadReview = null;
  // `mode` is 'local' (store it to answer here) or 'contribute' (Computers' Start sharing: answer public requests).
  // The button and explanation name what confirming does: answering requests (compute), sharing model files only
  // (storage), or neither. Storage alone never starts compute.
  const confirmLabel = (mode, sharingValues, cached) => {
    const compute = sharingValues.includes('compute'), files = sharingValues.includes('files');
    if (compute && (mode === 'contribute' || !cached)) return cached ? 'Start sharing' : 'Download & share';
    if (files && !compute) return cached ? 'Share model files' : 'Download and share model files';
    return cached ? 'Apply settings' : 'Download model';
  };
  const downloadExplanation = (mode, sharingValues, cached) => {
    if (mode === 'local') return 'Store this model on this device to answer when network capacity is unavailable. Sharing choices apply to cached models on this device when you confirm.';
    const compute = sharingValues.includes('compute'), files = sharingValues.includes('files');
    if (compute) return cached ? 'Answer public requests while this page is open. Pause anytime.' : 'Download a model to answer public requests while this page is open. Pause anytime.';
    if (files) return cached ? 'Share this model\u2019s files with other computers while this page is open. This device does not answer requests. Pause anytime.'
      : 'Download this model and share its files with other computers while this page is open. This device does not answer requests. Pause anytime.';
    return cached ? 'This device shares nothing for this model.' : 'Download this model without sharing it. This device does not answer requests or share files.';
  };
  const openDownload = (modelId, review = null, mode = 'local') => {
    downloadReview = review;
    const state = sessionState;
    const models = (state.models || []).filter(model => !model.partition
      && (hasBrowserModelOrigin(model) || mode !== 'local' && (model.localReady || model.localCached))
      && (mode !== 'local' || !model.adapters?.length));
    const chosen = models.find(model => modelKey(model) === modelId) || null;
    const network = state.network || {};
    const compute = mode === 'contribute' || !!(network.computeEnabled ?? network.sharing), filesShared = !!(network.files?.enabled ?? network.files?.sharing);
    const cached = mode !== 'local' && !!chosen && !!(chosen.localCached || chosen.localReady);
    download = { open: true, mode, cached, modelId: chosen ? modelKey(chosen) : modelKey(models[0]) ?? null, choose: !chosen,
      title: chosen ? (mode === 'local' ? `Download ${chosen.name || chosen.id}` : chosen.name || chosen.id) : mode === 'local' ? 'Download model' : 'Start sharing',
      models: models.map(model => ({ value: modelKey(model), title: modelVariantLabel(model) })),
      explanation: downloadExplanation(mode, [...(compute ? ['compute'] : []), ...(filesShared ? ['files'] : [])], cached),
      sharing: sharingOptionChoices({ canShareCompute: !!session.setComputeContribution, canShareFiles: !!session.setCachedFileContribution, compute, files: filesShared })
        .map(option => ({ value: option.value, title: option.title, status: option.status, disabled: !!option.disabled })),
      sharingValues: [...(compute ? ['compute'] : []), ...(filesShared ? ['files'] : [])],
      size: cached ? 'Downloaded' : 'Checking download size…', ready: cached, retry: false, fit: '', info: cached ? { cached: true } : null,
      confirm: confirmLabel(mode, [...(compute ? ['compute'] : []), ...(filesShared ? ['files'] : [])], cached) };
    requestFocus('download');
    notify();
    if (!cached) void checkDownload();
  };
  const checkDownload = async () => {
    if (!download) return;
    downloadRequest?.abort(); const request = downloadRequest = new AbortController();
    download = { ...download, cached: false, size: 'Checking download size…', ready: false, retry: false, info: null };
    notify();
    try {
      if (!download.modelId) throw new Error('No model is available to download.');
      const info = await session.getModelDownload(download.modelId, { signal: request.signal });
      if (request.signal.aborted || disposed || !download) return;
      const model = sessionState.models?.find(row => modelKey(row) === info.id) || sessionState.models?.find(row => modelKey(row) === download.modelId);
      download = { ...download, info, size: Math.ceil(info.sizeBytes / 1e6) + ' MB download', ready: true, fit: localFitText(model, null, { sizeBytes: info.sizeBytes }) };
      notify();
      if (model && session.getLocalModelFit) session.getLocalModelFit(model, { signal: request.signal }).then(fit => {
        if (!request.signal.aborted && !disposed && download) { download = { ...download, fit: localFitText(model, fit, { sizeBytes: info.sizeBytes }) }; notify(); }
      }).catch(() => {});
    } catch (cause) {
      if (!request.signal.aborted && !disposed && download) { download = { ...download, size: cause.message, retry: true }; notify(); }
    }
  };
  const closeDownload = () => { downloadRequest?.abort(); download = null; downloadReview = null; requestFocus(sheet.open ? 'sheet' : 'composer'); notify(); };
  const confirmDownload = () => {
    if (!download?.ready || !download.info) return;
    const { modelId, sharingValues, mode, cached } = download, review = downloadReview;
    download = null; downloadReview = null; notify();
    if (review && !review.isCurrent(modelId)) return;
    const compute = sharingValues.includes('compute'), shareFiles = sharingValues.includes('files');
    const contribute = mode === 'contribute' && compute;
    void act(async () => {
      const network = sessionState.network || {};
      const changeCompute = session.setComputeContribution && compute !== !!(network.computeEnabled ?? network.sharing);
      const changeFiles = session.setCachedFileContribution && shareFiles !== !!(network.files?.enabled ?? network.files?.sharing);
      if (changeCompute && !compute) await session.setComputeContribution(false);
      if (changeFiles) await session.setCachedFileContribution(shareFiles);
      if (changeCompute && compute) await session.setComputeContribution(true);
      if (contribute) {
        if (network.paused) await session.connect();
        await session.setSharing(true, modelId, true);
      } else if (!cached) {
        if (review && !review.isCurrent(modelId)) return;
        await session.downloadLocalModel(modelId, true);
        if (!disposed && review?.isCurrent(modelId)) review.onStored();
      }
    });
  };

  let retryPending = false;
  const unsubscribe = session.subscribe(state => { sessionState = state; notify(); });
  const unsubscribeSearch = search && session.searchPermissionRequest ? search.subscribe(() => notify()) : () => {};
  if (search && search.state().state === 'unknown') void search.refresh();
  const unsubscribeWebSearch = webSearch ? webSearch.subscribe(state => {
    searchOn = state.enabled && (!!state.url || !!search?.available() || deviceSearchOn());
    notify();
  }) : () => {};
  snapshot = project();

  const thread = () => sessionState.activeThread;
  const api = {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    /** The draft text as typed: it pins the model a new thread starts with and drops a queued Send. */
    setDraft(text) {
      draftText = text; composerRevision++;
      if (text.trim()) pinDraftModel(sessionState);
      queuedSend = null;
      try { observe(saveDraft()); } catch (cause) { error(cause); }
      notify();
    },
    useStartingPrompt(text) { api.setDraft(text); requestFocus('composer'); notify(); },
    attach(chosen) {
      const list = [...chosen];
      if (list.length) pinDraftModel(sessionState);
      observe(attachmentReader.enqueue(list));
    },
    showAttachmentHelp() { if (!attachmentHelp) { attachmentHelp = true; notify(); } },
    removeFile(index) { files.splice(index, 1); composerRevision++; void act(async () => { await saveDraft(); notify(); }); },
    toggleSearch() { queuedSend = null; searchOn = !searching(); notify(); },
    send() { submitDraft(); },
    stop() { void act(() => session.cancel(sessionState.selectedId)); },
    cancelQueuedSend() { queuedSend = null; notify(); },
    retryConnection() {
      queuedSend = null; retryPending = true; notify();
      const deadline = setTimeout(() => { retryPending = false; notify(); }, 8000);
      void Promise.resolve().then(() => session.connect()).catch(cause => error(cause.message))
        .finally(() => { clearTimeout(deadline); retryPending = false; notify(); });
    },
    cancelDownload() { session.cancelModelDownload?.(); },
    downloadLocal() {
      const state = sessionState;
      const model = state.activeThread?.model || (state.models || []).find(item => modelKey(item) === currentKey) || chosenModel || state.defaultModel;
      if (model) openDownload(modelKey(model));
    },
    reviewSharedModel() {
      const alternative = recoveryAlternative(sessionState);
      if (alternative) { openPicker(alternative); notify(); }
    },
    reviewNetworkExecution() { openDestination({ forSend: true }); },
    takeRouteAlternative(key) {
      pickerChoice = null;
      void act(async () => { await applyDestination(key); requestFocus('composer'); notify(); });
    },
    joinHost() {
      const invite = viewState.guestInvite;
      if (!invite || !session.guestJoin) return;
      void session.guestJoin.join({ hostPeerId: invite.hostPeerId, token: invite.token, hostLabel: invite.hostLabel, roomId: invite.roomId })
        .then(() => { viewState.guestInvite = null; requestFocus('composer'); notify(); })
        .catch(() => notify());
    },
    // The "Answer on" sheet.
    openSheet() { if (!privacyDisabledNow()) { sendAfterDestination = false; openPicker(); notify(); } },
    closeSheet() { sendAfterDestination = false; closePicker(); },
    setSheetDetails(open) { sheet = { ...sheet, detailsOpen: open }; notify(); },
    pickComputer(choice) {
      const current = sessionState;
      if (choice === 'desktop' && !desktopRecipient(current)) { error('That desktop is no longer available. Nothing was changed.'); return; }
      pickerTouched = true; pickerRevision++;
      pickerLocation = choice === 'local' ? 'local' : 'network';
      pickerChoice = choice === 'local' ? 'device' : choice === 'desktop' ? 'desktop' : 'contributors';
      stagedDestination = null;
      pickerModelImplied = choice !== 'desktop';
      const kept = pickerModel;
      if (choice !== 'desktop') pickerModel = modelForLocation(current.models, pickerModel, pickerLocation, { state: current, canDownload });
      // A model that came with the computer is not the person's pick.
      if (modelKey(pickerModel) !== modelKey(kept)) pickerPicked = false;
      if (choice === 'network' && blockFor(current)) { notify(); return; }
      if (!current.activeThread) applyDraftDestination(pickerChoice);
      notify();
      void act(async () => { if (sessionState.activeThread) await applyDestination(pickerChoice); notify(); });
    },
    /** A model row: `browsing` (arrow keys) stages it without committing; a tap, click or Enter applies it. */
    pickModel(key, { browsing = false } = {}) {
      pickerRevision++;
      if (modelKey(recoverySelection) !== key) recoverySelection = null;
      pickerTouched = true; pickerModelImplied = false;
      const state = sessionState;
      pickerModel = (state.models || []).find(model => modelKey(model) === key) || pickerModel;
      pickerPicked = modelKey(pickerModel) === key;
      const side = locationForModel(pickerModel, pickerLocation, { block: blockFor(state), choice: pickerChoice });
      const moved = side !== (pickerLocation === 'local' ? 'local' : 'network');
      if (moved) { pickerLocation = side; pickerChoice = side === 'local' ? 'device' : 'contributors'; stagedDestination = side === 'network' ? 'contributors' : null; }
      notify();
      if ((!moved || pickerModel?.fleet) && !browsing && pickerModel && modelExecutionState(pickerModel, pickerLocation).usable && !recoverySelection) commitPickerChoice();
    },
    commitSheet() { commitPickerChoice(); },
    runSheetAction() { runAnswerAction(snapshot.sheet.open ? snapshot.sheet.outcome.action || 'commit' : 'commit'); },
    /** The model the sheet stages and its serving computers, for the Computers drawer. */
    modelProviders(key) {
      const model = sessionState.models?.find(item => modelKey(item) === key);
      return model?.providerIds?.length ? { providerIds: [...model.providerIds], label: modelVariantLabel(model) } : null;
    },
    // "Who can read it".
    openPrivacy() {
      if (submitting || applyingPrivacy || privacyDisabledNow()) return;
      queuedSend = null;
      if (sheet.open) sheet = { open: false, title: 'Answer on' };
      const state = sessionState, context = presetContext(state), policy = explicitPrivacy(state);
      editingThread = state.selectedId;
      let preset = null, requirements = null;
      try { requirements = executionRequirementsFor(validateExecutionPolicy(policy)); preset = presetForPolicy(policy, ownDevicesOf(context)); } catch { /* read-only below */ }
      const route = requirements ? conversationRoute(policy, context) : null;
      const editable = preset === 'standard' || preset === 'own-devices';
      privacyDialog = { open: true, protection: requirements?.protection ?? null, route, ownDevices: route !== 'local' && preset === 'own-devices', editable,
        error: editable ? '' : 'This conversation has requirements these choices cannot express. It is read-only here.' };
      notify();
    },
    pickProtection(value) { if (PROTECTION_DISPLAY[value]) { privacyDialog = { ...privacyDialog, protection: value, error: '' }; notify(); } },
    pickRoute(value) { privacyDialog = { ...privacyDialog, route: value, error: '' }; notify(); },
    setOwnDevices(on) { privacyDialog = { ...privacyDialog, ownDevices: !!on, error: '' }; notify(); },
    closePrivacy() { privacyDialog = { ...privacyDialog, open: false }; requestFocus('privacy'); notify(); },
    applyPrivacy() {
      const state = sessionState;
      if (!privacyDialog.open || applyingPrivacy || submitting || editingThread !== state.selectedId || privacyDisabledNow() || !privacyDialog.editable) return;
      applyingPrivacy = true; notify();
      void (async () => {
        try {
          // privacy-controls.js readPrivacyControls, from the staged choices.
          const { protection, route } = privacyDialog;
          if (!protection) throw new Error('Choose who can read your content.');
          if (protection !== 'plaintext') throw new Error(`${PROTECTION_DISPLAY[protection]?.label ?? protection} is unavailable here. Nothing was changed.`);
          if (!route) throw new Error('Choose where it runs.');
          const context = presetContext(state);
          const own = ownDevicesChoice({ desktop: context.desktop?.label ?? null, route, editable: true, checked: privacyDialog.ownDevices });
          const preset = route === 'local' || own.checked ? 'own-devices' : 'standard';
          const devices = route === 'local' ? [] : ownDevicesOf(context);
          const stored = explicitPrivacy(state);
          const current = stored && (requirementsOf(stored)?.route === 'local') === (route === 'local') ? stored : null;
          const privacy = policyForPreset(preset, current, devices);
          viewState.privacyTouched = true;
          // The route is stored as the thread's execution location; the request derives `execution.route` from it.
          const location = locationForRoute(route), model = context.model;
          if (!state.activeThread) viewState.privacyPreset = privacy.placement === 'local-only' || privacy.recipients.kind === 'named' ? 'own-devices' : 'standard';
          if (state.activeThread) {
            await session.setExecutionPrivacy(state.activeThread.id, privacy);
            if (!(location === 'local' && model?.partition) && state.activeThread.permissions?.executionLocation !== location) {
              await session.setExecutionLocation(state.activeThread.id, location);
            }
          } else {
            viewState.privacy = privacy;
            executionLocation = viewState.executionLocation = location;
          }
          privacyDialog = { ...privacyDialog, open: false }; requestFocus('privacy');
        } catch (cause) {
          privacyDialog = { ...privacyDialog, error: cause.message };
        } finally { applyingPrivacy = false; notify(); }
      })();
    },
    // The reviewed download.
    selectDownloadModel(modelId) { if (download) { download = { ...download, modelId }; void checkDownload(); } },
    setDownloadSharing(values) {
      if (!download) return;
      download = { ...download, sharingValues: [...values], confirm: confirmLabel(download.mode, values, download.cached),
        explanation: downloadExplanation(download.mode, values, download.cached) };
      notify();
    },
    /** Computers' Start sharing: the same reviewed download, sharing this device's compute with the model. */
    startSharing(modelId) { openDownload(modelId ?? null, null, 'contribute'); },
    /** The context prompt a new thread starts with; a sent thread keeps its own (Conversation details). */
    setDraftContext(selection) { contextPrompt = selection; viewState.contextPrompt = selection; notify(); },
    retryDownloadCheck() { void checkDownload(); },
    closeDownload, confirmDownload,
    // Threads.
    newThread() {
      queuedSend = null;
      try {
        observe(after(saveDraft(), () => after(session.select(null), () => {
          // A pick carries to the new thread; an automatic choice is made again from what is available.
          if (chosenModel && !chosenAuto) rememberedChoice = answerChoiceOf(chosenModel, null, true);
          setChosen(null); provisionalChoice = false; archived = false;
          requestFocus('composer'); notify();
        })));
      } catch (cause) { error(cause); }
    },
    selectThread(id) {
      queuedSend = null;
      try { observe(after(saveDraft(), () => session.select(id))); } catch (cause) { error(cause); }
    },
    showArchived(value) { archived = !!value; notify(); },
    archiveThread(id) {
      void act(async () => {
        await saveDraft();
        if (archived) { archived = false; await session.restoreThread(id); } else await session.archiveThread(id);
        requestFocus('threads'); notify();
      });
    },
    openRename(id) {
      const item = sessionState.threads.find(entry => entry.id === id);
      if (!item) return;
      rename = { open: true, id, value: item.title || item.purpose || item.messages.find(message => message.role === 'user')?.content || 'New thread' };
      notify();
    },
    setRenameValue(value) { rename = { ...rename, value }; notify(); },
    closeRename() { rename = { open: false, id: null, value: '' }; notify(); },
    saveRename() {
      const { id, value } = rename;
      void act(async () => { await session.renameThread(id, value); rename = { open: false, id: null, value: '' }; notify(); });
    },
    // The transcript.
    retryAttempt(attemptId) {
      void act(async () => {
        const current = thread();
        const failed = current.attempts.find(item => item.id === attemptId);
        if (!session.searchRetryNeedsPermission?.(failed)) return session.retry(current.id, attemptId);
        const allowed = await prepareSearch(current.model, failed.request?.permissions?.sharingScope ?? current.permissions?.sharingScope,
          failed.request?.retrieval?.route, failed.request?.permissions?.executionLocation ?? 'auto', failed.request?.retrieval?.query || '');
        if (allowed) return session.retry(current.id, attemptId, { search: allowed });
        return undefined;
      });
    },
    async copyMessage(messageId) {
      const message = thread()?.messages.find(item => item.id === messageId);
      if (message) await clipboard(message.content);
    },
    async copyText(text) { await clipboard(text); },
    async copyError(attemptId) {
      const attempt = thread()?.attempts.find(item => item.id === attemptId);
      if (attempt?.error) await clipboard(attempt.error);
    },
    exportConversation() { return session.exportConversation?.(selectedId) ?? ''; },
    allowRemote() {
      const pending = thread()?.attempts?.find(item => item.status === 'approval' && item.approval?.permissionNeed);
      if (pending) void act(() => session.grantRemotePermission(pending.approval.permissionNeed, { wording: remotePermissionWording(pending.approval.permissionNeed) }));
    },
    declineRemote() {
      const current = thread(), pending = current?.attempts?.find(item => item.status === 'approval' && item.approval?.permissionNeed);
      if (pending) void act(() => session.approve(current.id, pending.id, pending.approval.id, false));
    },
    clearError() { if (errorText) { errorText = ''; notify(); } },
    dispose() {
      if (disposed) return;
      try { observe(saveDraft()); } catch (cause) { error(cause); }
      disposed = true;
      fitRequest?.abort(); downloadRequest?.abort(); attachmentReader.close(); if (clock) clearInterval(clock);
      unsubscribe(); unsubscribeSearch(); unsubscribeWebSearch(); listeners.clear();
    }
  };
  return api;
}
