/**
 * "Sequence provider" (/compute): the records the host's contribution controller
 * (apps/poolday/host/decisions/compute.js) projects and the commands the page may call. The host
 * loads, serves, signs and stops; readiness rows report what it observed and grant nothing.
 */
export type Fact = readonly [label: string, value: string];
export type Choice = { readonly value: string; readonly title: string };

export type ProviderState = 'online' | 'starting' | 'degraded' | 'error' | 'offline';

/** One readiness line: label, value, and whether the value is still loading. */
export type HealthRow = readonly [label: string, value: string, loading: boolean];

export type ReceiptRow = { readonly id: string; readonly answer: string; readonly model: string; readonly tokens: string; readonly room: string };

export type PermissionKey = 'relayArtifacts' | 'verifyResults';
export type LimitKey = 'maxConcurrentJobs' | 'maxTokensPerJob' | 'storageBudgetMiB' | 'bandwidthBudgetMbps';

export type ResultRecovery = {
  readonly kind: string;
  readonly title: string;
  readonly message: string;
  readonly details: ReadonlyArray<string>;
  readonly actions: ReadonlyArray<{ readonly id: string; readonly label: string; readonly primary: boolean; readonly href: string | null }>;
};

export type ComputeSnapshot = {
  readonly status: string;
  readonly state: ProviderState;
  readonly notice: { readonly state: string; readonly title: string; readonly message: string } | null;
  readonly room: { readonly id: string; readonly relay: string };
  /** Sharing or starting: the button stops. */
  readonly active: boolean;
  readonly starting: boolean;
  readonly stopping: boolean;
  readonly modelId: string;
  /** The model cannot change while this tab shares it. */
  readonly modelLocked: boolean;
  readonly models: ReadonlyArray<Choice>;
  readonly workload: string;
  readonly facts: ReadonlyArray<Fact>;
  readonly boundary: ReadonlyArray<{ readonly strong: string; readonly text: string }>;
  readonly permissions: Readonly<Record<PermissionKey, boolean>>;
  readonly limits: Readonly<Record<LimitKey, number>>;
  readonly limitBounds: Readonly<Record<LimitKey, { readonly min: number; readonly max: number }>>;
  readonly health: { readonly primary: ReadonlyArray<HealthRow>; readonly details: ReadonlyArray<HealthRow> };
  readonly contribution: { readonly optedIn: boolean; readonly stats: ReadonlyArray<Fact>; readonly recent: ReadonlyArray<ReceiptRow> };
  readonly identity: { readonly label: string; readonly protection: string | null; readonly title: string };
  readonly passkey: { readonly label: string; readonly disabled: boolean; readonly status: string };
  readonly result: { readonly summary: ReadonlyArray<Fact>; readonly message: string; readonly raw: string; readonly recovery: ResultRecovery | null };
};

export type ComputeServices = {
  readonly getSnapshot: () => ComputeSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly toggle: () => void;
  readonly setModel: (modelId: string) => void;
  readonly setPermission: (key: PermissionKey, on: boolean) => void;
  readonly setLimit: (key: LimitKey, value: number) => void;
  readonly enrollPasskey: () => void;
};
