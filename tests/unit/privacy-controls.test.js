import { it, expect } from 'vitest';
import { renderPrivacyControls, readPrivacyControls, showPrivacyChoices, updatePrivacyControls, answerPrivacy } from '../../apps/poolday/ui/pool-home/privacy-controls.js';

it('keeps placement, recipient eligibility and computation separate and never opens remote recipients implicitly', () => {
  const root = document.createElement('div'); document.body.append(root); root.innerHTML = renderPrivacyControls();
  const find = selector => root.querySelector(selector);
  expect(find('option[value="cryptographic"]').disabled).toBe(true);
  expect(find('option[value="attested"]').disabled).toBe(true);
  expect(readPrivacyControls(root)).toMatchObject({ placement: 'local-only', recipients: { kind: 'none', ids: [] }, computation: 'plaintext' });
  find('[data-privacy-placement]').value = 'network-allowed';
  showPrivacyChoices(root);
  expect(readPrivacyControls(root)).toMatchObject({ placement: 'network-allowed', recipients: { kind: 'none', ids: [] } });
  find('[data-privacy-recipient-mode]').value = 'named';
  expect(() => readPrivacyControls(root)).toThrow('at least one recipient ID');
  find('[data-privacy-recipients]').value = 'peer:a, peer:b, peer:a';
  expect(() => readPrivacyControls(root)).toThrow(/unique list/);
  find('[data-privacy-recipients]').value = 'peer:a, peer:b';
  const policy = readPrivacyControls(root);
  expect(policy.recipients).toEqual({ kind: 'named', ids: ['peer:a', 'peer:b'] });
  updatePrivacyControls(root, policy);
  expect(find('[data-privacy-recipients-label]').hidden).toBe(false);
  expect(readPrivacyControls(root)).toEqual(policy);
  updatePrivacyControls(root, { ...policy, retention: 'ephemeral' });
  expect(find('[data-privacy-apply]').disabled).toBe(true);
  expect(find('[data-privacy-error]').textContent).toContain('read-only');
  root.remove();
});

it('labels only the actual recipients in a current disclosure receipt', () => {
  const privacy = { schema: 'reploid.privacy-receipt/v2', computation: 'plaintext', recipients: ['a', 'b'] };
  const state = { computerLabels: new Map([['a', 'Mars'], ['b', 'Jupiter']]) };
  expect(answerPrivacy({ privacy }, state)).toEqual(['Plaintext · 2 computers', 'Plaintext · Mars · Jupiter']);
  expect(answerPrivacy({ privacy: { ...privacy, schema: 'reploid.privacy-receipt/v1' } }, state)[0]).toBe('Disclosure unrecorded');
});
