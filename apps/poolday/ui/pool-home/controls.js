import { createPeerRunSession, supportsLocalRequest, canOfferLocalFallback } from '../../host/peer-run-session.js';
import { createProviderContributionSession } from '../../host/provider-contribution-session.js';
import { assessPoolDeviceCapability } from '../../host/device-capability.js';
/**
 * @fileoverview Route control bindings for the Reploid product home.
 */

import { adapterRequirementFromPublication } from '../../pool/adapter-publication.js';
import { resolveFetchableAdapterPublication } from '../../pool/adapter-registry.js';

import { LAUNCH_MODEL, POOLDAY_MODEL_WORKLOADS, getEnabledPoolModelContract, getPoolModelWorkload, listPoolModels } from '../../../../shared/pool/model-contract.js';
import { createPoolIdentity } from '../../../../shared/pool/identity.js';
import { PARTICIPATION_MODES, readParticipationPreferences, writeParticipationPreferences } from '../../../../shared/pool/participation-profile.js';
import { FASTEST_RECEIPT_POLICY_ID, listPolicies } from '../../pool/policy-router.js';

import { createPoolSdk, verifyReceiptRecord } from '../../../../shared/pool/sdk.js';

import { SEQUENCE_ALPHABETS, SEQUENCE_PUBLIC_SENSITIVITY, getMaxPublicSequenceLength, normalizeSequenceInput, isSequenceWorkload } from '../../../../shared/pool/sequence-workload.js';
import { createSignedResearchResult, createSignedResearchSubmission } from '../../pool/evidence-network.js';
import { addReceiptLedgerRow, clearPoolRoomDraft, describeSelectedRun, findReceiptLedgerRecord, getPeerInviteUrl, getPeerRelayMode, getPeerRoomId, refreshContributionStatusBar, refreshProviderStorageHealth, refreshRecordTimelineState, refreshRoomActivityState, recordPeerLedgerEvents, restorePoolRecordDisclosures, renderReceiptLedger, setPoolRecordDisclosureOpen, setPoolRecordFacet, setPoolRunVisualState, setResearchPublicationStatus, setResult, updateProviderHealth, updateProviderNotice, updateProviderStatus } from './view.js';
import { recordContributionReceipt, updateContributionState } from './contribution-state.js';
import { choosePooldayAskPlaceholderForLane } from './constants.js';
import { publishResearchRecord } from './research-store.js';

const errorString = (error) => String(error?.message || error?.error || error || 'Unknown error');
const POOL_ROOM_ACTIVITY_POLL_MS = 5000;
const POOL_SEQUENCE_PUBLIC_CONSENT_KEY = 'reploid.pool.sequence-public-consent.v1';
export { POOL_CONTRIBUTION_RESUME_STORAGE_KEY } from '../../host/contribution-resume.js';
export const POOL_PENDING_REQUEST_STORAGE_KEY = 'reploid.pool.pending-request.v1';
const POOL_PENDING_REQUEST_VERSION = 1;
const POOL_PENDING_REQUEST_TTL_MS = 15 * 60 * 1000;
const policyGuaranteesIndependentExecution = (policy = {}) => (
  Number(policy.redundancy || 0) >= 2
  || Number(policy.minRingSize || 0) >= 2
);

const pendingRequestIsRecoverable = (record, { navigationType = pageIdentityNavigationType() } = {}) => {
  if (!record || typeof record !== 'object') return false;
  if (navigationType !== 'reload' && navigationType !== 'back_forward') return false;
  if (record.version !== POOL_PENDING_REQUEST_VERSION || record.lane !== 'sequence') return false;
  if (record.sensitivity !== SEQUENCE_PUBLIC_SENSITIVITY || typeof record.sequence !== 'string' || !record.sequence.trim()) return false;
  if (record.roomId !== getPeerRoomId() || record.relay !== getPeerRelayMode()) return false;
  const startedAt = Date.parse(record.startedAt || '');
  return Number.isFinite(startedAt) && Date.now() - startedAt >= 0 && Date.now() - startedAt <= POOL_PENDING_REQUEST_TTL_MS;
};

const readPendingRequestRecovery = () => {
  try {
    const record = JSON.parse(window.sessionStorage?.getItem(POOL_PENDING_REQUEST_STORAGE_KEY) || 'null');
    if (pendingRequestIsRecoverable(record)) return record;
    window.sessionStorage?.removeItem(POOL_PENDING_REQUEST_STORAGE_KEY);
  } catch {
    try {
      window.sessionStorage?.removeItem(POOL_PENDING_REQUEST_STORAGE_KEY);
    } catch {
      // A malformed recovery record must not prevent the current page from loading.
    }
  }
  return null;
};

