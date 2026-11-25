import { useMemo, useState, type ReactNode } from 'react';
import { ConversationLayout, Notice, Transcript } from '@reploid/poolday-ui';
import { conversation as t } from '../../../l10n/conversation';
import { AnswerOnSheet } from './AnswerOnSheet';
import { DownloadDialog, PrivacyDialog, RemotePermissionDialog, RenameDialog } from './ChatDialogs';
import { ComposerBar } from './ComposerBar';
import { useConversation } from './conversationContext';
import { Message } from './MessagesView';

/** Computers narrowed to the ones serving one model, as the composition opens them. */
export type ProvidersFilter = { readonly providerIds: ReadonlyArray<string>; readonly label: string };

/**
 * The conversation: the transcript of the selected thread, notices, and the composer, with the "Answer on" sheet,
 * "Who can read it", the reviewed download, Rename and the permission prompt. The host executes and records; this
 * screen renders the controller's snapshot and calls its commands.
 */
export function ChatWorkspace({
  handover,
  onOpenComputers,
  onOpenDetails,
}: {
  readonly handover?: ReactNode;
  readonly onOpenComputers?: (filter?: ProvidersFilter) => void;
  readonly onOpenDetails?: (attemptId?: string) => void;
}) {
  const [snapshot, port] = useConversation();
  const { focus } = snapshot;
  // Keep Stop reachable: the composer's steps aside while the running answer's own Stop is in view.
  const [answerStopInView, setAnswerStopInView] = useState(false);
  // One stable actions object, so a message re-renders only when its own record changes.
  const actions = useMemo(
    () => ({
      retryAttempt: port.retryAttempt,
      copyMessage: port.copyMessage,
      copyError: port.copyError,
      stop: port.stop,
      inspect: (attemptId: string) => onOpenDetails?.(attemptId),
    }),
    [port, onOpenDetails],
  );
  return (
    <>
      <ConversationLayout
        data={{ 'data-conversation-area': true }}
        composerData={{ 'data-composer-area': true }}
        transcript={
          <Transcript label={t.messages} conversation={snapshot.selectedId} logData={{ 'data-message-stream': true }} onWatchedVisible={setAnswerStopInView} data={{ 'data-chat-transcript': true }}>
            {snapshot.messages.map((message) => (
              <Message key={message.id} message={message} actions={actions} />
            ))}
          </Transcript>
        }
        notices={
          <>
            <Notice tone="error" data={{ 'data-chat-error': true }}>
              {snapshot.composer.error || null}
            </Notice>
            {handover}
          </>
        }
        composer={
          <ComposerBar
            composer={snapshot.composer}
            commands={port}
            focusSignal={focus.target === 'composer' ? focus.seq : 0}
            answerOnFocus={focus.target === 'answer-on' ? focus.seq : 0}
            stopCovered={answerStopInView}
          />
        }
      />
      <AnswerOnSheet
        sheet={snapshot.sheet}
        commands={port}
        onInspectProviders={(key) => {
          const filter = port.modelProviders(key);
          port.closeSheet();
          if (filter) onOpenComputers?.(filter);
        }}
      />
      <PrivacyDialog privacy={snapshot.privacy} commands={port} />
      <DownloadDialog download={snapshot.download} commands={port} />
      <RenameDialog rename={snapshot.rename} commands={port} />
      <RemotePermissionDialog permission={snapshot.remotePermission} commands={port} />
    </>
  );
}
