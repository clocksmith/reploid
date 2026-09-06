import policy from './document-search-policy.json' with { type: 'json' };
import { hashDopplerEvidence } from './executable-pack.js';
import { snapshotPackOperationData } from './pack-operation.js';
import { validateOperationModel } from './operation-model.js';

const bytes = (text) => new TextEncoder().encode(text).length;
const requireValue = (value, message) => { if (!value) throw new Error(message); };

export async function ingestDocuments(inputs, limits = policy) {
  requireValue(Number.isInteger(limits.chunkCharacters) && limits.chunkCharacters >= 2, 'Invalid chunk size');
  requireValue(Array.isArray(inputs) && inputs.length > 0 && inputs.length <= limits.maxDocuments, `Choose 1 to ${limits.maxDocuments} documents`);
  const snapshot = snapshotPackOperationData(inputs);
  let totalBytes = 0;
  const documents = [];
  const chunks = [];
  const seen = new Map();
  for (const input of snapshot) {
    requireValue(typeof input.name === 'string' && input.name.trim() && input.name.length <= 255
      && typeof input.text === 'string' && input.text.trim(), 'Each document needs a name and nonempty text');
    const size = bytes(input.text);
    totalBytes += size;
    requireValue(size <= limits.maxDocumentBytes && totalBytes <= limits.maxCorpusBytes, 'Document size limit exceeded');
    const contentHash = await hashDopplerEvidence(input.text);
    if (seen.has(contentHash)) {
      seen.get(contentHash).sources.push(input.name);
      continue;
    }
    const document = { id: contentHash, sources: [input.name], sizeBytes: size };
    seen.set(contentHash, document);
    documents.push(document);
    for (let start = 0; start < input.text.length;) {
      let end = Math.min(start + limits.chunkCharacters, input.text.length);
      if (end < input.text.length && /[\uD800-\uDBFF]/u.test(input.text[end - 1])) end--;
      const text = input.text.slice(start, end);
      if (text.trim()) {
        chunks.push({ id: await hashDopplerEvidence({ documentId: contentHash, start, end }),
          documentId: contentHash, start, end, text });
        requireValue(chunks.length <= limits.maxChunks, `Corpus exceeds ${limits.maxChunks} passages`);
      }
      start = end;
    }
  }
  return snapshotPackOperationData({ documents, chunks, totalBytes,
    corpusHash: await hashDopplerEvidence({ documents, chunks }) });
}

export function rankDocumentVectors(chunks, embeddings, queryEmbedding, topK) {
  requireValue(Number.isInteger(topK) && topK > 0, 'Invalid result limit');
  requireValue(chunks.length === embeddings.length && chunks.length > 0, 'Embedding count does not match passages');
  const normalize = (vector) => {
    requireValue(Array.isArray(vector) && vector.length > 0 && vector.length <= 65536 && vector.every(Number.isFinite), 'Invalid embedding vector');
    const norm = Math.hypot(...vector);
    requireValue(Number.isFinite(norm) && norm > 0, 'Empty or overflowing embedding norm');
    return vector.map((value) => value / norm);
  };
  const query = normalize(queryEmbedding);
  return chunks.map((chunk, index) => {
    const vector = normalize(embeddings[index]);
    requireValue(vector.length === query.length, 'Embedding dimension mismatch');
    return { ...chunk, similarity: vector.reduce((sum, value, axis) => sum + value * query[axis], 0) };
  }).sort((left, right) => right.similarity - left.similarity || left.id.localeCompare(right.id)).slice(0, topK);
}

