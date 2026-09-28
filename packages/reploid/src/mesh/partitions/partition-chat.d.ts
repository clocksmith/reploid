import type { ChatModel, ChatRequest, ChatControls, ChatResult, ChatEnvelope } from '../../chat/index.js';
import type { PartitionRuntime, PartitionPlan, PartitionLimits } from './partition-runner.js';
import type { ResidentPartition } from './resident-partition.js';
import type { PartitionPeer } from './partition-peer.js';
import type { PartitionGrantAuthority } from './partition-grants.js';
export interface PartitionChat {
  getModels(): ChatModel[];
  subscribe(listener: (models: ChatModel[]) => void): () => void;
  refresh(options?: { signal?: AbortSignal }): Promise<ChatModel[]>;
  generate(request: ChatRequest & ChatEnvelope & { meshId: string; participantId: string; placementGeneration?: number }, controls: ChatControls): Promise<ChatResult>;
  /** Cancels owned conversations, preserving borrowed residents and network endpoints. */
  close(): Promise<void>;
}
export function createPartitionChat(options: { runtime: PartitionRuntime; local: ResidentPartition; remote: PartitionPeer;
  authority: PartitionGrantAuthority; model: ChatModel; plan: PartitionPlan; planId: string;
  limits: PartitionLimits; grantTtlMs: number;
  authorizeRequester?: (request: ChatRequest & { participantId: string }, signal: AbortSignal) => Promise<boolean>; now?: () => number }): PartitionChat;
