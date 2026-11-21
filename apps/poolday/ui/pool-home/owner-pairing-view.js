import { parseOwnerPairingUrl } from '../../host/owner-pairing.js';

export const renderOwnerPairingControls = () => `
  <details class="pool-disclosure" data-owner-pairing hidden>
    <summary>Pair your desktop (cellular)</summary>
    <div class="pool-stack pool-gap-sm">
      <p class="pool-small" data-owner-pairing-state>Not paired</p>
      <p class="pool-small" data-owner-pairing-readable hidden></p>
      <p class="pool-caption" data-owner-pairing-notice hidden></p>
      <form class="pool-stack pool-gap-sm" data-owner-pairing-form>
        <p class="pool-caption pool-muted">Scan the QR link or paste the one-time code from your desktop terminal, then approve on the desktop. No local address or room-token file is needed.</p>
        <label>Pairing link (optional)<input class="pool-input" name="link" type="url" placeholder="https://replo.id/#pair=..." autocomplete="off"></label>
        <label>Desktop ID<input class="pool-input" name="hostParticipantId" type="text" placeholder="peer:..." autocomplete="off" spellcheck="false" required></label>
        <label>Desktop name (optional)<input class="pool-input" name="hostLabel" type="text" placeholder="Alex's PC" autocomplete="off"></label>
        <label>One-time pairing code<input class="pool-input" name="code" type="text" autocomplete="off" spellcheck="false" required></label>
        <button class="pool-button btn-primary" type="submit">Request desktop approval</button>
      </form>
      <button class="pool-button btn-ghost" type="button" data-owner-pairing-unpair hidden>Unpair desktop</button>
      <p class="pool-caption" role="status" data-owner-pairing-status></p>
    </div>
  </details>`;

export function bindOwnerPairingControls(root, session, { initialUrl = globalThis.location?.href || '' } = {}) {
  const panel = root.querySelector('[data-owner-pairing]');
  const port = session?.ownerPairing;
  if (!panel || !port) return { update() {}, dispose() {} };

  const find = selector => panel.querySelector(selector);
  const stateNode = find('[data-owner-pairing-state]');
  const readableNode = find('[data-owner-pairing-readable]');
  const noticeNode = find('[data-owner-pairing-notice]');
  const form = find('[data-owner-pairing-form]');
  const submit = form.querySelector('button');
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
    if (parsed.hostLabel) form.elements.hostLabel.value = parsed.hostLabel;
    panel.open = true;
    statusNode.textContent = 'Pairing details loaded. Confirm to request desktop approval.';
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
      stateNode.textContent = `Paired with ${current.hostLabel} · Offline (prompts will not be sent to another computer)`;
    } else {
      stateNode.textContent = 'Not paired';
    }

    if (current.disclosure) {
      readableNode.hidden = false;
      noticeNode.hidden = false;
      readableNode.textContent = current.disclosure.readableBy;
      noticeNode.textContent = current.disclosure.notice;
    } else {
      readableNode.hidden = true;
      noticeNode.hidden = true;
      readableNode.textContent = '';
      noticeNode.textContent = '';
    }

    if (current.error) statusNode.textContent = current.error;
  }

  form.elements.link.addEventListener('input', () => {
    const value = form.elements.link.value.trim();
    if (value) applyPairingLink(value);
  }, options);

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const hostParticipantId = form.elements.hostParticipantId.value.trim();
    const hostLabel = form.elements.hostLabel.value.trim();
    const code = form.elements.code.value.trim();
    statusNode.textContent = 'Waiting for approval on your desktop terminal…';
    void port.pair({ hostParticipantId, code, ...(hostLabel ? { hostLabel } : {}) })
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
    statusNode.textContent = 'Desktop unpaired. Pair again to authorize a computer.';
    render(session?.getState?.());
  }, options);

  render(session?.getState?.());
  return { update: render, dispose: () => controller.abort() };
}
