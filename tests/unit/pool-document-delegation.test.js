import { expect, it, vi } from 'vitest';
import { createDocumentAssistant } from '../../self/pool/document-delegation.js';
import { createLocalPackExecutor } from '../../self/pool/local-pack-executor.js';
import { createPackProviderAdvert, packPeerModel } from '../../self/pool/peer-pack-job.js';
import { createDocumentPackFixture } from '../fixtures/document-packs.js';
import { operationCapabilities, operationResources, packPeerIdentity } from '../fixtures/peer-pack-operation.js';
import config from '../../self/pool/pool-config.json' with { type: 'json' };

async function setup() {
  const fixture = await createDocumentPackFixture();
  const model = packPeerModel(fixture.configuration.generator);
  const limits = { ...config.operationNetwork.requestLimits, maxJobMs: 30000 };
  const advert = await createPackProviderAdvert({ identity: await packPeerIdentity(), models: [model],
    capabilities: await operationCapabilities(model), limits, expiresAt: Date.now() + 30000 });
  const network = { describe: vi.fn(async () => ({ adverts: [advert], resources: operationResources, limits })),
    run: vi.fn(async () => { throw new Error('Unexpected task disclosure'); }) };
  const workflow = createDocumentAssistant({ executor: createLocalPackExecutor({ service: fixture.service }), network });
  workflow.configure(fixture.configuration);
  await workflow.setDocuments([{ name: 'private-file.md', text: 'private-file-contents apple' }]);
  await workflow.search({ query: 'private-question apple' });
  return { workflow, network, fixture };
}

it('requires exact, unexpired, single task approval and keeps retrieval out of discovery', async () => {
  const { workflow, network, fixture } = await setup();
  try {
    const task = 'Explain a public concept.';
    const preview = await workflow.prepareDelegation({ task });
    expect(JSON.stringify(network.describe.mock.calls)).not.toMatch(/private-file|private-question/);
    expect(network.describe.mock.calls[0][0]).toEqual({ model: packPeerModel(fixture.configuration.generator) });
    const approval = { previewId: preview.id, text: task, publicInput: true };
    await expect(workflow.approveDelegation({ ...approval, text: task + ' changed' })).rejects.toThrow('exact text');
    await expect(workflow.approveDelegation({ ...approval, publicInput: false })).rejects.toThrow('exact text');
    await expect(workflow.approveDelegation({ ...approval, previewId: 'different' })).rejects.toThrow('exact text');
    const now = vi.spyOn(Date, 'now').mockReturnValue(preview.expiresAt);
    try { await expect(workflow.approveDelegation(approval)).rejects.toThrow('expired'); }
    finally { now.mockRestore(); }
    workflow.cancel();
    await expect(workflow.approveDelegation(approval)).rejects.toThrow('Prepare a task');
    expect(network.run).not.toHaveBeenCalled();
  } finally { await workflow.close(); }
});

it('rejects empty and oversized sharing and invalidates previews when local inputs change', async () => {
  const { workflow, network } = await setup();
  try {
    for (const task of ['', ' ', '界'.repeat(config.documentDelegation.maxTaskBytes)]) {
      await expect(workflow.prepareDelegation({ task })).rejects.toThrow('short task');
    }
    expect(network.describe).not.toHaveBeenCalled();
    const preview = await workflow.prepareDelegation({ task: 'Public task' });
    await workflow.setDocuments([{ name: 'new-private.md', text: 'new private apple evidence' }]);
    await expect(workflow.approveDelegation({ previewId: preview.id, text: preview.text, publicInput: true })).rejects.toThrow('Prepare a task');
    expect(network.run).not.toHaveBeenCalled();
  } finally { await workflow.close(); }
});
