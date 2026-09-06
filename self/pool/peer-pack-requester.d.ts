import type { JsonValue, PackOperationRegistry } from './pack-operation-adapters.js';
import type { PackOperationEvent, PackOperationResult } from './pack-operation.js';
import type { PackPeerIdentity, PackPeerJobBody, SignedPackPeerMessage, createPackPeerJob } from './peer-pack-job.js';
import type { CurrentPackJobPolicy } from './peer-pack-job-policy.js';
export interface PackPeerBus {
  send(message: SignedPackPeerMessage<unknown>): Promise<void>;
  subscribe(listener: (message: SignedPackPeerMessage<unknown>) => void): () => void;
  onDisconnect?(listener: () => void): () => void;
}
export interface PackPeerRunCallbacks {
  readonly signal?: AbortSignal | null;
  readonly onPartial?: ((event: PackOperationEvent) => void | Promise<void>) | null;
}
export type PackPeerRunInput = Omit<Parameters<typeof createPackPeerJob>[0], 'identity' | 'registry' | 'policy'>
  & PackPeerRunCallbacks & { readonly reference: JsonValue };
export interface PackPeerJobResult {
  readonly job: SignedPackPeerMessage<PackPeerJobBody>;
  readonly execution: PackOperationResult;
  readonly assessment: Readonly<Record<string, JsonValue>>;
  readonly acceptance: SignedPackPeerMessage;
  readonly updates: readonly SignedPackPeerMessage[];
  readonly accounting: { readonly deliveries: number; readonly sentBytes: number; readonly receivedBytes: number };
}
export interface PackPeerRequester {
  run(input: PackPeerRunInput): Promise<PackPeerJobResult>;
  runPrepared(input: PackPeerRunCallbacks & { job: SignedPackPeerMessage<PackPeerJobBody>; reference: JsonValue }): Promise<PackPeerJobResult>;
  cancel(): void;
  getState(): { closed: boolean; active: boolean; deliveries: number };
  close(): void;
}
export interface PackPeerRequesterOptions {
  readonly identity: PackPeerIdentity;
  readonly bus: PackPeerBus;
  readonly models: readonly Readonly<Record<string, JsonValue>>[];
  readonly registry?: PackOperationRegistry;
  readonly policy?: CurrentPackJobPolicy;
  readonly maxDeliveries?: number;
  readonly retryMs?: number;
  readonly onError?: (error: Error) => void;
}
export function createPackPeerRequester(options: PackPeerRequesterOptions): PackPeerRequester;
