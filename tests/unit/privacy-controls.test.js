import { it, expect, vi } from 'vitest';
import { answerPrivacy, presetForPolicy, policyForPreset, namedPrivacyPreset } from '../../apps/poolday/ui/pool-home/privacy-controls.js';
import { createConversationController } from '../../apps/poolday/host/decisions/conversation-controller.js';
import { createExecutionPolicy, PROTECTIONS } from '../../packages/reploid/src/chat/execution-policy.js';
import { PROTECTION_DISPLAY, ROUTE_DISPLAY, SPLIT_DISPLAY, splitReadersLine } from '../../packages/reploid/src/inference/protections.js';
import { createInference } from '../../packages/reploid/src/inference/index.js';

const desktop = { id: 'peer:' + 'd'.repeat(24), label: 'Studio' };
const open = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } });
const staged = { id: 'm', identity: 'sha256:' + 'b'.repeat(64), partition: { route: { stages: ['a', 'b', 'c'].map((participantId, index) => ({ index, participantId })) } } };
// "Who can read it?" as the conversation controller stages it (host/decisions/conversation-controller.js); the React
// dialog renders exactly these rows.
const dialog = ({ model = null, privacy = open, location } = {}) => {
  const state = { models: model ? [model] : [], threads: [], runningIds: [], network: {},
    ownerPairing: { paired: true, hostParticipantId: desktop.id, hostLabel: desktop.label } };
  const viewState = { privacy, ...(model ? { chosenModel: model } : {}), ...(location ? { executionLocation: location } : {}) };
  const controller = createConversationController({ getState: () => state, subscribe: () => () => {} }, { viewState, href: () => 'http://localhost/' });
  controller.openPrivacy();
  return { controller, viewState, view: () => controller.getSnapshot().privacy };
};

it('lists four protections with their shared lines, the five routes, and keeps only-your-devices a participants choice', async () => {
  const { controller, viewState, view } = dialog();
  // Four protections in the shared order, each with its shared label and line; only plaintext runs in this browser.
  expect(view().protections.map(row => row.value)).toEqual(PROTECTIONS);
  for (const row of view().protections) expect(row.title).toBe(PROTECTION_DISPLAY[row.value].label);
  expect(view().protection).toBe('plaintext');
  const plaintext = view().protections[0];
  expect(plaintext.disabled).toBe(false);
  expect(plaintext.status).toBe(PROTECTION_DISPLAY.plaintext.line);
  for (const row of view().protections.slice(1)) {
    expect(row.disabled).toBe(true);
    expect(row.status.startsWith(PROTECTION_DISPLAY[row.value].line)).toBe(true);
    expect(row.status.slice(PROTECTION_DISPLAY[row.value].line.length)).toMatch(/^ Unavailable: \S.+\.$/);
  }
  expect(view().protections.find(row => row.value === 'attested').status).toContain('No attested route is enabled');
  // No bare "Private" or "Confidential" labels, and no "Your devices or the network".
  expect(JSON.stringify(view())).not.toMatch(/\b(Private|Confidential)\b|Your devices or the network/);
  // Where it runs: the five route values, single choice; a network policy with no chosen location lets it choose.
  expect(view().routes.map(row => row.value)).toEqual(['local', 'remote', 'split', 'split-local-edges', 'auto']);
  expect(view().routes.map(row => row.title)).toEqual(Object.values(ROUTE_DISPLAY).map(row => row.label));
  expect(view().route).toBe('auto');
  const route = value => view().routes.find(row => row.value === value);
  expect(route('split-local-edges').disabled).toBe(true);
  expect(route('split-local-edges').status).toBe('Unavailable: This browser cannot bind both edge devices to you.');
  expect(route('split').disabled).toBe(true);
  expect(view().splitNote).toBe('');
  // Only your devices: a participants choice beside the route, needing the paired desktop.
  expect(view().ownDevicesOption.disabled).toBe(false);
  expect(view().ownDevicesOption.status).toBe('This device and your desktop process your request. No other computer can.');
  // Only the checked choice's exposure statement is shown.
  expect(view().preset).toBe('standard');
  expect(view().note).toMatch(/^The computer that answers reads your content in plaintext and can see its access patterns.*model identity, timing and message sizes can also be visible/);
  // This device: a local-only route; the participants choice does not apply.
  controller.pickRoute('local');
  expect(view().ownDevicesOption.disabled).toBe(true);
  expect(view().note).toMatch(/^Only this device runs the model/);
  // Only your devices with one computer: plaintext, the paired desktop the one named participant, route remote.
  controller.pickRoute('remote'); controller.setOwnDevices(true);
  controller.applyPrivacy();
  await vi.waitFor(() => expect(view().open).toBe(false));
  expect(viewState.privacy).toMatchObject({ placement: 'network-allowed', recipients: { kind: 'named', ids: [desktop.id] }, computation: 'plaintext' });
  expect(presetForPolicy(viewState.privacy, [desktop.id])).toBe('own-devices');
  expect(presetForPolicy(createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: ['peer:' + 'e'.repeat(24)] } }), [desktop.id])).toBe('standard');
  // Even when chosen, an unavailable protection is refused rather than stored as plaintext.
  controller.openPrivacy(); controller.pickProtection('homomorphic'); controller.applyPrivacy();
  await vi.waitFor(() => expect(view().error).toMatch(/Compute on encrypted data is unavailable here/));
  expect(() => policyForPreset('no-device', open)).toThrow(/Choose where it runs/);
  // A policy outside these choices is shown read-only, not converted.
  const fixed = dialog({ privacy: { ...open, retention: 'ephemeral' } });
  expect(fixed.view().editable).toBe(false);
  expect(fixed.view().error).toContain('read-only');
});

it('a plaintext split names how many computers can read the message', () => {
  const { controller, view } = dialog({ model: staged, location: 'network' });
  expect(view().route).toBe('split');
  const route = value => view().routes.find(row => row.value === value);
  expect(route('split').disabled).toBe(false);
  expect(route('remote').disabled).toBe(true);
  expect(view().splitNote).toBe(splitReadersLine(3));
  expect(view().splitNote).toBe('3 computers can read your message.');
  // Requester-held edges keep their own line.
  controller.pickRoute('split-local-edges');
  expect(view().splitNote).toBe(SPLIT_DISPLAY['requester-edges'].line);
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
