/**
 * "Run a model" (/ask): the records the host's run controller (apps/poolday/host/decisions/ask.js)
 * projects and the commands the page may call. The host signs, routes, verifies and saves; these
 * records are its snapshot, never a stronger claim.
 */
export type Fact = readonly [label: string, value: string];
export type Choice = { readonly value: string; readonly title: string };

export type RunState = 'idle' | 'submitting' | 'running' | 'complete' | 'error' | 'inspecting';

export type RecoveryAction = { readonly id: string; readonly label: string; readonly primary: boolean; readonly href: string | null };
export type RunRecovery = { readonly kind: string; readonly title: string; readonly message: string; readonly details: ReadonlyArray<string>; readonly actions: ReadonlyArray<RecoveryAction> };

export type EmbeddingView = {
  readonly dimensions: number;
  readonly permitted: boolean;
  readonly meta: string;
  readonly outcomeMeta: string;
  readonly vector: string;
  readonly withheld: string;
};

export type ContributionRow = { readonly providerId: string; readonly status: string; readonly reason: string; readonly tokens: string; readonly output: string; readonly outputTitle: string };
export type ContributionView = {
  readonly local: boolean;
  readonly summary: ReadonlyArray<Fact>;
  readonly note: string;
  readonly route: ReadonlyArray<Fact> | null;
  readonly rejected: ReadonlyArray<{ readonly providerId: string; readonly reasons: string }>;
  readonly rows: ReadonlyArray<ContributionRow>;
};

export type RunResultView = {
  readonly summary: ReadonlyArray<Fact>;
  readonly output: string;
  readonly message: string;
  readonly raw: string;
  readonly recovery: RunRecovery | null;
  readonly embedding: EmbeddingView | null;
  readonly contribution: ContributionView;
  /** A recovery card replaces the answer box until the person chooses. */
  readonly answerHidden: boolean;
};

export type AskSnapshot = {
  readonly form: { readonly prompt: string; readonly modelId: string; readonly policyId: string; readonly sequencePublic: boolean };
  readonly busy: boolean;
  readonly run: { readonly state: RunState; readonly phase: string; readonly message: string };
  readonly outputVisible: boolean;
  readonly models: ReadonlyArray<Choice>;
  readonly policies: ReadonlyArray<Choice>;
  readonly workload: string;
  readonly facts: ReadonlyArray<Fact>;
  /** False while this device is set to contribute only: request controls are off. */
  readonly canRequest: boolean;
  readonly identity: { readonly label: string; readonly protection: string | null; readonly title: string };
  readonly room: { readonly id: string; readonly relay: string; readonly recordsHref: string };
  readonly result: RunResultView;
  readonly copyStatus: string;
};

export type AskServices = {
  readonly getSnapshot: () => AskSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly setPrompt: (prompt: string) => void;
  readonly setModel: (modelId: string) => void;
  readonly setPolicy: (policyId: string) => void;
  readonly setSequencePublic: (on: boolean) => void;
  readonly run: () => void;
  /** A recovery card's action by its id. */
  readonly recover: (actionId: string) => void;
  readonly copyEmbedding: () => void;
};
