export { createLegacyGenerationMesh } from './legacy-generation.js';
export * from './placement-beliefs.js';
export * from './swarm-coordination.js';
export * from './contribution.js';
export * from './partitions/partition-runner.js';
export * from './partitions/partition-step-receiver.js';
export { default as contributionPolicy } from './contribution.js';
export { default as swarmCoordination } from './swarm-coordination.js';
import type { ResolvedConfig, Json } from '../config/index.js';
import type { Authorize, GenerationProvider } from '../index.js';
import type { LegacyGenerationMesh } from './legacy-generation.js';
export function createIntelligenceMesh(options: { config: ResolvedConfig; ports: {
  authorize: Authorize; local?: GenerationProvider; remote?: LegacyGenerationMesh;
} }): GenerationProvider & { connect(): Promise<unknown>; describe(): Json; close(): Promise<void> };

export * from './partitions/resident-partition.js';
export * from './partitions/partition-grants.js';
export * from './partitions/partition-peer.js';
export * from './partitions/partition-network.js';
export * from './partitions/partition-chat.js';
export { partitionFingerprint } from './partitions/partition-contract.js';

export * from './partitions/partition-entry.js';
export * from './partitions/partition-link.js';
