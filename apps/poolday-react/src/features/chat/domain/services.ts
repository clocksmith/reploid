import type { AnswerDecisions } from './decisions';
import type { ChatPort } from './session';

/** What the composition root supplies to the chat screens. */
export type ChatServices = {
  readonly chat: ChatPort;
  readonly decisions: AnswerDecisions;
};
