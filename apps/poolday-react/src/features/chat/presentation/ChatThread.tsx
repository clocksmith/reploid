import { Stack } from '@reploid/poolday-ui';
import type { ChatMessage, ComposerState } from '../domain/chat';
import { Composer } from './Composer';
import { MessageList } from './MessageList';

/** One conversation: the transcript above, the composer pinned below. */
export function ChatThread({
  messages,
  composer,
  onDraft,
  onSend,
  onStop,
  onOpenAnswerOn,
  onCancelDownload,
  onCancelQueued,
}: {
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly composer: ComposerState;
  readonly onDraft: (text: string) => void;
  readonly onSend: () => void;
  readonly onStop: () => void;
  readonly onOpenAnswerOn: () => void;
  readonly onCancelDownload?: () => void;
  readonly onCancelQueued?: (() => void) | undefined;
}) {
  return (
    <Stack gap="lg" data={{ 'data-conversation-area': true }}>
      <MessageList messages={messages} />
      <Composer state={composer} onDraft={onDraft} onSend={onSend} onStop={onStop} onOpenAnswerOn={onOpenAnswerOn} onCancelDownload={onCancelDownload} onCancelQueued={onCancelQueued} />
    </Stack>
  );
}
