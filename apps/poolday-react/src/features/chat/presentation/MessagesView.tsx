import { memo, useState } from 'react';
import { Button, Disclosure, IconButton, List, ListItem, MessageRow, MessageText, Prose, Readout, Row, Stack, StatusDot, Text } from '@reploid/poolday-ui';
import type { ConversationCommands, MessageView } from '../domain/conversation';
import { conversation as t } from '../../../l10n/conversation';

const COPY_CODE = { copy: t.copyCode, copied: t.copied };

type Actions = Pick<ConversationCommands, 'retryAttempt' | 'copyMessage' | 'copyError' | 'stop'> & { readonly inspect: (attemptId: string) => void };

/** A copy action that says it copied. */
function CopyButton({ label, onCopy, data }: { readonly label: string; readonly onCopy: () => Promise<void>; readonly data: Record<`data-${string}`, string | boolean> }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      label={copied ? t.copied : label}
      icon={copied ? 'check' : 'copy'}
      onPress={() => {
        void onCopy().then(() => setCopied(true), () => undefined);
      }}
      data={data}
    />
  );
}

/**
 * One message of the transcript. It re-renders only when its own record changes: the controller keeps a record
 * until its message or attempt changes, so a streaming answer never re-renders the rest of the conversation.
 */
export const Message = memo(function Message({ message, actions }: { readonly message: MessageView; readonly actions: Actions }) {
  const user = message.role === 'user';
  const targets = new Map(message.markdownTargets);
  const activity = message.activity;
  const footer = (
    <>
      {activity && (
        <Row gap="sm" data={{ 'data-execution-activity': true, 'data-active': activity.active, 'data-transcript-watch': activity.active }}>
          <Button
            variant="quiet"
            icon={activity.icon ?? undefined}
            label={activity.active ? activity.activeText : [activity.count ? String(activity.count) : '', activity.readable || t.executionDetails].filter(Boolean).join(' ')}
            accessibleLabel={activity.label}
            title={activity.title}
            hasPopup="dialog"
            onPress={message.attemptId ? () => actions.inspect(message.attemptId as string) : undefined}
            data={{ 'data-execution-trigger': true }}
          />
          {/* The pulse follows the status, so the trigger's leading edge stays put when the answer settles. */}
          {activity.active ? <StatusDot state="waiting" data={{ 'data-tool-status': true }} /> : null}
          {activity.active && <Button variant="quiet" label={t.stop} onPress={activity.stopDisabled ? undefined : actions.stop} data={{ 'data-answer-stop': true }} />}
        </Row>
      )}
      {message.measurements && !message.systemOnly && (
        <Readout items={message.measurements.map((item) => ({ icon: item.icon, text: item.text, title: item.title, data: { 'data-metric': item.metric } }))} />
      )}
      {message.sources.length > 0 && (
        <Disclosure quiet summary={t.sourcesSearched(message.sources.length)}>
          <List>
            {message.sources.map((source) => (
              <ListItem key={source.number} title={`[${source.number}] ${source.title}`} href={source.url} data={{ 'data-source': source.anchor }} />
            ))}
          </List>
        </Disclosure>
      )}
      {message.retry && (
        <Button
          icon="retry"
          label={t.retry}
          accessibleLabel={t.retryResponse}
          title={t.retryTitle}
          onPress={message.retry.disabled ? undefined : () => actions.retryAttempt(message.retry?.attemptId ?? '')}
          data={{ 'data-retry-attempt': message.retry.attemptId }}
        />
      )}
      {message.copy && (
        <CopyButton label={user ? t.copyMessage : t.copyResponse} onCopy={() => actions.copyMessage(message.id)} data={{ 'data-copy-message': true }} />
      )}
      {message.error && <CopyButton label={t.copyError} onCopy={() => actions.copyError(message.attemptId ?? '')} data={{ 'data-copy-error': message.attemptId ?? '' }} />}
    </>
  );
  return (
    <MessageRow
      role={message.role}
      author={message.authorStatus || undefined}
      footer={footer}
      data={{ 'data-message-id': message.id, 'data-message-role': message.role, 'data-system-only': message.systemOnly }}
    >
      {user ? (
        message.documents ? (
          <MessageText label={t.yourMessage}>
            <Stack gap="sm">
              <Text>{message.question ?? ''}</Text>
              {message.documents.map((document) => (
                <Disclosure key={document.name} summary={document.name}>
                  {document.passages.map((passage) => (
                    <Text key={passage.id} variant="small" id={passage.anchor}>
                      {`[${passage.id}] ${passage.text}`}
                    </Text>
                  ))}
                </Disclosure>
              ))}
            </Stack>
          </MessageText>
        ) : (
          <MessageText label={t.yourMessage}>{message.content}</MessageText>
        )
      ) : (
        message.content !== '' && <Prose markdown={message.content} sources={targets} label={t.modelOutput} copyLabels={COPY_CODE} />
      )}
      {message.systemText !== '' && (
        <Text variant="small" data={{ 'data-system-status': true }}>
          {`System · ${message.systemText}`}
        </Text>
      )}
      {message.previousAttempts.length > 0 && (
        <Disclosure quiet summary={t.previousAttempts(message.previousAttempts.length)} data={{ 'data-previous-attempts': true }}>
          {message.previousAttempts.map((line, index) => (
            <Text key={index} variant="small" muted>
              {line}
            </Text>
          ))}
        </Disclosure>
      )}
    </MessageRow>
  );
});
