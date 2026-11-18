import type { Authorize, GenerationProvider, GenerationResult, Message } from '../index.js';
import type { ResolvedConfig } from '../config/index.js';
import type { SigningIdentity } from '../artifacts/identity.js';
import type { SwarmTransport, SwarmOptions } from '../transport/swarm.js';
import type { GenerationSettings, GenerationSettingsCapability, GenerationSettingsInput } from './generation-settings.js';
export interface PeerGenerationMesh extends GenerationProvider {
  connect(): Promise<unknown>; initialize(): Promise<unknown>; close(): Promise<void>;
  verifyPeerIdentity(peerId: string, signal?: AbortSignal): Promise<string | null>;
  identifyComputer(peerId: string, options?: {
    ownerLabel?: string; signal?: AbortSignal;
    storage?: { getItem(key: string): string | null | Promise<string | null>; setItem(key: string, value: string): unknown };
  }): Promise<import('./computer-identity.js').ComputerIdentity>;
  recoverGeneration(reference: { requestId: string; providerId: string; providerIdentity: string; modelId: string; modelIdentity: string; adapterIdentities: string[] },
    messages: Message[], signal?: AbortSignal, options?: { settings?: GenerationSettingsInput }): Promise<{ status: string; response?: GenerationResult; terminal?: Record<string, unknown> }>;
  refreshAdvertisement(): Record<string, unknown>;
  generate(messages: Message[], onUpdate?: ((chunk: string) => void) | null,
    control?: { offerId?: string | null; privacy?: import('../chat/execution-policy.js').ExecutionPolicy | null; signal?: AbortSignal; modelId?: string; modelIdentity?: string | null; adapterIdentities?: string[]; requestContext?: import('../config/index.js').Json;
      /** Per-request generation settings. Refused before disclosure unless the chosen provider advertises them. */
      settings?: GenerationSettingsInput }): Promise<GenerationResult>;
  rotateIdentity(input?: object): Promise<unknown>; getSwarmSnapshot(): Record<string, unknown>; hasAvailableProvider(modelId?: string): boolean;
  on(event: string, handler: (event: unknown) => void): () => void;
}
export interface PlacementCandidate { peerId: string; verifiedIdentity: string | null; contributionScore: number; availableSlots: number | null }
/** Reported with each `mesh.dispatch` authorization: why this provider, and the eligible providers in the order considered. */
export interface PlacementChoice { reason: 'conversation-affinity' | 'host-ranking' | 'default-order'; candidates: PlacementCandidate[] }
export interface PeerGenerationMeshPorts {
  instanceId: string; modelConfig: Record<string, unknown> | null; utils: SwarmOptions['Utils'];
  getExecutionState?(): { phase: string; modelIdentity: string | null; adapterIdentities?: string[]; progress?: unknown; hardware?: import('./provider-hardware.js').ProviderHardware | null };
  authorize: Authorize; createTransport(): SwarmTransport;
  /** Optional requester-side order over eligible providers: connection ids or identities proven on this channel, best first.
   * Providers it does not name keep the default order after it. The choice and its reason reach `authorize` as `placement`. */
  rankProviders?(candidates: PlacementCandidate[], request: { modelId: string | null; modelIdentity: string | null }): string[] | null | undefined;
  generate(messages: Message[], onUpdate: ((chunk: string) => void) | null | undefined,
    controls: { privacyBinding?: import('../chat/execution-policy.js').ExecutionBinding; privacy?: import('../chat/execution-policy.js').ExecutionPolicy; signal?: AbortSignal; adapterIdentities?: string[]; requestId?: string; consumer?: string;
      contextId?: string | null; contextOwner?: string | null;
      /** Canonical settings of an admitted request. The host applies them; its result may name the applied
       * output constraint as `constraintIdentity` (`sha256:<hex>`), which is then signed into the receipt. */
      settings?: Readonly<GenerationSettings> }): Promise<GenerationResult>;
  /** Provider side: the settings this host's `generate` enforces. Advertised to peers; absent means none. */
  getGenerationSettingsCapability?(): GenerationSettingsCapability | null | undefined;
  /** Requester side: the output constraint identity expected for these settings, or null for no expectation.
   * A receipt naming a different identity is refused before it is countersigned. */
  expectedConstraintIdentity?(settings: GenerationSettings): string | null | undefined | Promise<string | null | undefined>;
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
