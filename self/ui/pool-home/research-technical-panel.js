/**
 * @fileoverview Consent-aware technical evidence disclosures for Research Room records.
 *
 * This module only presents metadata already carried by signed records. It
 * never exposes raw vectors or sequence values without their publication
 * consent and never creates or persists evidence.
 */

import { compactHash } from './research-panels.js';

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const publicationState = (allowed) => allowed === true ? 'permitted' : 'withheld';

export const renderSequenceDisclosure = (record = {}) => {
  if (record.kind !== 'research_submission') return '';
  if (record.consent?.publicSequence === true) {
    return `<code data-research-sequence>${escapeHtml(record.sequence?.value || '')}</code>`;
  }
  return `<p class="type-caption" data-research-sequence-withheld>Sequence value withheld. Hash ${escapeHtml(compactHash(record.sequence?.hash))} remains available for provenance.</p>`;
};

export const renderTechnicalEvidencePanel = ({
  record = {},
  publication = record.consent || {},
  reviewState = 'unresolved',
  invalidated = false
} = {}) => {
  const isResult = record.kind === 'research_result';
  const isSubmission = record.kind === 'research_submission';
  return `
    <details class="pool-research-technical-evidence">
      <summary>Technical evidence</summary>
      <dl class="pool-research-technical-facts">
        <div><dt>Record hash</dt><dd>${escapeHtml(record.recordHash || 'unknown')}</dd></div>
        <div><dt>Room</dt><dd>${escapeHtml(record.roomId || 'unknown')}</dd></div>
        <div><dt>Review state</dt><dd>${escapeHtml(reviewState)}</dd></div>
        <div><dt>History state</dt><dd>${escapeHtml(invalidated ? 'invalidated' : 'active')}</dd></div>
        ${isSubmission ? `<div><dt>Sequence hash</dt><dd>${escapeHtml(record.sequence?.hash || 'unknown')}</dd></div><div><dt>Sequence publication</dt><dd>${escapeHtml(publicationState(publication.publicSequence === true))}</dd></div><div><dt>Sequence length</dt><dd>${escapeHtml(record.sequence?.length || 'not published')}</dd></div>` : ''}
        ${isResult ? `<div><dt>Source submission</dt><dd>${escapeHtml(compactHash(record.submissionHash))}</dd></div><div><dt>Receipt</dt><dd>${escapeHtml(record.compute?.receiptHash || 'unknown')}</dd></div><div><dt>Model</dt><dd>${escapeHtml(record.modelContract?.id || 'unknown')}</dd></div><div><dt>Model hash</dt><dd>${escapeHtml(record.modelContract?.hash || 'unknown')}</dd></div><div><dt>Manifest</dt><dd>${escapeHtml(record.modelContract?.manifestHash || 'unknown')}</dd></div><div><dt>Runtime</dt><dd>${escapeHtml(record.modelContract?.runtime || 'unknown')} / ${escapeHtml(record.modelContract?.backend || 'unknown')}</dd></div><div><dt>Route decision</dt><dd>${escapeHtml(record.compute?.routeDecisionHash || 'none')}</dd></div><div><dt>Runtime profile</dt><dd>${escapeHtml(record.compute?.runtimeProfileHash || 'none')}</dd></div><div><dt>Assignment</dt><dd>${escapeHtml(record.compute?.assignmentId || 'none')}</dd></div><div><dt>Embedding publication</dt><dd>${escapeHtml(publicationState(publication.publishEmbedding === true))}</dd></div><div><dt>Residue evidence</dt><dd>${escapeHtml(publicationState(publication.publishResidueEvidence === true))}</dd></div>` : ''}
      </dl>
      ${isResult ? '<p class="type-caption">Raw vectors, residue values, and unpublished sequence values remain outside this disclosure unless their signed publication consent exists.</p>' : ''}
    </details>
  `;
};

export default { renderSequenceDisclosure, renderTechnicalEvidencePanel };
