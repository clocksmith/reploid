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
    ${row('sequence-public', 'This sequence is public', sequenceConsentAttributes)}
    ${includeSavedNotice ? '<strong data-pool-sequence-consent-saved hidden>Saved</strong>' : ''}
    ${row('research-public', 'Save the question and result to this room')}
  `;
}

export function renderRequesterIntentFields({
  prefix,
  textTag = 'input',
  requestAttributes = '',
  compact = false
} = {}) {
  const safePrefix = escapeHtml(prefix);
  const intentOptionsMarkup = intentOptions
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join('');
  const textControl = textTag === 'textarea'
    ? `<textarea id="${safePrefix}-intent-text" rows="3" maxlength="8000" placeholder="What do you want to learn?"${requestAttributes}></textarea>`
    : `<input id="${safePrefix}-intent-text" maxlength="8000" placeholder="What do you want to learn?"${requestAttributes}>`;
  if (compact) {
    return `
      <div class="pool-research-intent-fields pool-research-intent-fields--compact">
        <label><span>Question</span>${textControl}</label>
        <details class="pool-advanced pool-question-contract">
          <summary>Add details</summary>
          <div class="pool-research-intent-fields">
            <label><span>Conditions</span><textarea id="${safePrefix}-intent-conditions" rows="2" maxlength="2000" placeholder="System, environment, or assay"${requestAttributes}></textarea></label>
            <label><span>Useful result</span><textarea id="${safePrefix}-intent-observation" rows="2" maxlength="2000" placeholder="What result would answer the question?"${requestAttributes}></textarea></label>
            <label><span>Decision</span><input id="${safePrefix}-intent-decision" maxlength="2000" placeholder="What will this evidence inform?"${requestAttributes}></label>
            <label><span>Scope</span><input id="${safePrefix}-intent-scope" maxlength="2000" placeholder="What is included?"${requestAttributes}></label>
            <label><span>Exclusions</span><input id="${safePrefix}-intent-exclusions" maxlength="2000" placeholder="What is not claimed?"${requestAttributes}></label>
            <label><span>Unknowns</span><textarea id="${safePrefix}-intent-unknowns" rows="2" maxlength="2000" placeholder="Missing evidence or confounders"${requestAttributes}></textarea></label>
          </div>
        </details>
      </div>
    `;
  }
  return `
    <div class="pool-research-intent-fields">
      <label><span>Intent</span><select id="${safePrefix}-intent-kind"${requestAttributes}>${intentOptionsMarkup}</select></label>
      <label><span>Short label</span><input id="${safePrefix}-intent-label" maxlength="240" placeholder="Signal peptide candidate"${requestAttributes}></label>
      <label><span>Question, hypothesis, or context <small>(required for public research)</small></span>${textControl}</label>
      <details class="pool-advanced pool-question-contract">
        <summary>Bound the research question</summary>
        <div class="pool-research-intent-fields">
          <label><span>Conditions</span><textarea id="${safePrefix}-intent-conditions" rows="2" maxlength="2000" placeholder="Organism, system, environment, or assay conditions"${requestAttributes}></textarea></label>
          <label><span>Observation that would resolve it</span><textarea id="${safePrefix}-intent-observation" rows="2" maxlength="2000" placeholder="What observable result would distinguish the possibilities?"${requestAttributes}></textarea></label>
          <label><span>Decision context</span><input id="${safePrefix}-intent-decision" maxlength="2000" placeholder="Which human decision may this evidence inform?"${requestAttributes}></label>
          <label><span>Scope</span><input id="${safePrefix}-intent-scope" maxlength="2000" placeholder="What is included?"${requestAttributes}></label>
          <label><span>Exclusions</span><input id="${safePrefix}-intent-exclusions" maxlength="2000" placeholder="What does this question not claim?"${requestAttributes}></label>
          <label><span>Known unknowns</span><textarea id="${safePrefix}-intent-unknowns" rows="2" maxlength="2000" placeholder="Known uncertainty, missing evidence, or confounders"${requestAttributes}></textarea></label>
        </div>
      </details>
    </div>
  `;
}

export default { renderRequesterConsentRows, renderRequesterIntentFields };
