/** Network-answer preference and the consent dialog used when it is off.
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

/** The exact wording the dialog shows for `need`, as the permission record keeps it. */
export function remotePermissionWording(need) {
  const text = remotePermissionText(need);
  return { ...REMOTE_PERMISSION_WORDING, text: ['title', 'what', 'who', 'scope'].map(key => text[key]).join('\n\n') };
}

export function renderRemotePermissionDialog() {
  return `<dialog class="chat-model-setup pool-surface pool-small" data-remote-permission aria-labelledby="chat-remote-permission-title" aria-describedby="chat-remote-permission-body">
    <h2 class="pool-heading" id="chat-remote-permission-title" data-remote-permission-title></h2>
    <div id="chat-remote-permission-body"><p data-remote-permission-what></p><p data-remote-permission-who></p><p data-remote-permission-scope></p></div>
    <div class="chat-network-actions"><button class="pool-button" type="button" data-remote-permission-local>Keep answers local</button>
      <button class="pool-button btn-primary" type="button" data-remote-permission-allow>Allow</button></div>
  </dialog>`;
}

/** Opens the explanation for `need`; resolves true after Allow stores the permission, false otherwise. */
export function bindRemotePermissionDialog(dialog, session, { onError = () => {} } = {}) {
  const find = selector => dialog.querySelector(selector), controller = new AbortController(), options = { signal: controller.signal };
  let pending = null, opener = null;
  const finish = value => { const done = pending; pending = null; if (dialog.open) dialog.close(); done?.(value); };
  find('[data-remote-permission-local]').addEventListener('click', () => finish(false), options);
  dialog.addEventListener('close', () => { opener?.isConnected && opener.focus({ preventScroll: true }); finish(false); }, options);
  find('[data-remote-permission-allow]').addEventListener('click', () => {
    const need = JSON.parse(dialog.dataset.need), allow = find('[data-remote-permission-allow]');
    allow.disabled = true;
    Promise.resolve().then(() => session.grantRemotePermission(need, { wording: remotePermissionWording(need) }))
      .then(() => finish(true), error => { onError(error); finish(false); })
      .finally(() => { allow.disabled = false; });
  }, options);
  return {
    get open() { return dialog.open; },
    ask(need) {
      if (pending) return Promise.resolve(false);
      const text = remotePermissionText(need);
      for (const key of ['title', 'what', 'who', 'scope']) find(`[data-remote-permission-${key}]`).textContent = text[key];
      dialog.dataset.need = JSON.stringify(need);
      opener = dialog.ownerDocument.activeElement;
      return new Promise(resolve => { pending = resolve; dialog.showModal(); find('[data-remote-permission-allow]').focus(); });
    },
    dispose() { controller.abort(); finish(false); }
  };
}

export function renderRemotePermissionSettings() {
  return `<section class="pool-stack pool-gap-xs" data-remote-permission-settings aria-labelledby="remote-permission-settings-title">
    <div class="pool-row pool-row-between"><h3 class="pool-small" id="remote-permission-settings-title">Allow network answers</h3>
      <button class="pool-switch" type="button" role="switch" aria-checked="false" aria-labelledby="remote-permission-settings-title" aria-describedby="remote-permission-help" data-remote-answers-toggle><span aria-hidden="true"></span></button></div>
    <p class="pool-small pool-muted" id="remote-permission-help" data-remote-permission-status role="status"></p>
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
