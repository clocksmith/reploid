/**
 * "Who can read it?": the protection, where it runs and whether only your devices may run it, staged until Apply,
 * then stored on the thread (or on the draft for a new one). Moved here from the conversation controller
 * (conversation-controller.js), which composes it. The session stores the policy; this only stages the choice.
 */
import { executionRequirementsFor, validateExecutionPolicy } from '../../../../shared/vendor/reploid/chat/execution-policy.js';
import { PROTECTION_DISPLAY } from '../../../../shared/vendor/reploid/inference/protections.js';
import { locationForRoute } from '../execution-route.js';
import { conversationRoute, presetForPolicy, policyForPreset, presetDisclosure } from '../../ui/pool-home/privacy-controls.js';
import { ownDevicesChoice, protectionChoices, routeChoices } from '../../ui/pool-home/choice-availability.js';
import { promptDisclosure } from './prompt-disclosure.js';

const ownDevicesOf = context => context?.desktop?.id ? [context.desktop.id] : [];
const requirementsOf = policy => { try { return executionRequirementsFor(policy); } catch { return null; } };
const stageCount = model => new Set(model?.partition?.route?.stages?.map(stage => stage.participantId)
  ?? [model?.partition?.participantA, model?.partition?.participantB].filter(Boolean)).size;
const option = ({ value, title, status, disabled }) => ({ value, title, status, disabled });
const CLOSED = Object.freeze({ open: false, protection: null, route: null, ownDevices: false, editable: true, error: '' });

/**
 * `presetContext(state)` names the paired desktop, the conversation's model and its execution location;
 * `explicitPrivacy(state)` is the policy the conversation sends with now. `blocked()` says the controller is
 * sending or the thread cannot change; `beforeOpen()` drops what opening replaces (a held Send, the open sheet);
 * `setDraftLocation(location)` stores a new conversation's execution location.
 */
export function createPrivacyDialog({ session, getState, viewState, notify, requestFocus, presetContext, explicitPrivacy,
  blocked, beforeOpen, setDraftLocation }) {
  let dialog = CLOSED, applying = false, editingThread;
  return {
    /** The dialog's rows, lines and notes for what is staged (privacy-controls.js showPrivacyChoices, without markup). */
    project(state) {
      const context = presetContext(state), { editable } = dialog;
      const protection = dialog.protection ?? 'plaintext', route = dialog.route ?? 'auto';
      const own = ownDevicesChoice({ desktop: context.desktop?.label ?? null, route, editable, checked: dialog.ownDevices });
      const split = protection === 'plaintext' && (route === 'split' || route === 'split-local-edges');
      const preset = route === 'local' || own.checked ? 'own-devices' : 'standard';
      const desktop = route === 'local' ? null : context.desktop?.label ?? null;
      return {
        open: dialog.open, editable, error: dialog.error, applying,
        protection: dialog.protection, route: dialog.route, ownDevices: own.checked,
        protections: protectionChoices({ editable, value: protection }).map(option),
        routes: routeChoices({ model: context.model, canRunHere: true, editable, value: route }).map(option),
        ownDevicesOption: option(own),
        splitNote: !split ? '' : promptDisclosure({ site: 'split-note', stages: true, edges: route === 'split-local-edges', stageCount: stageCount(context.model) }),
        preset, note: presetDisclosure(preset, { desktop }),
        // Both statements stay in the page, the chosen one shown, as the vanilla dialog keeps them.
        notes: Object.fromEntries(['standard', 'own-devices'].map(name => [name, presetDisclosure(name, { desktop })]))
      };
    },
    /** Closes the dialog when its thread can no longer change or another thread is selected. */
    follow(state, disabled) {
      if (dialog.open && (disabled || editingThread !== state.selectedId)) dialog = { ...dialog, open: false };
    },
    applying: () => applying,
    open() {
      if (applying || blocked()) return;
      beforeOpen();
      const state = getState(), context = presetContext(state), policy = explicitPrivacy(state);
      editingThread = state.selectedId;
      let preset = null, requirements = null;
      try { requirements = executionRequirementsFor(validateExecutionPolicy(policy)); preset = presetForPolicy(policy, ownDevicesOf(context)); } catch { /* read-only below */ }
      const route = requirements ? conversationRoute(policy, context) : null;
      const editable = preset === 'standard' || preset === 'own-devices';
      dialog = { open: true, protection: requirements?.protection ?? null, route, ownDevices: route !== 'local' && preset === 'own-devices', editable,
        error: editable ? '' : 'This conversation has requirements these choices cannot express. It is read-only here.' };
      notify();
    },
    pickProtection(value) { if (PROTECTION_DISPLAY[value]) { dialog = { ...dialog, protection: value, error: '' }; notify(); } },
    pickRoute(value) { dialog = { ...dialog, route: value, error: '' }; notify(); },
    setOwnDevices(on) { dialog = { ...dialog, ownDevices: !!on, error: '' }; notify(); },
    close() { dialog = { ...dialog, open: false }; requestFocus('privacy'); notify(); },
    apply() {
      const state = getState();
      if (!dialog.open || applying || editingThread !== state.selectedId || blocked() || !dialog.editable) return;
      applying = true; notify();
      void (async () => {
        try {
          // privacy-controls.js readPrivacyControls, from the staged choices.
          const { protection, route } = dialog;
          if (!protection) throw new Error('Choose who can read your content.');
          if (protection !== 'plaintext') throw new Error(`${PROTECTION_DISPLAY[protection]?.label ?? protection} is unavailable here. Nothing was changed.`);
          if (!route) throw new Error('Choose where it runs.');
          const context = presetContext(state);
          const own = ownDevicesChoice({ desktop: context.desktop?.label ?? null, route, editable: true, checked: dialog.ownDevices });
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
            setDraftLocation(location);
          }
          dialog = { ...dialog, open: false }; requestFocus('privacy');
        } catch (cause) {
          dialog = { ...dialog, error: cause.message };
        } finally { applying = false; notify(); }
      })();
    }
  };
}
