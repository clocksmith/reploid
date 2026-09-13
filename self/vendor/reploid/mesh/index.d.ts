export { createLegacyGenerationMesh } from './legacy-generation.js';
export * from './swarm-coordination.js';
export { rankProviderPeers } from './contribution.js';
import type { ResolvedConfig, Json } from '../config/index.js';
import type { Authorize, GenerationProvider } from '../index.js';
import type { LegacyGenerationMesh } from './legacy-generation.js';
export function createIntelligenceMesh(options: { config: ResolvedConfig; ports: {
  authorize: Authorize; local?: GenerationProvider; remote?: LegacyGenerationMesh;
} }): GenerationProvider & { connect(): Promise<unknown>; describe(): Json; close(): Promise<void> };
