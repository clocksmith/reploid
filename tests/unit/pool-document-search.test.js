import { describe, expect, it, vi } from 'vitest';
import { ingestDocuments, rankDocumentVectors, createDocumentSearch } from '../../self/pool/document-search.js';
import { createLocalPackExecutor } from '../../self/pool/local-pack-executor.js';
import { validateOperationModel } from '../../self/pool/operation-model.js';
import { validateEnabledPoolModelContract } from '../../self/pool/model-contract.js';
import { createDocumentPackFixture } from '../fixtures/document-packs.js';
import policy from '../../self/pool/document-search-policy.json' with { type: 'json' };

const documents = [{ name: 'fruit.md', text: 'Apple trees grow fruit.' }, { name: 'sea.txt', text: 'Whales live in the sea.' }];

describe('local document search (synthetic Pack outputs)', () => {
  it('ingests bounded text, retains source offsets, and deduplicates contents', async () => {
    const corpus = await ingestDocuments([...documents, { ...documents[0], name: 'copy.md' }]);
    expect(corpus.documents).toHaveLength(2);
    expect(corpus.documents[0].sources).toEqual(['fruit.md', 'copy.md']);
    expect(corpus.chunks[0].text).toBe(documents[0].text.slice(corpus.chunks[0].start, corpus.chunks[0].end));
    expect(Object.isFrozen(corpus.chunks[0])).toBe(true);
    await expect(ingestDocuments([{ name: 'empty', text: '' }])).rejects.toThrow('nonempty');
    await expect(ingestDocuments(documents, { ...policy, maxCorpusBytes: 2 })).rejects.toThrow('size');
    await expect(ingestDocuments(documents, { ...policy, chunkCharacters: 1 })).rejects.toThrow('chunk');
    await expect(ingestDocuments(documents, { ...policy, maxChunks: 1 })).rejects.toThrow('passages');
    const unicode = await ingestDocuments([{ name: 'text', text: 'ab😀cd' }], { ...policy, chunkCharacters: 3 });
    expect(unicode.chunks.map((chunk) => chunk.text).join('')).toBe('ab😀cd');
    expect(unicode.chunks.every((chunk) => !/[\uD800-\uDBFF]$/u.test(chunk.text))).toBe(true);
  });

  it('rejects unknown/mismatched/split model contracts without self-admitting a model', async () => {
    const { configuration } = await createDocumentPackFixture();
    expect(validateOperationModel(configuration.embedding).ok).toBe(true);
    expect(validateEnabledPoolModelContract(configuration.embedding).ok).toBe(false);
    for (const patch of [{ workload: 'sequence.embedding.v1' }, { modelHash: 'other' }, { kvShardPlan: {} },
      { executablePack: { ...configuration.embedding.executablePack, requiredOperation: 'unknown' } }]) {
      expect(validateOperationModel({ ...configuration.embedding, ...patch }).ok).toBe(false);
    }
  });

  it('runs ingestion, retrieval, and reranking through public Pack receipts without network delegation', async () => {
    const f = await createDocumentPackFixture();
    const executor = createLocalPackExecutor({ service: f.service });
    const workflow = createDocumentSearch({ executor });
    workflow.configure(f.configuration);
    await workflow.setDocuments(documents);
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network payload permitted'));
    try {
      const first = await workflow.search({ query: 'apple', topK: 2 });
      expect(first.matches[0].sources).toEqual(['fruit.md']);
      expect(first.receipts[0].assignmentHash).toBeNull();
      expect(f.calls[0].input.texts).toHaveLength(3);
      expect(f.calls[0].input.application).toEqual(f.configuration.embedding.application);
      expect(first.indexReceipt).toEqual(first.receipts[0]);
      const ranked = await workflow.search({ query: 'apple', topK: 2, rerank: true });
      expect(f.calls[1].input.texts).toEqual(['apple']);
      expect(f.calls[1].input.application).toEqual(f.configuration.embedding.application);
      expect(f.calls[2].operation.name).toBe('rerank');
      expect(ranked.matches[0].sources).toEqual(['sea.txt']);
      expect(ranked.reranked).toBe(true);
      expect(ranked.receipts).toHaveLength(2);
      expect(ranked.indexReceipt).toEqual(first.indexReceipt);
      expect(f.closes()).toBe(3);
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); await workflow.close(); }
  });

  it('requires the selected embedding application without inventing an identity', async () => {
    const f = await createDocumentPackFixture();
    const executor = { cancel: vi.fn() };
    const workflow = createDocumentSearch({ executor });
    for (const application of [undefined, null, []]) {
      const configuration = structuredClone(f.configuration);
      if (application === undefined) delete configuration.embedding.application;
      else configuration.embedding.application = application;
      expect(() => workflow.configure(configuration)).toThrow('embedding application identity');
    }
    expect(executor.cancel).not.toHaveBeenCalled();
    expect(workflow.getState().configured).toBe(false);
  });

  it('rejects zero/invalid vectors and resolves score ties deterministically', () => {
    const chunks = [{ id: 'b' }, { id: 'a' }];
    expect(rankDocumentVectors(chunks, [[1, 0], [1, 0]], [1, 0], 2).map((item) => item.id)).toEqual(['a', 'b']);
    expect(() => rankDocumentVectors(chunks, [[0, 0], [1, 0]], [1, 0], 2)).toThrow('norm');
    expect(() => rankDocumentVectors(chunks, [[1], [1]], [1, 0], 2)).toThrow('dimension');
    expect(() => rankDocumentVectors(chunks, [[NaN], [1]], [1], 2)).toThrow('Invalid');
  });

  it('never falls back to a legacy session and suppresses results after cancellation during load', async () => {
    const f = await createDocumentPackFixture();
    let release;
    const originalOpen = f.service.openPack;
    f.service.openPack = () => new Promise((resolve) => { release = async () => resolve(await originalOpen()); });
    const executor = createLocalPackExecutor({ service: f.service });
    const running = executor.run({ model: f.configuration.embedding, input: { texts: ['apple'] },
      limits: { maxInputBytes: 1024, maxOutputBytes: 1024, deadlineAt: Date.now() + 10000 } });
    const assertion = expect(running).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    executor.cancel(); await release(); await assertion;
    expect(f.calls).toHaveLength(0); expect(f.closes()).toBe(1);
    await executor.close();
  });

  it('clearing during execution cannot restore private results or history', async () => {
    const f = await createDocumentPackFixture();
    let release;
    const executor = { run: () => new Promise((resolve) => { release = resolve; }), cancel() {}, close: async () => {} };
    const workflow = createDocumentSearch({ executor });
    workflow.configure(f.configuration); await workflow.setDocuments(documents);
    const pending = workflow.search({ query: 'private question' });
    const assertion = expect(pending).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    workflow.clear(); release({ output: { embeddings: [] }, receipt: {} }); await assertion;
    expect(workflow.getState()).toMatchObject({ corpus: null, result: null, history: [], status: 'Add documents' });
  });
});
