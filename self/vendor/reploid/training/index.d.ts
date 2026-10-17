import type { PartitionChannelLimits } from '../transport/partition-data-channel.js';
export interface TrainingSample { inputIds: number[]; targetIds: number[]; supervisedTokenCount: number }
export interface TrainingPolicy {
  baseManifestHash: string; vocabSize: number; maxSamples: number; maxTokensPerSample: number;
  maxInputBytes: number; maxParticipants: number; timeoutMs: number; connectTimeoutMs: number;
  channel: PartitionChannelLimits;
}
export interface TrainingCandidate {
  manifest: Record<string, unknown>; json: string; weights: ArrayBuffer; weightsSha256: string;
  metrics: Record<string, unknown>[]; evaluated: false; activated: false;
}
export interface TrainingState {
  phase: string; message: string; busy: boolean; completedSteps: number;
  candidate: null | { id: string; version: string; weightsSha256: string };
}
export interface TrainingExecutor {
  request(action: string, input: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
  close(): Promise<void>;
}
export interface TrainingPeer {
  participantId: string;
  request(action: string, jobId: string, body: unknown, signal: AbortSignal): Promise<unknown>;
}
export interface TrainingNetwork { connect(peerId: string, signal: AbortSignal): Promise<TrainingPeer>; close(): Promise<void> }
export interface TrainingReceiver {
  action: string; jobId: string; body: Record<string, unknown>; remoteParticipantId: string; signal: AbortSignal;
}
export interface TrainingSession {
  getState(): TrainingState; getCandidate(): TrainingCandidate | null;
  subscribe(listener: (state: TrainingState) => void): () => void;
  connect(): Promise<void>;
  run(input: { samples: TrainingSample[]; consent: boolean; peers?: string[];
    adapter: { id: string; name: string; version: string } }): Promise<TrainingCandidate>;
  contribute(input: { sample: TrainingSample; coordinator: string; consent: boolean }): Promise<void>;
  stop(): Promise<void>; disconnect(): Promise<void>; close(): Promise<void>;
}
export function createTrainingSession(options: {
  policy: TrainingPolicy; participantId(networked: boolean): Promise<string>;
  openExecutor(options: { signal: AbortSignal; onProgress(message: string): void }): Promise<TrainingExecutor>;
  connectPeer(network: TrainingNetwork, peer: string, signal: AbortSignal): Promise<TrainingPeer>;
  openNetwork(options: { receive(input: TrainingReceiver): Promise<unknown>; allowed(remote: string): boolean }): TrainingNetwork;
  onChange?(state: TrainingState): void;
}): TrainingSession;
export function createTrainingNetwork(options: {
  openNetwork: (options: Record<string, unknown>) => { connect(peerId: string): Promise<unknown>; close(): Promise<void> };
  localParticipantId: string; receive(input: TrainingReceiver): Promise<unknown>;
  allowed(remote: string): boolean; policy: TrainingPolicy;
}): TrainingNetwork;
