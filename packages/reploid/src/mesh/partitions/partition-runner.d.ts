import type { CanonicalRunnerRequest, CanonicalRunnerResult } from './partition-canonical-execution.js';
import type { PartitionRequestTiming } from '../../transport/partition-data-channel.js';

import type { LayerPartitionPlan, ResidentPartitionIdentity, ResidentPartitionStep,
  ResidentPartitionLimits, ResidentPartitionARequest, ResidentPartitionAResult,
  ResidentPartitionBRequest, ResidentPartitionBResult, ActivationFrame as DopplerActivationFrame } from '../../contracts/doppler-partitions.js';
export type PartitionPlan = LayerPartitionPlan;
export type AttemptIdentity = Omit<ResidentPartitionIdentity, 'modelId' | 'participantA' | 'participantB'>;
export type PartitionBinding = ResidentPartitionIdentity;
export type PartitionStep = Pick<ResidentPartitionStep, 'step' | 'tokenPosition' | 'inputTokenCount' | 'maxTokens'>
  & { generationDigest: string };
export type ActivationTensor = ResidentPartitionAResult['activationTensor'];
export type ActivationFrame = DopplerActivationFrame;
export interface PartitionRuntime {
  LAYER_PARTITION_SCHEMA: string;
  ACTIVATION_TENSOR_SCHEMA: string;
  getPartitionActivationContract?(plan: PartitionPlan): { schema: string; dtype: string;
    precision: string; components: number; elementStrideBytes: number; hiddenSize: number };
  validateActivationFrameForPlan?(frame: unknown, plan: PartitionPlan): unknown;
  serializeActivationFrame(options: ActivationTensor & { metadata: Record<string, unknown> }): ActivationFrame;
  deserializeActivationFrame(frame: ActivationFrame): unknown;
}
export interface PartitionGrants {
  executionA: object;
  executionB: object;
  activation: object;
  tokenContext: object;
  output: object;
}
export type PartitionLimits = ResidentPartitionLimits;
export type PartitionStepOptions = ResidentPartitionStep & { executionGrant: object; generationDigest: string };
export interface PartitionDevice {
  id: string;
  /** Settles only the named attempt; does not release shared resident weights. */
  closeAttempt(options: { identity: Readonly<PartitionBinding> }): Promise<void>;
}
export interface PartitionDeviceA extends PartitionDevice {
  executeGroup0(options: ResidentPartitionARequest & { executionGrant: object; generationDigest: string }): Promise<ResidentPartitionAResult>;
}
export interface PartitionDeviceB extends PartitionDevice {
  executeGroup1(options: ResidentPartitionBRequest & { executionGrant: object; outputGrant: object; generationDigest: string }):
    Promise<Omit<ResidentPartitionBResult, 'logits' | 'metrics'> & Partial<Pick<ResidentPartitionBResult, 'logits' | 'metrics'>>
      & { transportTiming?: PartitionRequestTiming | null }>;
}
export interface PartitionRequest {
  tokenIds: number[];
  generation: ResidentPartitionStep['generation'];
  identity: AttemptIdentity;
  grants: PartitionGrants;
  maxTokens: number;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void | Promise<void>;
}
export interface PartitionAttemptReceipt {
  identity: PartitionBinding;
  /** Immutable admission acknowledgements, not current capacity or physical memory measurements. */
  reservations: import('./resident-partition.js').PartitionReservation[];
  phase: 'executing' | 'settling' | 'completed' | 'failed' | 'cancelled' | 'cleanup-failed';
  startedAt: number; failure: string | null; cleanupStartedAt: number | null; cleanupSettledAt: number | null;
  cleanup: Array<{ participantId: string; status: 'settled' | 'failed'; settledAt: number | null; error: string | null }>;
}
export interface PartitionRunnerState { closed: boolean; active: number; attempts: PartitionAttemptReceipt[] }
export interface PartitionResult {
  content: string;
  tokenIds: number[];
  logits: Float32Array | number[] | null;
  stopReason: string;
  execution: PartitionBinding & {
    schema: 'reploid.mesh.partition-execution/v2';
    settlement: PartitionAttemptReceipt;
    placement: 'two-device-layer-partition';
    splitLayer: number;
    activationBytes: number;
    steps: Array<PartitionStep & { tokenId: number; activationBytes: number;
      /** Waiting for this runner's shared FIFO lease, excluding output delivery. */
      leaseWaitMs: number;
      /** Awaited output callback outside the lease; zero when no delta is delivered. */
      outputDeliveryMs: number;
      localStepMs: number; serializationMs: number;
      computationA: Record<string, unknown> | null; computationB: Record<string, unknown> | null;
      transferMs: number | null; remoteStepMs: number | null;
      transportTiming: PartitionRequestTiming | null; elapsedMs: number }>;
  };
}
export interface LayerPartitionRunner {
  readonly plan: Readonly<PartitionPlan>;
  getState(): PartitionRunnerState;
  execute(options: PartitionRequest): Promise<PartitionResult>;
  /** Requires constructor opt-in and authenticated durable publication; shares ordinary leases and settlement. */
  executeCanonical(options: CanonicalRunnerRequest): Promise<CanonicalRunnerResult>;
  close(): Promise<void>;
}
export function createLayerPartitionRunner(options: {
  runtime: PartitionRuntime;
  /** Explicit capability opt-in. Legacy accepted runtimes remain on execute(). */
  canonical?: boolean;
  plan: PartitionPlan;
  deviceA: PartitionDeviceA;
  deviceB: PartitionDeviceB | import('./partition-peer.js').RemotePartitionDevice;
  transport?: { transferActivation(frame: ActivationFrame,
    options: PartitionStep & { identity: PartitionBinding; signal: AbortSignal }): Promise<ActivationFrame> };
  /** Must verify actual recipient-bound grants; a grant's schema/name is not authorization. */
  authorize(options: PartitionBinding & PartitionStep & {
    action: 'mesh.execute_partition_a' | 'mesh.execute_partition_b'
      | 'mesh.transfer_intermediate_activation' | 'mesh.transfer_token_context' | 'mesh.transfer_partition_output';
    grant: object;
    plan: PartitionPlan;
    signal: AbortSignal;
  }): Promise<boolean>;
  limits: PartitionLimits;
}): LayerPartitionRunner;
export interface PartitionComparison {
  matches: boolean;
  maxDiff: number;
  cosineSimilarity: number;
  tolerance: number;
}
export function verifySplitParity(options: {
  runtime: { comparePartitionExecution(options: { splitOutput: Float32Array | number[];
    referenceOutput: Float32Array | number[]; tolerance: number }): PartitionComparison };
  splitRunner: Pick<LayerPartitionRunner, 'execute'>;
  referenceRunner: { execute(options: { tokenIds: number[]; maxTokens: number }): Promise<{
    logits: Float32Array | number[]; tokenIds: number[];
  }> };
  tokenIds: number[];
  generation: PartitionRequest['generation'];
  identity: AttemptIdentity;
  grants: PartitionGrants;
  maxTokens: number;
  tolerance: number;
}): Promise<PartitionComparison & { tokensMatch: boolean; splitResult: PartitionResult;
  refResult: { logits: Float32Array | number[]; tokenIds: number[] }; comparison: PartitionComparison }>;
