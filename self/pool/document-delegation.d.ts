import type { DocumentSearchState, DocumentModels, DocumentSearchResult, DocumentCorpus } from './document-search.js';
import type { LocalPackExecutor } from './local-pack-executor.js';
import type { PackPeerLimits, PackProviderAdvertBody, SignedPackPeerMessage } from './peer-pack-job.js';
import type { WorkRequirements } from './peer-capabilities.js';
import type { JsonValue } from './pack-operation-adapters.js';
import type { PackPeerModel } from './peer-pack-job.js';
import type { PackPeerJobResult } from './peer-pack-requester.js';
import type { runPeerOperationJob } from './peer-room.js';
export interface DocumentOperationNetwork {
  describe(options: { model: PackPeerModel }): Promise<{ readonly adverts: readonly SignedPackPeerMessage<PackProviderAdvertBody>[]; readonly resources: WorkRequirements['resources']; readonly limits: PackPeerLimits }>;
  run(options: Pick<Parameters<typeof runPeerOperationJob>[0], 'request' | 'providerAdverts' | 'signal'>): Promise<PackPeerJobResult>;
}
export interface DocumentDelegationPreview {
  readonly id: string; readonly text: string; readonly providerId: string; readonly modelId: string;
  readonly bytes: number; readonly expiresAt: number;
}
export interface DocumentAssistantState extends DocumentSearchState {
  delegation: { available: boolean; preview: DocumentDelegationPreview | null; phase: string };
}
export interface DelegatedDocumentResult extends DocumentSearchResult {
  execution: 'local-and-approved-peer'; remoteExecution: PackPeerJobResult; disclosure: DocumentDelegationPreview;
}
export function createDocumentAssistant(options: { executor: LocalPackExecutor; network?: DocumentOperationNetwork | null;
  onChange?: (state: DocumentAssistantState) => void; policy?: object; jobPolicy?: object; registry?: object }): {
    getState(): DocumentAssistantState;
    configure(settings: DocumentModels): void;
    setDocuments(documents: readonly { name: string; text: string }[]): Promise<DocumentCorpus>;
    search(options: { query: string; topK?: number; rerank?: boolean; generateAnswer?: boolean }): Promise<DocumentSearchResult>;
    connectNetwork(network: DocumentOperationNetwork): void;
    prepareDelegation(input: { task: string }): Promise<DocumentDelegationPreview>;
    approveDelegation(input: { previewId: string; text: string; publicInput: boolean }): Promise<DelegatedDocumentResult>;
    withdrawDelegation(): void;
    cancel(): void;
    clear(): void;
    close(): Promise<void>;
  };
