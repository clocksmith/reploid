import { renderToggleRow } from '../components/choices.js';

/** Network-answer settings and retained permission-record wording.
 * The host stores and enforces authorization; this view reports the person's choice. */

const WHO = {
  'ordered-partition-activations-and-tokens': 'The first computer receives the text. The other computers receive the same content as model tokens, which read back as text, plus intermediate results.',
  'partition-activations-and-tokens': 'The first computer receives the text. The second receives the same content as model tokens, which read back as text, plus intermediate results.',
  public: 'One computer receives the text and returns the answer.'
};

/** Identifies the wording below in each permission record; change the version whenever the text changes. */
export const REMOTE_PERMISSION_WORDING = Object.freeze({ id: 'reploid.remote-contributor-permission', version: '1' });

export function remotePermissionText(need) {
  return { title: "Answer with contributors' computers?",
    what: "To answer, this conversation is sent to contributors' computers on this network: your message, earlier messages in the thread, and the context prompt when it is on.",
    who: WHO[need.disclosure] || WHO.public,
    scope: 'You are asked once. Later questions and follow-ups are sent the same way until you turn this off in Settings.' };
}

/** Retained wording for permission records; the current conversation uses Settings. */
export function remotePermissionWording(need) {
  const text = remotePermissionText(need);
  return { ...REMOTE_PERMISSION_WORDING, text: ['title', 'what', 'who', 'scope'].map(key => text[key]).join('\n\n') };
}

export function renderRemotePermissionSettings() {
  return `<section class="pool-stack pool-gap-xs" data-remote-permission-settings aria-labelledby="remote-permission-title">
    ${renderToggleRow({ id: 'remote-permission', title: 'Allow network answers', statusAttrs: { 'data-remote-permission-status': true, role: 'status' },
      switchAttrs: { 'data-remote-answers-toggle': true } })}
  </section>`;
}

/** The network preference is distinct from routing and from sharing this device's capacity. */
export function updateRemotePermissionSettings(root, state) {
  const enabled = state.remoteAnswersEnabled === true;
  root.querySelector('[data-remote-answers-toggle]').setAttribute('aria-checked', String(enabled));
  root.querySelector('[data-remote-permission-status]').textContent = enabled
    ? "Your messages and conversation context can be sent to contributors' computers on this network."
    : 'Network answers are off. Turn this on to use contributors, or choose this device.';
}
