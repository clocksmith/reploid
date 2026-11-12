/**
 * @fileoverview Computers view of the computer-preferences store: local names for verified
 * computers and the optional GPU check. The store (persistence, validation, measurement)
 * is host/computer-preferences.js, passed in through the product session.
 */
import policy from '../../config/computer-preferences.json' with { type: 'json' };
import { setComputerNames, setBlockedComputers } from './computer-labels.js';
import { hardwareText } from './execution-ribbon.js';

export const renderComputerDiagnostic = () => `<details class="pool-disclosure" data-computer-diagnostic hidden>
  <summary>GPU check (optional)</summary><div class="pool-stack pool-gap-sm">
  <p class="pool-caption pool-muted">Runs a small test on this device’s GPU. Measurements and saved names stay in this browser. This check does not verify a computer’s identity.</p>
  <div class="pool-row pool-gap-sm"><button class="pool-button" type="button" data-gpu-check>Run GPU check</button><button class="pool-button" type="button" data-gpu-stop hidden>Stop check</button></div>
  <p class="pool-small" role="status" data-gpu-result>No measurement yet.</p>
  <p class="pool-caption pool-muted" data-gpu-hardware hidden></p>
  <p class="pool-caption pool-muted" data-gpu-baseline>No baseline saved.</p>
  <div class="pool-row pool-gap-sm"><button class="pool-button btn-ghost" type="button" data-gpu-save disabled>Save baseline</button><button class="pool-button btn-ghost" type="button" data-gpu-clear hidden>Clear baseline</button></div>
  </div></details>`;

/** These are local aliases for verified keys, not names supplied by a peer. */
export const renderComputerRename = () => `<form class="pool-stack pool-gap-xs" data-computer-rename hidden>
  <label class="pool-field"><span>Name on this device</span><input class="pool-input" data-computer-name-input maxlength="${policy.maxLabelLength}" autocomplete="off"></label>
  <p class="pool-caption pool-muted">Leave blank to use the generated name. This name is saved only here.</p>
  <button class="pool-button btn-ghost" type="submit">Save name</button></form>`;

/** A local choice about where this device sends its own requests. It is not a network-level ban. */
export const renderComputerBlock = () => `<div class="pool-stack pool-gap-xs" data-computer-block hidden>
  <button class="pool-button btn-ghost" type="button" data-computer-block-toggle>Block</button>
  <p class="pool-caption pool-muted" data-computer-block-note></p></div>`;

