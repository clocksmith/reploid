/**
 * @fileoverview The remembered consent to send a public protein sequence to selected peers,
 * kept in this browser and synchronized to its checkbox.
 */

const POOL_SEQUENCE_PUBLIC_CONSENT_KEY = 'reploid.pool.sequence-public-consent.v1';

const readSequencePublicConsent = () => {
  try {
    return window.localStorage?.getItem(POOL_SEQUENCE_PUBLIC_CONSENT_KEY) === 'true';
  } catch {
    return false;
  }
};

export const writeSequencePublicConsent = () => {
  try {
    window.localStorage?.setItem(POOL_SEQUENCE_PUBLIC_CONSENT_KEY, 'true');
  } catch {
    // Consent still applies to the current page when storage is unavailable.
  }
};

export const syncSequencePublicConsent = (control) => {
  if (!control) return;
  if (readSequencePublicConsent()) control.checked = true;
  const acknowledged = control.checked === true;
  const row = control.closest('[data-pool-sequence-consent-row]');
  const saved = document.querySelector('[data-pool-sequence-consent-saved]');
  if (row) row.hidden = acknowledged;
  if (saved) saved.hidden = !acknowledged;
};
