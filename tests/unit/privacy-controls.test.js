import { it, expect } from 'vitest';
import { renderPrivacyControls, readPrivacyControls, updatePrivacyControls, showPrivacyChoices, answerPrivacy, presetForPolicy, policyForPreset,
  namedPrivacyPreset } from '../../apps/poolday/ui/pool-home/privacy-controls.js';
import { createExecutionPolicy, PROTECTIONS } from '../../packages/reploid/src/chat/execution-policy.js';
import { PROTECTION_DISPLAY, ROUTE_DISPLAY, SPLIT_DISPLAY, splitReadersLine } from '../../packages/reploid/src/inference/protections.js';
import { createInference } from '../../packages/reploid/src/inference/index.js';

const desktop = { id: 'peer:' + 'd'.repeat(24), label: 'Studio' };
const open = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } });
const mount = () => {
  const root = document.createElement('div'); document.body.append(root); root.innerHTML = renderPrivacyControls();
  const find = selector => root.querySelector(selector);
  return { root, find,
    route: value => { for (const input of root.querySelectorAll('[data-privacy-route]')) input.checked = input.value === value; },
    own: checked => { find('[data-privacy-own-devices]').checked = checked; } };
};
const staged = { id: 'm', identity: 'sha256:' + 'b'.repeat(64), partition: { route: { stages: ['a', 'b', 'c'].map((participantId, index) => ({ index, participantId })) } } };

it('lists four protections with their shared lines, the five routes, and keeps only-your-devices a participants choice', () => {
  const { root, find, route, own } = mount();
  updatePrivacyControls(root, open, { desktop });
  expect(find('#chat-privacy-title').textContent).toBe('Who can read it?');
  // Four protections in the shared order, each with its shared label and line; only plaintext runs in this browser.
  const rows = [...root.querySelectorAll('[data-privacy-protection]')];
  expect(rows.map(input => input.value)).toEqual(PROTECTIONS);
  for (const protection of PROTECTIONS) {
    expect(find(`[data-privacy-protection][value="${protection}"]`).closest('.pool-option').querySelector('.pool-row-title').textContent)
      .toBe(PROTECTION_DISPLAY[protection].label);
  }
  expect(find('[data-privacy-protection][value="plaintext"]').checked).toBe(true);
  expect(find('[data-privacy-protection][value="plaintext"]').disabled).toBe(false);
  expect(find('[data-protection-status="plaintext"]').textContent).toBe(PROTECTION_DISPLAY.plaintext.line);
  for (const protection of ['secret-sharing', 'homomorphic', 'attested']) {
    expect(find(`[data-privacy-protection][value="${protection}"]`).disabled).toBe(true);
    const status = find(`[data-protection-status="${protection}"]`).textContent;
    expect(status.startsWith(PROTECTION_DISPLAY[protection].line)).toBe(true);
    expect(status.slice(PROTECTION_DISPLAY[protection].line.length)).toMatch(/^ Unavailable: \S.+\.$/);
  }
  expect(find('[data-protection-status="attested"]').textContent).toContain('No attested route is enabled');
  // No bare "Private" or "Confidential" labels, and no "Your devices or the network".
  expect(root.textContent).not.toMatch(/\b(Private|Confidential)\b|Your devices or the network/);
  // Where it runs: the five route values, single choice; a network policy with no chosen location lets it choose.
  const routes = [...root.querySelectorAll('[data-privacy-route]')];
  expect(routes.map(input => input.value)).toEqual(['local', 'remote', 'split', 'split-local-edges', 'auto']);
  expect(routes.map(input => input.closest('.pool-option').querySelector('.pool-row-title').textContent))
    .toEqual(Object.values(ROUTE_DISPLAY).map(row => row.label));
  expect(find('[data-privacy-route][value="auto"]').checked).toBe(true);
  expect(find('[data-privacy-route][value="split-local-edges"]').disabled).toBe(true);
  expect(find('[data-route-status="split-local-edges"]').textContent).toBe('Unavailable: This browser cannot bind both edge devices to you.');
  expect(find('[data-privacy-route][value="split"]').disabled).toBe(true);
  expect(find('[data-split-note]').hidden).toBe(true);
  // Only your devices: a participants choice beside the route, needing the paired desktop.
  expect(find('[data-privacy-own-devices]').type).toBe('checkbox');
  expect(find('[data-privacy-own-devices]').disabled).toBe(false);
  expect(find('[data-own-devices-status]').textContent).toBe('This device and Studio process your request. No other computer can.');
  // Only the checked choice's exposure statement is shown, inside a collapsed disclosure under the rows.
  expect(find('[data-privacy-detail]').open).toBe(false);
  expect(find('[data-preset-note="standard"]').textContent).toMatch(/^The computer that answers reads your content in plaintext and can see its access patterns.*model identity, timing and message sizes can also be visible/);
  expect(find('[data-preset-note="standard"]').hidden).toBe(false);
  expect(find('[data-preset-note="own-devices"]').hidden).toBe(true);
  // Only your devices with one computer: plaintext, the paired desktop the one named participant, route remote.
  route('remote'); own(true);
  const chosen = readPrivacyControls(root, { desktop, current: open });
  expect(chosen.route).toBe('remote');
  expect(chosen.privacy).toMatchObject({ placement: 'network-allowed', recipients: { kind: 'named', ids: [desktop.id] }, computation: 'plaintext' });
  expect(presetForPolicy(chosen.privacy, [desktop.id])).toBe('own-devices');
  // This device: a local-only policy; the participants choice does not apply.
  route('local');
  showPrivacyChoices(root, { desktop });
  expect(find('[data-privacy-own-devices]').disabled).toBe(true);
  expect(readPrivacyControls(root, { desktop, current: open })).toMatchObject({ route: 'local', privacy: { placement: 'local-only', recipients: { kind: 'none' } } });
  expect(find('[data-preset-note="own-devices"]').textContent).toMatch(/^Only this device runs the model/);
  // Let it choose without a paired desktop: open recipients.
  route('auto');
  expect(readPrivacyControls(root, { current: open })).toMatchObject({ route: 'auto', privacy: { recipients: { kind: 'open' } } });
  expect(presetForPolicy(createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: ['peer:' + 'e'.repeat(24)] } }), [desktop.id])).toBe('standard');
  // Even when forced, an unavailable protection is refused rather than stored as plaintext.
  const homomorphic = find('[data-privacy-protection][value="homomorphic"]');
  homomorphic.disabled = false; homomorphic.checked = true;
  expect(() => readPrivacyControls(root, { desktop, current: open })).toThrow(/Compute on encrypted data is unavailable here/);
  expect(() => policyForPreset('no-device', open)).toThrow(/Choose where it runs/);
  // A policy outside these choices is shown read-only, not converted.
  updatePrivacyControls(root, { ...open, retention: 'ephemeral' }, { desktop });
  expect(find('[data-privacy-apply]').disabled).toBe(true);
  expect(find('[data-privacy-error]').textContent).toContain('read-only');
  root.remove();
});

