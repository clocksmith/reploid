/**
 * The Examples page (/examples) as the screens see it: the protein-sequence run and the document search. The host's
 * examples decisions (apps/poolday/host/decisions/examples.js) produce these snapshots; the peer run session and the
 * document assistant own execution.
 */
export type Option = { readonly value: string; readonly label: string };
export type Pair = readonly [label: string, value: string];
export type RunState = 'idle' | 'submitting' | 'running' | 'complete' | 'error' | 'inspecting';

export type RecoveryAction = { readonly id: string; readonly label: string; readonly primary: boolean; readonly href: string | null };

export type RunResultView = {
  readonly error: boolean;
  readonly summary: ReadonlyArray<Pair>;
  readonly embedding: {
    readonly permitted: boolean;
    readonly meta: string;
    readonly detailMeta: string;
    readonly vector: string;
    readonly withheld: string;
  } | null;
  readonly output: string;
  readonly recovery: {
    readonly kind: string;
    readonly title: string;
    readonly message: string;
    readonly details: ReadonlyArray<string>;
    readonly actions: ReadonlyArray<RecoveryAction>;
  } | null;
  readonly contributors: {
    readonly local: boolean;
    readonly summary: ReadonlyArray<Pair>;
    readonly note: string;
    readonly route: ReadonlyArray<Pair> | null;
    readonly excluded: ReadonlyArray<string>;
    readonly rows: ReadonlyArray<{ readonly provider: string; readonly status: string; readonly reason: string | null; readonly tokens: string; readonly output: string }>;
  } | null;
  readonly raw: string;
};

export type RunSnapshot = {
  readonly models: ReadonlyArray<Option>;
  readonly policies: ReadonlyArray<Option>;
  readonly modelId: string;
  readonly policyId: string;
  readonly sequence: string;
  readonly suggestion: string;
  readonly consent: boolean;
  readonly consentSaved: boolean;
  readonly feedback: { readonly count: string; readonly message: string; readonly invalid: boolean };
  readonly pack: ReadonlyArray<Pair>;
  readonly visual: { readonly state: RunState; readonly phase: string; readonly message: string };
  readonly busy: boolean;
  readonly outputVisible: boolean;
  readonly result: RunResultView | null;
  readonly focusSequence: number;
};

export type RunServices = {
  readonly getSnapshot: () => RunSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly setSequence: (value: string) => void;
  readonly setModel: (modelId: string) => void;
  readonly setPolicy: (policyId: string) => void;
  readonly setConsent: (on: boolean) => void;
  readonly rotateSuggestion: () => void;
  readonly useExample: () => void;
  readonly submit: () => void;
  readonly recover: (actionId: string) => void;
};

export type TaskClass = 'local-only' | 'derived-remote' | 'public-remote';

export type DocumentSnapshot = {
  readonly workflow: 'sequence' | 'documents';
  readonly configured: boolean;
  readonly busy: boolean;
  readonly status: string;
  readonly modelStatus: string;
  readonly modelsChosen: boolean;
  readonly trusted: boolean;
  readonly setupOpen: boolean;
  readonly corpus: string;
  readonly query: string;
  readonly rerank: boolean;
  readonly answerRequested: boolean;
  readonly rerankAvailable: boolean;
  readonly answerAvailable: boolean;
  readonly submitDisabled: boolean;
  readonly cancelVisible: boolean;
  readonly taskClass: TaskClass;
  readonly shareStatus: string;
  readonly shareTask: string;
  readonly shareConsent: boolean;
  readonly reviewDisabled: boolean;
  readonly taskDisabled: boolean;
  readonly preview: { readonly id: string; readonly recipient: string; readonly scope: string; readonly input: string; readonly technical: string } | null;
  readonly sendDisabled: boolean;
  readonly answer: string;
  readonly matches: ReadonlyArray<{ readonly title: string; readonly text: string }>;
  readonly evidence: string;
};

export type DocumentServices = {
  readonly getSnapshot: () => DocumentSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly setWorkflow: (workflow: 'sequence' | 'documents', options?: { readonly runBusy?: boolean }) => void;
  readonly setSetupOpen: (open: boolean) => void;
  readonly setModelsFile: (file: File | null) => void;
  readonly setTrusted: (on: boolean) => void;
  readonly configure: () => void;
  readonly addDocuments: (files: ReadonlyArray<File>) => void;
  readonly setQuery: (value: string) => void;
  readonly setRerank: (on: boolean) => void;
  readonly setAnswer: (on: boolean) => void;
  readonly search: () => void;
  readonly setTaskClass: (value: TaskClass) => void;
  readonly setShareTask: (value: string) => void;
  readonly reviewShare: () => void;
  readonly setShareConsent: (on: boolean) => void;
  readonly sendShare: () => void;
  readonly cancel: () => void;
  readonly clear: () => void;
};

export type ExamplesServices = {
  readonly copy: { readonly name: string; readonly body: string; readonly experiments: ReadonlyArray<{ readonly id: string; readonly label: string; readonly href: string }> };
  readonly run: RunServices;
  /** Null where this page's host has no document assistant. */
  readonly documents: DocumentServices | null;
  readonly enhancePrism: (shell: HTMLElement) => () => void;
  /** The verified vector to the clipboard; resolves to the status to show. */
  readonly copyVector: () => Promise<string>;
  readonly recordsHref: string;
  readonly dispose: () => void;
};
