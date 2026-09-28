export interface PartitionPlan {
  schema: string;
  modelId: string;
  totalLayers: number;
  hiddenSize: number;
  vocabSize: number;
  splitLayer: number;
  activationDtype: 'f16' | 'f32';
  partitions: readonly unknown[];
}
export interface AttemptIdentity {
  requesterId?: string;
  placementGeneration?: number;
  modelIdentity: string;
  planId: string;
  threadId: string;
  attemptId: string;
}
export interface PartitionBinding extends AttemptIdentity {
  modelId: string;
  participantA: string;
  participantB: string;
}
export interface PartitionStep {
  step: number;
  tokenPosition: number;
  inputTokenCount: number;
  /** Effective request limit, unchanged for every stage; Doppler owns length-stop finalization. */
  maxTokens: number;
  generationDigest: string;
}
export interface ActivationTensor {
  shape: number[];
  dtype: 'f16' | 'f32';
  data: ArrayBuffer | ArrayBufferView;
  seqOffset: number;
  step: number;
}
export interface ActivationFrame {
  schema: string;
  shape: readonly number[];
  dtype: 'f16' | 'f32';
  seqOffset: number;
  step: number;
  byteLength: number;
  metadata: Record<string, unknown>;
  buffer: ArrayBuffer;
}
export interface PartitionRuntime {
  LAYER_PARTITION_SCHEMA: string;
  ACTIVATION_TENSOR_SCHEMA: string;
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
export interface PartitionLimits {
  maxTokens: number;
  maxPromptTokens: number;
  maxActivationBytes: number;
  maxOutputCharacters: number;
  maxAttempts: number;
  maxConcurrentAttempts: number;
}
export interface PartitionStepOptions extends PartitionStep {
  identity: Readonly<PartitionBinding>;
  /** Structured-cloneable session handle; KV/GPU resources stay at their device. */
  continuation: unknown;
  executionGrant: object;
  generation: Record<string, unknown> & { maxTokens: number };
  signal: AbortSignal;
}
export interface PartitionDevice {
  id: string;
  /** Settles only the named attempt; does not release shared resident weights. */
  closeAttempt(options: { identity: Readonly<PartitionBinding> }): Promise<void>;
}
export interface PartitionDeviceA extends PartitionDevice {
  executeGroup0(options: PartitionStepOptions & { tokenIds: number[] }): Promise<{
    activationTensor: ActivationTensor;
    continuation: unknown;
  }>;
}
export interface PartitionDeviceB extends PartitionDevice {
  executeGroup1(options: PartitionStepOptions & { activation: unknown; inputTokenIds: number[]; outputGrant: object }): Promise<{
    identity: PartitionBinding;
    step: number;
    tokenPosition: number;
    tokenId: number;
    done: boolean;
    delta: string;
    stopReason?: string;
    continuation: unknown;
    logits?: Float32Array | number[] | null;
  }>;
}
export interface PartitionRequest {
  tokenIds: number[];
  generation: Record<string, unknown> & { maxTokens: number };
  identity: AttemptIdentity;
  grants: PartitionGrants;
  maxTokens: number;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void | Promise<void>;
}
export interface PartitionResult {
  content: string;
  tokenIds: number[];
  logits: Float32Array | number[] | null;
  stopReason: string;
  execution: PartitionBinding & {
    schema: 'reploid.mesh.partition-execution/v2';
    placement: 'two-device-layer-partition';
    splitLayer: number;
    activationBytes: number;
    steps: Array<PartitionStep & { tokenId: number; activationBytes: number; transferMs: number | null; remoteStepMs: number | null; elapsedMs: number }>;
  };
}
export interface LayerPartitionRunner {
  readonly plan: Readonly<PartitionPlan>;
  execute(options: PartitionRequest): Promise<PartitionResult>;
  close(): Promise<void>;
}
export function createLayerPartitionRunner(options: {
  runtime: PartitionRuntime;
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
