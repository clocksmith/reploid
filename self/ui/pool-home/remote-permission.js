import { escapeHtml as escape } from '../components/attachments.js';
/** One-time permission to answer with contributors' computers, and its setting. The host stores and
 * enforces the permission; this view explains it once and reports the person's choice. */

const WHO = {
  'ordered-partition-activations-and-tokens': 'The first computer receives the text. The other computers receive the same content as model tokens, which read back as text, plus intermediate results.',
  'partition-activations-and-tokens': 'The first computer receives the text. The second receives the same content as model tokens, which read back as text, plus intermediate results.',
  public: 'One computer receives the text and returns the answer.'
};
const HOW = {
  'ordered-partition-activations-and-tokens': 'split across several computers',
  'partition-activations-and-tokens': 'split across two computers',
  public: 'answered by one computer'
};

export function remotePermissionText(need) {
  return { title: "Answer with contributors' computers?",
    what: "To answer, this conversation is sent to contributors' computers on this network: your message, earlier messages in the thread, and the context prompt when it is on.",
    who: WHO[need.disclosure] || WHO.public,
    scope: 'You are asked once. Later questions and follow-ups are sent the same way until you turn this off in Settings.' };
}

export function renderRemotePermissionDialog() {
  return `<dialog class="chat-model-setup pool-surface" data-remote-permission aria-labelledby="chat-remote-permission-title" aria-describedby="chat-remote-permission-body">
    <h2 id="chat-remote-permission-title" data-remote-permission-title></h2>
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
    Promise.resolve().then(() => session.grantRemotePermission(need)).then(() => finish(true), error => { onError(error); finish(false); })
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
  return `<section class="chat-network-details" data-remote-permission-settings aria-labelledby="remote-permission-settings-title">
    <h3 id="remote-permission-settings-title">Contributors' computers</h3>
    <p data-remote-permission-status role="status"></p><ul data-remote-permission-list></ul>
  </section>`;
}

/** Active permissions with their disclosure scope and a way to turn each off. Revoked ones are history only. */
export function updateRemotePermissionSettings(root, state) {
  const active = (state.remotePermissions || []).filter(permission => permission.revokedAt === null);
  const markup = active.map(permission => `<li><span>On: conversations are sent to contributors' computers on this network, ${escape(HOW[permission.disclosure] || permission.disclosure)}, for ${permission.modelIdentities.length} ${permission.modelIdentities.length === 1 ? 'model' : 'models'}.</span>
    <button class="pool-button" type="button" data-revoke-remote-permission="${escape(permission.id)}">Turn off</button></li>`).join('');
  const list = root.querySelector('[data-remote-permission-list]');
  if (list.dataset.projection !== markup) { list.innerHTML = markup; list.dataset.projection = markup; }
  root.querySelector('[data-remote-permission-status]').textContent = active.length ? ''
    : "Off. You are asked before a conversation is sent to contributors' computers.";
  root.querySelector('[data-remote-permission-status]').hidden = !!active.length;
}
