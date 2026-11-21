import { createExecutionPolicy, validateExecutionPolicy } from '../../../../shared/vendor/reploid/chat/execution-policy.js';
import { computerLabel } from './computer-labels.js';

export const privacyLabel = policy => policy.placement === 'local-only' ? 'This device only'
  : policy.recipients.kind === 'named' ? 'Named recipients'
    : policy.recipients.kind === 'open' ? 'Eligible network recipients' : 'No network recipients';

export function allowsOpenPlaintext(policy) {
  return policy?.schema === 'reploid.execution-policy/v2' && policy.placement === 'network-allowed' && policy.recipients?.kind === 'open'
    && policy.computation === 'plaintext' && !policy.attestation && !policy.protocol && !policy.keyContext
    && policy.collusion === 'none' && policy.retention === 'execution-and-recovery'
    && ['model-id', 'timing', 'length', 'access-patterns', 'plaintext'].every(item => policy.leakage?.includes(item));
}

export const renderPrivacyControls = () => `<dialog class="chat-model-setup pool-surface pool-small" id="chat-privacy-dialog" data-privacy-dialog aria-labelledby="chat-privacy-title">
  <h2 class="pool-heading" id="chat-privacy-title">Execution and disclosure</h2>
  <fieldset class="pool-stack pool-bare pool-gap-sm" data-privacy-controls>
    <legend class="chat-visually-hidden">Execution and disclosure policy</legend>
    <label>Where inference can run
      <select class="pool-input" data-privacy-placement>
        <option value="local-only">This device only</option>
        <option value="network-allowed">Allow network execution</option>
      </select>
    </label>
    <fieldset class="pool-stack pool-bare pool-gap-xs" data-privacy-recipient-controls hidden disabled><legend>Who can receive input</legend>
      <select class="pool-input" data-privacy-recipient-mode aria-label="Eligible recipients">
        <option value="none">No network recipients</option>
        <option value="named">Named recipients only</option>
        <option value="open">Any eligible recipient, subject to approval</option>
      </select>
      <label data-privacy-recipients-label hidden>Recipient IDs
        <input class="pool-input" data-privacy-recipients autocomplete="off" spellcheck="false" aria-describedby="privacy-recipient-help">
        <span class="pool-muted" id="privacy-recipient-help">Separate IDs with commas.</span></label>
    </fieldset>
    <label>Computation
      <select class="pool-input" data-privacy-computation>
        <option value="plaintext">Plaintext: the worker can read its input</option>
        <option value="cryptographic" disabled>Cryptographic computation (unavailable)</option>
        <option value="attested" disabled>Attested execution (unavailable)</option>
      </select>
    </label>
  </fieldset>
  <p class="pool-muted">Applies to new messages. Retries keep their original policy.</p>
  <p role="alert" data-privacy-error hidden></p>
  <div class="chat-network-actions"><button type="button" class="pool-button btn-ghost" data-privacy-cancel>Cancel</button><button type="button" class="pool-button btn-primary" data-privacy-apply>Apply</button></div>
</dialog>`;

export function readPrivacyControls(root) {
  const placement = root.querySelector('[data-privacy-placement]').value;
  const kind = placement === 'local-only' ? 'none' : root.querySelector('[data-privacy-recipient-mode]').value;
  const computation = root.querySelector('[data-privacy-computation]').value;
  if (computation !== 'plaintext') throw new Error('Only plaintext computation is available.');
  const ids = kind === 'named' ? root.querySelector('[data-privacy-recipients]').value.split(',').map(id => id.trim()) : [];
  if (kind === 'named' && !ids.some(Boolean)) throw new Error('Enter at least one recipient ID.');
  if (ids.some(id => !id)) throw new Error('Remove empty recipient IDs.');
  return createExecutionPolicy({ placement, recipients: { kind, ids }, computation });
}

export function showPrivacyChoices(root) {
  const remote = root.querySelector('[data-privacy-placement]')?.value === 'network-allowed';
  const recipients = root.querySelector('[data-privacy-recipient-controls]');
  recipients.hidden = !remote;
  recipients.disabled = !remote;
  root.querySelector('[data-privacy-recipients-label]').hidden = !remote
    || root.querySelector('[data-privacy-recipient-mode]')?.value !== 'named';
  root.querySelector('[data-privacy-error]').hidden = true;
}

export function updatePrivacyControls(root, privacy) {
  const fields = root.querySelector('[data-privacy-controls]');
  const apply = root.querySelector('[data-privacy-apply]');
  const notice = root.querySelector('[data-privacy-error]');
  let editable = false;
  try {
    const policy = validateExecutionPolicy(privacy);
    root.querySelector('[data-privacy-placement]').value = policy.placement;
    root.querySelector('[data-privacy-recipient-mode]').value = policy.recipients.kind;
    root.querySelector('[data-privacy-computation]').value = policy.computation;
    root.querySelector('[data-privacy-recipients]').value = policy.recipients.ids.join(', ');
    const preset = readPrivacyControls(root);
    editable = Object.keys(preset).every(key => JSON.stringify(preset[key]) === JSON.stringify(policy[key]));
  } catch { /* Unsupported policies must not be converted to plaintext by opening this dialog. */ }
  showPrivacyChoices(root);
  fields.disabled = !editable;
  apply.disabled = !editable;
  notice.textContent = editable ? '' : 'This policy has unavailable or additional requirements and is read-only here.';
  notice.hidden = editable;
}

// Authorization is not evidence that computation happened or that the worker was honest.
export function answerPrivacy(execution, state) {
  const receipt = execution?.privacy;
  if (receipt?.schema !== 'reploid.privacy-receipt/v2' || receipt.computation !== 'plaintext'
    || !Array.isArray(receipt.recipients) || !receipt.recipients.every(id => typeof id === 'string' && id.length)) {
    return ['Disclosure unrecorded', 'This answer has no supported execution disclosure receipt.'];
  }
  const names = [...new Set(receipt.recipients)].map(id => computerLabel(state || {}, id));
  if (!names.length && execution.placement === 'local-webgpu') names.push('This device');
  const summary = names.length > 1 ? `${names.length} computers` : names[0];
  return [['Plaintext', summary].filter(Boolean).join(' · '), ['Plaintext', ...names].join(' · ')];
}
