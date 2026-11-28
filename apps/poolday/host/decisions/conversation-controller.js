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
import { selectAvailableChatModel } from '../chat-view.js';
import { createSendIntentStore } from '../send-intents.js';

export { relativeTime } from './threads.js';
import workProfile from '../../config/work-profile.json' with { type: 'json' };
import chatPrompts from '../../config/chat-prompts.json' with { type: 'json' };

const busyAcquisition = state => state.acquisition?.phase === 'downloading';
const modelIdentity = model => JSON.stringify([modelKey(model), model?.identity, (model?.adapters || []).map(adapter => adapter.identity)]);
const selectable = model => selectableStatus(model.availability);
/**
 * How Ask names this device's paired desktop. The desktop's own name (its pairing `hostLabel`) is private to its owner
 * and stays in device management (decisions/computers.js); Ask, its disclosures and its route offers say only this.
 */
export const OWN_DESKTOP = 'your desktop';
const OWN_DESKTOP_TITLE = 'Your desktop';

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
  const notify = () => { if (disposed) return; snapshot = project(advance()); for (const listener of listeners) listener(); };

  // ---- view state: what the person has staged on this page (the vanilla page's viewState and closures) ----
  /**
   * The model the composer stands on before a thread exists, and how it came to be chosen:
   * - `model`: the chosen model, or null while the page chooses one from availability;
   * - `automatic`: it came with a computer or a default, so it follows availability; otherwise the person picked it
   *   and it is never replaced for them;
   * - `waiting`: it is a remembered pick still waiting through the discovery wait for its computer;
   * - `remembered`: the stored "Answer on" record (answer-choice.js) not yet applied.
   * `model` and `automatic` are kept in viewState too, so a remount of the screens keeps them.
   */
  const choice = { model: viewState.chosenModel || null, automatic: !!viewState.chosenAuto, waiting: false, remembered: null };
  let pickerModel = null, pickerLocation = 'auto';
  let changingModel = false, pickerTouched = false, recoverySelection = null, pickerRevision = 0, pickerModelImplied = false;
  // Whether the sheet's staged model is the person's pick.
  let pickerPicked = false;
  const setChosen = (model, automatic = false) => {
    choice.model = viewState.chosenModel = model || null; choice.automatic = viewState.chosenAuto = !!model && automatic;
    // A chosen model replaces the model a draft was pinned to: a stale pin would otherwise outlive the choice and
    // stand in for it after New thread.
    if (model) viewState.draftModel = null;
  };
  let files = [], composerRevision = 0, draftText = '', currentKey = '';
  let contextPrompt = viewState.contextPrompt || null;
  let executionLocation = viewState.executionLocation || 'auto';
  let errorText = '', searchOn = false, retryPending = false, retryDeadline = null, dismissedExpiry = null;
  /**
   * The held Send is the chat host's (host/send-intents.js, a reploid.send-intent/1 intent): it expires 30 s after
   * the press whatever discovery is doing, and the host checks its deadline, selection revision and pinned artifact
   * right before dispatch. A session that brings no store (a test double) gets one of its own here.
   */
  const ownIntents = session.sendIntents ? null : createSendIntentStore({ now });
  const intents = session.sendIntents ?? ownIntents;
  /**
   * Send, as one record: `idle`; `held` while the host holds its intent (`intentId`) for a route (`scope` is the
   * draft and route it was pressed for, `scheduled` that its release is already queued); `submitting` from the press
   * until the session admitted it. A held Send and a submitting one never coexist.
   */
  const IDLE = Object.freeze({ kind: 'idle' }), SUBMITTING = Object.freeze({ kind: 'submitting' });
  let send = IDLE;
  const held = () => send.kind === 'held' && intents.holds(send.intentId) ? send : null;
  const dropHold = () => { if (send.kind === 'held') { intents.cancel(send.intentId); send = IDLE; } };
  /** The model selection the host's intents bind: the thread's model, or a pick; otherwise the page chooses (auto). */
  const reportSelection = state => {
    const thread = state.activeThread;
    const pin = thread ? (thread.automaticModel ? null : thread.model) : choice.model && !choice.automatic ? choice.model : null;
    intents.select(pin ? { mode: 'pinned', artifact: pin } : { mode: 'auto' });
  };
  const submitting = () => send.kind === 'submitting';
  const endSubmit = () => { if (send.kind === 'submitting') send = IDLE; };
  let sendAfterDestination = false, pickerChoice = null, stagedDestination = null;
  let sheet = { open: false, title: 'Answer on' };
  let attachmentHelp = false, focus = { target: null, seq: 0 };
  // Up to three distinct starters, chosen at random from the set and kept for this view's life so nothing moves.
  const startingPrompts = pickStartingPrompts(chatPrompts, random);
  const startingPrompt = startingPrompts[0] || '';
  const localPolicy = createExecutionPolicy();
  const openPolicy = () => createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] }, computation: 'plaintext' });
  const requestFocus = target => { focus = { target, seq: focus.seq + 1 }; };

  choice.remembered = choice.model ? null : readAnswerChoice(storage);
  if (choice.remembered?.route && viewState.privacy === undefined && !viewState.privacyTouched) {
    const device = choice.remembered.route === 'device';
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
   * the first Send. Prefer a ready contributor to cached local weights. With no ready contributor, a stored local
   * model can answer; without either, the draft stays put. A held network Send never silently changes destinations.
   */
  const automaticContributors = state => !state.activeThread && viewState.privacy === undefined && !viewState.privacyTouched
    && state.remoteAnswersEnabled !== false && !lockedDestination(state)
    && (!!held() || !(state.models || []).some(storedHere)
      || (state.models || []).some(model => publicAnswers(model) && model.networkAvailability === 'ready'));
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
  const waitsForAnyModel = state => anyPublicModel(state) && (!choice.model || choice.automatic);

  const lockedDestination = state => {
    const owner = state.ownerPairing, invite = viewState.guestInvite, guest = state.guestAccess;
    const modelId = model => typeof model === 'string' ? model : model?.id ?? null;
    if (owner?.status === 'online' && owner.hostParticipantId && !invite) {
      return { id: owner.hostParticipantId, label: OWN_DESKTOP, readyModel: modelId(owner.readyModel), status: 'online', guest: false };
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
    ? { id: state.ownerPairing.hostParticipantId, label: OWN_DESKTOP, status: state.ownerPairing.status } : null);
  // The paired desktop, the conversation's model and its execution location: what the dialog and the chip need to name
  // the route a request sends.
  const presetContext = state => ({ desktop: state.ownerPairing?.hostParticipantId
    ? { id: state.ownerPairing.hostParticipantId, label: OWN_DESKTOP } : null,
  model: state.activeThread?.model ?? choice.model ?? null,
  location: state.activeThread?.permissions?.executionLocation ?? executionLocation });
  /**
   * The request may go only to this device's paired desktop (a thread or draft restricted to your devices), and that
   * desktop is not online: nothing can answer, and no other computer is ever used in its place.
   */
  const ownDesktopOffline = state => {
    const id = state.ownerPairing?.hostParticipantId, recipients = explicitPrivacy(state).recipients;
    return !!id && state.ownerPairing.status !== 'online' && recipients?.kind === 'named' && recipients.ids.length > 0
      && recipients.ids.every(item => item === id);
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
    // An unpinned conversation followed the paired desktop only because it was online. Once it is not, the
    // conversation is automatic again and an eligible contributor answers; a choice the person made is kept.
    if (!destination && viewState.privacyFromPairing && !viewState.privacyTouched && !state.activeThread) {
      viewState.privacy = undefined; viewState.privacyFromPairing = false;
      if (choice.automatic) setChosen(null);
    }
    if (state.activeThread || !destination || (viewState.privacyTouched && !destination.guest)) return;
    const current = viewState.privacy;
    if (current?.recipients?.kind !== 'named' || current.recipients.ids.length !== 1 || current.recipients.ids[0] !== destination.id) {
      viewState.privacy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: [destination.id] }, computation: 'plaintext' });
      viewState.privacyFromPairing = !destination.guest;
      if (executionLocation === 'local') executionLocation = viewState.executionLocation = 'auto';
    }
    if (!choice.model && destination.readyModel) {
      const model = (state.models || []).find(item => item.id === destination.readyModel || modelKey(item) === destination.readyModel);
      if (model) setChosen(model, true);
    }
  };
  const choiceAvailable = (model, state) => {
    return selectableStatus(modelExecutionState(model, effectiveLocation(state)).status);
  };
  const preferenceOrder = workProfile.chatModelPreference || [];
  const preferenceRank = model => {
    const index = preferenceOrder.indexOf(model?.id);
    return index < 0 ? preferenceOrder.length : index;
  };
  const topPreferredReady = state => {
    const candidates = (state.models || []).filter(model => !model.fleet && !model.partition && !model.adapters?.length);
    if (!candidates.length) return false;
    const bestRank = Math.min(...candidates.map(preferenceRank));
    return candidates.some(model => preferenceRank(model) === bestRank
      && model.networkAvailability === 'ready' && model.reachableProviderIds?.length > 0);
  };
  const choiceWaitOver = state => state.peerDiscoveryTimedOut === true && state.discoveryPhase === 'observed';
  const choiceSettled = state => choiceWaitOver(state) || (state.discoveryPhase === 'observed' && topPreferredReady(state));
  /** Whether the page is still choosing the model among the computers that answer: no draft is pinned to one meanwhile. */
  const choosingStill = state => automaticContributors(state) ? !choiceSettled(state)
    : waitsForAnyModel(state) && (state.discoveryPhase === 'searching' || state.discoveryPhase === 'observed' && !choiceSettled(state));
  /**
   * The automatic choice is provisional while the session's bounded discovery wait is open (chat-session.js: 8 s from
   * connecting, then peerDiscoveryTimedOut) unless the highest-ranked public model in the preference order is already
   * ready: while only a lower-ranked model is seen, a higher-ranked one may still answer and move the choice. Only a
   * choice the page makes is provisional, never a pick, a thread's model or a paired desktop's. Meanwhile the composer
   * names no model as ready, and a Send pressed is held and goes to the settled choice as soon as the top-ranked model
   * answers or the wait ends; the held intent's own 30 s still bounds it.
   */
  const provisionalChoice = state => !state.activeThread && waitsForAnyModel(state)
    && state.discoveryPhase === 'observed' && !choiceSettled(state);
  /**
   * A remembered pick whose model the catalog does not list yet (a private pool's model before the pool's state has
   * loaded, a split route that is down, a build that changed). It stands as the chosen model so the composer names
   * it as unavailable and Send goes nowhere else; the catalog entry takes its place when it is listed.
   */
  const unlistedPick = (record, models = []) => {
    const sameBuild = record.identity ? models.find(model => model.identity === record.identity) : null;
    return { id: record.selectionId, selectionId: record.selectionId, identity: record.identity,
      name: record.name || sameBuild?.name || record.selectionId, unlisted: true };
  };
  const applyRememberedChoice = state => {
    if (state.activeThread) return;
    // Only a pick names a model for a later visit; any other record has already given its computer above. A pick
    // is the chosen model from the first render, whatever draft is in the composer and whether or not it is listed.
    if (choice.remembered?.picked && !choice.model) {
      setChosen(findAnswerChoice(choice.remembered, state.models) || unlistedPick(choice.remembered, state.models));
      choice.waiting = true; choice.remembered = null;
    } else if (choice.remembered && !choice.model && !viewState.draftModel) choice.remembered = null;
    if (choice.model?.unlisted) {
      const listed = findAnswerChoice(answerChoiceOf(choice.model), state.models);
      if (listed) setChosen(listed);
    }
    if (!choice.waiting) return;
    const current = choice.model && findAnswerChoice(answerChoiceOf(choice.model), state.models);
    if (current && choiceAvailable(current, state)) { setChosen(current); choice.waiting = false; }
    // A pick that nothing serves after the wait stays the choice: the composer says it is unavailable and Send
    // stays off until the person chooses another model. It is never replaced for them.
    else if (!choice.model || choiceWaitOver(state)) choice.waiting = false;
  };
  /**
   * A remembered pick waits for its computer through the bounded discovery wait, even once another computer has
   * settled discovery: while it waits the page reads as still searching. The session's phase is left as reported.
   */
  const choiceWaiting = state => choice.waiting && !state.activeThread && state.discoveryPhase === 'observed' && !choiceWaitOver(state);
  /** Searching, as the page reads it: the session is searching, or a remembered pick is still waiting. */
  const searchingNow = state => state.discoveryPhase === 'searching' || choiceWaiting(state);
  /** The paired desktop or invited host the draft is named to alone: its operator can read the prompt. */
  const pairedOperator = state => {
    const destination = lockedDestination(state), privacy = explicitPrivacy(state);
    if (ownDesktopOffline(state)) return OWN_DESKTOP;
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
    if (waitsForAnyModel(state) || choosingStill(state)) return;
    if (state.selectedId == null && !choice.model && !viewState.draftModel) {
      viewState.draftModel = state.models?.find(model => modelKey(model) === currentKey);
    }
  }
  function queueScope(state, model) {
    const privacy = explicitPrivacy(state);
    return JSON.stringify([state.selectedId, waitsForAnyModel(state) ? 'automatic' : modelIdentity(model), effectiveLocation(state), privacy,
      state.remoteNetworkId, state.remoteAnswersEnabled, state.activeThread?.permissions, contextPrompt,
      state.activeThread?.systemContext, searching(), composerRevision, draftText]);
  }
  /** Whether a Send pressed now may be held: a whole public model while computers are being found. */
  const canWaitForPublicModel = (state, model, location) => holdable(state, model, location)
    && ['observed', 'searching'].includes(state.discoveryPhase);
  /** Whether a held Send may keep waiting for `model`: its route and draft still permit it. Discovery does not bound it. */
  function holdable(state, model, location) {
    const privacy = explicitPrivacy(state);
    const pinned = state.activeThread?.model || (waitsForAnyModel(state) ? null : choice.model || viewState.draftModel);
    return !!model?.identity && (!pinned?.identity || modelIdentity(model) === modelIdentity(pinned)) && !model.partition && !model.fleet && location !== 'local'
      && (!state.activeThread || location === 'network') && allowsOpenPlaintext(privacy)
      && !searching() && !attachmentReader.pending
      && !state.storageError && !state.activeThread?.closed && !state.comparisonPhase
      && !(state.runningIds || []).includes(state.selectedId) && !submitting();
  }
  function readyForQueuedSend(state, intent) {
    const model = state.models?.find(item => modelKey(item) === currentKey);
    return !disposed && !provisionalChoice(state) && holdable(state, model, effectiveLocation(state))
      && queueScope(state, model) === intent.scope && model.networkAvailability === 'ready'
      && model.reachableProviderIds?.length > 0;
  }

  // ---- the state transition and the projection ----
  // advance() moves what the page has staged on with the session (the remembered pick, the automatic choice, the draft
  // pin, the held Send, the sheet's staged model) and returns the frame project() reads. project() only reads: it
  // builds the snapshot record from that frame and changes nothing. notify() runs both.
  let fitRequest, fitKey, fitInfo, sendDisabled = true;
  const localFitShown = model => !!model?.source && !model.partition && !model.fleet
    && (hasBrowserModelOrigin(model) || model.localCached || model.localReady);
  /** The sheet's staged computer and model follow the session until the person touches them; details fetch the fit. */
  function advanceSheet(state) {
    if (pickerLocation === 'local') pickerChoice = 'device';
    else if (!pickerChoice || pickerChoice === 'device') pickerChoice = 'contributors';
    const block = blockFor(state);
    if (pickerModelImplied && pickerLocation === 'network' && pickerChoice === 'contributors' && !block) {
      const current = state.models?.find(model => modelKey(model) === modelKey(pickerModel)) || pickerModel;
      pickerModel = modelForLocation(state.models, current, 'network', { state, canDownload });
      if (modelKey(pickerModel) !== modelKey(current)) pickerPicked = false;
    }
    if (!pickerTouched) pickerModel = (state.models || []).find(model => modelKey(model) === currentKey) || pickerModel;
    const key = localFitShown(pickerModel) && sheet.detailsOpen ? modelIdentity(pickerModel) : null;
    if (fitKey !== key) {
      fitRequest?.abort(); fitInfo = null; fitKey = key;
      if (key && session.getLocalModelFit) {
        const request = fitRequest = new AbortController(), model = pickerModel;
        session.getLocalModelFit(model, { signal: request.signal }).then(info => {
          if (!request.signal.aborted && !disposed) { fitInfo = info; notify(); }
        }).catch(() => {});
      }
    }
  }
  function projectSheet(snapshotState, finding) {
    const state = snapshotState.computerLabels ? snapshotState : withComputerLabels(snapshotState, session);
    const block = blockFor(state), locked = lockedDestination(state);
    const models = [...(state.models || [])];
    const selected = (state.models || []).find(model => modelKey(model) === modelKey(pickerModel));
    if (pickerModel && !models.some(model => modelKey(model) === modelKey(pickerModel))) models.push(selected || unavailableModelChoice(pickerModel));
    const side = pickerLocation === 'local' ? 'local' : 'network';
    const pressed = side === 'local' ? 'local' : pickerChoice === 'desktop' && locked ? 'desktop' : 'network';
    const runsHere = model => modelExecutionState(model, 'local').usable, runsOnNetwork = model => modelExecutionState(model, 'network').usable;
    const lockedComputers = changingModel || !!state.activeThread?.closed || (state.runningIds || []).includes(state.selectedId);
    const computerState = computer => {
      if (computer === 'desktop') return { online: 'Ready', pairing: 'Connecting…', joining: 'Connecting…', connecting: 'Connecting…', offline: 'Offline', invited: 'Tap Join' }[locked?.status] || 'Not connected';
      if (computer === 'local') return runsHere(selected) ? 'Ready' : selected && canDownloadModelHere(selected, state, canDownload) ? 'Download needed' : 'Runs stored models';
      if (block === 'own-devices') return 'Off · Only your devices';
      if (runsOnNetwork(selected)) return 'Ready';
      if ((state.models || []).some(runsOnNetwork)) return 'Not serving this model';
      return finding ? 'Finding computers…' : 'None available';
    };
    const computers = [
      { choice: 'local', title: 'This device' },
      ...(locked ? [{ choice: 'desktop', title: locked.guest ? locked.label : OWN_DESKTOP_TITLE }] : []),
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
    const showLocalFit = localFitShown(pickerModel);
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

  function advance() {
    const state = withComputerLabels(sessionState, session);
    // An intent the host no longer holds (expired, claimed or cancelled) is no longer this page's held Send.
    if (send.kind === 'held' && !intents.holds(send.intentId)) send = IDLE;
    applyPairedDesktopDefault(state);
    applyRememberedChoice(state);
    reportSelection(state);
    const finding = searchingNow(state);
    if (selectedId !== state.selectedId) {
      pickerRevision++;
      drafts.set(selectedId, { text: draftText, files }); selectedId = state.selectedId; attachmentReader.reset();
      const draft = drafts.get(selectedId) || session.getDraft?.(selectedId); draftText = draft?.text || ''; files = draft?.files || [];
    }
    const thread = state.activeThread, catalogModels = state.models || [], runningIds = state.runningIds || [];
    if (!thread && !draftText.trim() && !files.length && !attachmentReader.pending) viewState.draftModel = null;
    // A typed public draft follows a better fallback when its current model stops serving.
    // Don't depend on the session's generic default: it may include private or split routes.
    const publicAuto = waitsForAnyModel(state);
    const location = effectiveLocation(state);
    if (publicAuto && viewState.draftModel) {
      const serving = catalogModels.filter(publicAnswers);
      const currentDraftModel = serving.find(model => modelIdentity(model) === modelIdentity(viewState.draftModel));
      if (!currentDraftModel || (currentDraftModel.networkAvailability !== 'ready'
        && serving.some(model => model.networkAvailability === 'ready'))) viewState.draftModel = null;
    }
    if (!publicAuto && !thread && state.defaultModels?.[location] && !lockedDestination(state)) {
      const served = model => { const item = findAnswerChoice(answerChoiceOf(model), catalogModels); return !!item && choiceAvailable(item, state); };
      if (viewState.draftModel && !choice.model && !served(viewState.draftModel)) viewState.draftModel = null;
      if (choice.model && choice.automatic && !choice.waiting && !served(choice.model)) setChosen(null);
    }
    const pinnedModel = thread?.model || (publicAuto ? viewState.draftModel : choice.model || viewState.draftModel);
    const models = catalogModels.filter(model => modelKey(model) !== modelKey(pinnedModel)
      || !pinnedModel?.identity || modelIdentity(model) === modelIdentity(pinnedModel));
    if (pinnedModel && !models.some(model => modelKey(model) === modelKey(pinnedModel))) models.push(unavailableModelChoice(pinnedModel));
    // The public automatic path only chooses whole-model contributors.
    const whole = publicAuto ? models.filter(model => !model.fleet && !model.partition) : models;
    const sessionDefault = state.defaultModels?.[location] || state.defaultModel;
    const defaultModel = whole === models || whole.some(model => modelKey(model) === modelKey(sessionDefault)) ? sessionDefault
      : whole.find(model => model.id === sessionDefault?.id) || whole[0];
    const freshVisitor = !thread && viewState.privacy === undefined && !viewState.privacyTouched && !lockedDestination(state);
    const downloadable = model => canDownloadModelHere(model, state, canDownload);
    const servedDownload = models.find(model => modelExecutionState(model, 'network').usable && downloadable(model));
    const localStart = !pinnedModel && location === 'local'
      ? startingLocalModel(models, { defaultModel: servedDownload || defaultModel, canDownloadHere: downloadable }) : null;
    const bestPublic = publicAuto ? selectAvailableChatModel(whole.filter(publicAnswers), preferenceOrder, 'network') : null;
    const current = modelKey(pinnedModel) || modelKey(bestPublic) || modelKey(localStart)
      || modelKey(whole.find(model => modelKey(model) === modelKey(defaultModel) && selectable(model)))
      || modelKey(whole.find(selectable))
      // An internal target lets the picker explain and offer recovery with no serving model.
      || (publicAuto ? modelKey(whole.find(model => modelKey(model) === modelKey(defaultModel))) : undefined)
      || modelKey(whole[0]);
    currentKey = current || '';
    const selectedModel = catalogModels.find(model => modelKey(model) === current
      && (!pinnedModel?.identity || modelIdentity(model) === modelIdentity(pinnedModel)));
    const execution = modelExecutionState(selectedModel, location);
    // A typed draft keeps the model it was written for, once computers are known: nothing is pinned while they are
    // being found. For a visitor who chose nothing that lasts the whole bounded discovery wait, so the model is the
    // preferred one among the computers that answered in it, not whichever advertised first.
    if (!thread && (!choice.model || publicAuto) && !viewState.draftModel && (draftText.trim() || files.length)
      && (!publicAuto || selectedModel && publicAnswers(selectedModel))
      && !((freshVisitor || waitsForAnyModel(state)) && finding && !execution.usable)
      && !choosingStill(state)) viewState.draftModel = selectedModel;
    const prepareHere = location === 'local' && selectedModel?.localCached === true;
    // A route restricted to the paired desktop answers only there: contributors serving the model do not make it usable.
    const blocked = ownDesktopOffline(state);
    const usable = explicitPrivacy(state).computation === 'plaintext' && (execution.usable || prepareHere) && !blocked;
    const busy = runningIds.includes(thread?.id) || !!state.comparisonPhase;
    // A model able to answer that the page chose while discovery is still choosing: Send holds rather than dispatches.
    const settling = usable && provisionalChoice(state);
    privacyChoice.follow(state, busy || !!thread?.closed);
    // The queued Send: it waits for a computer running this model until its intent expires (30 s from the press,
    // host/send-intents.js), and lapses earlier only when its draft or route no longer permits it.
    const permitted = !busy && holdable(state, selectedModel, location);
    if (held() && (!permitted || held().scope !== queueScope(state, selectedModel))) dropHold();
    const intent = held(), ready = !!intent && readyForQueuedSend(state, intent);
    // Released when its computer is ready, or, for a model already able to answer, once the discovery wait has
    // chosen it: then it goes the way a Send pressed now would, after the host's check.
    if (intent && !intent.scheduled && (ready || usable && choiceWaitOver(state))) {
      intent.scheduled = true;
      queueMicrotask(() => {
        intent.scheduled = false;
        if (disposed || send !== intent) return;
        const latest = sessionState;
        if (readyForQueuedSend(latest, intent)) submitDraft(intent);
        else if (choiceWaitOver(latest) && !sendDisabled
          && modelExecutionState(latest.models?.find(item => modelKey(item) === currentKey), effectiveLocation(latest)).usable) {
          const refusal = intents.claim(intent.intentId, { model: latest.models.find(item => modelKey(item) === currentKey),
            threadId: latest.selectedId ?? null });
          send = IDLE;
          if (refusal) notify(); else submitDraft();
        }
      });
    }
    const invite = viewState.guestInvite, guest = state.guestAccess;
    const inviteJoined = !!invite && guest?.joined && guest.hostParticipantId === invite.hostPeerId;
    const queueable = !busy && (settling || !usable && finding) && canWaitForPublicModel(state, selectedModel, location);
    // With nothing chosen and no contributor to answer, Send asks where to run only when contributors are not the route.
    const askFirst = !thread && !busy && !usable && !queueable && viewState.privacy === undefined && !viewState.privacyTouched && !lockedDestination(state)
      && !automaticContributors(state);
    const sendMode = queueable ? 'queue' : usable ? 'dispatch' : askFirst ? 'choose' : 'none';
    sendDisabled = attachmentReader.pending || !(usable || queueable || askFirst) || !!thread?.closed || !!state.storageError || (!!invite && !inviteJoined);
    // What the composer reads of the sheet is its staging before the sheet follows this change.
    const frame = { state, finding, thread, catalogModels, runningIds, pinnedModel, models, location, freshVisitor, current, selectedModel,
      execution, usable, settling, blocked, sendMode, busy, ready, invite, guest, inviteJoined, sheetModel: pickerModel, sheetChoice: pickerChoice };
    if (sheet.open) advanceSheet(state);
    threadList.follow(state);
    return frame;
  }

  function project({ state, finding, thread, catalogModels, runningIds, pinnedModel, models, location, freshVisitor, current, selectedModel,
    execution, usable, settling, blocked, sendMode, busy, ready, invite, guest, inviteJoined, sheetModel, sheetChoice }) {
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
    // The reviewed download of this model to this device: the next action only when the person chose this device; on
    // any other route an optional recovery once nothing answered. It never starts by itself.
    const localEligible = !!session.downloadLocalModel && !state.localDownloadIssue && !usable && !localPreparing && !busyAcquisition(state)
      && !requestedModel?.fleet && isDownloadableBaseModel(requestedModel) && !publicCanAnswer && !blocked;
    const canAcquire = localEligible && location === 'local' && (phase === 'observed' || !freshVisitor || exhausted);
    const optionalDownload = localEligible && location !== 'local' && phase === 'observed' && !thread?.closed && !busy && !held();
    const acquisition = state.acquisition;
    let acquisitionText = acquiring ? acquisition.progress?.message || 'Checking model files.'
      : ['failed', 'cancelled'].includes(acquisition?.phase) ? acquisition.error || '' : '';
    if (acquiring && execution.source === 'network' && execution.status === 'ready') acquisitionText += ' Network model ready.';
    const progress = !acquiring ? null : acquisition?.progress?.totalBytes && acquisition.progress.receivedBytes !== null
      ? { value: acquisition.progress.receivedBytes, max: acquisition.progress.totalBytes } : { value: null, max: null };
    const privacy = explicitPrivacy(state);
    const privacyDisabled = busy || !!thread?.closed;
    const named = namedPrivacyPreset(privacy, presetContext(state));
    const shared = !busy && !usable && !preparing && !thread?.closed && !acquiring ? recoverySharedModel(state, current, location, privacy) : null;
    let statusText = '';
    if (!busy) {
      if (state.history?.mode === 'refused' && historyHandover) statusText = '';
      else if (thread?.closed) statusText = 'Restore this thread to continue.';
      else if (settling) statusText = 'Finding computers…';
      else if (usable) {
        if (execution.source === 'network') statusText = execution.status === 'busy' ? 'Waiting for capacity.' : creditCapText(selectedModel);
        else if (execution.status === 'cached') statusText = 'Model downloaded.';
      } else if (preparing) statusText = state.localModel?.progress?.message || 'Model preparing…';
      else if (blocked) statusText = `${OWN_DESKTOP_TITLE} is offline. Open Reploid on ${OWN_DESKTOP}.`;
      else if (freshVisitor && phase === 'searching') statusText = 'Finding computers…';
      else if (location === 'local') statusText = state.localModel?.error || state.localDownloadIssue
        || (publicCanAnswer ? 'Not on this device. A public computer can answer.' : 'Model not downloaded yet.');
      else if (phase === 'paused') statusText = 'Network paused.';
      else if (phase === 'searching') statusText = 'Finding computers…';
      else if (!waitsForAnyModel(state) && phase === 'observed') statusText = 'No eligible computer found for this model.';
      if (statusText && !usable && !blocked && location !== 'local' && state.localDownloadIssue && !shared && !canAcquire && exhausted) statusText += ' ' + state.localDownloadIssue;
    }
    if (!busy && searching() && !thread?.closed && !state.storageError) {
      const personal = webSearch?.enabled() ? webSearch.state() : null;
      const recipient = webSearchRecipient({ personalRecipient: personal?.url ? personal.recipient : null, route: searchRouteNow(), provider: search?.state?.().provider });
      statusText = [statusText, recipient ? `Web search sends your question to ${recipient}.` : 'Web search recipient is not confirmed.'].filter(Boolean).join(' ');
    }
    const disclosure = promptDisclosure({ site: 'composer', computation: privacy.computation,
      local: privacy.recipients.kind === 'none' && !usable || location === 'local' || execution.usable && execution.source === 'local' && !blocked,
      operator: pairedOperator(state), named: privacy.recipients.kind === 'named', stages: !!selectedModel?.partition,
      usable, pool: !!selectedModel?.fleet });
    // While a Send is held, the composer names what it waits for: capacity on the model shown, or a computer for it.
    const expired = intents.state().expired;
    const expiredShown = !held() && !!expired && expired.intentId !== dismissedExpiry && !usable;
    if (expiredShown) statusText = 'No computer answered in 30 seconds. Nothing was sent.';
    if (held()) statusText = usable && !ready ? 'Waiting for capacity.'
      : waitsForAnyModel(state) ? 'Finding computers…' : `Waiting for a computer running ${modelVariantLabel(selectedModel)}…`;
    const detailModel = sheet.open ? sheetModel : requestedModel;
    const cells = state.answerLimits?.find(entry => entry.selectionId === modelKey(detailModel || {}))?.cells || [];
    const bounds = [...new Map(cells.map(cell => [cell.maxPromptTokens + '/' + cell.maxAnswerTokens, cell])).values()].sort((a, b) => a.maxPromptTokens - b.maxPromptTokens);
    const configuredAnswerTokens = catalogModels.find(model => model.id === detailModel?.id && !model.partition)?.generation?.maxTokens;
    const answerLimit = bounds.length ? 'Route limits: ' + bounds.map(cell => `${cell.maxAnswerTokens} answer tokens for up to ${cell.maxPromptTokens} input tokens`).join('; ')
      + '. Input includes conversation history. Answers reaching the limit are incomplete.'
      : Number.isSafeInteger(configuredAnswerTokens) ? `Answer limit: ${configuredAnswerTokens} tokens. Answers reaching the limit are incomplete.` : '';
    const activeModel = selectedModel || pinnedModel || models.find(model => modelKey(model) === current)
      || catalogModels.find(model => modelKey(model) === current) || requestedModel;
    // The one resolved route: where the request goes, whether it can go now, and what Send does. The placeholder,
    // the chip, the disclosure, the status line and the next action all read it.
    const lockedHost = lockedDestination(state), destination = currentRoute(state);
    const runsHereNow = destination === 'device' || location === 'local' || execution.usable && execution.source === 'local' && !blocked;
    const findingFirst = settling || (freshVisitor || waitsForAnyModel(state)) && !(thread?.model || choice.model) && phase === 'searching' && !execution.usable;
    const computerName = runsHereNow ? 'This device' : destination === 'desktop' ? (lockedHost?.guest ? lockedHost.label : OWN_DESKTOP_TITLE)
      : destination === 'named' ? 'Named computers' : selectedModel?.fleet ? execution.label : 'Contributors';
    const availability = blocked ? 'unavailable' : settling ? 'waiting' : execution.usable ? 'ready' : preparing || phase === 'searching' ? 'waiting' : 'unavailable';
    const route = Object.freeze({
      destination: runsHereNow ? 'device' : destination === 'desktop' ? (lockedHost?.guest ? 'invited' : 'desktop') : destination,
      computer: computerName, restricted: destination === 'desktop' && !lockedHost?.guest,
      status: held() ? 'queued' : blocked ? 'blocked' : usable && !settling ? 'ready' : availability === 'waiting' ? 'waiting' : 'unavailable',
      send: busy || thread?.closed ? 'none' : sendDisabled ? 'none' : sendMode
    });
    const availabilityText = { ready: 'Ready', waiting: preparing ? 'Loading' : 'Finding computers', unavailable: 'Unavailable' }[availability];
    const modelDigest = findingFirst ? '' : activeModel ? `${computerName} · ${modelVariantLabel(activeModel)}` : '';
    // An invite link offers one action: join that computer. Until it is joined, nothing can be sent anywhere.
    const joiningHost = !!invite && guest?.status === 'joining';
    let statusHidden = !statusText || !!acquisitionText;
    if (held() || expiredShown) statusHidden = false;
    if (acquisitionText && !held()) statusHidden = true;
    if (invite && !inviteJoined) {
      statusHidden = false; acquisitionText = '';
      statusText = joiningHost ? `Connecting to ${guest.hostLabel}…` : guest?.error || 'Invited. Join to send messages to this computer.';
    }
    const nextActions = [
      ['join', !!invite && !inviteJoined && !joiningHost],
      ['cancel-download', acquiring],
      ['cancel-queued', !!held()],
      ['review-shared', !!shared],
      ['network-opt-in', !busy && !usable && !preparing && !acquiring && !thread?.closed
        && (publicCanAnswer || (!!thread && (privacy.placement === 'local-only' || privacy.recipients.kind === 'none')))],
      ['download-local', !busy && canAcquire && !thread?.closed],
      ['retry', !busy && !usable && !preparing && location !== 'local' && phase === 'paused' && !thread?.closed]
    ];
    const nextAction = nextActions.find(([, eligible]) => eligible)?.[0] ?? null;
    const optionalAction = optionalDownload && nextAction !== 'download-local' && nextAction !== 'cancel-download' ? 'download-local' : null;
    const startingHidden = !!(thread?.messages.length || thread?.closed || runningIds.includes(thread?.id) || state.comparisonPhase);
    const searchVisible = searchAvailable();
    const composer = {
      draft: draftText, files: files.map(file => ({ name: file.name, size: file.size ?? file.text?.length ?? 0 })), attachmentsPending: attachmentReader.pending,
      attachmentHelp: attachmentHelp || files.length > 0, attachmentHelpText: ATTACHMENT_HELP,
      placeholder: !activeModel || findingFirst || route.status !== 'ready' ? 'Message…' : computerName === 'Contributors' ? 'Message a contributor…'
        : computerName === OWN_DESKTOP_TITLE ? `Message ${OWN_DESKTOP}…` : `Message ${computerName}…`,
      send: { visible: !busy, disabled: sendDisabled, mode: route.send },
      route,
      // Stop stays reachable when the reader scrolls away from the active answer; the transcript row has its own.
      stop: { visible: busy },
      // The host's held Send, as it reports it: held until `expiresAt`, or expired with nothing sent.
      sendIntent: held() ? { status: 'held', expiresAt: intents.state().intent.expiresAt }
        : intents.state().expired ? { status: 'expired', expiresAt: intents.state().expired.expiredAt } : null,
      chip: {
        visible: models.length > 0, caption: !activeModel, findingFirst,
        // The selection the composer would send with now (the vanilla page's hidden model select).
        selectionId: current || null,
        source: findingFirst ? '' : activeModel ? computerName : '',
        name: findingFirst ? 'Finding computers…' : activeModel ? modelVariantLabel(activeModel) : '',
        availability, label: modelDigest ? `Answer on ${modelDigest}, ${availabilityText}` : findingFirst ? 'Answer on, Finding computers' : 'Answer on',
        activity: execution.status === 'ready' && !blocked && !settling ? 'ready' : 'idle', executionSource: execution.source
      },
      // The chip beside "Answer on" always names the thread's protection (and "Your devices" when it runs only there).
      privacy: { label: `Who can read it: ${named.label}`, caption: named.label, disabled: privacyDisabled },
      search: { visible: searchVisible, pressed: searching() },
      status: { text: statusHidden ? '' : statusText },
      acquisition: { text: acquisitionText, progress },
      nextAction,
      optionalAction,
      nextLabels: {
        join: invite ? `Join ${describeCircleHost(invite.hostLabel, invite.hostPeerId).hostLabel}` : 'Join',
        reviewShared: shared ? `Review ${modelVariantLabel(shared)}` : '',
        downloadLocal: ['failed', 'cancelled'].includes(acquisition?.phase) ? 'Retry download' : 'Download model',
        retry: 'Reconnect',
        retryPending: !!retryPending
      },
      disclosure: thread?.closed ? '' : disclosure,
      routeAlternatives: held() ? [] : routeAlternatives({ current: currentRoute(state), model: requestedModel, desktop: pairedDesktop(state), busy,
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
    if (!content || attachmentReader.pending || submitting() || (state.runningIds || []).includes(state.selectedId)) return;
    if (intent ? !readyForQueuedSend(state, intent) : sendDisabled) return;
    const model = state.models.find(item => modelKey(item) === currentKey);
    if (!intent && !state.activeThread && viewState.privacy === undefined && !viewState.privacyTouched && !lockedDestination(state)
      && !modelExecutionState(model, effectiveLocation(state)).usable
      && !(finding && canWaitForPublicModel(state, model, effectiveLocation(state)))) {
      openDestination({ forSend: true });
      return;
    }
    if (!intent && (provisionalChoice(state) || finding && !modelExecutionState(model, effectiveLocation(state)).usable)
      && canWaitForPublicModel(state, model, effectiveLocation(state))) {
      // The host records the intent for the current selection; nothing else is created until a route is ready.
      reportSelection(state);
      let created;
      try { created = intents.hold({ threadId: state.selectedId ?? null }); } catch { return; }
      send = { kind: 'held', intentId: created.intentId, scope: queueScope(state, model), scheduled: false };
      notify();
      return;
    }
    const pinned = state.activeThread?.model || (waitsForAnyModel(state) ? null : choice.model || viewState.draftModel);
    if (!model || pinned?.identity && modelIdentity(model) !== modelIdentity(pinned)) return;
    // Right before dispatch the host checks the intent's deadline, selection revision and pinned artifact; a refusal
    // dispatches and creates nothing, and the typed text stays.
    if (intent) {
      const refusal = intents.claim(intent.intentId, { model, threadId: state.selectedId ?? null });
      if (refusal) { send = IDLE; notify(); return; }
    }
    const location = intent ? 'network' : effectiveLocation(state);
    const searched = searching();
    if (searched && files.length) { error("Search-backed answers don't include files. Remove the files or turn off search for this answer."); return; }
    send = SUBMITTING;
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
        endSubmit(); notify(); await completion;
      } finally { endSubmit(); notify(); }
    };
    notify();
    void dispatch().catch(error);
  }

  const openPicker = (alternative = null) => {
    pickerRevision++;
    dropHold();
    recoverySelection = alternative;
    pickerTouched = !!alternative;
    pickerModelImplied = false;
    const state = sessionState;
    // The sheet opens on the current model. It is a pick only if the person picked it earlier, or picks one here.
    pickerPicked = !state.activeThread && !!choice.model && !choice.automatic;
    pickerModel = alternative || (state.models || []).find(model => modelKey(model) === currentKey)
      || state.activeThread?.model || choice.model || state.defaultModel || null;
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
        setChosen(model, !picked); choice.remembered = null; choice.waiting = false;
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
    blocked: () => submitting() || privacyDisabledNow(),
    beforeOpen: () => { dropHold(); if (sheet.open) sheet = { open: false, title: 'Answer on' }; },
    setDraftLocation: location => { executionLocation = viewState.executionLocation = location; } });

  // ---- the Threads list (threads.js) ----
  const threadList = createThreadList({ session, getState: () => sessionState, notify, now, act, requestFocus, saveDraft, viewState,
    disposed: () => disposed });

  // ---- the reviewed download (download-dialog.js) ----
  const downloads = createDownloadDialog({ session, getState: () => sessionState, notify, requestFocus, act,
    sheetOpen: () => sheet.open, disposed: () => disposed });

  const unsubscribe = session.subscribe(state => { sessionState = state; notify(); });
  // The host's intents change on their own (expiry); the page re-reads after the change that caused it returns.
  const unsubscribeIntents = intents.subscribe(() => queueMicrotask(notify));
  const unsubscribeSearch = search && session.searchPermissionRequest ? search.subscribe(() => notify()) : () => {};
  if (search && search.state().state === 'unknown') void search.refresh();
  const unsubscribeWebSearch = webSearch ? webSearch.subscribe(state => {
    searchOn = state.enabled && (!!state.url || !!search?.available() || deviceSearchOn());
    notify();
  }) : () => {};
  snapshot = project(advance());

  const thread = () => sessionState.activeThread;
  const approval = createRemoteApproval({ session, thread, act });
  const api = {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    /** The draft text as typed: it pins the model a new thread starts with and drops a queued Send. */
    setDraft(text) {
      draftText = text; composerRevision++;
      // The expired held Send's notice stays until the person edits the text it kept.
      dismissedExpiry = intents.state().expired?.intentId ?? dismissedExpiry;
      if (text.trim()) pinDraftModel(sessionState);
      dropHold();
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
    toggleSearch() { dropHold(); searchOn = !searching(); notify(); },
    send() { submitDraft(); },
    stop() { void act(() => session.cancel(sessionState.selectedId)); },
    cancelQueuedSend() { dropHold(); notify(); },
    retryConnection() {
      dismissedExpiry = intents.state().expired?.intentId ?? dismissedExpiry;
      dropHold(); retryPending = true; notify();
      clearTimeout(retryDeadline);
      const deadline = retryDeadline = setTimeout(() => { retryPending = false; notify(); }, 8000);
      void Promise.resolve().then(() => session.connect()).catch(cause => error(cause.message))
        .finally(() => { clearTimeout(deadline); retryPending = false; notify(); });
    },
    cancelDownload() { session.cancelModelDownload?.(); },
    downloadLocal() {
      const state = sessionState;
      const model = state.activeThread?.model || (state.models || []).find(item => modelKey(item) === currentKey) || choice.model || state.defaultModel;
      if (model) {
        if (sheet.open) closePicker();
        downloads.open(modelKey(model));
      }
    },
    reviewSharedModel() {
      const alternative = recoveryAlternative(sessionState);
      if (alternative) { openPicker(alternative); notify(); }
    },
    reviewNetworkExecution() { openDestination({ forSend: true }); },
    takeRouteAlternative(key) {
      pickerChoice = null;
      void act(async () => {
        await applyDestination(key);
        if (sheet.open) closePicker();
        requestFocus('composer'); notify();
      });
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
    pickComputer(computer) {
      const current = sessionState;
      if (computer === 'desktop' && !desktopRecipient(current)) { error('That desktop is no longer available. Nothing was changed.'); return; }
      pickerTouched = true; pickerRevision++;
      pickerLocation = computer === 'local' ? 'local' : 'network';
      pickerChoice = computer === 'local' ? 'device' : computer === 'desktop' ? 'desktop' : 'contributors';
      stagedDestination = null;
      pickerModelImplied = computer !== 'desktop';
      const kept = pickerModel;
      if (computer !== 'desktop') pickerModel = modelForLocation(current.models, pickerModel, pickerLocation, { state: current, canDownload });
      // A model that came with the computer is not the person's pick.
      if (modelKey(pickerModel) !== modelKey(kept)) pickerPicked = false;
      if (computer === 'network' && blockFor(current)) { notify(); return; }
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
      dropHold();
      try {
        observe(after(saveDraft(), () => after(session.select(null), () => {
          // A pick carries to the new thread; an automatic choice is made again from what is available.
          if (choice.model && !choice.automatic) choice.remembered = answerChoiceOf(choice.model, null, true);
          setChosen(null); choice.waiting = false; threadList.showCurrent();
          requestFocus('composer'); notify();
        })));
      } catch (cause) { error(cause); }
    },
    selectThread(id) {
      dropHold();
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
      dropHold();
      disposed = true;
      clearTimeout(retryDeadline);
      fitRequest?.abort(); downloads.dispose(); attachmentReader.close(); threadList.dispose();
      unsubscribe(); unsubscribeIntents(); ownIntents?.close(); unsubscribeSearch(); unsubscribeWebSearch(); listeners.clear();
    }
  };
  return api;
}
