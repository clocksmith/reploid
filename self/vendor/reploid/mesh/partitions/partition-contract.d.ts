import type { PartitionBinding } from './partition-runner.js';
export const partitionIdentityKeys: readonly (keyof PartitionBinding)[];
export const partitionActions: readonly string[];
export function assertPartition(value: unknown, message: string): asserts value;
export function samePartitionIdentity(actual: unknown, expected: PartitionBinding): boolean;
export function validatePartitionIdentity(identity: unknown): asserts identity is PartitionBinding;
export function canonicalPartitionJson(value: unknown): string;
export function partitionFingerprint(metadata: unknown, bytes?: Uint8Array): Promise<string>;
