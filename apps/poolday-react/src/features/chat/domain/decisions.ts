import type { AnswerOutcome } from './chat';
import type { ExecutionLocation, HostAttempt, HostChatState, HostModel } from './session';

/** Where the sheet judges a model: this device or the network. */
export type SheetSide = 'local' | 'network';
/** Why contributors may not answer without an explicit preset change. */
export type ContributorBlock = 'own-devices' | 'guest' | null;
/** A destination preset: this device, contributors, or the paired desktop. */
export type Destination = 'device' | 'contributors' | 'desktop';

/**
 * The host's answer and disclosure decisions, injected so the screens judge a choice exactly as the
 * legacy interface does (one source: apps/poolday/ui/pool-home/conversation-model-picker.js and
 * its helpers, adapted in infrastructure). Pure functions over host records.
 */
export type AnswerDecisions = {
  /** Whether this shell can offer a reviewed download. */
  readonly canDownload: boolean;
  readonly executionState: (model: HostModel | null | undefined, location: ExecutionLocation) => { readonly usable: boolean; readonly source: string; readonly status: string };
  readonly describeAnswerChoice: (
    model: HostModel | null,
    side: SheetSide,
    options: { state: HostChatState; block: ContributorBlock; canDownload: boolean; choice: 'desktop' | null; locked: null; sending: boolean; implied: boolean },
  ) => AnswerOutcome;
  readonly locationForModel: (model: HostModel | null, location: SheetSide, options: { block: ContributorBlock; choice: Destination | null }) => SheetSide;
  readonly modelForLocation: (models: ReadonlyArray<HostModel> | undefined, model: HostModel | null, location: SheetSide, options: { state: HostChatState; canDownload: boolean }) => HostModel | null;
  readonly contributorBlock: (options: { activeThread: boolean; privacy: unknown; preset: string | null }) => ContributorBlock;
  readonly canDownloadHere: (model: HostModel, state: HostChatState) => boolean;
  readonly modelLabel: (model: HostModel) => string;
  /** Who could read the prompt, from the attempt's execution receipt: [summary, detail]. */
  readonly answerPrivacy: (attempt: HostAttempt | undefined, state: HostChatState) => readonly [string, string];
  /** Why an attempt did not finish, as the transcript states it. */
  readonly failureLabel: (attempt: HostAttempt) => string;
  /** The execution policy a destination sets. */
  readonly destinationPolicy: (destination: Destination) => unknown;
  /** The policy a fresh conversation starts with: nothing leaves this device. */
  readonly localPolicy: () => unknown;
};