it('a plaintext split names how many computers can read the message', () => {
  const { root, find } = mount();
  updatePrivacyControls(root, open, { desktop, model: staged, location: 'network' });
  expect(find('[data-privacy-route][value="split"]').checked).toBe(true);
  expect(find('[data-privacy-route][value="split"]').disabled).toBe(false);
  expect(find('[data-privacy-route][value="remote"]').disabled).toBe(true);
  expect(find('[data-split-note]').hidden).toBe(false);
  expect(find('[data-split-note]').textContent).toBe(splitReadersLine(3));
  expect(find('[data-split-note]').textContent).toBe('3 computers can read your message.');
  // Requester-held edges keep their own line.
  for (const input of root.querySelectorAll('[data-privacy-route]')) input.checked = input.value === 'split-local-edges';
  showPrivacyChoices(root, { desktop, model: staged });
  expect(find('[data-split-note]').textContent).toBe(SPLIT_DISPLAY['requester-edges'].line);
  root.remove();
});

it('names the thread protection on the composer chip', () => {
  expect(namedPrivacyPreset(open, {})).toMatchObject({ preset: 'standard', protection: 'plaintext', label: 'Standard' });
  expect(namedPrivacyPreset(createExecutionPolicy(), {}).label).toBe('Standard · Your devices');
  expect(namedPrivacyPreset({ ...open, retention: 'ephemeral' }, {}).label).toBe('Fixed requirements');
});

it('shows who could read an answer and only what this browser checked, from the execution receipt', async () => {
  const identity = 'sha256:' + 'a'.repeat(64);
  const inference = createInference({
    resolveRoute: () => ({ shape: 'local', backend: 'doppler-plaintext/v1' }),
    execute: async () => ({ modelId: 'm', modelIdentity: identity, adapterIdentities: [], content: 'answer', execution: { stopReason: 'eos-token' } })
  });
  const plan = await inference.prepare({ model: { id: 'm', identity }, execution: { protection: 'plaintext', route: 'local', allowMetadata: [] } });
  const local = await (await inference.run({ planId: plan.id, requestId: 'local-1', input: { messages: [{ role: 'user', content: 'q' }] } })).result;
  const [summary, detail] = answerPrivacy({ receipt: local.executionReceipt }, {});
  expect(summary).toBe('Readable by This device');
  expect(detail).toMatch(/^Protection: Standard\. Readable by This device\./);
  expect(detail).toContain('Checked here: content stayed on this device, model identity, adapters, streamed text');
  expect(detail).toContain('Not checked: recipient conduct, erasure, correct computation');
  expect(detail).not.toContain('Exposed');
  const remote = structuredClone(local.executionReceipt);
  remote.route = { ...remote.route, shape: 'remote', participants: ['a', 'b'] };
  remote.disclosure = { ...remote.disclosure, metadata: { ...remote.disclosure.metadata, items: ['model-id', 'timing', 'length'] } };
  const state = { computerLabels: new Map([['a', 'Studio'], ['b', 'Workstation']]) };
  expect(answerPrivacy({ receipt: remote }, state)[0]).toBe('Readable by 2 computers');
  expect(answerPrivacy({ receipt: remote }, state)[1]).toMatch(/^Protection: Standard\. Readable by Studio · Workstation\. Exposed: model identity, timing, message sizes\./);
  expect(answerPrivacy({ receipt: { ...remote, schema: 'reploid.execution-receipt/v1' } }, state)[0]).toBe('Disclosure unrecorded');
  expect(answerPrivacy({ receipt: { ...remote, route: null } }, state)[0]).toBe('Disclosure unrecorded');
  expect(local.executionReceipt).toMatchObject({ routeKind: 'local', issuedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) });
});
