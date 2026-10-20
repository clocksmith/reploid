import type { PartitionBinding } from './partition-runner.js';
export const partitionIdentityKeys: readonly (keyof PartitionBinding)[];
export const partitionActions: readonly string[];
export function assertPartition(value: unknown, message: string): asserts value;
/** Codes declared in transport/partition-errors.json; the message is the declared one. */
export type PartitionFailureCode = 'RESULT_EXPIRED' | 'RESOURCE_EXHAUSTED' | 'AUTHORIZATION_DENIED' | 'EXECUTION_FAILED'
  | 'OUTPUT_LIMIT_EXCEEDED' | 'GENERATION_OUTPUT_INVALID' | 'CAPACITY_UNAVAILABLE' | 'CAPACITY_QUEUE_FULL'
  | 'CAPACITY_QUEUE_TIMEOUT' | 'CONNECTION_LOST' | 'REQUEST_TIMEOUT' | 'CLEANUP_FAILED';
export function partitionFailure<T extends object = {}>(code: PartitionFailureCode, detail?: T): Error & T & { code: PartitionFailureCode };
/** Throws CAPACITY_UNAVAILABLE unless `value` holds. */
export function assertCapacity(value: unknown): asserts value;
export function samePartitionIdentity(actual: unknown, expected: PartitionBinding): boolean;
export function validatePartitionIdentity(identity: unknown): asserts identity is PartitionBinding;
export function canonicalPartitionJson(value: unknown): string;
export function partitionFingerprint(metadata: unknown, bytes?: Uint8Array): Promise<string>;
export interface PartitionActivationContract {
  schema: string; dtype: 'f32' | 'f16'; hiddenSize: number;
  precision: 'f32' | 'f16' | 'two-f32'; components: 1 | 2; elementStrideBytes: 2 | 4 | 8;
}
export interface OrderedPartitionPlan {
  schema: 'doppler.layer-partition-contract/v3'; modelId: string; stageCount: number;
  partitions: readonly { index: number }[];
}
export interface OrderedPartitionRuntime {
  hashLayerPartitionPlan(plan: OrderedPartitionPlan): string | Promise<string>;
  getPartitionActivationContract(plan: OrderedPartitionPlan): PartitionActivationContract;
  validateActivationFrameForPlan(frame: unknown, plan: OrderedPartitionPlan): unknown;
}
export interface PartitionRouteStage {
  readonly index: number; readonly participantId: string; readonly transportId: string;
  readonly residentId: string; readonly executionId: string;
}
export interface PartitionRoute {
  readonly schema: 'reploid.partition-route/v1'; readonly modelId: string; readonly modelIdentity: string;
  readonly planId: string; readonly stages: readonly PartitionRouteStage[];
  readonly activation: Readonly<PartitionActivationContract>;
}
export interface RouteAttemptBinding {
  readonly schema: 'reploid.partition-attempt/v2'; readonly threadId: string; readonly attemptId: string;
  readonly requesterId: string; readonly placementGeneration: number; readonly route: PartitionRoute;
}
export const PARTITION_ROUTE_SCHEMA: PartitionRoute['schema'];
export const ROUTE_ATTEMPT_SCHEMA: RouteAttemptBinding['schema'];
export function canonicalPartitionRoute(route: unknown): PartitionRoute;
export function validatePartitionRoute(runtime: OrderedPartitionRuntime, plan: OrderedPartitionPlan, route: unknown): Promise<PartitionRoute>;
export function canonicalRouteAttemptBinding(identity: unknown): RouteAttemptBinding;
export function sameRouteAttemptIdentity(actual: unknown, expected: unknown): boolean;

export function validateOrderedPartitionCapability(description: unknown, participantId: string, maxOffersPerPeer: number): void;
export function isOrderedPartitionEntryModel(model: unknown, peer: { participantId: string; transportId: string;
  description?: { schema?: string } | null }): boolean;

export function partitionAdapterIdentities(model: {identity: string; adapters?: readonly {identity:string;baseModelIdentity:string}[]}): string[];
export function samePartitionAdapters(left: Parameters<typeof partitionAdapterIdentities>[0], right: Parameters<typeof partitionAdapterIdentities>[0]): boolean;
export function selectPartitionContribution<T extends import('../../chat/index.js').ChatModel>(model: T, adapters?: T['adapters']): T;
