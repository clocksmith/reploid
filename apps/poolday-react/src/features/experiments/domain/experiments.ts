/**
 * The Experiments page ("Spot the imitation") as the screens see it. The host's experiments controller
 * (apps/poolday/host/decisions/experiments.js) produces it over the research plugin session; the session owns the
 * study record, consent and blinding.
 */
type Common = { readonly error: string; readonly footer: { readonly visible: boolean } | null };

export type ExperimentsSnapshot = Common &
  (
    | {
        readonly phase: 'setup';
        readonly models: ReadonlyArray<{ readonly value: string; readonly title: string }>;
        readonly targetId: string;
        readonly imitatorId: string;
        readonly recipients: ReadonlyArray<string>;
        readonly waiting: string;
        readonly canStart: boolean;
        readonly canRestore: boolean | null;
      }
    | { readonly phase: 'complete'; readonly identified: string; readonly controls: string; readonly rows: ReadonlyArray<ReadonlyArray<string>> }
    | { readonly phase: 'stopped'; readonly status: string }
    | {
        readonly phase: 'judging';
        readonly round: number;
        readonly total: number;
        readonly prompt: string;
        readonly followup: string;
        readonly canFollowup: boolean;
        readonly answers: ReadonlyArray<{ readonly side: string; readonly turns: ReadonlyArray<{ readonly label: string; readonly text: string }> }>;
        readonly choice: string | null;
        readonly confidence: number;
      }
    | { readonly phase: 'preparing' }
  );

export type Judgment = 'A' | 'B' | 'same' | 'unsure';

export type ExperimentsServices = {
  readonly getSnapshot: () => ExperimentsSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly dispose: () => void;
  readonly setTarget: (id: string) => void;
  readonly setImitator: (id: string) => void;
  readonly start: () => void;
  readonly restore: () => void;
  readonly stop: () => void;
  readonly followup: () => void;
  readonly setJudgment: (choice: Judgment) => void;
  readonly setConfidence: (value: number) => void;
  readonly judge: () => void;
  readonly newStudy: () => void;
  /** Exporting before the study completes reveals assignments and breaks blinding; the page confirms first. */
  readonly exportNeedsConfirmation: () => boolean;
  readonly exportRecord: () => void;
};
