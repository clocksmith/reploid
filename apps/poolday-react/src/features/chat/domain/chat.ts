/**
 * What the chat screens show. These are view records projected from the conversation state that
 * packages/reploid/src/chat and the Poolday host own; the screens never execute or admit work.
 */

/** Where an answer runs: this browser, the paired desktop, or contributors' computers. */
export type ComputerChoice = 'local' | 'desktop' | 'network';

export type ComputerOption = {
  readonly id: ComputerChoice;
  readonly title: string;
  readonly status: string;
  readonly disabled?: boolean;
};

export type ModelOption = {
  readonly id: string;
  readonly name: string;
  /** One status line: Ready, On this device, Download needed, or why it cannot answer. */
  readonly status: string;
  readonly disabled?: boolean;
};

/** What the sheet's primary does, as `describeAnswerChoice` in the host decides it. */
export type AnswerAction = 'commit' | 'download' | 'use-contributors' | 'use-device';

export type AnswerOutcome = {
  /** Why the selection cannot answer as chosen, or null. */
  readonly issue: string | null;
  readonly action: AnswerAction | null;
  /** The primary button's text: it always says what it does. */
  readonly label: string;
};

export type ModelSheetState = {
  readonly computers: ReadonlyArray<ComputerOption>;
  readonly computer: ComputerChoice;
  readonly models: ReadonlyArray<ModelOption>;
  readonly model: string | null;
  /** Who can read the prompt on the chosen computer. */
  readonly disclosure: string;
  readonly facts: string;
  readonly outcome: AnswerOutcome;
  /** Discovery is still running, so absence is not yet known. */
  readonly searching: boolean;
};

export type AttemptStatus =
  | 'queued' | 'loading' | 'executing' | 'approval' | 'completed' | 'cancelled' | 'cancelling'
  | 'failed' | 'interrupted' | 'disconnected' | 'recovering';

/** Where and how one answer ran. Every field is what the record says, never a stronger claim. */
export type Receipt = {
  readonly computer: string;
  readonly model: string;
  readonly readBy: string;
  readonly duration: string;
  readonly tokens: string;
  readonly settlement: string;
};

export type ChatMessage = {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly status?: AttemptStatus;
  /** Why the answer did not finish, as the system states it; never shown as model output. */
  readonly systemNote?: string;
  readonly receipt?: Receipt;
};

export type ThreadSummary = {
  readonly id: string;
  readonly title: string;
  readonly status: AttemptStatus | 'new';
  /** Relative time of the last activity, already formatted. */
  readonly time: string;
  readonly unread: boolean;
};

export type ComposerState = {
  readonly draft: string;
  readonly running: boolean;
  /** The Answer on summary: where and which model. */
  readonly answerOn: string;
  readonly status: string;
  readonly error: string | null;
  /** Downloading a model: 0 to 1, 'unknown' while the total is unknown, or null when not downloading. */
  readonly progress: number | 'unknown' | null;
  readonly suggestion: string | null;
};
