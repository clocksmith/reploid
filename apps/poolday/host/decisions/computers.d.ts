/**
 * The Computers decisions' contract: the records they project for the Computers screens. The React workspace keeps
 * its own copy in apps/poolday-react/src/features/computers/domain/services.ts and checks it against this
 * declaration in features/computers/infrastructure/hostComputers.ts.
 */
import type { Computer, OfferAvailability } from '../computer-records.js';
export type Tone = 'ready' | 'pending' | 'unavailable';
export type Fact = readonly [term: string, value: string];
/** A roster row's phase, from the peer's advertisement and this page's connection to it. */
export type PeerPhase = 'ready' | 'executing' | 'loading' | 'connecting' | 'idle' | 'failed' | (string & {});

export type FleetPairingView = {
  readonly state: string;
  readonly code: string;
  readonly command: string;
  readonly computer: string;
  readonly fingerprint: string;
  readonly status: string;
  readonly canConfirm: boolean;
  readonly confirmed: boolean;
};

export type FleetAccountView =
  | { readonly available: false }
  | {
      readonly available: true;
      readonly busy: boolean;
      readonly signedIn: boolean;
      readonly hasAccount: boolean;
      readonly status: string;
      readonly starter: string;
      readonly computers: ReadonlyArray<{ readonly id: string; readonly name: string; readonly status: string; readonly removable: boolean }>;
      readonly activityKey: string;
      readonly error: string;
      readonly pairing: FleetPairingView | null;
    };

export type PrivateComputersView =
  | { readonly available: false }
  | {
      readonly available: true;
      readonly connected: boolean;
      readonly hasRequester: boolean;
      readonly status: string;
      readonly error: string;
      readonly activityKey: string;
      readonly computers: ReadonlyArray<{ readonly id: string; readonly name: string; readonly status: string; readonly tone: Tone; readonly facts: ReadonlyArray<Fact> }>;
    };

export type PeerView = {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly tone: Tone;
  readonly phase: PeerPhase;
  readonly state: string;
  readonly model: string;
  readonly hardware: string | null;
  readonly detail: string;
  readonly progress: { readonly value: number; readonly max: number } | null;
  readonly quiet: boolean;
  readonly blocked: boolean;
  readonly reachable: boolean;
  readonly eligibility: string;
  readonly selection: ReadonlyArray<Fact>;
  readonly offers: string;
  /** The verified computer this row shows (reploid.computer/1); null for an unverified connection. */
  readonly computer: Computer | null;
  /** Whether this computer offers compute now, and, separately, whether it has capacity for new work (contracts offerAvailability). */
  readonly inference: OfferAvailability;
  readonly identity: string;
  readonly members: ReadonlyArray<{ readonly id: string; readonly identity: string }>;
  readonly localName: string;
  readonly blockNote: string;
  readonly connection: ReadonlyArray<Fact>;
  readonly usage: ReadonlyArray<Fact>;
  readonly ids: ReadonlyArray<Fact>;
};

export type DeviceView = {
  readonly summary: string;
  readonly localComputer: string;
  readonly supplied: string;
  readonly consumed: string;
  readonly usageScope: string;
  readonly usageError: string;
  readonly sharingSummary: string;
  readonly computeOn: boolean;
  readonly computeLabel: string;
  readonly computeDisabled: boolean;
  readonly filesOn: boolean;
  readonly filesLabel: string;
  readonly filesDisabled: boolean;
  readonly offers: string;
  readonly pauseAll: boolean;
  readonly retryStop: boolean;
  readonly retryStopDisabled: boolean;
  readonly progress: string;
  readonly introductions: boolean;
  readonly limits: string;
};

export type ShareableModel = {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly disabled: boolean;
  readonly needsSize: boolean;
  readonly label: string;
};

