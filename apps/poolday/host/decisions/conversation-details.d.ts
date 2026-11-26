/**
 * The Conversation details decisions' contract. The React workspace keeps its own copy of DetailsView in
 * apps/poolday-react/src/features/details/domain/services.ts and checks it against this declaration in
 * features/details/infrastructure/hostDetails.ts.
 */
type Facts = ReadonlyArray<readonly [string, string]>;

export type DetailsView = {
  readonly threadId: string | null;
  readonly hasAttempt: boolean;
  readonly statusLabel: string;
  readonly route: {
    readonly requester: { readonly label: string; readonly caption: string } | null;
    readonly model: string | null;
    readonly executors: ReadonlyArray<{ readonly id: string; readonly label: string; readonly caption: string }>;
  } | null;
  readonly activity: {
    readonly attemptId: string;
    readonly summary: string;
    readonly distribution: ReadonlyArray<{ readonly label: string; readonly share: number }> | null;
    readonly distributionLabel: string | null;
    readonly nodes: ReadonlyArray<{ readonly id: string; readonly label: string; readonly value: string; readonly gpu: string | null }>;
    readonly footnote: string | null;
    readonly footnoteTitle: string | null;
    readonly attemptSupply: string | null;
    readonly adapter: string | null;
    readonly facts: Facts;
    readonly error: string | null;
  } | null;
  readonly execution: {
    readonly error: string | null;
    readonly facts: Facts;
    readonly executors: ReadonlyArray<{ readonly id: string; readonly label: string; readonly facts: Facts }>;
    readonly noExecutor: string | null;
    readonly notes: ReadonlyArray<string>;
    readonly planId: string | null;
  } | null;
  readonly timeline: ReadonlyArray<string>;
  readonly creditRequest: string | null;
  readonly creditPending: boolean;
  readonly receiptAvailable: boolean;
  readonly contextDetail: string;
  readonly grants: ReadonlyArray<{ readonly id: string; readonly title: string; readonly status: string; readonly record: string }>;
  readonly canDownload: boolean;
  readonly busy: boolean;
  readonly closed: boolean;
};

/** The selected answer: its thread and attempt. */
export type Inspected = { readonly threadId: string | null; readonly attemptId: string };
type State = Record<string, unknown>;

export const RECORDED_GPU_TITLE: string;
/** The word caps a context prompt may use. */
export const CONTEXT_WORD_LIMITS: ReadonlyArray<number>;
/** Recorded steps of a paired private answer, by step name. */
export const TIMELINE_STEPS: Readonly<Record<string, string>>;
export function inspectedState<S extends State>(state: S, inspected: Inspected | null): S;
export function projectExecutionDetail(state: State): DetailsView['execution'];
export function projectConversationDetails(snapshot: State, options?: { readonly labels?: object; readonly inspected?: Inspected | null }): DetailsView;
/** A ledger receipt's outcome as one line, after `prefix`. */
export function ledgerOutcomeText(receipt: unknown, prefix: string): string;
