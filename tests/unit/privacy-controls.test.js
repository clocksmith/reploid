import { it, expect } from 'vitest';
import { renderPrivacyControls, readPrivacyControls, updatePrivacyControls, answerPrivacy, presetForPolicy, policyForPreset,
  presetDisclosure } from '../../apps/poolday/ui/pool-home/privacy-controls.js';
import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';
import { createInference } from '../../packages/reploid/src/inference/index.js';

const desktop = { id: 'peer:' + 'd'.repeat(24), label: 'Studio' };
const open = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } });
const mount = () => {
  const root = document.createElement('div'); document.body.append(root); root.innerHTML = renderPrivacyControls();
  return { root, find: selector => root.querySelector(selector), choose: value => { for (const input of root.querySelectorAll('[data-privacy-preset]')) input.checked = input.value === value; } };
};

it('offers three presets, states availability and exposure before Send, and never applies the unavailable one', () => {
  const { root, find, choose } = mount();
  updatePrivacyControls(root, open, { desktop });
  expect(find('[value="standard"]').checked).toBe(true);
  expect(find('[value="no-device"]').disabled).toBe(true);
  expect(find('[data-preset-note="standard"]').textContent).toMatch(/^Available\..*plaintext and can see its access patterns.*model identity, timing and message sizes can also be visible/);
  expect(find('[data-preset-note="own-devices"]').textContent).toMatch(/^Available on this device and Studio\..*plaintext, so they can also see its access patterns; no other computer can read it/);
  expect(find('[data-preset-note="no-device"]').textContent).toMatch(/^Unavailable\..*refused before anything is sent/);
  // Only your devices: the paired desktop is the one named participant, executor-readable.
  choose('own-devices');
  const own = readPrivacyControls(root, { desktop, current: open });
  expect(own).toMatchObject({ placement: 'network-allowed', recipients: { kind: 'named', ids: [desktop.id] }, computation: 'plaintext' });
  expect(presetForPolicy(own, [desktop.id])).toBe('own-devices');
  // Without a paired desktop the preset stays on this device; an invited host is never counted as one of yours.
  expect(readPrivacyControls(root, { current: open })).toMatchObject({ placement: 'local-only', recipients: { kind: 'none' } });
  expect(presetForPolicy(createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: ['peer:' + 'e'.repeat(24)] } }), [desktop.id])).toBe('standard');
  expect(presetDisclosure('own-devices')).toMatch(/^Available on this device only/);
  // Even when forced, the confidential preset is refused by the one compiler rather than stored as something weaker.
  find('[value="no-device"]').disabled = false; choose('no-device');
  expect(() => readPrivacyControls(root, { desktop, current: open })).toThrow(expect.objectContaining({ code: 'CONFIDENTIAL_EXECUTION_UNAVAILABLE' }));
  expect(() => policyForPreset('no-device', open)).toThrow(/Nothing was sent/);
  // A policy outside the presets is shown read-only, not converted.
  updatePrivacyControls(root, { ...open, retention: 'ephemeral' }, { desktop });
  expect(find('[data-privacy-apply]').disabled).toBe(true);
  expect(find('[data-privacy-error]').textContent).toContain('read-only');
  root.remove();
});

it('shows who could read an answer and only what this browser checked, from the execution receipt', async () => {
  const identity = 'sha256:' + 'a'.repeat(64);
  const inference = createInference({
    resolveRoute: () => ({ shape: 'local', backend: 'doppler-plaintext/v1' }),
    execute: async () => ({ modelId: 'm', modelIdentity: identity, adapterIdentities: [], content: 'answer', execution: { stopReason: 'eos-token' } })
  });
  const plan = await inference.prepare({ model: { id: 'm', identity }, execution: { placement: 'local-only', participants: { kind: 'none' },
    confidentiality: 'executor-readable', allowMetadata: [] } });
  const local = await (await inference.run({ planId: plan.id, requestId: 'local-1', input: { messages: [{ role: 'user', content: 'q' }] } })).result;
  const [summary, detail] = answerPrivacy({ receipt: local.executionReceipt }, {});
  expect(summary).toBe('Readable by This device');
  expect(detail).toContain('Checked here: content stayed on this device, model identity, adapters, streamed text');
  expect(detail).toContain('Not checked: recipient conduct, erasure, correct computation');
  expect(detail).not.toContain('Exposed');
  const remote = structuredClone(local.executionReceipt);
  remote.route = { ...remote.route, shape: 'remote', participants: ['a', 'b'] };
  remote.disclosures = { ...remote.disclosures, metadata: ['model-id', 'timing', 'length'] };
  const state = { computerLabels: new Map([['a', 'Studio'], ['b', 'Workstation']]) };
  expect(answerPrivacy({ receipt: remote }, state)[0]).toBe('Readable by 2 computers');
  expect(answerPrivacy({ receipt: remote }, state)[1]).toMatch(/^Readable by Studio · Workstation\. Exposed: model identity, timing, message sizes\./);
  expect(answerPrivacy({ receipt: { ...remote, schema: 'reploid.privacy-receipt/v2' } }, state)[0]).toBe('Disclosure unrecorded');
  expect(answerPrivacy({ receipt: { ...remote, route: null } }, state)[0]).toBe('Disclosure unrecorded');
});
