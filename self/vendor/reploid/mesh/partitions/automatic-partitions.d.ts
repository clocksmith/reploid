import type { SigningIdentity } from '../../artifacts/identity.js';
import type { ChatModel, ChatRequest, ChatControls, ChatResult } from '../../chat/index.js';
import type { PartitionPlan, PartitionRuntime, PartitionLimits } from './partition-runner.js';
import type { ResidentPartition, ResidentPartitionDescriptor } from './resident-partition.js';
import type { PartitionChannelLimits } from '../../transport/partition-data-channel.js';
import type { PartitionNetwork } from './partition-network.js';
export interface AutomaticPartitionState {
  phase: 'idle' | 'waiting' | 'loading' | 'ready' | 'failed'; error: string | null;
  offering: boolean; modelId: string | null; placement: string[] | null;
  descriptor: ResidentPartitionDescriptor | null; acquisition: unknown; models: ChatModel[];
}
export interface AutomaticPartitionPolicy {
  pollMs: number; maxPeers: number; connectTimeoutMs: number; grantMs: number;
  limits: PartitionLimits; inputChannel: PartitionChannelLimits;
  executionChannel: PartitionChannelLimits; controlChannel: PartitionChannelLimits;
  inputLimits: { maxInputCharacters: number; maxOutputCharacters: number; maxAttempts: number;
    maxConcurrentAttempts: number; descriptorTtlMs: number };
  receiver: { maxAttempts: number; maxSteps: number };
}
export interface AutomaticPartitions {
  getState(): AutomaticPartitionState; getModels(): ChatModel[];
  subscribe(listener: (models: ChatModel[]) => void): () => void;
  contribute(modelId: string, approved: boolean): Promise<void>;
  stop(): Promise<void>; close(): Promise<void>;
  generate(request: ChatRequest & { threadId: string; attemptId: string }, controls: ChatControls): Promise<ChatResult>;
}
export function createAutomaticPartitions(options: {
  identity: SigningIdentity; meshId: string; models: ChatModel[]; policy: AutomaticPartitionPolicy;
  peers(): Array<{ id: string; localTransportId: string }>;
  createNetwork<T extends { close(): void | Promise<void> }>(options: {
    label: string; maxPeers: number; timeoutMs: number;
    createEndpoint(options: { channel: RTCDataChannel; remoteParticipantId: string }): T;
    onPeer?(transportId: string, endpoint: T): void;
  }): PartitionNetwork<T>;
  loadProgram(model: ChatModel, index: 0 | 1, controls: { signal: AbortSignal; participantId: string;
    onProgress(value: unknown): void }): Promise<{ runtime: PartitionRuntime; model: ChatModel;
      plan: PartitionPlan; planId: string; resident: ResidentPartition; getReceipt?(): unknown }>;
  onChange?(state: AutomaticPartitionState & { progress?: unknown }): void;
}): AutomaticPartitions;
