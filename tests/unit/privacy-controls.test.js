import { it, expect } from 'vitest';
import { renderPrivacyControls, readPrivacyControls, updatePrivacyControls, answerPrivacy } from '../../apps/poolday/ui/pool-home/privacy-controls.js';

it('shows all tiers and maps named recipients or this device to the existing execution policy', () => {
  const root = document.createElement('div'); root.innerHTML = renderPrivacyControls();
  expect(root.querySelector('input[value="cryptographic"]').disabled).toBe(true);
  root.querySelector('input[value="restricted"]').checked = true;
  expect(readPrivacyControls(root).placement).toBe('local-only');
  root.querySelector('[data-privacy-recipients]').value = 'peer:a, peer:b, peer:a';
  const policy = readPrivacyControls(root);
  expect(policy.allowedRecipients).toEqual(['peer:a', 'peer:b']);
  expect(policy.placement).toBe('network-allowed');
  updatePrivacyControls(root, policy);
  expect(root.querySelector('[data-privacy-recipients-label]').hidden).toBe(false);
  expect(readPrivacyControls(root)).toEqual(policy);
  updatePrivacyControls(root, { ...policy, retention: 'ephemeral' });
  expect(root.querySelector('[data-privacy-apply]').disabled).toBe(true);
  expect(root.querySelector('[data-privacy-error]').textContent).toContain('read-only');
});

it('labels only the recipients in the returned receipt, including multi-computer routes', () => {
  const privacy = { schema: 'reploid.privacy-receipt/v1', profile: 'restricted', recipients: ['a', 'b'] };
  const state = { computerLabels: new Map([['a', 'Mars'], ['b', 'Jupiter']]) };
  expect(answerPrivacy({ privacy }, state)).toEqual(['Restricted recipients · 2 computers', 'Restricted recipients · Mars · Jupiter']);
  expect(answerPrivacy({ privacy: { ...privacy, schema: 'reploid.legacy-privacy-observation/v1' } }, state)[0]).toBe('Privacy unrecorded');
});
