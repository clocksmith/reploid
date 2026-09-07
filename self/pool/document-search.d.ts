import type { JsonValue } from './pack-operation-adapters.js';
import type { LocalPackExecutor } from './local-pack-executor.js';
import type { PackPeerModel } from './peer-pack-job.js';
type JsonObject = Readonly<Record<string, JsonValue>>;
export interface DocumentModels {
  schema: 'reploid.document-models/v1'; queryPrefix: string; embedding: PackPeerModel;
  reranker?: PackPeerModel | null; generator?: PackPeerModel | null; generationOptions?: JsonObject;
}
export interface DocumentChunk { id: string; documentId: string; start: number; end: number; text: string }
export interface DocumentCorpus { documents: readonly { id: string; sources: readonly string[]; sizeBytes: number }[];
  chunks: readonly DocumentChunk[]; totalBytes: number; corpusHash: string }
export interface DocumentSearchResult {
  schema: 'reploid.document-search-result/v1'; corpusHash: string; query: string; startedAt: string; completedAt: string;
  execution: 'local' | 'local-and-approved-peer'; reranked: boolean;
  matches: readonly (DocumentChunk & { sources: readonly string[]; similarity: number })[];
  answer: { text: string; status: 'cited' | 'abstained'; support: 'not-evaluated'; citations: readonly { number: number; chunkId: string; documentId: string; start: number; end: number }[] } | null;
  answerAudit: JsonObject | null;
  executionMetrics: ReturnType<LocalPackExecutor['getState']>['metrics'] | null;
  receipts: readonly JsonObject[]; indexReceipt: JsonObject; embeddingCache: { corpus: boolean; query: boolean };
}
export interface DocumentSearchState {
  corpus: DocumentCorpus | null; configured: boolean; hasReranker: boolean; hasGenerator: boolean;
  busy: boolean; result: DocumentSearchResult | null; status: string;
  history: readonly { status: 'completed' | 'failed' | 'cancelled'; startedAt: string; result?: DocumentSearchResult; error?: string; receipts?: readonly JsonObject[]; answerAudit?: JsonObject | null }[];
}
export interface DocumentSearchInput { query: string; topK?: number; rerank?: boolean; generateAnswer?: boolean; remoteDraft?: string | null }
export interface DocumentSearch {
  getState(): DocumentSearchState; configure(models: DocumentModels): void;
  setDocuments(documents: readonly { name: string; text: string }[]): Promise<DocumentCorpus>;
  search(input: DocumentSearchInput): Promise<DocumentSearchResult>;
  cancel(): void; clear(): void; close(): Promise<void>;
}
export function createDocumentSearch(options: { executor: LocalPackExecutor; onChange?: (state: DocumentSearchState) => void; limits?: object }): DocumentSearch;
export function ingestDocuments(documents: readonly { name: string; text: string }[], limits?: object): Promise<DocumentCorpus>;
export function rankDocumentVectors(chunks: readonly DocumentChunk[], embeddings: readonly (readonly number[])[], queryEmbedding: readonly number[], topK: number): (DocumentChunk & { similarity: number })[];
