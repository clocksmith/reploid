/**
 * Research Room-1 as the screen sees it. The host's room model (apps/poolday/host/decisions/rooms.js) produces it from
 * signed research records held in this browser and, when reachable, the coordinator.
 */
type Option = { readonly value: string; readonly title: string };
type Pair = readonly [term: string, value: string];
type Item = { readonly title: string; readonly detail?: string; readonly meta?: string };

export type RoomDraft = {
  readonly sequence: string;
  readonly intentKind: string;
  readonly intentLabel: string;
  readonly intentText: string;
  readonly intentConditions: string;
  readonly intentObservation: string;
  readonly intentDecision: string;
  readonly intentScope: string;
  readonly intentExclusions: string;
  readonly intentUnknowns: string;
  readonly sequencePublic: boolean;
  readonly researchPublic: boolean;
  readonly model: string;
  readonly policy: string;
};

export type RoomView = {
  readonly roomId: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly recovery: { readonly states: ReadonlyArray<string>; readonly details: ReadonlyArray<string> } | null;
  readonly question: { readonly title: string; readonly text: string; readonly facts: ReadonlyArray<Pair>; readonly gaps: ReadonlyArray<string>; readonly gapsTitle: string } | null;
  readonly result: {
    readonly status: string;
    readonly agreement: string;
    readonly review: string;
    readonly receipt: string;
    readonly reviewHref: string;
    readonly technical: ReadonlyArray<Pair>;
    readonly uncertainty: ReadonlyArray<string>;
  } | null;
  readonly next: {
    readonly title: string;
    readonly body: string;
    readonly boundary: string;
    readonly href: string;
    readonly reason: string;
    readonly basis: string;
    readonly raw: ReadonlyArray<Pair>;
    readonly approve:
      | { readonly kind: 'candidate'; readonly label: string; readonly targetHash: string; readonly contractHash: string }
      | { readonly kind: 'task'; readonly label: string; readonly taskId: string; readonly targetHash: string }
      | null;
  };
  readonly unresolved: ReadonlyArray<Item & { readonly kind: string; readonly action: string; readonly href: string }>;
  readonly memory: ReadonlyArray<Item>;
  readonly memoryPolicy: string;
  readonly archive: ReadonlyArray<Item & { readonly state: string; readonly exclusion: string }>;
  readonly archiveBoundary: string;
  readonly timeline: ReadonlyArray<TimelineEntry>;
  readonly participants: ReadonlyArray<{ readonly role: string; readonly label: string; readonly status?: string }>;
  readonly facts: ReadonlyArray<Pair>;
  readonly roles: ReadonlyArray<{ readonly title: string; readonly body: string; readonly link: string; readonly href: string }>;
  /** The request form's address in this room. */
  readonly requestHref: string;
  readonly contract: {
    readonly status: string;
    readonly label: string;
    readonly facts: ReadonlyArray<Pair>;
    readonly unfrozen: string;
    readonly triggers: string;
    readonly canCheckpoint: boolean;
    readonly button: string;
  };
  readonly resolution: { readonly status: string; readonly label: string; readonly boundary: string; readonly facts: ReadonlyArray<Pair> };
  readonly proof: {
    readonly status: string;
    readonly facts: ReadonlyArray<Pair>;
    readonly frozen: boolean;
    readonly metrics: ReadonlyArray<Item>;
    readonly evaluated: boolean;
    readonly gaps: string;
  };
  readonly campaign: {
    readonly count: number;
    readonly state: string;
    readonly dimensions: ReadonlyArray<Item>;
    readonly eligible: ReadonlyArray<Item & { readonly href: string }>;
    readonly boundary: string;
  };
  readonly prior: {
    readonly boundary: string;
    readonly searching: boolean;
    readonly error: string;
    readonly empty: string;
    readonly candidates: ReadonlyArray<{
      readonly hash: string;
      readonly originRoomId: string;
      readonly qualification: string;
      readonly title: string;
      readonly summary: string;
      readonly details: ReadonlyArray<string>;
      readonly attached: string;
      readonly attachable: boolean;
      readonly meta: string;
    }>;
  };
  readonly proposals: ReadonlyArray<{ readonly kind: string; readonly title: string; readonly status: string; readonly summary: string; readonly facts: ReadonlyArray<Pair>; readonly href: string }>;
  readonly canvas: { readonly accepted: ReadonlyArray<Item>; readonly disputed: ReadonlyArray<Item>; readonly missing: ReadonlyArray<Item> } | null;
  /** The timeline's anchors and latest entries; the rest sit behind a disclosure, as the vanilla timeline folded them. */
  readonly timelineShown: ReadonlyArray<TimelineEntry>;
  readonly timelineHidden: ReadonlyArray<TimelineEntry>;
};
type TimelineEntry = Item & { readonly status: string; readonly summary: string };

