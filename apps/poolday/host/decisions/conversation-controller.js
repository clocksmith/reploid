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
import { createExecutionPolicy } from '../../../../shared/vendor/reploid/chat/execution-policy.js';
import { describeCircleHost, parseCircleInviteUrl } from '../circle-invites.js';
import { allowsOpenPlaintext, namedPrivacyPreset } from '../../ui/pool-home/privacy-controls.js';
import { startingLocalModel } from '../../ui/pool-home/choice-availability.js';
import { withComputerLabels } from '../../ui/pool-home/computer-labels.js';
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
import { answerChoiceOf, findAnswerChoice, readAnswerChoice, writeAnswerChoice } from '../../ui/pool-home/answer-choice.js';
import { projectModelChoices } from './model-choices.js';
import { promptDisclosure } from './prompt-disclosure.js';
import { modelKey, preparingStatus, selectableStatus, servesPublicAnswers, storedHere } from './model-state.js';
import { createTranscript } from './transcript.js';
import { createDownloadDialog } from './download-dialog.js';
import { createThreadList } from './threads.js';
import { createPrivacyDialog } from './privacy-dialog.js';
import { createRemoteApproval, remotePermissionView } from './remote-approval.js';

export { relativeTime } from './threads.js';
import workProfile from '../../config/work-profile.json' with { type: 'json' };
import chatPrompts from '../../config/chat-prompts.json' with { type: 'json' };

