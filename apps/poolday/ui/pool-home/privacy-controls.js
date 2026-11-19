import { createExecutionPolicy } from '../../../../shared/vendor/reploid/chat/execution-policy.js';
import { computerLabel } from './computer-labels.js';

const profiles = [
  ['provider-visible', 'Provider-visible', 'The computer running the model can read its input.'],
  ['restricted', 'Restricted recipients', 'Only this device or the computers you name may receive input. They can read it.'],
  ['cryptographic', 'Cryptographic', 'Unavailable for chat.']
];
export const privacyLabel = profile => profiles.find(([key]) => key === profile)?.[1];

export const renderPrivacyControls = () => `<dialog class="chat-model-setup pool-surface pool-small" id="chat-privacy-dialog" data-privacy-dialog aria-labelledby="chat-privacy-title">
  <h2 class="pool-heading" id="chat-privacy-title">Inference privacy</h2>
  <fieldset class="pool-stack pool-bare pool-gap-sm" data-privacy-controls><legend class="chat-visually-hidden">Privacy for future messages in this thread</legend>
    ${profiles.map(([id, label, hint]) => `<label class="chat-privacy-choice${id === 'cryptographic' ? ' pool-muted' : ''}"><input type="radio" name="chat-privacy-profile" data-privacy-profile value="${id}"${id === 'cryptographic' ? ' disabled' : ''}><span><strong>${label}</strong><span class="pool-muted">${hint}</span></span></label>`).join('')}
    <label data-privacy-recipients-label hidden>Allowed computer IDs
      <input class="pool-input" data-privacy-recipients autocomplete="off" spellcheck="false" aria-describedby="privacy-recipient-help">
      <span class="pool-muted" id="privacy-recipient-help">Separate IDs with commas. Leave empty for this device only.</span></label>
  </fieldset>
  <p class="pool-muted">New messages use this setting. Retries keep their original privacy.</p>
  <p role="alert" data-privacy-error hidden></p>
  <div class="chat-network-actions"><button type="button" class="pool-button btn-ghost" data-privacy-cancel>Cancel</button><button type="button" class="pool-button btn-primary" data-privacy-apply>Apply</button></div>
</dialog>`;

export function readPrivacyControls(root) {
  const profile = root.querySelector('[data-privacy-profile]:checked').value;
  const recipients = [...new Set(root.querySelector('[data-privacy-recipients]').value.split(',').map(value => value.trim()).filter(Boolean))];
  if (profile === 'restricted') return createExecutionPolicy(profile, {
    placement: recipients.length ? 'network-allowed' : 'local-only', allowedRecipients: recipients });
  return createExecutionPolicy(profile);
}

export function updatePrivacyControls(root, privacy) {
  for (const option of root.querySelectorAll('[data-privacy-profile]')) option.checked = option.value === privacy.profile;
  root.querySelector('[data-privacy-recipients]').value = (privacy.allowedRecipients || []).join(', ');
  root.querySelector('[data-privacy-recipients-label]').hidden = privacy.profile !== 'restricted';
  // Imported policies can combine requirements which the two editable presets cannot express.
  const preset = privacy.profile !== 'cryptographic' && readPrivacyControls(root);
  const editable = preset && Object.keys(preset).every(key => JSON.stringify(preset[key]) === JSON.stringify(privacy[key]));
  root.querySelector('[data-privacy-controls]').disabled = !editable;
  root.querySelector('[data-privacy-apply]').disabled = !editable;
  const notice = root.querySelector('[data-privacy-error]');
  notice.textContent = editable ? '' : 'This policy has additional requirements and is read-only here.';
  notice.hidden = !!editable;
}

// A disclosure approval can precede a failed attempt. Show only the returned execution receipt.
export function answerPrivacy(execution, state) {
  const receipt = execution?.privacy;
  const label = receipt?.schema === 'reploid.privacy-receipt/v1' && privacyLabel(receipt.profile);
  if (!label || !Array.isArray(receipt.recipients) || !receipt.recipients.every(id => typeof id === 'string' && id.length)) {
    return ['Privacy unrecorded', 'This answer has no recorded inference privacy tier.'];
  }
  const names = [...new Set(receipt.recipients)].map(id => computerLabel(state || {}, id));
  if (!names.length && execution.placement === 'local-webgpu') names.push('This device');
  const summary = names.length > 1 ? `${names.length} computers` : names[0];
  return [[label, summary].filter(Boolean).join(' · '), [label, ...names].join(' · ')];
}
