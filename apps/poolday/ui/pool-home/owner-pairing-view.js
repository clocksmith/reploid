import { parseOwnerPairingUrl } from '../../host/owner-pairing.js';
import { bindDialog } from '../components/dialog.js';
import { renderDialog } from '../components/choices.js';

export function bindOwnerPairingLink(root, port, url) {
  const target = parseOwnerPairingUrl(url.href);
  if (!target || !port) return () => {};

  // The dialog shell: its body changes from request to waiting to result; the reserved status line and
  // the pinned footer keep its size from first paint.
  root.insertAdjacentHTML('beforeend', renderDialog({ titleId: 'owner-pairing-title', title: '', attrs: { 'data-owner-pairing-link': true },
    closeAttrs: { 'data-pairing-close': true },
    body: `<p class="pool-status-line pool-small" role="status" data-pairing-message hidden></p>
      <details class="pool-disclosure pool-disclosure-quiet"><summary>Details</summary><div class="pool-stack pool-gap-sm">
        <p class="pool-caption pool-muted" data-pairing-identity></p>
        <p class="pool-caption pool-muted" data-pairing-connection hidden></p>
      </div></details>`,
    footer: '<button class="pool-button btn-primary" type="button" data-pairing-connect>Connect</button>' }));
  const dialog = root.querySelector('[data-owner-pairing-link]');
  const title = dialog.querySelector('h2');
  const message = dialog.querySelector('[data-pairing-message]');
  const action = dialog.querySelector('[data-pairing-connect]');
  const connection = dialog.querySelector('[data-pairing-connection]');
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const modal = bindDialog(dialog);
  const { location, history } = root.ownerDocument.defaultView;
  const name = target.hostLabel || 'your desktop';
  let finished = false;

  title.textContent = `Connect to ${name}`;
  dialog.querySelector('[data-pairing-identity]').textContent = `Desktop ID: ${target.hostParticipantId}`;
  function forgetLink() {
    if (location.hash === url.hash) history.replaceState(history.state, '', location.pathname + location.search);
  }
  function showResult(heading, text, detail) {
    finished = true;
    title.textContent = heading;
    message.textContent = text;
    message.hidden = !text;
    connection.textContent = detail || '';
    connection.hidden = !detail;
    action.textContent = 'Done';
    action.disabled = false;
    action.focus({ preventScroll: true });
    forgetLink();
  }
  action.addEventListener('click', async () => {
    if (finished) { modal.close(); return; }
    action.disabled = true;
    title.textContent = 'Approve on your desktop';
    action.textContent = 'Waiting for approval…';
    try {
      const result = await port.pair({ ...target, signal: controller.signal });
      if (controller.signal.aborted || !dialog.open) return;
      const path = port.state().transportPath;
      showResult(target.hostLabel ? `Paired with ${result.hostLabel}` : 'Desktop paired', '', path ? `Connection: ${path}` : '');
    } catch (error) {
      if (controller.signal.aborted || !dialog.open) return;
      showResult('Couldn’t connect', 'Open a new pairing link from your desktop.', error.message);
    }
  }, options);
  dialog.querySelector('[data-pairing-close]').addEventListener('click', () => modal.close(), options);
  dialog.addEventListener('close', () => {
    forgetLink();
    controller.abort();
    dialog.remove();
    modal.dispose();
  }, options);
  modal.open(action);

  return () => {
    controller.abort();
    modal.dispose();
    dialog.remove();
  };
}

/**
 * One path for people: scan the code your desktop shows, or paste its link. The raw fields the link carries
 * (desktop ID, code, room) stay behind a quiet disclosure for experts.
 */
export const renderOwnerPairingControls = () => `
  <details class="pool-disclosure pool-disclosure-quiet" data-owner-pairing hidden>
    <summary><span class="pool-row-text"><span class="pool-row-title">Connect a desktop</span><span class="pool-row-status" data-owner-pairing-state>Not paired</span></span></summary>
    <div class="pool-stack pool-gap-md">
      <p class="pool-small pool-muted">Start Reploid on your desktop. Scan the code it shows with this device’s camera, or paste the pairing link here.</p>
      <form class="pool-stack pool-gap-sm" data-owner-pairing-form>
        <label class="pool-stack pool-gap-xs pool-small">Pairing link<input class="pool-input" name="link" type="url" placeholder="Paste the link from your desktop" autocomplete="off"></label>
        <div class="pool-row pool-gap-md"><button class="pool-button btn-primary" type="submit">Connect</button><p class="pool-status-line pool-small pool-muted pool-grow" role="status" data-owner-pairing-status></p></div>
        <details class="pool-disclosure pool-disclosure-quiet" data-pairing-manual>
          <summary class="pool-small">Enter the details by hand (for experts)</summary>
          <div class="pool-stack pool-gap-sm">
            <label class="pool-stack pool-gap-xs pool-small">Desktop ID<input class="pool-input" name="hostParticipantId" type="text" placeholder="peer:…" autocomplete="off" spellcheck="false"></label>
            <label class="pool-stack pool-gap-xs pool-small">Pairing code<input class="pool-input" name="code" type="text" autocomplete="off" spellcheck="false"></label>
            <label class="pool-stack pool-gap-xs pool-small">Desktop name (optional)<input class="pool-input" name="hostLabel" type="text" placeholder="Alex’s PC" autocomplete="off"></label>
            <label class="pool-stack pool-gap-xs pool-small">Network room (optional)<input class="pool-input" name="roomId" type="text" placeholder="reploid-swarm-…" autocomplete="off" spellcheck="false"></label>
          </div>
        </details>
      </form>
      <button class="pool-button btn-ghost" type="button" data-owner-pairing-unpair hidden>Forget computer</button>
    </div>
  </details>`;