export function bindComputerPreferences(root, preferences, session, refresh) {
  const section = root.querySelector('[data-computer-diagnostic]');
  if (!preferences || !section) return { update() {}, dispose() {} };
  const controller = new AbortController(), options = { signal: controller.signal };
  const find = selector => section.querySelector(selector);
  const status = root.ownerDocument.createElement('p');
  status.className = 'pool-small'; status.setAttribute('role', 'status');
  section.before(status);
  const observe = operation => Promise.resolve().then(operation).catch(cause => { status.textContent = cause.message; });
  const update = () => {
    const view = preferences.getState();
    setComputerNames(session, view.names);
    setBlockedComputers(session, view.blocked);
    section.hidden = false;
    for (const block of root.querySelectorAll('[data-computer-block]')) {
      const row = block.closest('[data-computer-id]'), blocked = row.dataset.blocked === 'true';
      const identity = /^peer:[a-f0-9]{24}$/.test(row.dataset.computerParticipant || '') ? row.dataset.computerParticipant : '';
      const button = block.querySelector('button');
      block.hidden = false;
      button.textContent = blocked ? 'Unblock' : 'Block';
      button.disabled = view.busy;
      block.querySelector('[data-computer-block-note]').textContent = !blocked
        ? 'Your requests will not be sent to this computer. Saved only on this device; it can still see the network.'
        : identity && view.blocked.includes(identity) ? 'Your requests are not sent to this computer. Saved only on this device; it can still see the network.'
        : 'Your requests are not sent over this connection. Its identity was not verified, so the block may not apply after it reconnects.';
    }
    for (const form of root.querySelectorAll('[data-computer-rename]')) {
      const identity = form.closest('[data-computer-id]').dataset.computerParticipant || '';
      const input = form.querySelector('input');
      form.hidden = !/^peer:[a-f0-9]{24}$/.test(identity);
      if (form.dataset.identity !== identity || !input.dataset.edited && root.ownerDocument.activeElement !== input) {
        input.value = view.names[identity] || '';
        delete input.dataset.edited;
      }
      form.dataset.identity = identity;
      form.querySelector('button').disabled = view.busy;
      input.disabled = view.busy;
    }
    status.textContent = view.error;
    status.hidden = !view.error;
    find('[data-gpu-check]').disabled = view.busy;
    find('[data-gpu-stop]').hidden = view.operation !== 'gpu';
    find('[data-gpu-save]').disabled = view.busy || !view.canSave;
    find('[data-gpu-clear]').hidden = !view.baselineStored;
    find('[data-gpu-clear]').disabled = view.busy;
    find('[data-gpu-baseline]').textContent = view.baselineAt ? `Baseline saved: ${view.baselineAt}`
      : view.baselineStored ? 'Saved baseline could not be validated. Clear it or replace it after a new check.' : 'No baseline saved.';
    const comparison = view.comparison;
    const hardware = hardwareText(view.latest?.hardware);
    find('[data-gpu-hardware]').hidden = !hardware;
    find('[data-gpu-hardware]').textContent = hardware ? `Reported GPU for this check: ${hardware}` : '';
    find('[data-gpu-result]').textContent = view.operation === 'gpu' ? 'Measuring this device…'
      : view.latest?.status === 'unavailable' ? `GPU check unavailable: ${view.latest.reason}`
      : view.baselineFromCurrent ? 'Baseline saved from this measurement. Run another check to compare.'
      : view.latest?.status === 'measured' ? comparison.distance !== null
        ? `Comparison uncertain. Distance ${comparison.distance.toFixed(4)}; observed variability ${comparison.variability.toFixed(4)}. Recognition thresholds have not been established.`
        : 'Measurement complete. Save a baseline to compare a later check. This is not proof of GPU identity.'
      : 'No measurement yet.';
  };
  // The rows are redrawn from the new preferences, then the row controls from the redrawn rows.
  const unsubscribe = preferences.subscribe(() => { update(); refresh(); update(); });
  root.addEventListener('input', event => {
    if (event.target.matches('[data-computer-name-input]')) event.target.dataset.edited = 'true';
  }, options);
  root.addEventListener('click', event => {
    const button = event.target.closest?.('[data-computer-block-toggle]');
    if (!button || !root.contains(button)) return;
    const row = button.closest('[data-computer-id]'), id = row.dataset.computerId;
    const participantId = /^peer:[a-f0-9]{24}$/.test(row.dataset.computerParticipant || '') ? row.dataset.computerParticipant : null;
    void observe(async () => {
      if (row.dataset.blocked === 'true') preferences.unblock(id, { participantId });
      else await preferences.block(id, { participantId });
    });
  }, options);
  root.addEventListener('submit', event => {
    const form = event.target.closest('[data-computer-rename]');
    if (!form || !root.contains(form)) return;
    event.preventDefault();
    const id = form.closest('[data-computer-id]').dataset.computerId;
    const participantId = form.dataset.identity;
    if (!participantId) return;
    void observe(async () => {
      await preferences.rename(id, form.querySelector('input').value, { participantId });
      if (form.dataset.identity === participantId) delete form.querySelector('input').dataset.edited;
      update();
    });
  }, options);
  find('[data-gpu-check]').addEventListener('click', () => { void observe(() => preferences.measure({ consent: true })); }, options);
  find('[data-gpu-stop]').addEventListener('click', () => preferences.cancel(), options);
  find('[data-gpu-save]').addEventListener('click', () => { void observe(() => preferences.saveBaseline()); }, options);
  find('[data-gpu-clear]').addEventListener('click', () => { void observe(() => preferences.clearBaseline()); }, options);
  return { update, dispose() { controller.abort(); unsubscribe(); status.remove(); } };
}