const writePendingRequestRecovery = (request) => {
  if (
    request?.lane !== 'sequence'
    || request?.sequenceRequest?.sensitivity !== SEQUENCE_PUBLIC_SENSITIVITY
    || typeof request.sequence !== 'string'
    || !request.sequence.trim()
  ) return;
  const record = {
    version: POOL_PENDING_REQUEST_VERSION,
    lane: 'sequence',
    sequence: request.sequence,
    selectedModelId: request.selectedModel?.modelId || null,
    policyId: request.policyId || FASTEST_RECEIPT_POLICY_ID,
    researchSubmission: request.researchSubmission || null,
    roomId: getPeerRoomId(),
    relay: getPeerRelayMode(),
    sensitivity: SEQUENCE_PUBLIC_SENSITIVITY,
    startedAt: new Date().toISOString()
  };
  try {
    window.sessionStorage?.setItem(POOL_PENDING_REQUEST_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // The current run continues, but a reload cannot offer restoration.
  }
};

const clearPendingRequestRecovery = () => {
  try {
    window.sessionStorage?.removeItem(POOL_PENDING_REQUEST_STORAGE_KEY);
  } catch {
    // The in-memory request state remains valid for the current page.
  }
};

const readSequencePublicConsent = () => {
  try {
    return window.localStorage?.getItem(POOL_SEQUENCE_PUBLIC_CONSENT_KEY) === 'true';
  } catch {
    return false;
  }
};

const writeSequencePublicConsent = () => {
  try {
    window.localStorage?.setItem(POOL_SEQUENCE_PUBLIC_CONSENT_KEY, 'true');
  } catch {
    // Consent still applies to the current page when storage is unavailable.
  }
};

const syncSequencePublicConsent = (control) => {
  if (!control) return;
  if (readSequencePublicConsent()) control.checked = true;
  const acknowledged = control.checked === true;
  const row = control.closest('[data-pool-sequence-consent-row]');
  const saved = document.querySelector('[data-pool-sequence-consent-saved]');
  if (row) row.hidden = acknowledged;
  if (saved) saved.hidden = !acknowledged;
};

const displayPoolError = (error, {
  title = 'Request failed',
  action = 'Check the details below, then try the operation again.',
  context = {}
} = {}) => ({
  status: 'error',
  error: title,
  reason: errorString(error),
  code: error?.code || error?.payload?.code || null,
  retryable: error?.retryable ?? error?.payload?.retryable ?? null,
  action: error?.payload?.action || error?.action || action,
  transportDiagnostics: error?.diagnostics || error?.payload?.diagnostics || null,
  ...context,
  payload: error?.payload || null
});

const formatDeviceLabel = (deviceInfo = {}) => {
  const adapter = deviceInfo.adapterInfo || {};
  return [
    adapter.vendor,
    adapter.architecture,
    adapter.device
  ].filter(Boolean).join(' / ') || deviceInfo.probeStatus || 'unknown';
};

const pageIdentityNavigationType = (performanceRef = globalThis.performance) => {
  try {
    return performanceRef?.getEntriesByType?.('navigation')?.[0]?.type || null;
  } catch {
    return null;
  }
};

export const getPageIdentityNamespace = (globalKey, {
  windowRef = window,
  navigationType = pageIdentityNavigationType()
} = {}) => {
  if (windowRef[globalKey]) return windowRef[globalKey];
  const storageKey = `reploid.pool.page-identity.${globalKey}`;
  try {
    const stored = windowRef.sessionStorage?.getItem(storageKey);
    // sessionStorage is copied when a tab is duplicated or opened by an
    // opener. Restore only after a reload/history traversal so a copied tab
    // cannot impersonate the source tab's ephemeral role namespace.
    if (stored && (navigationType === 'reload' || navigationType === 'back_forward')) {
      windowRef[globalKey] = stored;
      return stored;
    }
  } catch {
    // A memory-only identity namespace remains valid for the current page.
  }
  const id = windowRef.crypto?.randomUUID
    ? windowRef.crypto.randomUUID()
    : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  windowRef[globalKey] = `page_${id}`;
  try {
    windowRef.sessionStorage?.setItem(storageKey, windowRef[globalKey]);
  } catch {
    // A memory-only identity namespace remains valid for the current page.
  }
  return windowRef[globalKey];
};

const getProviderIdentityNamespace = () => getPageIdentityNamespace('REPLOID_POOL_PROVIDER_NAMESPACE');
const getRequesterIdentityNamespace = () => getPageIdentityNamespace('REPLOID_POOL_REQUESTER_NAMESPACE');
const participationIdentity = createPoolIdentity('requester', {
  localOnly: true,
  namespace: 'network_participation'
});

const canRequestWith = (preferences) => (
  preferences.mode === PARTICIPATION_MODES.request || preferences.mode === PARTICIPATION_MODES.both
);
const canContributeWith = (preferences) => (
  preferences.mode === PARTICIPATION_MODES.contribute || preferences.mode === PARTICIPATION_MODES.both
);

const requestControlAvailability = new WeakMap();

const setRequestControlParticipation = (control, canRequest) => {
  if (!canRequest) {
    if (!requestControlAvailability.has(control)) {
      requestControlAvailability.set(control, control.disabled);
    }
    control.disabled = true;
    return;
  }
  if (!requestControlAvailability.has(control)) return;
  control.disabled = requestControlAvailability.get(control);
  requestControlAvailability.delete(control);
};

const shortIdentity = (identity = {}) => {
  const value = String(identity.identityRootId || identity.deviceId || '');
  const fingerprint = value.replace(/^[^_]+_/, '');
  return fingerprint ? `ID ${fingerprint.slice(0, 6)}…${fingerprint.slice(-4)}` : 'Identity unavailable';
};

export const refreshParticipationControls = async (preferences = readParticipationPreferences()) => {
  const canRequest = canRequestWith(preferences);
  const canContribute = canContributeWith(preferences);
  document.documentElement.dataset.poolParticipationMode = preferences.mode;
  document.body.dataset.poolParticipationMode = preferences.mode;
  document.querySelectorAll('[data-pool-participation]').forEach((surface) => {
    surface.dataset.participationMode = preferences.mode;
  });
  document.querySelectorAll('[data-pool-participation-mode]').forEach((button) => {
    const active = button.dataset.poolParticipationMode === preferences.mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-pool-request-control], [data-pool-run-surface="run"] input, [data-pool-run-surface="run"] textarea, [data-pool-run-surface="run"] select, [data-pool-run-surface="run"] button').forEach((control) => {
    if (control.closest('[data-pool-participation]')) return;
    setRequestControlParticipation(control, canRequest);
  });
  document.querySelectorAll('.pool-home-ask-dock').forEach((form) => {
    form.hidden = Boolean(form.closest('.pool-home-task')?.querySelector('[data-pool-workflow="documents"][aria-pressed="true"]'));
  });
  document.querySelectorAll('.pool-home-share-toggle').forEach((button) => {
    button.hidden = !canContribute;
  });
  const connectionSummary = document.querySelector('[data-pool-drawer-summary="network-connection"]');
  if (connectionSummary) {
    const modeLabel = preferences.mode === PARTICIPATION_MODES.both
      ? 'Both'
      : preferences.mode === PARTICIPATION_MODES.contribute
        ? 'Contribute'
        : 'Request';
    connectionSummary.textContent = `${getPeerRoomId()} · ${modeLabel}`;
  }
  try {
    const identity = await participationIdentity.getDeviceIdentity();
    document.querySelectorAll('[data-pool-device-identity]').forEach((element) => {
      element.textContent = shortIdentity(identity);
      element.dataset.identityProtection = identity.keyProtection;
      element.title = identity.keyProtection === 'passkey'
        ? 'Passkey-bound device identity'
        : identity.keyProtection === 'browser_non_exportable'
          ? 'Non-exportable browser device key'
          : 'Browser identity fallback; use a passkey for stronger protection';
    });
    document.querySelectorAll('[data-pool-passkey]').forEach((button) => {
      button.disabled = identity.keyProtection === 'passkey';
      button.textContent = identity.keyProtection === 'passkey'
        ? 'Passkey protected'
        : 'Protect identity with passkey';
    });
  } catch (error) {
    document.querySelectorAll('[data-pool-device-identity]').forEach((element) => {
      element.textContent = 'Identity unavailable';
      element.title = errorString(error);
    });
  }
  return preferences;
};

const updateParticipationPreference = async (nextPreferences) => {
  const previous = readParticipationPreferences();
  const next = writeParticipationPreferences(nextPreferences);
  await getProviderContributionController().applyParticipationPreferences(previous, next);
  await refreshParticipationControls(next);
  return next;
};

export const bindParticipationControls = () => {
  document.querySelectorAll('[data-pool-participation-mode]').forEach((button) => {
    if (button.dataset.poolParticipationBound === 'true') return;
    button.dataset.poolParticipationBound = 'true';
    button.addEventListener('click', () => {
      void updateParticipationPreference({
        ...readParticipationPreferences(),
        mode: button.dataset.poolParticipationMode
      });
    });
  });
  document.querySelectorAll('[data-pool-permission], [data-pool-limit]').forEach((control) => {
    if (control.dataset.poolParticipationBound === 'true') return;
    control.dataset.poolParticipationBound = 'true';
    control.addEventListener('change', () => {
      const current = readParticipationPreferences();
      const permissions = { ...current.permissions };
      const limits = { ...current.limits };
      if (control.dataset.poolPermission) permissions[control.dataset.poolPermission] = control.checked;
      if (control.dataset.poolLimit) {
        limits[control.dataset.poolLimit] = control.type === 'checkbox'
          ? control.checked
          : Number(control.value);
      }
      void updateParticipationPreference({ ...current, permissions, limits });
    });
  });
  document.querySelectorAll('[data-pool-passkey]').forEach((button) => {
    if (button.dataset.poolPasskeyBound === 'true') return;
    button.dataset.poolPasskeyBound = 'true';
    button.addEventListener('click', async () => {
      const status = button.closest('[data-pool-participation]')?.querySelector('[data-pool-passkey-status]');
      button.disabled = true;
      if (status) status.textContent = 'Waiting for passkey';
      try {
        await participationIdentity.enrollPasskey();
        if (status) status.textContent = 'Passkey bound to this device identity.';
      } catch (error) {
        if (status) status.textContent = errorString(error);
      } finally {
        await refreshParticipationControls();
      }
    });
  });
  void refreshParticipationControls();
};

export { POOL_DEVICE_CAPABILITY_TIERS, scorePoolDeviceCapability, resetPoolDeviceCapabilityForTests, resolveCapabilityAvailabilityLimits, assessPoolDeviceCapability } from '../../host/device-capability.js';

const formatMetric = (value, suffix, digits = 0) => (
  Number.isFinite(Number(value)) ? `${Number(value).toFixed(digits)}${suffix}` : '--'
);