export type ProductionView = {
  readonly attention: boolean;
  readonly error: string;
  readonly local: ReadonlyArray<string>;
  readonly work: string;
  readonly metrics: ReadonlyArray<Fact>;
  readonly progress: { readonly message: string; readonly value: number | null; readonly max: number | null } | null;
  readonly settlement: boolean;
  readonly setup: boolean;
  readonly changeModel: boolean;
  readonly models: ReadonlyArray<ShareableModel>;
  readonly empty: string;
  readonly emptyTitle: string;
  readonly selection: string | null;
  readonly history: {
    readonly count: string;
    readonly status: string;
    readonly records: ReadonlyArray<{ readonly id: string; readonly model: string; readonly at: string; readonly tokens: string }>;
  };
};

export type DiagnosticView =
  | { readonly available: false }
  | {
      readonly available: true;
      readonly busy: boolean;
      readonly measuring: boolean;
      readonly canSave: boolean;
      readonly baselineStored: boolean;
      readonly error: string;
      readonly baseline: string;
      readonly hardware: string;
      readonly result: string;
    };

/** The pane as projectComputers builds it; the adapter adds the account, invites, diagnostic and network line. */
export type ComputersProjection = {
  readonly connection: { readonly on: boolean; readonly label: string; readonly detail: string; readonly privateScope: boolean };
  readonly filterLabel: string;
  readonly readiness: string;
  readonly peers: ReadonlyArray<PeerView>;
  readonly empty: string;
  readonly quiet: { readonly show: string; readonly hide: string } | null;
  /** A discovery error for the pane's network line, or empty. */
  readonly networkIssue: string;
  readonly privateComputers: PrivateComputersView;
  readonly ownerPairing: { readonly status: string; readonly paired: boolean; readonly busy: boolean; readonly error: string } | null;
  readonly device: DeviceView;
  readonly production: ProductionView;
};

export type ComputersFilter = { readonly providerIds: ReadonlyArray<string>; readonly label: string } | { readonly model: object };
type State = Record<string, unknown>;

export function projectComputers(state: State, options?: {
  readonly filter?: ComputersFilter | null;
  readonly sizes?: ReadonlyMap<string, { readonly sizeBytes?: number; readonly error?: string }> | null;
  readonly names?: Readonly<Record<string, string>>;
  readonly selected?: string | null;
}): ComputersProjection;
export function projectFleetAccount(port: unknown): FleetAccountView;
export function projectPrivateComputers(fleet: unknown): PrivateComputersView;
export function projectDiagnostic(view: unknown): DiagnosticView;
export function ownerPairingStatus(current: { readonly status?: string; readonly hostLabel?: string; readonly transportPath?: string | null; readonly readyModel?: string | null } | null | undefined): string;
export function offerText(offer?: { readonly compute?: string; readonly files?: string }): string;
export function shareableModels(state: State): ReadonlyArray<Record<string, unknown> & { readonly id: string }>;

export function creditActivity(statement: unknown, options?: { readonly modelName?: (id: string) => string }): ReadonlyArray<{ readonly at: number; readonly requestId: string; readonly text: string }>;
export function creditAccounts(snapshot: unknown, ownId: string | undefined): { readonly own: { readonly name: string } | null; readonly others: ReadonlyArray<{ readonly name: string }> };
export function accountText(row: unknown): string;

export function relayUnavailableReason(): string | null;
export const RELAY_UNAVAILABLE_TEXT: string;

export function withComputerLabels<S extends State>(state: S, session: object): S;
export function setComputerNames(session: object, names: Readonly<Record<string, string>>): void;
export function setBlockedComputers(session: object, ids: ReadonlyArray<string>): void;

export type OperationPhase = 'idle' | 'starting' | 'sharing' | 'stopping';
export function operationModels(): ReadonlyArray<{ readonly modelId: string; readonly label?: string }>;
export function operationLimitsText(): string;
export function operationStatusText(state: { readonly phase: OperationPhase; readonly modelId?: string; readonly error?: string }): string;
export function operationSelection(input?: { readonly modelId?: string; readonly file?: File | null }): Promise<object>;
