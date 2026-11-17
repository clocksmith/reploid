import { createExecutionPolicy } from '../../../../shared/vendor/reploid/chat/execution-policy.js';

export const renderPrivacyControls = () => `<fieldset class="pool-stack pool-gap-xs" data-privacy-controls><legend>Inference privacy</legend>
  <label class="pool-small">Request profile <select class="pool-input" data-privacy-profile>
    <option value="provider-visible">Provider-visible</option><option value="restricted">Restricted recipients</option>
    <option value="cryptographic" disabled>Cryptographic — unavailable</option></select></label>
  <label class="pool-small" data-privacy-recipients-label hidden>Allowed computer identities (comma-separated; empty means this device only)
    <input class="pool-input" data-privacy-recipients autocomplete="off" spellcheck="false"></label>
  <p class="pool-small pool-muted" data-privacy-explanation>Executors can see the data needed for inference. Publication and reuse are not authorized.</p>
  <p class="pool-small pool-muted">Attested hardware execution is unavailable.</p>
  <button type="button" class="pool-button btn-ghost" data-privacy-apply>Apply privacy</button></fieldset>`;

export function readPrivacyControls(root) {
  const profile = root.querySelector('[data-privacy-profile]').value;
  const recipients = [...new Set(root.querySelector('[data-privacy-recipients]').value.split(',').map(value => value.trim()).filter(Boolean))];
  if (profile === 'restricted') return createExecutionPolicy(profile, {
    placement: recipients.length ? 'network-allowed' : 'local-only', allowedRecipients: recipients });
  return createExecutionPolicy(profile);
}

export function updatePrivacyControls(root, privacy, disabled) {
  root.querySelector('[data-privacy-profile]').value = privacy?.profile ?? 'provider-visible';
  root.querySelector('[data-privacy-recipients]').value = (privacy?.allowedRecipients || []).join(', ');
  root.querySelector('[data-privacy-recipients-label]').hidden = privacy?.profile !== 'restricted';
  for (const control of root.querySelectorAll('input, select, button')) control.disabled = disabled;
  root.querySelector('[data-privacy-explanation]').textContent = privacy?.profile === 'restricted'
    ? 'Only this device or the named recipients may receive inference data. This uses ordinary plaintext inference.'
    : 'Executors can see the data needed for inference. Publication and reuse are not authorized.';
}