const renderCapabilityProfileState = (root, profile) => {
  if (!root || !profile) return;
  root.dataset.capabilityState = profile.supported ? 'ready' : 'unsupported';
  const setText = (selector, value) => {
    const element = root.querySelector(selector);
    if (element) element.textContent = value;
  };
  setText('[data-pool-capability-tier]', profile.tier.label);
  setText('[data-pool-capability-score]', profile.supported ? `${profile.score}/100` : 'N/A');
  setText('[data-pool-capability-summary]', profile.summary);
  setText('[data-pool-capability-webgpu]', profile.supported ? 'Available' : 'Unavailable');
  setText('[data-pool-capability-buffer]', formatMetric(profile.maxBufferMiB, ' MiB'));
  setText('[data-pool-capability-kernel]', profile.measured ? formatMetric(profile.gigaOpsPerSecond, ' GOPS', 1) : 'Not measured');
  setText('[data-pool-capability-stability]', profile.measured ? `${Math.round(profile.stability * 100)}%` : '--');
  const meter = root.querySelector('[data-pool-capability-meter]');
  meter?.style.setProperty('--pool-param-capability-score', `${profile.score}%`);
  const models = root.querySelector('[data-pool-capability-models]');
  if (models) {
    models.replaceChildren();
    const eligible = profile.modelEligibility.filter((model) => model.eligible);
    const rows = eligible.length ? eligible : [{ label: 'Request from another contributor', eligible: false }];
    for (const model of rows) {
      const item = document.createElement('span');
      item.dataset.eligible = String(Boolean(model.eligible));
      item.textContent = model.label;
      models.append(item);
    }
  }
  const providerModel = document.getElementById('pool-provider-model');
  if (providerModel) {
    const previousModelId = providerModel.value;
    for (const option of providerModel.options) {
      const eligibility = profile.modelEligibility.find((entry) => entry.modelId === option.value);
      option.disabled = eligibility ? !eligibility.eligible : true;
      option.title = eligibility?.eligible
        ? `Qualified at ${profile.tier.label}`
        : eligibility?.reasons?.join('; ') || 'Not qualified by this device profile';
    }
    if (providerModel.selectedOptions[0]?.disabled) {
      const eligibleOption = [...providerModel.options].find((option) => !option.disabled);
      if (eligibleOption) providerModel.value = eligibleOption.value;
    }
    if (providerModel.value !== previousModelId) {
      providerModel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
};

export const bindCapabilityAssessmentControls = () => {
  const roots = [...document.querySelectorAll('[data-pool-capability-profile]')];
  if (!roots.length) return;
  const run = async (force = false) => {
    roots.forEach((root) => { root.dataset.capabilityState = 'checking'; });
    const profile = await assessPoolDeviceCapability({ force });
    roots.forEach((root) => renderCapabilityProfileState(root, profile));
  };
  roots.forEach((root) => {
    const rerun = root.querySelector('[data-pool-capability-rerun]');
    if (!rerun || rerun.dataset.poolCapabilityBound === 'true') return;
    rerun.dataset.poolCapabilityBound = 'true';
    rerun.addEventListener('click', () => void run(true));
  });
  void run(false);
};

const setControlDrawerOpen = (open) => {
  const rail = document.querySelector('.pool-control-drawer');
  const toggle = rail?.querySelector('.pool-nav-toggle');
  if (!rail || !toggle) return;
  if (rail.classList.contains('is-open') !== open) {
    toggle.click();
  }
};

const POOL_DRAWER_SECTION_STATE_KEY = 'reploid.pool.drawerSections.v1';

const readDrawerSectionState = () => {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(POOL_DRAWER_SECTION_STATE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeDrawerSectionState = (state) => {
  try {
    globalThis.localStorage?.setItem(POOL_DRAWER_SECTION_STATE_KEY, JSON.stringify(state));
  } catch {
    // Disclosure remains usable when browser storage is unavailable.
  }
};

const bindDrawerSections = () => {
  const state = readDrawerSectionState();
  document.querySelectorAll('details[data-pool-drawer-section]').forEach((section) => {
    const id = section.dataset.poolDrawerSection;
    if (typeof state[id] === 'boolean') section.open = state[id];
    if (section.dataset.poolDrawerSectionBound === 'true') return;
    section.dataset.poolDrawerSectionBound = 'true';
    section.querySelector(':scope > summary')?.addEventListener('click', (event) => {
      // Clicking a collapsed section expands the single control rail and opens it.
      const rail = section.closest('.pool-nav-rail');
      if (rail && !rail.classList.contains('is-open')) {
        const toggle = rail.querySelector('.pool-nav-toggle');
        toggle?.click();
        section.open = true;
        event.preventDefault();
        return;
      }
      const next = readDrawerSectionState();
      next[id] = !section.open;
      writeDrawerSectionState(next);
    });
    section.addEventListener('toggle', () => {
      const next = readDrawerSectionState();
      next[id] = section.open;
      writeDrawerSectionState(next);
    });
  });
};

export const applyPoolDashboardView = (view = 'home', { updateHistory = true } = {}) => {
  const normalized = ['home', 'ask', 'compute', 'records'].includes(view) ? view : 'home';
  const stage = document.querySelector('.pool-home-stage');
  if (!stage) return normalized;
  stage.dataset.poolDashboardView = normalized;
  document.querySelectorAll('.pool-nav-link[data-pool-dashboard-view]').forEach((control) => {
    const active = control.dataset.poolDashboardView === normalized;
    control.classList.toggle('is-active', active);
    if (active) control.setAttribute('aria-current', 'page');
    else control.removeAttribute('aria-current');
  });
  if (normalized === 'ask') document.getElementById('pool-home-ask-prompt')?.focus();
  if (normalized === 'compute' || normalized === 'records') setControlDrawerOpen(true);
  if (updateHistory) {
    const url = new URL(window.location.href);
    if (normalized === 'home') url.searchParams.delete('view');
    else url.searchParams.set('view', normalized);
    window.history.pushState({ reploidPoolDashboardView: normalized }, '', `${url.pathname}${url.search}`);
  }
  return normalized;
};

export const bindPoolDashboardControls = () => {
  bindDrawerSections();
  document.querySelectorAll('.pool-nav-link[data-pool-dashboard-view], [data-pool-dashboard-view-target]').forEach((control) => {
    if (control.dataset.poolDashboardBound === 'true') return;
    control.dataset.poolDashboardBound = 'true';
    control.addEventListener('click', (event) => {
      event.preventDefault();
      applyPoolDashboardView(control.dataset.poolDashboardView || control.dataset.poolDashboardViewTarget || 'home');
    });
  });
  if (window.REPLOID_POOL_INSPECTOR_ESCAPE_HANDLER) {
    window.removeEventListener('keydown', window.REPLOID_POOL_INSPECTOR_ESCAPE_HANDLER);
    window.REPLOID_POOL_INSPECTOR_ESCAPE_HANDLER = null;
  }
};

const bindSuggestedPromptEditing = (input) => {
  if (!input || input.dataset.poolSuggestedPromptBound === 'true') return;
  input.dataset.poolSuggestedPromptBound = 'true';
  const intervalId = setInterval(() => {
    if (!document.body.contains(input)) {
      clearInterval(intervalId);
      return;
    }
    if (document.activeElement !== input && !input.value.trim()) {
      const lane = document.querySelector('.pool-home-stage')?.dataset.poolLane || 'sequence';
      const nextPrompt = choosePooldayAskPlaceholderForLane(lane);
      input.placeholder = nextPrompt;
      input.dataset.poolSuggestedPrompt = nextPrompt;
    }
  }, 4000);
};

const refreshServerRoomActivity = async (isActive = () => true) => {
  const activity = document.getElementById('pool-room-activity');
  const networkState = document.querySelector('[data-pool-network-state]');
  if (!activity && !networkState) return null;
  if (getPeerRelayMode() === 'local') {
    if (isActive()) refreshRoomActivityState();
    return null;
  }
  try {
    const summary = await createPoolSdk({ authTokenProvider: null }).peerRoomSummary(getPeerRoomId(), { limit: 100 });
    if (isActive()) refreshRoomActivityState(summary);
    return summary;
  } catch (error) {
    if (isActive()) refreshRoomActivityState({ error: errorString(error) });
    return null;
  }
};

export const bindRoomActivityControls = () => {
  window.REPLOID_POOL_ROOM_ACTIVITY_STOP?.();
  if (!document.getElementById('pool-room-activity') && !document.querySelector('[data-pool-network-state]')) return;
  let active = true;
  let refreshing = false;
  const refresh = async () => {
    if (!active || refreshing || document.visibilityState === 'hidden') return;
    refreshing = true;
    try {
      await refreshServerRoomActivity(() => active);
    } finally {
      refreshing = false;
    }
  };
  const intervalId = window.setInterval(() => void refresh(), POOL_ROOM_ACTIVITY_POLL_MS);
  window.REPLOID_POOL_ROOM_ACTIVITY_STOP = () => {
    active = false;
    window.clearInterval(intervalId);
    if (window.REPLOID_POOL_ROOM_ACTIVITY_STOP) window.REPLOID_POOL_ROOM_ACTIVITY_STOP = null;
  };
  void refresh();
};

const RUN_ACTIVITY_COPY = Object.freeze({
  peer_run_intent_created: 'Request signed',
  peer_provider_discovery_started: 'Finding compatible contributor tabs',
  peer_assignment_planned: 'Contributor tabs matched',
  'relay-publish-retrying': 'Retrying relay publish',
  'relay-poll-failed': 'Relay delayed — retrying',
  'relay-dispatch-retrying': 'Retrying local message delivery',
  'relay-dispatch-recovered': 'Message delivery recovered',
  'relay-circuit-open': 'Relay unavailable — retrying shortly',
  'relay-circuit-half-open': 'Checking relay recovery',
  'relay-circuit-closed': 'Relay connection recovered',
  peer_inference_started: 'Contributor tabs are answering',
  peer_provider_queued: 'Request queued behind existing contributor work',
  peer_provider_execution_started: 'Contributor started this request',
  peer_transport_retrying: 'Retrying through relay transport',
  peer_receipts_received: 'Checking returned receipts',
  peer_agreement_verified: 'Agreement verified',
  peer_run_completed: 'Answer verified',
  peer_run_failed: 'Run needs attention'
});

const createSelectOption = (label, value = '') => {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
};

const resolveSelectedAdapter = async (adapterSelect, model, { required = false } = {}) => {
  const packHash = String(adapterSelect?.value || '').trim();
  if (!packHash) {
    if (required) throw new Error('Select a published adapter pack before running the adapter lane');
    return null;
  }
  const publication = await resolveFetchableAdapterPublication({
    sdk: createPoolSdk(),
    packHash,
    model
  });
  return adapterRequirementFromPublication(publication, { state: 'fetchable' });
};

const bindPeerRunSurface = ({
  button,
  prompt,
  form = null,
  policySelect = null,
  modelSelect = null,
  adapterSelect = null,
  adapterRequired = () => false,
  sequencePublicControl = null,
  researchPublicControl = null,
  intentKindControl = null,
  intentLabelControl = null,
  intentTextControl = null,
  intentConditionsControl = null,
  intentObservationControl = null,
  intentDecisionControl = null,
  intentScopeControl = null,
  intentExclusionsControl = null,
  intentUnknownsControl = null,
  resultId
} = {}) => {
  if (!button || !prompt || !resultId || button.dataset.poolRunBound === 'true') return;
  button.dataset.poolRunBound = 'true';
  const runSession = createPeerRunSession({ identityNamespace: getRequesterIdentityNamespace() });
  const { requesterIdentity } = runSession;
  const researchIdentity = createPoolIdentity('requester');
  const recoveryElement = document.getElementById(`${resultId}-recovery`);
  let pendingRequest = null;
  let pendingErrorResult = null;
  let requestInFlight = false;
  let disposed = false;
  let runActivityGeneration = 0;
  const updateRunState = (state, phase = '', message = '') => {
    setPoolRunVisualState({ state, phase, message });
  };
  const handleRunActivity = (activity = {}) => {
    updateRunState(
      'running',
      activity.phase || '',
      RUN_ACTIVITY_COPY[activity.status] || 'Running on the network'
    );
  };

  const modelLabelOf = (model = {}) => model.label || model.name || model.modelId || 'the selected model';
  const buildMissingProviderRecovery = (request) => ({
    kind: 'provider_missing',
    title: 'No matching browser is ready',
    message: `No contributor in "${getPeerRoomId()}" is currently advertising ${modelLabelOf(request.selectedModel)}.${supportsLocalRequest(request) ? ' Run here without sharing compute, or keep searching.' : ' The selected checks require a matching contributor; local execution cannot replace them.'}`,
    actions: [
      {
        id: 'retry_network',
        label: 'Keep searching',
        primary: true
      },
      ...(supportsLocalRequest(request) ? [{
        id: 'offer_local_provider',
        label: 'Run on this device'
      }] : []),
      {
        id: 'invite_contributor',
        label: 'Invite a contributor',
        href: getPeerInviteUrl()
      }
    ]
  });
  const buildLocalConsentRecovery = (request) => ({
    kind: 'local_provider_consent',
    title: 'Run on this device?',
    message: `${modelLabelOf(request.selectedModel)} may need to download before this browser can answer the preserved request.`,
    details: [
      'Uses WebGPU and browser storage after a capability check.',
      'Runs only your request. Does not advertise this tab or change Share compute.',
      'Verifies the signed model and local execution receipt; does not claim independent peer agreement.'
    ],
    actions: [
      {
        id: 'confirm_local_provider',
        label: 'Download and run here',
        primary: true
      },
      {
        id: 'back_to_network',
        label: 'Back'
      },
      {
        id: 'invite_contributor',
        label: 'Invite a contributor',
        href: getPeerInviteUrl()
      }
    ]
  });
  const requestFromPendingRecovery = (record) => {
    const selectedModel = getEnabledPoolModelContract(record?.selectedModelId);
    if (!selectedModel || !isSequenceWorkload(getPoolModelWorkload(selectedModel))) return null;
    return {
      lane: 'sequence',
      promptText: null,
      sequence: record.sequence.trim(),
      sequenceRequest: {
        workload: getPoolModelWorkload(selectedModel),
        alphabet: selectedModel.sequence?.alphabet || SEQUENCE_ALPHABETS.aminoAcid,
        sensitivity: SEQUENCE_PUBLIC_SENSITIVITY,
        includeTokenEmbeddings: false,
        includeLogits: false
      },
      selectedModel,
      modelRequirements: selectedModel,
      adapterPackHash: null,
      policyId: record.policyId || FASTEST_RECEIPT_POLICY_ID,
      researchSubmission: record.researchSubmission || null
    };
  };

  const buildInterruptedRequestRecovery = (request) => ({
    kind: 'request_interrupted',
    title: 'Previous request was interrupted',
    message: `This tab reloaded before a verified result arrived from "${getPeerRoomId()}". The request has not been resumed or sent again.`,
    details: [
      `The explicitly public protein sequence remains in this browser tab for ${Math.round(POOL_PENDING_REQUEST_TTL_MS / 60000)} minutes.`,
      'Retry creates a new peer request and a new receipt path.',
      `Selected model: ${modelLabelOf(request.selectedModel)}.`
    ],
    actions: [
      {
        id: 'retry_interrupted_request',
        label: 'Retry request',
        primary: true
      },
      {
        id: 'discard_interrupted_request',
        label: 'Discard'
      }
    ]
  });
  const restoreInterruptedRequest = () => {
    const persisted = readPendingRequestRecovery();
    if (!persisted) return false;
    const restoredRequest = requestFromPendingRecovery(persisted);
    if (!restoredRequest) {
      clearPendingRequestRecovery();
      return false;
    }
    pendingRequest = restoredRequest;
    if (prompt) prompt.value = restoredRequest.sequence;
    if (modelSelect) modelSelect.value = restoredRequest.selectedModel.modelId;
    if (sequencePublicControl) {
      sequencePublicControl.checked = true;
      syncSequencePublicConsent(sequencePublicControl);
    }
    if (researchPublicControl && restoredRequest.researchSubmission) researchPublicControl.checked = true;
    if (intentKindControl && restoredRequest.researchSubmission) intentKindControl.value = restoredRequest.researchSubmission.requesterIntent?.kind || 'question';
    if (intentLabelControl && restoredRequest.researchSubmission) intentLabelControl.value = restoredRequest.researchSubmission.requesterIntent?.label || '';
    if (intentTextControl && restoredRequest.researchSubmission) intentTextControl.value = restoredRequest.researchSubmission.requesterIntent?.text || '';
    if (intentConditionsControl && restoredRequest.researchSubmission) intentConditionsControl.value = restoredRequest.researchSubmission.requesterIntent?.conditions || '';
    if (intentObservationControl && restoredRequest.researchSubmission) intentObservationControl.value = restoredRequest.researchSubmission.requesterIntent?.desiredObservation || '';
    if (intentDecisionControl && restoredRequest.researchSubmission) intentDecisionControl.value = restoredRequest.researchSubmission.requesterIntent?.decisionContext || '';
    if (intentScopeControl && restoredRequest.researchSubmission) intentScopeControl.value = restoredRequest.researchSubmission.requesterIntent?.scope || '';
    if (intentExclusionsControl && restoredRequest.researchSubmission) intentExclusionsControl.value = restoredRequest.researchSubmission.requesterIntent?.exclusions || '';
    if (intentUnknownsControl && restoredRequest.researchSubmission) intentUnknownsControl.value = restoredRequest.researchSubmission.requesterIntent?.knownUnknowns || '';
    const interrupted = {
      status: 'error',
      statusLabel: 'Interrupted',
      error: 'Previous request needs a decision',
      reason: 'This tab reloaded before a verified result arrived.',
      code: 'peer_request_interrupted',
      retryable: true,
      action: 'Retry the request or discard the preserved input.',
      roomId: getPeerRoomId(),
      relay: getPeerRelayMode(),
      model: restoredRequest.selectedModel,
      recovery: buildInterruptedRequestRecovery(restoredRequest)
    };
    pendingErrorResult = interrupted;
    setResult(resultId, interrupted, { stream: true });
    updateRunState('error', 'recovery', 'Previous request needs a decision');
    return true;
  };

  const setRunButtonBusy = (busy, label = 'Running') => {
    if (busy) {
      if (!button.dataset.poolRunIdleLabel) button.dataset.poolRunIdleLabel = button.textContent;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = label;
      return;
    }
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (button.dataset.poolRunIdleLabel) {
      button.textContent = button.dataset.poolRunIdleLabel;
      delete button.dataset.poolRunIdleLabel;
    }
  };

  const prepareRunRequest = async () => {
    const lane = document.querySelector('.pool-home-stage')?.dataset.poolLane || 'sequence';
    let requestInput = prompt.value.trim();
    if (!requestInput && prompt.placeholder) {
      requestInput = prompt.placeholder.trim();
      prompt.value = requestInput;
    }
    if (!requestInput) {
      const inputLabel = lane === 'sequence' ? 'protein sequence' : 'prompt';
      updateRunState('error', 'prompt', `Enter a ${inputLabel} to run`);
      setResult(resultId, {
        status: 'error',
        error: lane === 'sequence' ? 'Protein sequence is required' : 'Prompt is required',
        reason: 'The request body is empty.',
        action: `Enter a ${inputLabel}, then run again.`
      }, { stream: true });
      return null;
    }
    if (lane === 'sequence' && sequencePublicControl?.checked !== true) {
      const error = new Error('Confirm that this protein sequence is public before sending it to selected contributors');
      error.code = 'sequence_public_consent_required';
      error.action = 'Check the public-sequence confirmation, then run again.';
      throw error;
    }
    if (lane === 'sequence') {
      writeSequencePublicConsent();
      syncSequencePublicConsent(sequencePublicControl);
    }
    const targetModelId = modelSelect?.value;
    const selectedModel = getEnabledPoolModelContract(targetModelId || LAUNCH_MODEL.modelId) || LAUNCH_MODEL;
    const sequenceWorkload = isSequenceWorkload(getPoolModelWorkload(selectedModel));
    if (lane === 'sequence' && !sequenceWorkload) {
      throw new Error('The selected request model does not support biological sequence work');
    }
    const sequence = lane === 'sequence'
      ? requestInput.replace(/^Sequence:\s*/i, '')
      : null;
    const sequenceRequest = lane === 'sequence'
      ? {
        workload: getPoolModelWorkload(selectedModel),
        alphabet: selectedModel.sequence?.alphabet || SEQUENCE_ALPHABETS.aminoAcid,
        sensitivity: SEQUENCE_PUBLIC_SENSITIVITY,
        includeTokenEmbeddings: false,
        includeLogits: false
      }
      : null;
    const publishesResearch = lane === 'sequence' && researchPublicControl?.checked === true;
    if (publishesResearch && !intentTextControl?.value?.trim()) {
      const error = new Error('State the question, hypothesis, or context before publishing research evidence');
      error.code = 'research_question_required';
      error.action = 'Add the exact question reviewers should answer, then run again.';
      throw error;
    }
    const adapter = await resolveSelectedAdapter(adapterSelect, selectedModel, {
      required: Boolean(adapterRequired())
    });
    let selectedPolicyId = policySelect?.value || FASTEST_RECEIPT_POLICY_ID;
    const selectedPolicy = listPolicies().find((policy) => policy.policyId === selectedPolicyId);
    if (publishesResearch && !policyGuaranteesIndependentExecution(selectedPolicy)) {
      const redundantPolicy = listPolicies().find((policy) => policy.policyId === 'redundant_agreement');
      if (!policyGuaranteesIndependentExecution(redundantPolicy)) {
        const error = new Error('Public Research Room evidence requires an independent-execution policy');
        error.code = 'research_independence_policy_required';
        error.action = 'Restore the redundant-agreement policy contract, then run again.';
        throw error;
      }
      selectedPolicyId = redundantPolicy.policyId;
      if (policySelect?.querySelector(`option[value="${selectedPolicyId}"]`)) {
        policySelect.value = selectedPolicyId;
      }
    }
    const request = {
      lane,
      promptText: lane === 'sequence' ? null : requestInput,
      sequence,
      sequenceRequest,
      selectedModel,
      modelRequirements: adapter ? { ...selectedModel, adapter } : selectedModel,
      adapterPackHash: adapter?.packHash || null,
      policyId: selectedPolicyId
    };
    if (publishesResearch) {
      const researchSubmission = await createSignedResearchSubmission({
        identity: researchIdentity,
        roomId: getPeerRoomId(),
        sequence,
        intent: {
          kind: intentKindControl?.value || 'question',
          text: intentTextControl?.value || '',
          label: intentLabelControl?.value || '',
          context: '',
          conditions: intentConditionsControl?.value || '',
          desiredObservation: intentObservationControl?.value || '',
          decisionContext: intentDecisionControl?.value || '',
          scope: intentScopeControl?.value || '',
          exclusions: intentExclusionsControl?.value || '',
          knownUnknowns: intentUnknownsControl?.value || ''
        },
        consent: {
          publicSequence: true,
          publicEvidenceNetwork: true,
          publishEmbedding: true
        },
        modelContract: selectedModel,
        policyId: request.policyId
      });
      const publication = await publishResearchRecord(researchSubmission, { roomId: getPeerRoomId() });
      clearPoolRoomDraft(getPeerRoomId());
      request.researchSubmission = researchSubmission;
      setResearchPublicationStatus(resultId, publication.remote
        ? `Submission ${researchSubmission.recordHash} published before compute.`
        : `Submission ${researchSubmission.recordHash} preserved locally; coordinator sync is pending.`);
    }
    return request;
  };

  const submitRunRequest = async (preparedRequest = null) => {
    if (requestInFlight || disposed) return;
    const activityGeneration = ++runActivityGeneration;
    let acceptRunActivity = true;
    requestInFlight = true;
    if (!preparedRequest) {
      pendingRequest = null;
      pendingErrorResult = null;
    }
    setRunButtonBusy(true);
    const usingKnownProvider = Boolean(preparedRequest?.knownProviderAdverts?.length);
    updateRunState('submitting', 'prompt', usingKnownProvider
      ? 'Starting the preserved request on this device'
      : preparedRequest
        ? 'Checking the network again'
        : 'Preparing signed request');
    try {
      const request = preparedRequest || await prepareRunRequest();
      if (!request || disposed) return;
      pendingRequest = request;
      pendingErrorResult = null;
      writePendingRequestRecovery(request);
      setResult(resultId, describeSelectedRun({
        status: usingKnownProvider ? 'starting_known_provider' : 'finding_peer_provider',
        policyId: request.policyId,
        modelId: request.selectedModel.modelId,
        adapterPackHash: request.adapterPackHash
      }), { stream: true });
      const result = await runSession.run(request, {
        onLocalExecution: () => updateRunState('running', 'infer', 'Preparing this device: verifying and loading the selected model'),
        onActivity(activity) {
          if (acceptRunActivity && activityGeneration === runActivityGeneration) handleRunActivity(activity);
        }
      });
      acceptRunActivity = false;
      if (disposed) return;
      result.inviteUrl = getPeerInviteUrl();
      result.relay = result.transport === 'local_capsule' ? 'none' : getPeerRelayMode();
      if (request.researchSubmission && request.lane === 'sequence') {
        const researchResult = await createSignedResearchResult({
          identity: researchIdentity,
          roomId: getPeerRoomId(),
          submission: request.researchSubmission,
          receiptRecord: result.receiptRecord || result,
          receiptEvidence: result.receiptEvidence || null,
          agreement: result.agreement || null,
          routeDecision: result.plan?.routeDecision || result.routeDecision || null,
          embedding: result.sequenceOutput?.pooledEmbedding || result.receiptRecord?.sequenceOutput?.pooledEmbedding || null,
          sequenceResult: result.sequenceResult || result.receiptRecord?.sequenceResult || null,
          sequenceOutput: result.sequenceOutput || result.receiptRecord?.sequenceOutput || null
        });
        const publication = await publishResearchRecord(researchResult, { roomId: getPeerRoomId() });
        result.researchSubmissionHash = request.researchSubmission.recordHash;
        result.researchResultHash = researchResult.recordHash;
        result.researchPublication = publication.remote ? 'coordinator_synced' : 'local_sync_pending';
        result.embeddingPublicationConsent = request.researchSubmission.consent?.publishEmbedding === true;
      }
      addReceiptLedgerRow({
        ...(result.receiptRecord || result),
        requesterAcceptance: result.requesterAcceptance || null,
        agreement: result.agreement || null,
        routeDecision: result.plan?.routeDecision || result.routeDecision || null,
        transport: result.transport || null,
        relay: result.relay || getPeerRelayMode(),
        policyId: result.policyId || request.policyId,
        outputKind: result.outputKind || null,
        sequenceResultHash: result.sequenceResultHash || null,
        embeddingDimensions: result.embeddingDimensions || null
      }, result.receiptHash);
      void refreshServerRoomActivity();
      setResult(resultId, result, { stream: true });
      if (result.researchResultHash) {
        setResearchPublicationStatus(resultId, `Evidence result ${result.researchResultHash} preserved. Open Records to review, connect, and discover.`);
      }
      updateRunState(
        'complete',
        'answer',
        result.transport === 'local_capsule' ? 'Completed on this device' : request.lane === 'sequence' ? 'Protein embedding verified' : 'Answer verified'
      );
      pendingRequest = null;
      clearPendingRequestRecovery();
    } catch (error) {
      acceptRunActivity = false;
      if (disposed) return;
      const selectedModel = pendingRequest?.selectedModel
        || getEnabledPoolModelContract(modelSelect?.value || LAUNCH_MODEL.modelId)
        || LAUNCH_MODEL;
      const networkUnavailable = pendingRequest && canOfferLocalFallback(error);
      const displayError = displayPoolError(error, {
        title: networkUnavailable ? 'No matching provider is currently available' : 'Request could not complete',
        action: networkUnavailable
          ? 'Reploid searched the peer network. Choose a recovery option below.'
          : error?.payload?.action || error?.action || 'Check the technical details, then try again.',
        context: {
          roomId: getPeerRoomId(),
          relay: getPeerRelayMode(),
          model: selectedModel,
          adapterPackHash: pendingRequest?.adapterPackHash || adapterSelect?.value || null
        }
      });
      if (networkUnavailable) {
        displayError.statusLabel = 'No provider';
        displayError.action = 'The request is preserved. Choose a recovery option below.';
        displayError.recovery = buildMissingProviderRecovery(pendingRequest);
        pendingErrorResult = displayError;
        recordPeerLedgerEvents([{
          type: 'request_event',
          fromPeerId: requesterIdentity.identityRootId || requesterIdentity.userId || 'local-requester',
          createdAt: new Date().toISOString(),
          body: {
            status: 'waiting_for_provider',
            reason: 'No matching provider',
            roomId: getPeerRoomId(),
            modelId: selectedModel.modelId || selectedModel.id || null,
            policyId: pendingRequest.policyId || null,
            retryable: true
          }
        }]);
        refreshRecordTimelineState();
      }
      setResult(resultId, displayError, { stream: true });
      clearPendingRequestRecovery();
      updateRunState('error', 'match', networkUnavailable
        ? 'No matching provider is currently available'
        : 'Run needs attention');
    } finally {
      acceptRunActivity = false;
      requestInFlight = false;
      if (!disposed) setRunButtonBusy(false);
    }
  };

  const runPreservedRequestLocally = async () => {
    if (!pendingRequest || requestInFlight) return;
    await submitRunRequest({ ...pendingRequest, localExecution: true });
  };

  recoveryElement?.addEventListener('click', (event) => {
    const action = event.target.closest?.('[data-pool-run-recovery-action]');
    if (!action || action.tagName === 'A') return;
    const actionId = action.dataset.poolRunRecoveryAction;
    if (actionId === 'retry_network') {
      void submitRunRequest(pendingRequest);
      return;
    }
    if (actionId === 'retry_interrupted_request' && pendingRequest) {
      void submitRunRequest(pendingRequest);
      return;
    }
    if (actionId === 'discard_interrupted_request') {
      clearPendingRequestRecovery();
      pendingRequest = null;
      pendingErrorResult = null;
      setResult(resultId, '', { stream: true });
      updateRunState('idle', '', 'Ready for a new request');
      return;
    }
    if (actionId === 'offer_local_provider' && pendingRequest && pendingErrorResult) {
      setResult(resultId, {
        ...pendingErrorResult,
        recovery: buildLocalConsentRecovery(pendingRequest)
      }, { stream: true });
      return;
    }
    if (actionId === 'back_to_network' && pendingErrorResult) {
      setResult(resultId, pendingErrorResult, { stream: true });
      return;
    }
    if (actionId === 'confirm_local_provider') {
      void runPreservedRequestLocally();
    }
  });
  const submit = (event) => {
    event?.preventDefault?.();
    void submitRunRequest();
  };
  if (form) form.addEventListener('submit', submit);
  else button.addEventListener('click', submit);
  if (!restoreInterruptedRequest()) updateRunState('idle');
  return () => {
    disposed = true;
    ++runActivityGeneration;
    runSession.close();
  };
};

const runWorkloadOf = (modelSelect) => (
  modelSelect?.selectedOptions?.[0]?.dataset?.workload || POOLDAY_MODEL_WORKLOADS.sequenceEmbedding
);

const syncRunWorkloadAffordance = (modelSelect) => {
  const badge = document.querySelector('[data-pool-run-workload]');
  const promptLabel = document.querySelector('[data-pool-run-prompt-label]');
  const workload = runWorkloadOf(modelSelect);
  const isSequence = true;
  if (badge) badge.textContent = workload.replace(/[-_]/g, ' ');
  if (promptLabel) promptLabel.textContent = isSequence ? 'Sequence' : 'Prompt';
};

export const bindRunControls = () => {
  const modelSelect = document.getElementById('pool-run-model');
  const sequencePublicControl = document.getElementById('pool-run-sequence-public');
  const stopRun = bindPeerRunSurface({
    button: document.getElementById('pool-run-submit'),
    prompt: document.getElementById('pool-run-prompt'),
    policySelect: document.getElementById('pool-run-policy'),
    modelSelect,
    sequencePublicControl,
    researchPublicControl: document.getElementById('pool-run-research-public'),
    intentKindControl: document.getElementById('pool-run-intent-kind'),
    intentLabelControl: document.getElementById('pool-run-intent-label'),
    intentTextControl: document.getElementById('pool-run-intent-text'),
    intentConditionsControl: document.getElementById('pool-run-intent-conditions'),
    intentObservationControl: document.getElementById('pool-run-intent-observation'),
    intentDecisionControl: document.getElementById('pool-run-intent-decision'),
    intentScopeControl: document.getElementById('pool-run-intent-scope'),
    intentExclusionsControl: document.getElementById('pool-run-intent-exclusions'),
    intentUnknownsControl: document.getElementById('pool-run-intent-unknowns'),
    resultId: 'pool-run-result'
  });
  if (modelSelect && modelSelect.dataset.poolWorkloadBound !== 'true') {
    modelSelect.dataset.poolWorkloadBound = 'true';
    modelSelect.addEventListener('change', () => {
      syncRunWorkloadAffordance(modelSelect);
    });
    syncRunWorkloadAffordance(modelSelect);
  }
  return stopRun;
};

export const bindEmbeddingResultControls = () => {
  document.querySelectorAll('[data-pool-copy-embedding]').forEach((button) => {
    if (button.dataset.poolEmbeddingCopyBound === 'true') return;
    button.dataset.poolEmbeddingCopyBound = 'true';
    button.addEventListener('click', async () => {
      const resultId = String(button.dataset.poolEmbeddingResultId || '').trim();
      const vector = resultId ? document.getElementById(`${resultId}-embedding`)?.textContent?.trim() : '';
      const status = button.closest('.pool-embedding-outcome')?.querySelector('[data-pool-embedding-copy-status]');
      if (button.dataset.poolEmbeddingPublicationPermitted !== 'true') {
        if (status) status.textContent = 'The raw embedding is withheld because publication consent was not granted.';
        return;
      }
      if (!vector) {
        if (status) status.textContent = 'The embedding is not available to copy.';
        return;
      }
      if (typeof navigator.clipboard?.writeText !== 'function') {
        if (status) status.textContent = 'Clipboard access is unavailable. Open View embedding vector and copy it manually.';
        return;
      }
      try {
        await navigator.clipboard.writeText(vector);
        if (status) status.textContent = 'Embedding vector copied.';
      } catch {
        if (status) status.textContent = 'Copy failed. Open View embedding vector and copy it manually.';
      }
    });
  });
};

const setDrawerSummary = (sectionId, value) => {
  const summary = document.querySelector(`[data-pool-drawer-summary="${sectionId}"]`);
  if (summary) summary.textContent = String(value || '');
};

const requestModelsForLane = (lane) => listPoolModels({
  enabledOnly: true,
  workload: POOLDAY_MODEL_WORKLOADS.sequenceEmbedding
});

const replaceRequestModelOptions = (modelSelect, lane, preferredModelId = null) => {
  if (!modelSelect) return null;
  const models = requestModelsForLane(lane);
  modelSelect.replaceChildren(...models.map((model) => {
    const option = createSelectOption(model.label || model.modelId, model.modelId);
    option.dataset.workload = getPoolModelWorkload(model);
    return option;
  }));
  const preferredExists = models.some((model) => model.modelId === preferredModelId);
  const selectedModel = preferredExists ? preferredModelId : models[0]?.modelId || '';
  modelSelect.value = selectedModel;
  modelSelect.disabled = models.length === 0;
  return getEnabledPoolModelContract(selectedModel);
};

const bindHomeLaneChips = (input, adapterSelect, modelSelect) => {
  const chips = [...document.querySelectorAll('.pool-lane-chip[data-pool-lane]')];
  const stage = document.querySelector('.pool-home-stage');
  const adapterPicker = adapterSelect?.closest('[data-pool-home-adapter-picker]');
  const sequenceOptions = document.querySelector('[data-pool-sequence-options]');
  const sequencePublicControl = document.getElementById('pool-home-sequence-public');
  const taskDescription = document.querySelector('[data-pool-task-description]:not(.pool-lane-chip)');
  const submitButton = document.getElementById('pool-home-run-submit');
  const resultLabel = document.querySelector('label[for="pool-home-run-result-stream"]');
  const laneValues = new Map([[stage?.dataset.poolLane || 'sequence', input?.value || '']]);
  const laneModels = new Map([[stage?.dataset.poolLane || 'sequence', modelSelect?.value || '']]);
  if (chips.length === 0 || !stage) return;
  chips.forEach((chip) => {
    if (chip.disabled || chip.dataset.poolLaneBound === 'true') return;
    chip.dataset.poolLaneBound = 'true';
    chip.addEventListener('click', () => {
      const lane = chip.dataset.poolLane || 'sequence';
      chips.forEach((other) => {
        const active = other.dataset.poolLane === lane;
        other.classList.toggle('is-active', active);
        other.setAttribute('aria-pressed', String(active));
      });
      const previousLane = stage.dataset.poolLane || 'sequence';
      const previousModelId = modelSelect?.value || '';
      laneValues.set(previousLane, input.value);
      if (previousModelId) laneModels.set(previousLane, previousModelId);
      stage.dataset.poolLane = lane;
      input.value = laneValues.get(lane) || '';
      setDrawerSummary('request-task', chip.textContent.trim());
      if (taskDescription) taskDescription.textContent = chip.dataset.poolTaskDescription || '';
      const nextPrompt = choosePooldayAskPlaceholderForLane(lane);
      input.placeholder = nextPrompt;
      input.dataset.poolSuggestedPrompt = nextPrompt;
      input.dataset.poolSuggestedPromptCleared = 'false';
      input.name = lane === 'sequence' ? 'sequence' : 'prompt';
      input.setAttribute('aria-label', lane === 'sequence' ? 'Public protein sequence' : 'Ask prompt');
      if (submitButton) submitButton.setAttribute('aria-label', 'Run model');
      if (resultLabel) resultLabel.textContent = lane === 'sequence' ? 'Embedding' : 'Answer';
      if (adapterPicker) adapterPicker.hidden = lane !== 'adapters';
      if (sequenceOptions) sequenceOptions.hidden = lane !== 'sequence';
      if (sequencePublicControl) sequencePublicControl.required = lane === 'sequence';
      const sameModelFamily = true;
      replaceRequestModelOptions(
        modelSelect,
        lane,
        laneModels.get(lane) || (sameModelFamily ? previousModelId : null)
      );
      if (modelSelect) {
        modelSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (adapterSelect) {
        adapterSelect.value = '';
      }
    });
  });
};

export const bindHomeAskControls = () => {
  const form = document.getElementById('pool-home-ask-form');
  const input = document.getElementById('pool-home-ask-prompt');
  const button = document.getElementById('pool-home-run-submit');
  const adapterSelect = document.getElementById('pool-home-adapter');
  const modelSelect = document.getElementById('pool-home-request-model');
  const policySelect = document.getElementById('pool-home-request-policy');
  const sequencePublicControl = document.getElementById('pool-home-sequence-public');
  if (!form || !input || !button) return;
  let dockObserver;
  const stage = form.closest('.pool-home-stage');
  if (stage && form.dataset.poolDockMeasurementBound !== 'true') {
    form.dataset.poolDockMeasurementBound = 'true';
    const syncDockHeight = () => {
      const height = Math.ceil(form.getBoundingClientRect().height);
      if (height > 0) stage.style.setProperty('--pool-param-ask-dock-height', `${height}px`);
    };
    syncDockHeight();
    if (typeof ResizeObserver === 'function') {
      dockObserver = new ResizeObserver(syncDockHeight);
      dockObserver.observe(form);
    }
  }
  if (sequencePublicControl && sequencePublicControl.dataset.poolConsentBound !== 'true') {
    sequencePublicControl.dataset.poolConsentBound = 'true';
    syncSequencePublicConsent(sequencePublicControl);
    sequencePublicControl.addEventListener('change', () => {
      if (sequencePublicControl.checked) writeSequencePublicConsent();
      syncSequencePublicConsent(sequencePublicControl);
    });
  }
  bindSuggestedPromptEditing(input);
  const example = form.querySelector('[data-pool-use-example]');
  if (example && example.dataset.poolExampleBound !== 'true') {
    example.dataset.poolExampleBound = 'true';
    example.addEventListener('click', () => {
      if (input.disabled || example.disabled || !input.dataset.poolSuggestedPrompt) return;
      input.value = input.dataset.poolSuggestedPrompt;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    });
  }
  if (input.dataset.poolSequenceFeedbackBound !== 'true') {
    input.dataset.poolSequenceFeedbackBound = 'true';
    const updateFeedback = () => {
      const model = getEnabledPoolModelContract(modelSelect?.value) || LAUNCH_MODEL;
      const alphabet = model.sequence?.alphabet || SEQUENCE_ALPHABETS.aminoAcid;
      const policyLimit = getMaxPublicSequenceLength(alphabet);
      const limit = Math.min(policyLimit, Number(model.sequence?.maxLength) || policyLimit);
      const length = input.value.replace(/\s+/g, '').length;
      let message = '';
      if (length) {
        try {
          normalizeSequenceInput(input.value, alphabet);
          if (length > limit) message = `This model accepts up to ${limit} residues.`;
        } catch (error) {
          message = error.message;
        }
      }
      const counter = form.querySelector('#pool-sequence-count');
      const feedback = form.querySelector('#pool-sequence-feedback');
      if (counter) counter.textContent = `${length} / ${limit}`;
      if (feedback) feedback.textContent = message || 'Whitespace is ignored.';
      input.setAttribute('aria-invalid', String(Boolean(message)));
      input.setCustomValidity(message);
    };
    input.addEventListener('input', updateFeedback);
    input.addEventListener('change', updateFeedback);
    modelSelect?.addEventListener('change', updateFeedback);
    // Keep programmatically restored/suggested inputs in sync as well.
    form.addEventListener('submit', () => queueMicrotask(updateFeedback));
    updateFeedback();
  }
  bindHomeLaneChips(input, adapterSelect, modelSelect);
  if (modelSelect && modelSelect.dataset.poolRequestModelBound !== 'true') {
    modelSelect.dataset.poolRequestModelBound = 'true';
    const syncModel = () => {
      setDrawerSummary('request-model', modelSelect.selectedOptions[0]?.textContent || modelSelect.value);

    };
    modelSelect.addEventListener('change', syncModel);
    syncModel();
  }
  if (policySelect && policySelect.dataset.poolRequestPolicyBound !== 'true') {
    policySelect.dataset.poolRequestPolicyBound = 'true';
    const syncPolicy = () => {
      const label = policySelect.selectedOptions[0]?.textContent || policySelect.value;
      setDrawerSummary('request-checks', label.split(' - ')[0]);
    };
    policySelect.addEventListener('change', syncPolicy);
    syncPolicy();
  }
  const stopRun = bindPeerRunSurface({
    button,
    prompt: input,
    form,
    policySelect,
    modelSelect,
    adapterSelect,
    adapterRequired: () => document.querySelector('.pool-home-stage')?.dataset.poolLane === 'adapters',
    sequencePublicControl,
    researchPublicControl: document.getElementById('pool-home-research-public'),
    intentKindControl: document.getElementById('pool-home-intent-kind'),
    intentLabelControl: document.getElementById('pool-home-intent-label'),
    intentTextControl: document.getElementById('pool-home-intent-text'),
    intentConditionsControl: document.getElementById('pool-home-intent-conditions'),
    intentObservationControl: document.getElementById('pool-home-intent-observation'),
    intentDecisionControl: document.getElementById('pool-home-intent-decision'),
    intentScopeControl: document.getElementById('pool-home-intent-scope'),
    intentExclusionsControl: document.getElementById('pool-home-intent-exclusions'),
    intentUnknownsControl: document.getElementById('pool-home-intent-unknowns'),
    resultId: 'pool-home-run-result'
  });
  return () => { stopRun?.(); dockObserver?.disconnect(); };
};

const createProviderContributionController = () => {
  let controls = { workerToggleButton: null, modelInput: null, mount: null };
  let visibilityHandler = null;
  const mount = () => controls.mount || document.getElementById('app');
  const session = createProviderContributionSession({
    getProviderIdentityNamespace, refreshContributionStatusBar, updateProviderHealth, refreshProviderStorageHealth,
    formatDeviceLabel, recordContributionReceipt, addReceiptLedgerRow, updateContributionState, setResult,
    refreshServerRoomActivity, refreshParticipationControls, displayPoolError, getPeerInviteUrl, canContributeWith,
    getSelectedModelId: () => controls.modelInput?.value,
    hasControls: () => !!(controls.modelInput || controls.workerToggleButton),
    setProviderStatus: value => updateProviderStatus(mount(), value),
    setProviderNotice: value => updateProviderNotice(mount(), value),
    selectModel(modelId) {
      if (controls.modelInput) { controls.modelInput.value = modelId; syncProviderWorkloadCapability(controls.modelInput); }
    },
    setStopping() { controls.workerToggleButton?.setAttribute('disabled', 'true'); },
    renderControls({ workerRunning, workerStarting, modelId }) {
      if (controls.modelInput && modelId && (workerRunning || workerStarting)) controls.modelInput.value = modelId;
      const button = controls.workerToggleButton;
      if (button) {
        const active = workerRunning || workerStarting;
        button.disabled = workerStarting;
        button.textContent = workerStarting ? 'Starting...' : active ? 'Stop sharing' : 'Start sharing';
        button.dataset.op = workerStarting ? '○' : active ? '■' : '▶';
        button.dataset.contributionAction = active ? 'stop' : 'start';
        button.setAttribute('aria-pressed', String(active));
        button.classList.toggle('btn-primary', !active); button.classList.toggle('btn-ghost', active);
      }
      if (controls.modelInput) controls.modelInput.disabled = workerRunning || workerStarting;
      refreshContributionStatusBar();
    }
  });
  return {
    ...session,
    attachControls(nextControls = {}) {
      controls = { workerToggleButton: nextControls.workerToggleButton || null, modelInput: nextControls.modelInput || null,
        mount: nextControls.mount || controls.mount || document.getElementById('app') };
      if (controls.workerToggleButton && controls.workerToggleButton.dataset.poolContributionBound !== 'true') {
        controls.workerToggleButton.dataset.poolContributionBound = 'true';
        controls.workerToggleButton.addEventListener('click', () => { void session.toggle(); });
      }
      session.attach();
      if (!visibilityHandler) {
        visibilityHandler = () => { if (document.visibilityState === 'visible') void session.resume(); };
        document.addEventListener('visibilitychange', visibilityHandler);
      }
    },
    async dispose(options) {
      if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
      visibilityHandler = null;
      await session.dispose(options);
    }
  };
};

let providerContributionController = null;

const getProviderContributionController = () => {
  if (!providerContributionController) {
    providerContributionController = createProviderContributionController();
  }
  return providerContributionController;
};

export const resetProviderContributionControllerForTests = async ({
  preserveResumeIntent = false
} = {}) => {
  const current = providerContributionController;
  providerContributionController = null;
  if (current?.dispose) await current.dispose({ preserveResumeIntent });
};

const syncProviderWorkloadCapability = (modelSelect) => {
  const badge = document.querySelector('[data-pool-provider-workload]');
  if (!badge) return;
  const workload = modelSelect?.selectedOptions?.[0]?.dataset?.workload || POOLDAY_MODEL_WORKLOADS.sequenceEmbedding;
  badge.textContent = workload.replace(/[-_]/g, ' ');
};

export const bindProviderControls = () => {
  const modelInput = document.getElementById('pool-provider-model');
  getProviderContributionController().attachControls({
    workerToggleButton: document.getElementById('pool-provider-worker-toggle')
      || document.getElementById('pool-home-provider-toggle'),
    modelInput,
    mount: document.getElementById('app')
  });
  if (modelInput && modelInput.dataset.poolWorkloadBound !== 'true') {
    modelInput.dataset.poolWorkloadBound = 'true';
    modelInput.addEventListener('change', () => {
      syncProviderWorkloadCapability(modelInput);
      void getProviderContributionController().handleModelChange();
    });
    syncProviderWorkloadCapability(modelInput);
  }
};

export const bindRecordFacetControls = () => {
  const ledger = document.getElementById('pool-record-ledger');
  if (!ledger || ledger.dataset.poolFacetBound === 'true') return;
  ledger.dataset.poolFacetBound = 'true';
  ledger.addEventListener('click', (event) => {
    const chip = event.target.closest?.('[data-pool-record-facet]');
    if (!chip) return;
    ledger.dataset.recordFacet = setPoolRecordFacet(chip.dataset.poolRecordFacet || 'all');
    refreshRecordTimelineState();
  });
};

const bindRecordDisclosureControls = () => {
  const layout = document.querySelector('.pool-record-layout');
  if (!layout || layout.dataset.poolRecordDisclosureBound === 'true') return;
  layout.dataset.poolRecordDisclosureBound = 'true';
  restorePoolRecordDisclosures(layout);
  layout.addEventListener('toggle', (event) => {
    const details = event.target;
    const disclosureId = details?.dataset?.poolRecordDisclosure;
    if (!disclosureId) return;
    setPoolRecordDisclosureOpen(disclosureId, details.open);
  }, true);
};

export const bindReceiptControls = () => {
  bindRecordFacetControls();
  bindRecordDisclosureControls();
  const button = document.getElementById('pool-receipt-lookup');
  const input = document.getElementById('pool-receipt-hash');
  if (!button || !input) return;
  const ledgerContainer = document.getElementById('pool-receipt-ledger');
  if (ledgerContainer) {
    ledgerContainer.innerHTML = renderReceiptLedger();
  }
  void refreshServerRoomActivity();
  button.addEventListener('click', async () => {
    const receiptHash = input.value.trim();
    if (!receiptHash) {
      setResult('pool-receipt-result', { error: 'Hash is required' });
      return;
    }
    button.disabled = true;
    try {
      const record = findReceiptLedgerRecord(receiptHash);
      if (!record) {
        setResult('pool-receipt-result', {
          status: 'not_found',
          receiptHash,
          action: 'Submit a local peer-room job first, then inspect Records from this browser.'
        });
        return;
      }
      setResult('pool-receipt-result', {
        ...record,
        localVerification: record.receipt ? await verifyReceiptRecord(record) : null
      });
    } catch (error) {
      setResult('pool-receipt-result', { error: error.message, payload: error.payload || null });
    } finally {
      button.disabled = false;
    }
  });
};