/** Owns corpus/retrieval only. The executor owns local Pack calls; no network job or evidence admission. */
export function createDocumentSearch({ executor, onChange = () => {}, limits = policy }) {
  let corpus = null;
  let models = null;
  let index = null;
  let epoch = 0;
  let busy = false;
  let disposed = false;
  let retentionEpoch = 0;
  let result = null;
  let status = 'Add documents';
  const history = [];
  const state = () => ({ corpus, configured: Boolean(models), hasReranker: Boolean(models?.reranker), busy, result, status,
    history: [...history] });
  const notify = () => { if (!disposed) onChange(state()); };
  const invalidate = () => { epoch++; executor.cancel(); result = null; };
  return {
    getState: state,
    configure(configuration) {
      requireValue(!busy && !disposed, 'Stop the current operation before changing models');
      const next = snapshotPackOperationData(configuration);
      requireValue(next.schema === 'reploid.document-models/v1', 'Unknown document model configuration');
      requireValue(typeof next.queryPrefix === 'string', 'Explicit embedding query prefix required (empty string is allowed)');
      for (const [role, operation] of [['embedding', 'embed'], ['reranker', 'rerank']]) {
        if (role === 'reranker' && next[role] === null) continue;
        const validation = validateOperationModel(next[role]);
        requireValue(validation.ok && next[role].executablePack.requiredOperation === operation,
          `Invalid ${role} Pack: ${validation.reasons.join('; ')}`);
        requireValue(next[role].application && typeof next[role].application === 'object'
          && !Array.isArray(next[role].application), `${role} application identity required`);
      }
      invalidate(); models = next; index = null; status = 'Models selected'; notify();
    },
    async setDocuments(documents) {
      requireValue(!busy && !disposed, 'Stop the current operation before replacing documents');
      invalidate(); const currentEpoch = epoch;
      busy = true; status = 'Reading documents'; notify();
      try {
        const next = await ingestDocuments(documents, limits);
        requireValue(currentEpoch === epoch && !disposed, 'Document import cancelled');
        corpus = next; index = null; status = `${next.documents.length} documents ready`;
      } finally { busy = false; notify(); }
    },
    async search({ query, topK = 5, rerank = false }) {
      requireValue(!busy && !disposed, 'A document operation is already running');
      requireValue(models && corpus, 'Select model Packs and add documents first');
      requireValue(typeof query === 'string' && query.trim() && bytes(query) <= limits.maxQueryBytes, 'Enter a question within the input limit');
      requireValue(Number.isInteger(topK) && topK > 0 && topK <= limits.maxResults, 'Invalid result limit');
      requireValue(!rerank || models.reranker, 'Select a reranker Pack before requesting reranking');
      const currentEpoch = ++epoch;
      const currentRetentionEpoch = retentionEpoch;
      const current = () => requireValue(currentEpoch === epoch && !disposed, 'Document search cancelled');
      const operationLimits = () => ({ maxInputBytes: limits.maxInputBytes, maxOutputBytes: limits.maxOutputBytes,
        deadlineAt: Date.now() + limits.maxOperationMs });
      const startedAt = new Date().toISOString();
      busy = true; result = null; status = 'Embedding'; notify();
      const receipts = [];
      try {
        const modelKey = await hashDopplerEvidence(models.embedding);
        current();
        const cached = index?.modelKey === modelKey && index?.corpusHash === corpus.corpusHash;
        const queryInput = models.queryPrefix + query;
        const texts = cached ? [queryInput] : [...corpus.chunks.map((chunk) => chunk.text), queryInput];
        const embedded = await executor.run({ model: models.embedding,
          input: { texts, application: models.embedding.application }, options: {}, limits: operationLimits() });
        current(); receipts.push(embedded.receipt);
        const vectors = embedded.output.embeddings.map((item) => item.embedding);
        requireValue(vectors.length === texts.length, 'Embedding batch is incomplete');
        const corpusVectors = cached ? index.vectors : vectors.slice(0, -1);
        let matches = rankDocumentVectors(corpus.chunks, corpusVectors, vectors.at(-1), topK);
        if (!cached) index = { modelKey, corpusHash: corpus.corpusHash,
          vectors: snapshotPackOperationData(corpusVectors), receipt: embedded.receipt };
        if (rerank) {
          status = 'Reranking'; notify();
          const ranked = await executor.run({ model: models.reranker,
            input: { query, documents: matches.map((item) => item.text), application: models.reranker.application },
            options: {}, limits: operationLimits() });
          current(); receipts.push(ranked.receipt);
          matches = ranked.output.evidence.ranking.map((item) => ({ ...matches[item.index], rerankScore: item.score }));
        }
        current();
        result = snapshotPackOperationData({ schema: 'reploid.document-search-result/v1',
          corpusHash: corpus.corpusHash, query, startedAt, completedAt: new Date().toISOString(),
          execution: 'local', reranked: rerank, matches: matches.map((match) => ({ ...match,
            sources: corpus.documents.find((document) => document.id === match.documentId).sources })),
          receipts, indexReceipt: index.receipt });
        history.unshift(snapshotPackOperationData({ status: 'completed', startedAt, result }));
        status = `${matches.length} passages found`;
        return result;
      } catch (error) {
        if (currentRetentionEpoch === retentionEpoch && !disposed) {
          status = currentEpoch !== epoch ? 'Cancelled' : 'Search failed';
          history.unshift(snapshotPackOperationData({ status: currentEpoch !== epoch ? 'cancelled' : 'failed', startedAt,
            error: error.message, receipts }));
        }
        throw error;
      } finally {
        history.splice(limits.maxHistory); busy = false; notify();
      }
    },
    cancel() { invalidate(); status = 'Cancelling'; notify(); },
    clear() { retentionEpoch++; invalidate(); corpus = null; index = null; history.length = 0; status = 'Add documents'; notify(); },
    async close() { disposed = true; retentionEpoch++; invalidate(); await executor.close(); corpus = null; index = null; models = null; history.length = 0; }
  };
}
