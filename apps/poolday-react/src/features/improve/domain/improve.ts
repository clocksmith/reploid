/**
 * The Changes page as the screens see it: past attempts and the selected one's result, tool updates and the
 * tool-offer handoff, and LoRA adapter training. The host's improve controller
 * (apps/poolday/host/decisions/improve.js) produces it with the host's decisions; nothing here runs, evaluates
 * or adopts anything.
 */
export type DownloadFile = { readonly name: string; readonly text: string | Uint8Array; readonly type: string };

export type AttemptRow = {
  readonly id: string;
  readonly goal: string;
  readonly badge: string;
  readonly meta: string;
  readonly selected: boolean;
  readonly reviseDisabled: boolean;
  readonly error: string;
};

export type ResultView = {
  readonly id: string;
  readonly title: string;
  readonly tags: ReadonlyArray<string>;
  readonly reviewStatus: string;
  readonly answer: string;
  readonly error: string;
  readonly artifacts: ReadonlyArray<{ readonly id: string; readonly label: string; readonly meta: string; readonly title: string }>;
  readonly progress: {
    readonly visible: boolean;
    readonly open: boolean;
    readonly team: ReadonlyArray<{ readonly text: string; readonly title: string }>;
    readonly events: ReadonlyArray<string>;
    readonly draft: string;
  };
  readonly reviewActions: { readonly disabled: boolean } | null;
  readonly criteria: string;
  readonly audit: ReadonlyArray<string>;
  readonly comparison: { readonly output: string; readonly feedback: string } | null;
};

export type CandidateView = {
  readonly id: string;
  readonly targetId: string;
  readonly state: string;
  readonly reason: string;
  readonly imported: boolean;
  readonly origin: { readonly id: string; readonly label: string } | null;
  readonly checks: string;
  readonly latency: { readonly summary: string; readonly detail: string } | null;
  readonly error: string;
  readonly code: string;
  readonly canExportOffer: boolean;
  readonly exportDisabled: boolean;
  readonly send: { readonly peers: ReadonlyArray<{ readonly value: string; readonly title: string }>; readonly empty: string; readonly value: string | null; readonly disabled: boolean } | null;
  readonly decide: { readonly disabled: boolean } | null;
  readonly rollback: { readonly disabled: boolean } | null;
};

export type ToolsView = {
  readonly empty: boolean;
  readonly candidates: ReadonlyArray<CandidateView>;
  readonly status: string;
  readonly failed: boolean;
  readonly offers: {
    readonly receive: { readonly checked: boolean; readonly disabled: boolean };
    readonly fileDisabled: boolean;
    readonly preview: { readonly target: string; readonly reason: string; readonly code: string; readonly source: string; readonly evaluateDisabled: boolean } | null;
    readonly inbox: ReadonlyArray<{ readonly id: string; readonly text: string }>;
    readonly outbox: ReadonlyArray<{ readonly id: string; readonly text: string; readonly retry: boolean }>;
  } | null;
};

export type TrainingView = {
  readonly status: string;
  readonly error: string;
  readonly disabled: boolean;
  readonly adapterId: string;
  readonly version: string;
  readonly consent: boolean;
  readonly checkpoint: { readonly id: string; readonly step: number } | null;
  readonly resume: boolean;
  readonly peers: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly coordinator: string;
  readonly selected: ReadonlyArray<string>;
  readonly downloads: boolean;
};

export type ImproveSnapshot = {
  readonly error: string;
  readonly history: { readonly visible: boolean; readonly records: ReadonlyArray<AttemptRow> } | null;
  readonly inspection: { readonly open: boolean; readonly result: ResultView | null; readonly busy: boolean; readonly status: string };
  readonly tools: ToolsView | null;
  readonly training: TrainingView | null;
};

export type TrainingField = 'adapterId' | 'version' | 'consent' | 'resume' | 'coordinator' | 'selected';

export type ImproveServices = {
  readonly getSnapshot: () => ImproveSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly dispose: () => void;
  readonly select: (id: string) => void;
  readonly setInspectionOpen: (open: boolean) => void;
  /** Prepares a revision of an attempt and opens it where tasks are written. */
  readonly revise: (id: string) => void;
  readonly review: (accepted: boolean) => void;
  readonly downloadArtifact: (artifactId: string) => void;
  readonly exportRecords: () => void;
  readonly decide: (id: string, adopt: boolean) => void;
  readonly rollback: (id: string) => void;
  readonly exportEvaluation: (id: string) => void;
  readonly exportOffer: (id: string) => void;
  readonly choosePeer: (id: string, peerId: string) => void;
  readonly sendOffer: (id: string) => void;
  readonly importOfferFile: (file: File | null) => void;
  readonly previewPeerOffer: (transferId: string) => void;
  readonly dismissPeerOffer: (transferId: string) => void;
  readonly retryOffer: (transferId: string) => void;
  readonly allowOffers: (on: boolean) => void;
  readonly evaluateOffer: () => void;
  readonly chooseSamples: (file: File | null) => void;
  readonly setTrainingField: (field: TrainingField, value: string | boolean | ReadonlyArray<string>) => void;
  readonly trainHere: () => void;
  readonly trainPooled: () => void;
  readonly stopTraining: () => void;
  readonly connectTraining: () => void;
  readonly contributeRound: () => void;
  readonly downloadAdapter: (kind: 'manifest' | 'weights') => void;
};