/** One choice in a lifecycle form; an unavailable one says why. */
export type FormOption = { readonly value: string; readonly title: string; readonly disabled?: boolean };
type FieldBase = {
  readonly name: string;
  readonly label: string;
  readonly required: boolean;
  readonly disabled: boolean;
  readonly placeholder?: string;
  readonly readOnly?: boolean;
  readonly hook?: string;
  readonly source?: string;
};
/** A lifecycle form's fields, grouped and annotated as the vanilla form laid them out. */
export type FormItem =
  | { readonly k: 'note'; readonly text: string }
  | { readonly k: 'group'; readonly legend: string; readonly hook: string; readonly items: ReadonlyArray<FormItem> }
  | (FieldBase & { readonly k: 'text' | 'url' | 'number'; readonly value: string; readonly min?: number; readonly max?: number })
  | (FieldBase & { readonly k: 'textarea'; readonly value: string; readonly rows: number })
  | (FieldBase & { readonly k: 'select'; readonly value: string; readonly options: ReadonlyArray<FormOption> })
  | (FieldBase & { readonly k: 'multi'; readonly value: ReadonlyArray<string>; readonly options: ReadonlyArray<FormOption> })
  | (FieldBase & { readonly k: 'check'; readonly value: boolean });
export type FormValue = string | boolean | ReadonlyArray<string>;
export type LifecycleForm = {
  readonly k: 'form';
  readonly action: string;
  readonly summary: string | null;
  readonly submit: string;
  readonly quiet: boolean;
  /** False until the room holds the records this form signs about. */
  readonly ready: boolean;
  readonly items: ReadonlyArray<FormItem>;
  readonly pending: boolean;
  readonly error: string;
};
export type LifecycleSection = {
  readonly kicker: string;
  readonly title: string;
  readonly anchor: string;
  readonly parts: ReadonlyArray<{ readonly k: 'note'; readonly text: string } | LifecycleForm>;
};

/** One signed record in the collection, with its consent-aware technical evidence. */
export type RecordEntry = {
  readonly hash: string;
  readonly kind: string;
  readonly label: string;
  readonly meta: string;
  readonly invalidated: boolean;
  readonly sequence: { readonly value: string } | { readonly withheld: string } | null;
  readonly lines: ReadonlyArray<string>;
  readonly links: ReadonlyArray<{ readonly label: string; readonly url: string }>;
  readonly summary: { readonly text: string; readonly detail: string } | null;
  readonly technical: ReadonlyArray<Pair>;
  readonly technicalNote: string;
};

export type ReviewDraft = { readonly target: string; readonly text: string; readonly confidence: string; readonly evidenceUrl: string; readonly contextDetermination: string };

export type CandidateEntry = {
  readonly hash: string;
  readonly contractHash: string;
  readonly title: string;
  readonly rationale: string;
  readonly meta: string;
  readonly approved: boolean;
  readonly facts: ReadonlyArray<Pair>;
  readonly predicted: string;
  readonly falsifiers: string;
  readonly assumptions: string;
  readonly pending: boolean;
  readonly error: string;
};

