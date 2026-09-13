export { createLegacyGenerationMesh } from './legacy-generation.js';
export * from './swarm-coordination.js';
export * from './contribution.js';
export { default as contributionPolicy } from './contribution.js';
export { default as swarmCoordination } from './swarm-coordination.js';
import type { ResolvedConfig, Json } from '../config/index.js';
import type { Authorize, GenerationProvider } from '../index.js';
import type { LegacyGenerationMesh } from './legacy-generation.js';
export function createIntelligenceMesh(options: { config: ResolvedConfig; ports: {
  authorize: Authorize; local?: GenerationProvider; remote?: LegacyGenerationMesh;
} }): GenerationProvider & { connect(): Promise<unknown>; describe(): Json; close(): Promise<void> };