const busyAcquisition = state => state.acquisition?.phase === 'downloading';
const modelIdentity = model => JSON.stringify([modelKey(model), model?.identity, (model?.adapters || []).map(adapter => adapter.identity)]);
const selectable = model => selectableStatus(model.availability);

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
  let chosenModel = viewState.chosenModel || null, pickerModel = null, pickerLocation = 'auto';
  let changingModel = false, pickerTouched = false, recoverySelection = null, pickerRevision = 0, pickerModelImplied = false;
  // Whether the chosen model came with a computer or a default (it then follows availability) or the person picked
  // it (it stays, and is never replaced for them), and whether the sheet's staged model is such a pick.
  let chosenAuto = !!viewState.chosenAuto, pickerPicked = false;
  const setChosen = (model, automatic = false) => {
    chosenModel = viewState.chosenModel = model || null; chosenAuto = viewState.chosenAuto = !!model && automatic;
    // A chosen model replaces the model a draft was pinned to: a stale pin would otherwise outlive the choice and
    // stand in for it after New thread.
    if (model) viewState.draftModel = null;
  };
  let files = [], composerRevision = 0, queuedSend = null, draftText = '', currentKey = '';
  let contextPrompt = viewState.contextPrompt || null;
  let executionLocation = viewState.executionLocation || 'auto';
  let errorText = '', searchOn = false, submitting = false, retryPending = false, retryDeadline = null;
  let sendAfterDestination = false, pickerChoice = null, stagedDestination = null;
  let sheet = { open: false, title: 'Answer on' };
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
  // The same predicate ends the session's discovery search, so "observed" never arrives on capacity this path refuses.
  const publicAnswers = servesPublicAnswers;
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
  /**
   * The model is the page's to choose: no thread, no pick, and a route on which any public computer may answer. That
   * is the visitor above and also a returning one whose stored record names only the computer (every record from
   * before picks were marked, and a sheet commit without a model pick).
   */
  const anyPublicModel = state => automaticContributors(state) || (!state.activeThread && viewState.privacy !== undefined
    && allowsOpenPlaintext(viewState.privacy) && state.remoteAnswersEnabled !== false && !lockedDestination(state)
    && effectiveLocation(state) === 'network');
  /** Such a visitor's Send, pressed while computers are being found, waits for whichever model turns up: none is named yet. */
  const waitsForAnyModel = state => anyPublicModel(state) && (!chosenModel || chosenAuto);

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
    return selectableStatus(modelExecutionState(model, effectiveLocation(state)).status);
  };
  const choiceWaitOver = state => state.peerDiscoveryTimedOut === true && state.discoveryPhase === 'observed';
  /** Whether the page is still choosing the model among the computers that answer: no draft is pinned to one meanwhile. */
  const choosingStill = state => automaticContributors(state) ? !choiceWaitOver(state)
    : waitsForAnyModel(state) && (state.discoveryPhase === 'searching' || state.discoveryPhase === 'observed' && !choiceWaitOver(state));
  /**
   * A remembered pick whose model the catalog does not list yet (a private pool's model before the pool's state has
   * loaded, a split route that is down, a build that changed). It stands as the chosen model so the composer names
   * it as unavailable and Send goes nowhere else; the catalog entry takes its place when it is listed.
   */
  const unlistedPick = (choice, models = []) => {
    const sameBuild = choice.identity ? models.find(model => model.identity === choice.identity) : null;
    return { id: choice.selectionId, selectionId: choice.selectionId, identity: choice.identity,
      name: choice.name || sameBuild?.name || choice.selectionId, unlisted: true };
  };
  const applyRememberedChoice = state => {
    if (state.activeThread) return;
    // Only a pick names a model for a later visit; any other record has already given its computer above. A pick
    // is the chosen model from the first render, whatever draft is in the composer and whether or not it is listed.
    if (rememberedChoice?.picked && !chosenModel) {
      setChosen(findAnswerChoice(rememberedChoice, state.models) || unlistedPick(rememberedChoice, state.models));
      provisionalChoice = true; rememberedChoice = null;
    } else if (rememberedChoice && !chosenModel && !viewState.draftModel) rememberedChoice = null;
    if (chosenModel?.unlisted) {
      const listed = findAnswerChoice(answerChoiceOf(chosenModel), state.models);
      if (listed) setChosen(listed);
    }
    if (!provisionalChoice) return;
    const current = chosenModel && findAnswerChoice(answerChoiceOf(chosenModel), state.models);
    if (current && choiceAvailable(current, state)) { setChosen(current); provisionalChoice = false; }
    // A pick that nothing serves after the wait stays the choice: the composer says it is unavailable and Send
    // stays off until the person chooses another model. It is never replaced for them.
    else if (!chosenModel || choiceWaitOver(state)) provisionalChoice = false;
  };
  /**
   * A remembered pick waits for its computer through the bounded discovery wait, even once another computer has
   * settled discovery: while it waits the page reads as still searching. The session's phase is left as reported.
   */
  const choiceWaiting = state => provisionalChoice && !state.activeThread && state.discoveryPhase === 'observed' && !choiceWaitOver(state);
  /** Searching, as the page reads it: the session is searching, or a remembered pick is still waiting. */
  const searchingNow = state => state.discoveryPhase === 'searching' || choiceWaiting(state);
  /** The paired desktop or invited host the draft is named to alone: its operator can read the prompt. */
  const pairedOperator = state => {
    const destination = lockedDestination(state), privacy = explicitPrivacy(state);
    if (!destination || privacy.recipients?.kind !== 'named' || privacy.recipients.ids.length !== 1
      || privacy.recipients.ids[0] !== destination.id) return null;
    return destination.label;
  };
  const recoveryAlternative = state => recoverySharedModel(state, currentKey, effectiveLocation(state), explicitPrivacy(state));
  const matchesRecovery = state => {
    const candidate = recoveryAlternative(state);
    return candidate && modelIdentity(candidate) === modelIdentity(recoverySelection);
  };

  viewState.positions ??= new Map();
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
    // Not during the discovery wait of a visitor who picked no model: see the pin in project().
    if (choosingStill(state)) return;
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
  let fitRequest, fitKey, fitInfo, sendDisabled = true;
  function projectSheet(snapshotState, finding) {
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
      return finding ? 'Finding computers…' : 'None available';
    };
    const computers = [
      { choice: 'local', title: 'This device' },
      ...(locked ? [{ choice: 'desktop', title: locked.label }] : []),
      ...(locked?.guest ? [] : [{ choice: 'network', title: 'Contributors' }])
    ].map(row => ({ ...row, status: computerState(row.choice), checked: row.choice === pressed, disabled: lockedComputers }));
    const outcome = describeAnswerChoice(selected || (pickerModel ? unavailableModelChoice(pickerModel) : null), side,
      { state, block, canDownload, choice: pressed === 'desktop' ? 'desktop' : null, locked, sending: sendAfterDestination, implied: pickerModelImplied, searching: finding });
    const keep = { local: 'No model is stored on this device.',
      shared: finding ? 'Finding computers…' : 'No contributor shares a model right now.' };
    const sections = projectModelChoices(models, { value: modelKey(pickerModel), grouped: true, preferNetwork: false, variants: true, compact: true,
      location: side === 'local' ? 'local' : 'auto', describe: describeModelChoice(state), keep, inspectable: true, disabled: changingModel,
      // Discovery runs until the bounded wait is over, even after the first computer settled it (chat-session.js).
      discovering: state.discoveryPhase === 'searching' || state.discoveryPhase === 'observed' && !state.peerDiscoveryTimedOut });
    const detailModel = selected || pickerModel;
    const disclosure = promptDisclosure({ site: 'sheet', local: pickerLocation === 'local',
      operator: pickerChoice === 'desktop' && locked ? locked.label : null, blocked: !!block,
      stages: !!pickerModel?.partition, pool: !!pickerModel?.fleet });
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
    const finding = searchingNow(state);
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
    // While computers are still being found for a visitor who chose nothing, a split route or a private pool's model
    // is not what the search is waiting for (publicAnswers): the composer does not name one, and a held Send keeps
    // waiting on a whole model.
    const whole = automaticContributors(state) && !pinnedModel && !catalogModels.some(publicAnswers)
      ? models.filter(model => !model.fleet && !model.partition) : models;
    const sessionDefault = state.defaultModels?.[location] || state.defaultModel;
    const defaultModel = whole === models || whole.some(model => modelKey(model) === modelKey(sessionDefault)) ? sessionDefault
      : whole.find(model => model.id === sessionDefault?.id) || whole[0];
    const freshVisitor = !thread && viewState.privacy === undefined && !viewState.privacyTouched && !lockedDestination(state);
    const downloadable = model => canDownloadModelHere(model, state, canDownload);
    const servedDownload = models.find(model => modelExecutionState(model, 'network').usable && downloadable(model));
    const localStart = !pinnedModel && location === 'local'
      ? startingLocalModel(models, { defaultModel: servedDownload || defaultModel, canDownloadHere: downloadable }) : null;
    const current = modelKey(pinnedModel) || modelKey(localStart)
      || modelKey(whole.find(model => modelKey(model) === modelKey(defaultModel) && selectable(model)))
      || modelKey(whole.find(selectable))
      // While computers are being found for a visitor who chose nothing, a queued Send needs a whole model to wait on.
      || (automaticContributors(state) || waitsForAnyModel(state) ? modelKey(whole.find(model => modelKey(model) === modelKey(defaultModel))) : undefined)
      || modelKey(whole[0]) || modelKey(models[0]);
    currentKey = current || '';
    const selectedModel = catalogModels.find(model => modelKey(model) === current
      && (!pinnedModel?.identity || modelIdentity(model) === modelIdentity(pinnedModel)));
    const execution = modelExecutionState(selectedModel, location);
    // A typed draft keeps the model it was written for, once computers are known: nothing is pinned while they are
    // being found. For a visitor who chose nothing that lasts the whole bounded discovery wait, so the model is the
    // preferred one among the computers that answered in it, not whichever advertised first.
    if (!thread && !chosenModel && !viewState.draftModel && (draftText.trim() || files.length)
      && !((freshVisitor || waitsForAnyModel(state)) && finding && !execution.usable)
      && !choosingStill(state)) viewState.draftModel = selectedModel;
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
    const selectedPreparing = catalogModels.some(model => modelKey(model) === current && preparingStatus(model.availability));
    const preparing = localPreparing || remotePreparing || selectedPreparing;
    const acquiring = state.acquisition?.phase === 'downloading';
    const phase = finding ? 'searching' : state.discoveryPhase;
    const exhausted = phase === 'observed' || phase === 'interrupted' || phase === 'paused';
    const publicCanAnswer = freshVisitor && (modelExecutionState(selectedModel, 'network').usable
      || catalogModels.some(publicAnswers));
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
    privacyChoice.follow(state, privacyDisabled);
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
    const disclosure = promptDisclosure({ site: 'composer', computation: privacy.computation,
      local: privacy.recipients.kind === 'none' && !usable || location === 'local' || execution.usable && execution.source === 'local',
      operator: pairedOperator(state), named: privacy.recipients.kind === 'named', stages: !!selectedModel?.partition,
      usable, pool: !!selectedModel?.fleet });
    // The queued Send: it waits for a computer running this model while discovery runs, and lapses when that can't happen.
    const permitted = !busy && canWaitForPublicModel(state, selectedModel, location);
    if (queuedSend && (!permitted || queuedSend.scope !== queueScope(state, selectedModel))) queuedSend = null;
    // A Send held for whichever model turns up ends with the wait when none did: the status below says so.
    if (queuedSend && waitsForAnyModel(state) && choiceWaitOver(state) && !usable) queuedSend = null;
    if (queuedSend) {
      const intent = queuedSend, ready = readyForQueuedSend(state, intent);
      // The hold is bounded by the discovery wait. While the composer names a model that can answer but whose
      // computer is busy or not reachable yet, it says so; once the wait is over, the held Send goes the way a
      // Send pressed now would.
      statusText = usable && !ready ? 'Waiting for capacity.'
        : waitsForAnyModel(state) ? 'Finding computers…' : `Waiting for a computer running ${modelVariantLabel(selectedModel)}…`;
      if (!intent.scheduled && (ready || usable && choiceWaitOver(state))) {
        intent.scheduled = true;
        queueMicrotask(() => {
          intent.scheduled = false;
          if (disposed || queuedSend !== intent) return;
          const latest = sessionState;
          if (readyForQueuedSend(latest, intent)) submitDraft(intent);
          else if (choiceWaitOver(latest) && !sendDisabled
            && modelExecutionState(latest.models?.find(item => modelKey(item) === currentKey), effectiveLocation(latest)).usable) {
            queuedSend = null; submitDraft();
          }
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
    const findingFirst = (freshVisitor || waitsForAnyModel(state)) && !(thread?.model || chosenModel) && phase === 'searching' && !execution.usable;
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
    const queueable = !busy && !usable && finding && canWaitForPublicModel(state, selectedModel, location);
    const askFirst = !thread && !busy && !usable && !queueable && viewState.privacy === undefined && !viewState.privacyTouched && !lockedDestination(state);
    sendDisabled = attachmentReader.pending || !(usable || queueable || askFirst) || !!thread?.closed || !!state.storageError || (!!invite && !inviteJoined);
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
    const messageRows = transcript.update(thread, { usable: usable && !thread?.closed, busy, state, getSources: session.getDocumentSources });
    return Object.freeze({
      selectedId: state.selectedId, threadClosed: !!thread?.closed, busy, hasMessages: !!thread?.messages.length,
      composer,
      sheet: sheet.open ? projectSheet(state, finding) : { open: false },
      privacy: privacyChoice.project(state),
      rename: threadList.renameView(),
      download: downloads.view(),
      remotePermission: remotePermissionView(thread),
      threads: threadList.project(state, catalogModels),
      messages: messageRows,
      canExport: !!thread?.messages.length,
      draftContext: contextPrompt,
      focus
    });
  }

  // ---- commands ----
  function submitDraft(intent = null) {
    // A closed screen sends nothing, whether the Send was pressed or held for a computer.
    if (disposed) return;
    const content = draftText.trim(), state = sessionState, original = draftText, finding = searchingNow(state);
    if (!content || attachmentReader.pending || submitting || (state.runningIds || []).includes(state.selectedId)) return;
    if (intent ? !readyForQueuedSend(state, intent) : sendDisabled) return;
    const model = state.models.find(item => modelKey(item) === currentKey);
    if (!intent && !state.activeThread && viewState.privacy === undefined && !viewState.privacyTouched && !lockedDestination(state)
      && !modelExecutionState(model, effectiveLocation(state)).usable
      && !(finding && canWaitForPublicModel(state, model, effectiveLocation(state)))) {
      openDestination({ forSend: true });
      return;
    }
    if (!intent && finding && !modelExecutionState(model, effectiveLocation(state)).usable
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
      if (pickerLocation !== 'network' && wanted && downloadableHere(wanted, state)) { sheet = { open: false, title: 'Answer on' }; downloads.open(next); return; }
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
    if (pickerLocation !== 'network') { sheet = { open: false, title: 'Answer on' }; downloads.open(modelKey(model)); return; }
    const revision = ++pickerRevision, scope = queueScope(state, model);
    downloads.open(modelKey(model), {
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

  // ---- "Who can read it?" (privacy-dialog.js) ----
  const privacyChoice = createPrivacyDialog({ session, getState: () => sessionState, viewState, notify, requestFocus, presetContext, explicitPrivacy,
    blocked: () => submitting || privacyDisabledNow(),
    beforeOpen: () => { queuedSend = null; if (sheet.open) sheet = { open: false, title: 'Answer on' }; },
    setDraftLocation: location => { executionLocation = viewState.executionLocation = location; } });

  // ---- the Threads list (threads.js) ----
  const threadList = createThreadList({ session, getState: () => sessionState, notify, now, act, requestFocus, saveDraft, viewState,
    disposed: () => disposed });

  // ---- the reviewed download (download-dialog.js) ----
  const downloads = createDownloadDialog({ session, getState: () => sessionState, notify, requestFocus, act,
    sheetOpen: () => sheet.open, disposed: () => disposed });

  const unsubscribe = session.subscribe(state => { sessionState = state; notify(); });
  const unsubscribeSearch = search && session.searchPermissionRequest ? search.subscribe(() => notify()) : () => {};
  if (search && search.state().state === 'unknown') void search.refresh();
  const unsubscribeWebSearch = webSearch ? webSearch.subscribe(state => {
    searchOn = state.enabled && (!!state.url || !!search?.available() || deviceSearchOn());
    notify();
  }) : () => {};
  snapshot = project();

  const thread = () => sessionState.activeThread;
  const approval = createRemoteApproval({ session, thread, act });
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
      clearTimeout(retryDeadline);
      const deadline = retryDeadline = setTimeout(() => { retryPending = false; notify(); }, 8000);
      void Promise.resolve().then(() => session.connect()).catch(cause => error(cause.message))
        .finally(() => { clearTimeout(deadline); retryPending = false; notify(); });
    },
    cancelDownload() { session.cancelModelDownload?.(); },
    downloadLocal() {
      const state = sessionState;
      const model = state.activeThread?.model || (state.models || []).find(item => modelKey(item) === currentKey) || chosenModel || state.defaultModel;
      if (model) downloads.open(modelKey(model));
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
    // "Who can read it" (privacy-dialog.js).
    openPrivacy: privacyChoice.open, pickProtection: privacyChoice.pickProtection, pickRoute: privacyChoice.pickRoute,
    setOwnDevices: privacyChoice.setOwnDevices, closePrivacy: privacyChoice.close, applyPrivacy: privacyChoice.apply,
    // The reviewed download.
    selectDownloadModel: downloads.selectModel,
    setDownloadSharing: downloads.setSharing,
    /** Computers' Start sharing: the same reviewed download, sharing this device's compute with the model. */
    startSharing(modelId) { downloads.open(modelId ?? null, null, 'contribute'); },
    /** The context prompt a new thread starts with; a sent thread keeps its own (Conversation details). */
    setDraftContext(selection) { contextPrompt = selection; viewState.contextPrompt = selection; notify(); },
    retryDownloadCheck() { void downloads.check(); },
    closeDownload: downloads.close, confirmDownload: downloads.confirm,
    // Threads.
    newThread() {
      queuedSend = null;
      try {
        observe(after(saveDraft(), () => after(session.select(null), () => {
          // A pick carries to the new thread; an automatic choice is made again from what is available.
          if (chosenModel && !chosenAuto) rememberedChoice = answerChoiceOf(chosenModel, null, true);
          setChosen(null); provisionalChoice = false; threadList.showCurrent();
          requestFocus('composer'); notify();
        })));
      } catch (cause) { error(cause); }
    },
    selectThread(id) {
      queuedSend = null;
      try { observe(after(saveDraft(), () => session.select(id))); } catch (cause) { error(cause); }
    },
    showArchived: threadList.showArchived, archiveThread: threadList.archiveThread,
    openRename: threadList.openRename, setRenameValue: threadList.setRenameValue,
    closeRename: threadList.closeRename, saveRename: threadList.saveRename,
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
    allowRemote: approval.allow, declineRemote: approval.decline,
    clearError() { if (errorText) { errorText = ''; notify(); } },
    dispose() {
      if (disposed) return;
      try { observe(saveDraft()); } catch (cause) { error(cause); }
      queuedSend = null;
      disposed = true;
      clearTimeout(retryDeadline);
      fitRequest?.abort(); downloads.dispose(); attachmentReader.close(); threadList.dispose();
      unsubscribe(); unsubscribeSearch(); unsubscribeWebSearch(); listeners.clear();
    }
  };
  return api;
}