export type WorkspaceView = {
  readonly stats: ReadonlyArray<Pair>;
  readonly records: ReadonlyArray<RecordEntry>;
  readonly query: string;
  readonly sync: string;
  readonly modelEvidence: ReadonlyArray<{
    readonly title: string;
    readonly sources: string;
    readonly entries: ReadonlyArray<{ readonly title: string; readonly counts: string; readonly identity: string; readonly residues: string; readonly boundaries: string }>;
    readonly agreement: string;
    readonly disagreement: string;
    readonly shared: string;
    readonly uncertainty: ReadonlyArray<string>;
    readonly next: { readonly kind: string; readonly reason: string };
  }>;
  readonly review: Omit<ReviewDraft, 'target'> & {
    readonly targets: ReadonlyArray<Option>;
    readonly target: string;
    readonly context: { readonly hash: string; readonly title: string; readonly meta: string; readonly facts: ReadonlyArray<Pair>; readonly note: string } | null;
    readonly requiresContext: boolean;
    readonly determinations: ReadonlyArray<Option>;
    readonly actions: ReadonlyArray<Option & { readonly pendingLabel: string; readonly pending: boolean }>;
    readonly status: string;
  };
  readonly forms: ReadonlyArray<LifecycleSection>;
  readonly discovery: { readonly results: ReadonlyArray<Option>; readonly target: string; readonly similar: ReadonlyArray<Item>; readonly clusters: ReadonlyArray<Item> };
  readonly nextWork: {
    readonly candidates: ReadonlyArray<CandidateEntry>;
    readonly rejected: ReadonlyArray<Item>;
    readonly policy: ReadonlyArray<Pair>;
    readonly tasks: ReadonlyArray<{
      readonly id: string;
      readonly targetHash: string;
      readonly title: string;
      readonly reason: string;
      readonly approved: boolean;
      readonly meta: string;
      readonly pending: boolean;
      readonly error: string;
    }>;
    readonly taskPolicy: string;
  };
  readonly rewards: ReadonlyArray<Item>;
};

export type RoomSnapshot = {
  readonly roomId: string;
  readonly title: string;
  readonly body: string;
  readonly draft: RoomDraft;
  readonly models: ReadonlyArray<Option>;
  readonly policies: ReadonlyArray<Option>;
  readonly intentKinds: ReadonlyArray<Option>;
  readonly pack: ReadonlyArray<Pair>;
  readonly status: string;
  readonly panel: 'overview' | 'review' | 'discovery';
  readonly contextual: { readonly title: string; readonly body: string; readonly target: string } | null;
  readonly room: RoomView;
  /** Why the canonical sample dispute cannot be loaded: its full sequence exceeds the public input limit. */
  readonly sampleBlocked: string;
  readonly workspace: WorkspaceView;
  readonly pending: Readonly<Record<string, boolean>>;
  readonly errors: Readonly<Record<string, string>>;
};

export type RoomServices = {
  readonly dispose: () => void;
  readonly getSnapshot: () => RoomSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  /** One request field; it is kept in this room's unsent draft. */
  readonly setDraft: <K extends keyof RoomDraft>(field: K, value: RoomDraft[K]) => void;
  readonly setQuery: (query: string) => void;
  readonly approveTask: (taskId: string, targetHash: string) => Promise<unknown>;
  readonly approveCandidate: (recordHash: string, contractHash: string) => Promise<unknown>;
  /** Signs a Discovery Contract checkpoint over the active question's complete inputs. */
  readonly freezeContract: () => Promise<unknown>;
  /** Attaches a prior room's accepted evidence to this question as provisional, for review here. */
  readonly attachPrior: (recordHash: string, originRoomId: string) => Promise<unknown>;
  /** One lifecycle form field; the form keeps it until it signs. */
  readonly setLifecycleValue: (action: string, name: string, value: FormValue) => void;
  readonly submitLifecycle: (action: string) => Promise<unknown>;
  /** One review field; choosing another target keeps it in the address. */
  readonly setReview: (field: keyof ReviewDraft, value: string) => void;
  readonly submitReview: (action: string) => Promise<unknown>;
  readonly setSimilarityTarget: (target: string) => void;
};
