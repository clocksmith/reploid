import type { Authorize, GenerationProvider, GenerationResult, Message } from '../index.js';
import type { ResolvedConfig } from '../config/index.js';
import type { SigningIdentity } from '../artifacts/identity.js';
import type { SwarmTransport, SwarmOptions } from '../transport/swarm.js';
export interface PeerGenerationMesh extends GenerationProvider {
  connect(): Promise<unknown>; initialize(): Promise<unknown>; close(): Promise<void>;
  verifyPeerIdentity(peerId: string, signal?: AbortSignal): Promise<string | null>;
  identifyComputer(peerId: string, options?: {
    ownerLabel?: string; signal?: AbortSignal;
    storage?: { getItem(key: string): string | null | Promise<string | null>; setItem(key: string, value: string): unknown };
  }): Promise<import('./computer-identity.js').ComputerIdentity>;
  recoverGeneration(reference: { requestId: string; providerId: string; providerIdentity: string; modelId: string; modelIdentity: string; adapterIdentities: string[] },
    messages: Message[], signal?: AbortSignal): Promise<{ status: string; response?: GenerationResult; terminal?: Record<string, unknown> }>;
  refreshAdvertisement(): Record<string, unknown>;
  generate(messages: Message[], onUpdate?: ((chunk: string) => void) | null,
    control?: { signal?: AbortSignal; modelId?: string; modelIdentity?: string | null; adapterIdentities?: string[]; requestContext?: import('../config/index.js').Json }): Promise<GenerationResult>;
  rotateIdentity(input?: object): Promise<unknown>; getSwarmSnapshot(): Record<string, unknown>; hasAvailableProvider(modelId?: string): boolean;
  on(event: string, handler: (event: unknown) => void): () => void;
}
export interface PeerGenerationMeshPorts {
  instanceId: string; modelConfig: Record<string, unknown> | null; utils: SwarmOptions['Utils'];
  getExecutionState?(): { phase: string; modelIdentity: string | null; adapterIdentities?: string[]; progress?: unknown; hardware?: import('./provider-hardware.js').ProviderHardware | null };
  authorize: Authorize; createTransport(): SwarmTransport;
  generate(messages: Message[], onUpdate: ((chunk: string) => void) | null | undefined,
    controls: { signal?: AbortSignal; adapterIdentities?: string[]; requestId?: string; consumer?: string;
      contextId?: string | null; contextOwner?: string | null }): Promise<GenerationResult>;
  transport?: SwarmTransport | null; forceFreshIdentity?: boolean;
  onReceipt?(receipt: import('../artifacts/receipt.js').Receipt): void | Promise<void>;
  onGenerationTerminal?(terminal: import('../artifacts/generation-terminal.js').GenerationTerminal): void | Promise<void>;
  settleGeneration?(): Promise<boolean>;
  generationJournal?: { get(binding: Record<string, unknown>): Promise<{ binding: Record<string, unknown>; outcome: unknown } | null>;
    claim(binding: Record<string, unknown>): Promise<boolean>; finish(binding: Record<string, unknown>, outcome: unknown): Promise<void> } | null;
  events: { emit(event: string, data: unknown): void; on(event: string, handler: (event: unknown) => void): () => void };
  eventBus: { emit(event: string, data: unknown): void; on(event: string, handler: (event: unknown) => void, owner?: string): () => void };
  identity: { ensure(options: object): Promise<SigningIdentity>; save(identity: SigningIdentity): unknown | Promise<unknown>;
    rotate(options: object): Promise<SigningIdentity>; sync(identity: SigningIdentity, context: object): Promise<unknown> };
}
export function createPeerGenerationMesh(options: { config: ResolvedConfig; ports: PeerGenerationMeshPorts }): PeerGenerationMesh;
