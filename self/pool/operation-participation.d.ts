import type { OperationRoomOptions, createOperationRoomProvider } from './operation-room-network.js';
import type { LocalPackExecutor } from './local-pack-executor.js';
import type { DocumentModels } from './document-search.js';
import type { ExecutionAdapter } from './adapter-execution.js';
import type { PeerAdapterResolver } from './peer-adapter-execution.js';
import type { PackOperationRegistry } from './pack-operation-adapters.js';
export interface OperationParticipationState { phase: 'idle' | 'starting' | 'sharing' | 'stopping'; modelId: string | null; error: string | null }
export interface OperationParticipation {
  getState(): OperationParticipationState;
  start(options: { configuration: DocumentModels & { executionAdapters?: readonly ExecutionAdapter[] }; approved: boolean }): Promise<void>;
  stop(): Promise<void>; close(): Promise<void>;
}
export function createOperationParticipation(options: {
  networkOptions(): OperationRoomOptions;
  onChange?: (state: OperationParticipationState) => void; policy?: object;
  executorFactory?: () => LocalPackExecutor; createProvider?: typeof createOperationRoomProvider;
  registry?: PackOperationRegistry; adapterResolver?: PeerAdapterResolver | null;
  observeAdapters?: () => Promise<readonly { identity: string; availability: 'resident' | 'cached' | 'fetchable' }[]>;
}): OperationParticipation;
