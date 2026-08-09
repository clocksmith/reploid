/**
 * @fileoverview Shared requester consent and intent controls for the Research Room surfaces.
 */

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const intentOptions = [
  ['question', 'Question'],
  ['hypothesis', 'Hypothesis'],
  ['label', 'Label'],
  ['task_context', 'Task context']
];

export function renderRequesterConsentRows({
  prefix,
  includeSavedNotice = false,
  rowElement = 'label',
  sequenceConsentAttributes = '',
  requestAttributes = ''
} = {}) {
  const safePrefix = escapeHtml(prefix);
  const safeRowElement = rowElement === 'span' ? 'span' : 'label';
  const row = (id, label, attributes = '') => `
    <${safeRowElement} class="pool-consent-row"${attributes}>
      <input id="${safePrefix}-${id}" type="checkbox"${requestAttributes}>
      <span>${label}</span>
    </${safeRowElement}>
  `;
  return `
    ${row('sequence-public', 'I confirm this protein sequence is public.', sequenceConsentAttributes)}
    ${includeSavedNotice ? '<strong data-pool-sequence-consent-saved hidden>Public-sequence acknowledgement saved.</strong>' : ''}
    ${row('research-public', 'Publish this sequence, intent, accepted embedding, and provenance to the public evidence network.')}
  `;
}

export function renderRequesterIntentFields({
  prefix,
  textTag = 'input',
  requestAttributes = ''
} = {}) {
  const safePrefix = escapeHtml(prefix);
  const intentOptionsMarkup = intentOptions
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join('');
  const textControl = textTag === 'textarea'
    ? `<textarea id="${safePrefix}-intent-text" rows="3" maxlength="8000"${requestAttributes}></textarea>`
    : `<input id="${safePrefix}-intent-text" maxlength="8000" placeholder="What should reviewers examine?"${requestAttributes}>`;
  return `
    <div class="pool-research-intent-fields">
      <label><span>Intent</span><select id="${safePrefix}-intent-kind"${requestAttributes}>${intentOptionsMarkup}</select></label>
      <label><span>Short label</span><input id="${safePrefix}-intent-label" maxlength="240" placeholder="Signal peptide candidate"${requestAttributes}></label>
      <label><span>Question, hypothesis, or context <small>(optional)</small></span>${textControl}</label>
    </div>
  `;
}

export default { renderRequesterConsentRows, renderRequesterIntentFields };