export function bindOwnerPairingControls(root, session, { initialUrl = '' } = {}) {
  const panel = root.querySelector('[data-owner-pairing]');
  const port = session?.ownerPairing;
  if (!panel || !port) return { update() {}, dispose() {} };

  const find = selector => panel.querySelector(selector);
  const stateNode = find('[data-owner-pairing-state]');
  const form = find('[data-owner-pairing-form]');
  const submit = form.querySelector('button[type="submit"]');
  const unpairButton = find('[data-owner-pairing-unpair]');
  const statusNode = find('[data-owner-pairing-status]');
  const controller = new AbortController();
  const options = { signal: controller.signal };

  panel.hidden = false;

  function applyPairingLink(raw) {
    const parsed = parseOwnerPairingUrl(raw);
    if (!parsed) return false;
    form.elements.hostParticipantId.value = parsed.hostParticipantId;
    form.elements.code.value = parsed.code;
    form.elements.hostLabel.value = parsed.hostLabel || '';
    form.elements.roomId.value = parsed.roomId || '';
    panel.open = true;
    statusNode.textContent = '';
    return true;
  }

  if (initialUrl) applyPairingLink(initialUrl);

  function render(snapshot) {
    const current = snapshot?.ownerPairing || port.state();
    const busy = current.status === 'pairing';
    submit.disabled = busy;
    unpairButton.hidden = !current.paired;

    if (current.status === 'pairing') {
      stateNode.textContent = `Waiting for desktop confirmation on ${current.hostLabel}…`;
    } else if (current.status === 'online') {
      const pathSuffix = current.transportPath ? ` · ${current.transportPath}` : '';
      const modelSuffix = current.readyModel ? ` · ${current.readyModel}` : '';
      stateNode.textContent = `Paired with ${current.hostLabel} · Online${pathSuffix}${modelSuffix}`;
    } else if (current.status === 'offline') {
      stateNode.textContent = `${current.hostLabel} · Offline`;
    } else {
      stateNode.textContent = 'Not paired';
    }

    if (current.error) statusNode.textContent = current.error;
  }

  form.elements.link.addEventListener('input', () => {
    const value = form.elements.link.value.trim();
    if (!value || applyPairingLink(value)) return;
    for (const name of ['hostParticipantId', 'hostLabel', 'roomId', 'code']) form.elements[name].value = '';
  }, options);

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (form.elements.link.value.trim() && !applyPairingLink(form.elements.link.value)) {
      statusNode.textContent = 'Paste a valid desktop pairing link.';
      return;
    }
    const hostParticipantId = form.elements.hostParticipantId.value.trim();
    const hostLabel = form.elements.hostLabel.value.trim();
    const roomId = form.elements.roomId.value.trim();
    const code = form.elements.code.value.trim();
    if (!hostParticipantId || !code) {
      find('[data-pairing-manual]').open = true;
      statusNode.textContent = 'Paste the pairing link from your desktop, or enter its ID and code by hand.';
      form.elements[hostParticipantId ? 'code' : 'hostParticipantId'].focus();
      return;
    }
    statusNode.textContent = 'Approve on your desktop.';
    void port.pair({
      hostParticipantId,
      code,
      ...(hostLabel ? { hostLabel } : {}),
      ...(roomId ? { roomId } : {})
    })
      .then(result => {
        if (controller.signal.aborted) return;
        form.elements.code.value = '';
        form.elements.link.value = '';
        statusNode.textContent = `Paired with ${result.hostLabel}.`;
        render(session?.getState?.());
      })
      .catch(cause => {
        if (controller.signal.aborted) return;
        statusNode.textContent = cause?.message || 'Pairing failed';
        render(session?.getState?.());
      });
  }, options);

  unpairButton.addEventListener('click', () => {
    port.unpair();
    statusNode.textContent = 'Computer forgotten. Pair again to authorize a computer.';
    render(session?.getState?.());
  }, options);

  render(session?.getState?.());
  return { update: render, dispose: () => controller.abort() };
}
