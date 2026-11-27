import { beforeEach, expect, it } from 'vitest';
import { ADAPTER_GUIDE_URL, adapterAvailability, describeModelChoice } from '../../apps/poolday/ui/pool-home/model-adapters.js';
import { recordedAdapterText } from '../../apps/poolday/ui/pool-home/execution-ribbon.js';
import { CANONICAL_CHAT_MODELS } from '../../apps/poolday/host/chat-session.js';
import { projectChatCatalog } from '../../apps/poolday/host/chat-view.js';

const catalogBase = CANONICAL_CHAT_MODELS.find(model => model.availableAdapters?.length);
const catalogAdapter = catalogBase.availableAdapters[0];
const project = peers => projectChatCatalog({ models: [catalogBase], peers, partitionModels: [] })
  .map(model => ({ ...model, networkAvailability: model.availability }));
const peer = { peerId: 'peer-a', model: catalogBase.id, modelIdentity: catalogBase.identity, readiness: 'ready', hasInference: true,
  identityProtocol: 1, admissionProtocol: 2, availableSlots: 1, adapterIdentities: [catalogAdapter.identity] };
beforeEach(() => { document.body.innerHTML = '<div data-root><div data-model-adapter-details></div></div><select></select>'; });

it('names the adapter a completed answer recorded, never one it only requested', () => {
  const model = { adapters: [{ name: 'Named adapter', identity: 'sha256:' + 'b'.repeat(64), manifest: { version: '1.0.0' } }] };
  expect(recordedAdapterText({ status: 'completed', execution: { adapterIdentities: [model.adapters[0].identity] } }, model))
    .toBe(`Named adapter · v1.0.0 · ${model.adapters[0].identity}`);
  expect(recordedAdapterText({ status: 'completed', execution: {} }, model)).toBe('Adapter not recorded');
  expect(recordedAdapterText({ status: 'completed', execution: { adapterIdentities: [] } }, model)).toBe('No adapter recorded');
  expect(recordedAdapterText({ status: 'executing', execution: { adapterIdentities: [model.adapters[0].identity] } }, model)).toBeNull();
  expect(recordedAdapterText({ status: 'completed', execution: { adapterIdentities: [] } }, { adapters: [] })).toBeNull();
});
