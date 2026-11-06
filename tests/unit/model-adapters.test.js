import { beforeEach, expect, it } from 'vitest';
import { ADAPTER_GUIDE_URL, adapterAvailability, describeModelChoice, updateAdapterDetails } from '../../apps/poolday/ui/pool-home/model-adapters.js';
import { recordedAdapterText } from '../../apps/poolday/ui/pool-home/execution-ribbon.js';
import { bindModelChoices } from '../../apps/poolday/ui/components/model-select.js';
import { CANONICAL_CHAT_MODELS } from '../../apps/poolday/host/chat-session.js';
import { projectChatCatalog } from '../../apps/poolday/host/chat-view.js';

const catalogBase = CANONICAL_CHAT_MODELS.find(model => model.availableAdapters?.length);
const catalogAdapter = catalogBase.availableAdapters[0];
const project = peers => projectChatCatalog({ models: [catalogBase], peers, partitionModels: [] })
  .map(model => ({ ...model, networkAvailability: model.availability }));
const peer = { peerId: 'peer-a', model: catalogBase.id, modelIdentity: catalogBase.identity, readiness: 'ready', hasInference: true,
  availableSlots: 1, adapterIdentities: [catalogAdapter.identity] };
beforeEach(() => { document.body.innerHTML = '<div data-root><div data-model-adapter-details></div></div><select></select>'; });

it('shows the catalog adapter’s declared purpose and source, version, identities and no evaluation evidence', () => {
  const models = project([]), adapted = models.find(model => model.adapters?.length);
  const state = { models, adapterEvidence: { [catalogAdapter.identity]: { status: 'none' } } };
  const root = document.querySelector('[data-root]');
  updateAdapterDetails(root, state, adapted);
  const node = root.querySelector('[data-model-adapter-details]');
  expect(node.hidden).toBe(false);
  expect(node.querySelector('[data-adapter-purpose]').textContent).toContain(catalogAdapter.purpose.statement);
  expect(node.querySelector('[data-adapter-purpose] a').getAttribute('href')).toBe(catalogAdapter.purpose.url);
  expect(node.textContent).toContain(`v${catalogAdapter.manifest.version}`);
  expect(node.querySelector('[data-adapter-evidence]').textContent).toBe('Evaluation: No evaluation evidence');
  expect(node.querySelector('[data-adapter-evidence] a')).toBeNull();
  expect(node.querySelector('[data-adapter-availability]').textContent).toBe('No computer serves this adapter now. Requests wait; the base model is not used instead.');
  expect(node.querySelector(`a[href="${ADAPTER_GUIDE_URL}"]`)).toBeNull();
  updateAdapterDetails(root, state, models.find(model => !model.adapters?.length));
  expect(node.hidden).toBe(true);
  expect(node.textContent).toBe('');
});

it('names the computers serving the adapter now and links only a verified receipt', () => {
  const models = project([peer]), adapted = models.find(model => model.adapters?.length);
  expect(adapterAvailability({ models }, adapted).text).toBe('Served now by 1 computer');
  const root = document.querySelector('[data-root]');
  for (const [status, text] of [['passed', 'Passed held-out evaluation'], ['failed', 'Failed held-out evaluation'], ['invalid', 'Evaluation receipt rejected']]) {
    updateAdapterDetails(root, { models, adapterEvidence: { [catalogAdapter.identity]: { status, receiptUrl: '/config/adapter-evaluations/receipts/x.json', reason: 'bad' } } }, adapted);
    const evidence = root.querySelector('[data-adapter-evidence]');
    expect(evidence.dataset.evidenceStatus).toBe(status);
    expect(evidence.querySelector('a').textContent).toBe(text);
  }
  // A declaration the host has not verified is not evidence.
  updateAdapterDetails(root, { models, adapterEvidence: {} }, adapted);
  expect(root.querySelector('[data-adapter-evidence]').textContent).toBe('Evaluation: No evaluation evidence');
});

it('nests each adapter beneath its base with its own status, version and evidence', () => {
  const models = project([peer]);
  const select = document.querySelector('select'), choices = bindModelChoices(select);
  choices.update(models, { grouped: true, variants: true, describe: describeModelChoice({ models, adapterEvidence: {} }) });
  const labels = [...document.querySelectorAll('label[data-choice-key]')];
  expect(labels.map(label => label.hasAttribute('data-choice-adapter'))).toEqual([false, true]);
  // A provider applying the adapter also serves base requests, which never inherit it; both are shared choices.
  expect(labels[0].closest('[data-choice-group]').dataset.choiceGroup).toBe('shared');
  expect(labels[0].querySelector('[data-choice-status]').textContent).toBe('Ready');
  expect(labels[0].querySelector('[data-choice-facts]').textContent).toContain('1 adapter');
  expect(labels[1].querySelector('[data-choice-status]').textContent).toBe('Ready');
  expect(labels[1].querySelector('[data-choice-facts]').textContent).toBe(`Adapter · v${catalogAdapter.manifest.version}`);
  choices.dispose();
});

it('names the adapter a completed answer recorded, never one it only requested', () => {
  const model = { adapters: [{ name: 'Named adapter', identity: 'sha256:' + 'b'.repeat(64), manifest: { version: '1.0.0' } }] };
  expect(recordedAdapterText({ status: 'completed', execution: { adapterIdentities: [model.adapters[0].identity] } }, model))
    .toBe(`Named adapter · v1.0.0 · ${model.adapters[0].identity}`);
  expect(recordedAdapterText({ status: 'completed', execution: {} }, model)).toBe('Adapter not recorded');
  expect(recordedAdapterText({ status: 'completed', execution: { adapterIdentities: [] } }, model)).toBe('No adapter recorded');
  expect(recordedAdapterText({ status: 'executing', execution: { adapterIdentities: [model.adapters[0].identity] } }, model)).toBeNull();
  expect(recordedAdapterText({ status: 'completed', execution: { adapterIdentities: [] } }, { adapters: [] })).toBeNull();
});
