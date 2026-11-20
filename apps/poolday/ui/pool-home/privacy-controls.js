import { createExecutionPolicy } from '../../../../shared/vendor/reploid/chat/execution-policy.js';
import { computerLabel } from './computer-labels.js';

const profiles = [
  ['provider-visible', 'Provider-visible', 'The answering computer can read your prompt.'],
  ['restricted', 'Restricted recipients', 'Only this device or named computers can read your prompt.'],
  ['cryptographic', 'Cryptographic', 'Unavailable for chat.']
];
export const privacyLabel = profile => profiles.find(([key]) => key === profile)?.[1];

export const renderPrivacyControls = () => `<dialog class="chat-model-setup pool-surface pool-small" id="chat-privacy-dialog" data-privacy-dialog aria-labelledby="chat-privacy-title">
  <h2 class="pool-heading" id="chat-privacy-title">Inference privacy</h2>
  <p class="pool-muted" data-privacy-current></p>
  <fieldset class="pool-stack pool-bare pool-gap-sm" data-privacy-controls><legend class="chat-visually-hidden">Inference privacy tier</legend>
    ${profiles.map(([id, label, hint]) => `<label class="chat-model-choice pool-choice pool-button btn-ghost${id === 'cryptographic' ? ' pool-muted' : ''}"><input type="radio" name="chat-privacy-profile" data-privacy-profile value="${id}"${id === 'cryptographic' ? ' disabled' : ''}><span><strong>${label}</strong><span class="pool-muted">${hint}</span></span></label>`).join('')}
    <fieldset class="pool-stack pool-bare pool-gap-xs" data-privacy-placement-controls hidden><legend>Allowed recipients</legend>
      <label><input type="radio" name="chat-privacy-placement" data-privacy-placement value="local-only" checked> This device only</label>
      <label><input type="radio" name="chat-privacy-placement" data-privacy-placement value="named"> Named computers</label>
    </fieldset>
    <label data-privacy-recipients-label hidden>Allowed computer IDs
      <input class="pool-input" data-privacy-recipients autocomplete="off" spellcheck="false" aria-describedby="privacy-recipient-help">
      <span class="pool-muted" id="privacy-recipient-help">Separate computer IDs with commas.</span></label>
  </fieldset>
  <p class="pool-muted">Applies to new messages. Retries keep their original setting.</p>
  <p role="alert" data-privacy-error hidden></p>
  <div class="chat-network-actions"><button type="button" class="pool-button btn-ghost" data-privacy-cancel>Cancel</button><button type="button" class="pool-button btn-primary" data-privacy-apply>Apply</button></div>
</dialog>`;

export function readPrivacyControls(root) {
  const profile = root.querySelector('[data-privacy-profile]:checked').value;
  if (profile === 'restricted' && root.querySelector('[data-privacy-placement][value="named"]').checked) {
    const recipients = [...new Set(root.querySelector('[data-privacy-recipients]').value.split(',').map(id => id.trim()).filter(Boolean))];
    if (!recipients.length) throw new Error('Enter at least one computer ID.');
    return createExecutionPolicy(profile, { placement: 'network-allowed', allowedRecipients: recipients });
  }
  return createExecutionPolicy(profile);
}

export function showPrivacyChoices(root) {
  const restricted = root.querySelector('[data-privacy-profile]:checked')?.value === 'restricted';
  root.querySelector('[data-privacy-placement-controls]').hidden = !restricted;
  root.querySelector('[data-privacy-recipients-label]').hidden = !restricted || !root.querySelector('[data-privacy-placement][value="named"]').checked;
  root.querySelector('[data-privacy-error]').hidden = true;
}

export function updatePrivacyControls(root, privacy) {
  for (const option of root.querySelectorAll('[data-privacy-profile]')) option.checked = option.value === privacy.profile;
  root.querySelector('[data-privacy-recipients]').value = (privacy.allowedRecipients || []).join(', ');
  for (const option of root.querySelectorAll('[data-privacy-placement]')) {
    option.checked = option.value === (privacy.profile === 'restricted' && privacy.placement === 'network-allowed' ? 'named' : 'local-only');
  }
  showPrivacyChoices(root);
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
