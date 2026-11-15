import { it, expect } from 'vitest';
import { renderPrivacyControls, readPrivacyControls, updatePrivacyControls } from '../../apps/poolday/ui/pool-home/privacy-controls.js';
it('exposes the three request presets and keeps stronger unavailable paths disabled', () => {
  const root = document.createElement('div'); root.innerHTML = renderPrivacyControls();
  expect(root.querySelector('option[value="cryptographic"]').disabled).toBe(true);
  root.querySelector('[data-privacy-profile]').value = 'restricted';
  expect(readPrivacyControls(root).placement).toBe('local-only');
  root.querySelector('[data-privacy-recipients]').value = 'peer:a, peer:b';
  const policy = readPrivacyControls(root);
  expect(policy.allowedRecipients).toEqual(['peer:a', 'peer:b']);
  expect(policy.placement).toBe('network-allowed');
  updatePrivacyControls(root, policy, true);
  expect(root.querySelector('[data-privacy-apply]').disabled).toBe(true);
  expect(root.textContent).toContain('ordinary plaintext');
});
