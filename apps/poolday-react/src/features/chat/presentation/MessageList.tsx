import { Badge, Log, Prose, Spinner, Stack, Surface, Text } from '@reploid/poolday-ui';
import type { ChatMessage } from '../domain/chat';
import { strings } from '../../../l10n/strings';
import { Receipt } from './Receipt';

const t = strings.chat;

/** The transcript: questions on an inset well, answers as reading text with their receipt. */
export function MessageList({ messages }: { readonly messages: ReadonlyArray<ChatMessage> }) {
  return (
    <Log label={t.messages} data={{ 'data-message-stream': true }}>
      {messages.length === 0 && <Text muted>{t.emptyThread}</Text>}
      {messages.map((message) =>
        message.role === 'user' ? (
          <Surface key={message.id} variant="well" data={{ 'data-message-role': 'user' }}>
            <Text>{message.text}</Text>
          </Surface>
        ) : (
          <Stack key={message.id} gap="sm" data={{ 'data-message-role': 'assistant' }}>
            {message.text !== '' && <Prose markdown={message.text} label={t.modelOutput} />}
            {message.status === 'executing' && <Spinner label={t.status.executing} />}
            {message.systemNote && (
              <Text variant="small" muted data={{ 'data-system-status': true }}>
                {`${t.system} · ${message.systemNote}`}
              </Text>
            )}
            {!message.systemNote && message.status && message.status !== 'completed' && message.status !== 'executing' && (
              <Badge tone={message.status === 'failed' || message.status === 'disconnected' ? 'error' : 'pending'}>{t.status[message.status]}</Badge>
            )}
            {message.receipt && <Receipt receipt={message.receipt} />}
          </Stack>
        ),
      )}
    </Log>
  );
}
