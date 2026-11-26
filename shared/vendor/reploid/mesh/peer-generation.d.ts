import type { Authorize, GenerationProvider, GenerationResult, Message } from '../index.js';
import type { ResolvedConfig } from '../config/index.js';
import type { SigningIdentity } from '../artifacts/identity.js';
import type { SwarmTransport, SwarmOptions } from '../transport/swarm.js';
import type { GenerationSettings, GenerationSettingsCapability, GenerationSettingsInput } from './generation-settings.js';
export interface PeerGenerationMesh extends GenerationProvider {
  connect(): Promise<unknown>; initialize(): Promise<unknown>; close(): Promise<void>;
  getVerifiedPeerIdentity(peerId: string): string | null;
  verifyPeerIdentity(peerId: string, signal?: AbortSignal): Promise<string | null>;
  identifyComputer(peerId: string, options?: {
    ownerLabel?: string; signal?: AbortSignal;
    storage?: { getItem(key: string): string | null | Promise<string | null>; setItem(key: string, value: string): unknown };
  }): Promise<import('./computer-identity.js').ComputerIdentity>;
  recoverGeneration(reference: { requestId: string; providerId: string; providerIdentity: string; modelId: string; modelIdentity: string; adapterIdentities: string[] },
    messages: Message[], signal?: AbortSignal, options?: { settings?: GenerationSettingsInput;
      /** The caller's own check of the recovered answer, run before its receipt is countersigned. */
      acceptResult?: (response: GenerationResult) => boolean | void | Promise<boolean | void> }): Promise<{ status: string; response?: GenerationResult; terminal?: Record<string, unknown> }>;
  refreshAdvertisement(): Record<string, unknown>;
  generate(messages: Message[], onUpdate?: ((chunk: string) => void) | null,
    control?: { offerId?: string | null; privacy?: import('../chat/execution-policy.js').ExecutionPolicy | null; signal?: AbortSignal; modelId?: string; modelIdentity?: string | null; adapterIdentities?: string[]; requestContext?: import('../config/index.js').Json;
      /** Per-request generation settings. Only providers that advertise them are considered; refused before disclosure when none does. */
      settings?: GenerationSettingsInput;
      /** Called at most once, before any chunk, with the remote provider's own prompt token count when it reports one.
       * Once delivered, a completion or receipt that reports another input count is refused before countersigning.
       * A provider that predates the observation never calls it. */
      onUsage?: (usage: { inputTokens: number }) => void;
      /** Remote execution only: the caller's own check of a completed answer, run before the provider's receipt is
       * countersigned or its closing record acknowledged. Throwing or returning false fails the request with nothing
       * countersigned, so a caller never refuses an answer it was already charged for. */
      acceptResult?: (response: GenerationResult) => boolean | void | Promise<boolean | void> }): Promise<GenerationResult>;
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
  /** True when this host answers the `mesh.admit` authorization: the same decision as `mesh.execute`, asked with
   * the request's details and no messages. The provider then advertises that it can decide before the prompt is
   * sent, and all requester policies require admission before the prompt is sent. */
  admitsBeforeDisclosure?: boolean;
  /** Optional requester-side order over eligible providers: connection ids or identities proven on this channel, best first.
   * Providers it does not name keep the default order after it. The choice and its reason reach `authorize` as `placement`. */
  rankProviders?(candidates: PlacementCandidate[], request: { modelId: string | null; modelIdentity: string | null }): string[] | null | undefined;
  /** Contributor side: the signing identity of this computer's requester connection, or null. Its key signs a link to
   * this connection's key, so peers can show the two connections as one computer (snapshot peers' `computerId`). */
  computerIdentity?(): { peerId: string; publicJwk: object; privateJwk?: object } | null | undefined;
  generate(messages: Message[], onUpdate: ((chunk: string) => void) | null | undefined,
    controls: { privacyBinding?: import('../chat/execution-policy.js').ExecutionBinding; privacy?: import('../chat/execution-policy.js').ExecutionPolicy; signal?: AbortSignal; adapterIdentities?: string[]; requestId?: string; consumer?: string;
      contextId?: string | null; contextOwner?: string | null;
      /** Canonical settings of an admitted request. The host applies them; its result may name the applied
       * output constraint as `constraintIdentity` (`sha256:<hex>`), which is then signed into the receipt. */
      settings?: Readonly<GenerationSettings>;
      /** Provider side: report the prompt's token count once, before the first chunk, when it is known then.
       * Later, repeated or non-positive reports are dropped. Never call it with an estimate. */
      onUsage?: (usage: { inputTokens: number }) => void }): Promise<GenerationResult>;
  /** Provider side: the settings this host's `generate` enforces. Advertised to peers; absent means none. */
  getGenerationSettingsCapability?(): GenerationSettingsCapability | null | undefined;
  /** Requester side: the output constraint identity expected for these settings, or null for no expectation.
   * A receipt naming a different identity is refused before it is countersigned. */
  expectedConstraintIdentity?(settings: GenerationSettings): string | null | undefined | Promise<string | null | undefined>;
  /** Optional requester-side check of a completed answer against its settings, before countersigning. Returning
   * false refuses the result: it is not countersigned or settled. */
  acceptGenerationResult?(response: GenerationResult, settings: GenerationSettings): boolean | Promise<boolean>;
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
/** Codes on the abort reason of a job its requester ended (a stop frame, or its connection going away). */
export const REQUESTER_CANCELLED: 'REQUESTER_CANCELLED';
export const REQUESTER_DISCONNECTED: 'REQUESTER_DISCONNECTED';
export function createPeerGenerationMesh(options: { config: ResolvedConfig; ports: PeerGenerationMeshPorts }): PeerGenerationMesh;
