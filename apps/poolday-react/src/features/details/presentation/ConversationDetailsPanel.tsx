import { useState, useSyncExternalStore } from 'react';
import { Button, CodeBlock, Disclosure, List, Row, Section, Stack, Text } from '@reploid/poolday-ui';
import type { ContextSelection, DetailsServices } from '../domain/services';
import { detailsStrings as t } from '../../../l10n/details';
import { ContextSection } from './sections/DetailsContextSection';
import { LastAnswer } from './sections/DetailsLastAnswer';

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/**
 * The Conversation details drawer: the last answer of the current thread (or the one selected from its receipt),
 * its route, activity, execution facts and timeline; the thread's permissions; its context; and its download.
 * Everything shown is the attempt's own record; nothing here changes how an answer ran.
 */
export function ConversationDetailsPanel({
  services,
  attemptId = null,
  draftContext = null,
  onDraftContext,
}: {
  readonly services: DetailsServices;
  /** An answer selected from its receipt; null inspects the last answer. */
  readonly attemptId?: string | null;
  /** The context selection a new conversation will start with, held by the composition root for the composer. */
  readonly draftContext?: ContextSelection | null;
  readonly onDraftContext?: (selection: ContextSelection) => void;
}) {
  const view = useSyncExternalStore(services.subscribe, () => services.project(attemptId));
  const [error, setError] = useState<string | null>(null);
  const act = (work: () => Promise<unknown>) => {
    setError(null);
    work().catch((cause: unknown) => setError(message(cause)));
  };
  return (
    <Stack gap="xl" data={{ 'data-conversation-details': true }}>
      <LastAnswer services={services} view={view} act={act} />
      {view.grants.length > 0 && view.threadId && (
        <Section title={t.permissions} note={t.permissionsNote} data={{ 'data-thread-permissions': true }}>
          <List data={{ 'data-thread-grants': true }}>
            {view.grants.map((grant) => (
              <Stack key={grant.id} gap="xs">
                <Row justify="between" gap="sm">
                  <Stack gap="xs">
                    <Text variant="small">{grant.title}</Text>
                    <Text variant="caption" muted>
                      {grant.status}
                    </Text>
                  </Stack>
                  <Button label={t.revoke} onPress={() => act(() => services.revokeGrant(view.threadId as string, grant.id))} data={{ 'data-revoke-grant': grant.id }} />
                </Row>
                <Disclosure quiet summary={t.permissionRecord}>
                  <CodeBlock>{grant.record}</CodeBlock>
                </Disclosure>
              </Stack>
            ))}
          </List>
        </Section>
      )}
      <ContextSection services={services} view={view} draft={draftContext} onDraft={onDraftContext} act={act} />
      {view.canDownload && view.threadId && (
        <Row>
          <Button
            variant="quiet"
            icon="download"
            label={t.downloadConversation}
            onPress={() => act(async () => services.downloadConversation(view.threadId as string))}
            data={{ 'data-conversation-download': true }}
          />
        </Row>
      )}
      {error !== null && (
        <Text variant="small" data={{ 'data-inspector-error': true }}>
          {error}
        </Text>
      )}
    </Stack>
  );
}
