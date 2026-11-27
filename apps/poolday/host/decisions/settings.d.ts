/**
 * The Settings decisions' contract. The React workspace keeps its own copy of these records in
 * apps/poolday-react/src/features/settings/domain/services.ts and checks it against this declaration in
 * features/settings/infrastructure/hostSettings.ts.
 */
type State = Record<string, unknown>;

export type RoutePreference = 'balanced' | 'faster' | 'more-reliable';
export const ROUTE_PREFERENCES: ReadonlyArray<{ readonly id: RoutePreference; readonly label: string }>;
export const DEFAULT_ROUTE_PREFERENCE: RoutePreference;

export type RoutePreferenceView = {
  readonly reason: string;
  readonly fix: { readonly label: string } | null;
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: string; readonly checked: boolean; readonly disabled: boolean }>;
};

export type FileMode = 'cached-only' | 'bounded-acquisition' | 'full-model';
export type FileSharingSelection = { readonly modelId: string | null; readonly mode: FileMode; readonly allowance: string | null };
export type FileSharingView = {
  readonly enabled: boolean;
  readonly toggleDisabled: boolean;
  readonly status: string;
  readonly progress: string;
  readonly models: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly modelId: string | null;
  readonly modelDisabled: boolean;
  readonly modes: ReadonlyArray<{ readonly value: FileMode; readonly title: string; readonly status: string; readonly disabled: boolean }>;
  readonly mode: FileMode;
  readonly allowanceShown: boolean;
  readonly allowance: string;
  readonly allowanceDisabled: boolean;
  readonly limits: string;
};
export type FileSharingRequest = {
  readonly enable: boolean;
  readonly paused: boolean;
  readonly cachedOnly: boolean;
  readonly modelId: string | null;
  readonly controls: unknown;
};

export type WebSearchView = {
  readonly enabled: boolean;
  readonly disabled: boolean;
  readonly reason: string;
  readonly fix: string | null;
  readonly disclosure: string;
  readonly url: string;
  readonly tool: string;
  readonly tokenPlaceholder: string;
  readonly status: string;
};
export type WebSearchState = { readonly enabled: boolean; readonly url: string; readonly tool: string; readonly hasToken: boolean; readonly recipient?: string; readonly status: { readonly message?: string } };
export type SearchStatus = { readonly available: () => boolean; readonly state: () => { readonly message?: string; readonly provider?: string } };

export type CreditAccountView = {
  readonly ready: boolean;
  readonly balance: string;
  readonly topUps: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly checkout: string | null;
  readonly spendingLimit: number | null;
  readonly quote: string;
  readonly journal: ReadonlyArray<{ readonly id: string; readonly type: string; readonly text: string }>;
  readonly status: string;
};

export type SignInView = {
  readonly formShown: boolean;
  readonly signedIn: boolean;
  readonly sendDisabled: boolean;
  readonly summary: string;
  readonly message: string;
};

export function projectRoutePreference(state: State, session: { readonly getRoutePreference?: () => string | null; readonly setRoutePreference?: (value: string) => void } | null | undefined): RoutePreferenceView;
export function routePreferenceChoices(options?: { readonly remoteAnswersEnabled?: boolean; readonly canSet?: boolean; readonly value?: string }): RoutePreferenceView;
export function fileModeChoices(options?: { readonly storedModels?: number; readonly sharing?: boolean; readonly value?: FileMode }): ReadonlyArray<FileSharingView['modes'][number] & { readonly checked: boolean }>;
export function webSearchAvailability(options?: { readonly url?: string; readonly builtInAvailable?: boolean }): { readonly disabled: boolean; readonly reason: string; readonly fix: { readonly label: string; readonly action: string } | null };
export function webSearchDisclosure(state: WebSearchState, search: SearchStatus | null | undefined): string;
export function storedModelLabel(row: { readonly name: string; readonly sizeBytes: number }): string;
export function storageSummary(state: State): string;
export function fileSharingStatus(network?: object): string;
export function projectFileSharing(state: State, selection?: Partial<FileSharingSelection>): FileSharingView;
export function fileSharingRequest(state: State, selection: FileSharingSelection): FileSharingRequest;
export function remoteAnswersText(state: State): string;
export function changesAwaitingReview(candidates: ReadonlyArray<{ readonly status?: string }> | null | undefined): number;
export function projectWebSearch(state: WebSearchState, search: SearchStatus | null | undefined): WebSearchView;
export function projectCreditAccount(state: State): CreditAccountView;
export function projectSignIn(state: State): SignInView;
export function localSignInText(state: State): string;
