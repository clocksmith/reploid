import type { Authorize, GenerationProvider, GenerationResult, Message } from '../index.js';
import type { ResolvedConfig } from '../config/index.js';
import type { SigningIdentity } from '../artifacts/identity.js';
import type { SwarmTransport, SwarmOptions } from '../transport/swarm.js';
export interface LegacyGenerationMesh extends GenerationProvider {
  connect(): Promise<unknown>; initialize(): Promise<unknown>; close(): Promise<void>;
  refreshAdvertisement(): Record<string, unknown>;
  generate(messages: Message[], onUpdate?: ((chunk: string) => void) | null,
    control?: { signal?: AbortSignal; modelId?: string; modelIdentity?: string | null; requestContext?: import('../config/index.js').Json }): Promise<GenerationResult>;
  rotateIdentity(input?: object): Promise<unknown>; getSwarmSnapshot(): Record<string, unknown>; hasAvailableProvider(modelId?: string): boolean;
  on(event: string, handler: (event: unknown) => void): () => void;
}
export interface LegacyMeshPorts {
  instanceId: string; modelConfig: Record<string, unknown> | null; utils: SwarmOptions['Utils'];
  getExecutionState?(): { phase: string; modelIdentity: string | null };
  authorize: Authorize; createTransport(): SwarmTransport; generate: GenerationProvider['generate'];
  transport?: SwarmTransport | null; forceFreshIdentity?: boolean;
  events: { emit(event: string, data: unknown): void; on(event: string, handler: (event: unknown) => void): () => void };
  eventBus: { emit(event: string, data: unknown): void; on(event: string, handler: (event: unknown) => void, owner?: string): () => void };
  identity: { ensure(options: object): Promise<SigningIdentity>; save(identity: SigningIdentity): unknown | Promise<unknown>;
    rotate(options: object): Promise<SigningIdentity>; sync(identity: SigningIdentity, context: object): Promise<unknown> };
}
export function createLegacyGenerationMesh(options: { config: ResolvedConfig; ports: LegacyMeshPorts }): LegacyGenerationMesh;
