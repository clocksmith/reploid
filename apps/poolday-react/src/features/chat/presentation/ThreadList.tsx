import { Badge, Button, List, ListItem, Row, SingleChoice, Stack, Text } from '@reploid/poolday-ui';
import type { ThreadSummary } from '../domain/chat';
import { strings } from '../../../l10n/strings';

const t = strings.chat;
const ATTENTION = new Set(['queued', 'loading', 'recovering', 'cancelling', 'approval', 'failed', 'interrupted', 'disconnected']);

/** Independent threads, most recent first. Exactly one is current; selecting never cancels work. */
export function ThreadList({
  threads,
  current,
  view,
  onView,
  onSelect,
  onNew,
}: {
  readonly threads: ReadonlyArray<ThreadSummary>;
  readonly current: string | null;
  readonly view: 'active' | 'archived';
  readonly onView: (view: 'active' | 'archived') => void;
  readonly onSelect: (id: string) => void;
  readonly onNew: () => void;
}) {
  return (
    <Stack gap="md" data={{ 'data-thread-list': true }}>
      <Row justify="between">
        <Button variant="quiet" icon="plus" label={t.newThread} onPress={onNew} data={{ 'data-new-thread': true }} />
      </Row>
      <SingleChoice
        layout="segmented"
        label={t.threadHistory}
        value={view}
        onChange={onView}
        options={[
          { value: 'active', title: t.active },
          { value: 'archived', title: t.archived },
        ]}
      />
      {threads.length === 0 ? (
        <Text variant="small" muted data={{ 'data-thread-empty': true }}>
          {t.noThreads}
        </Text>
      ) : (
        <List>
          {threads.map((thread) => {
            const status = thread.unread ? t.newAnswer : t.status[thread.status];
            return (
              <ListItem
                key={thread.id}
                title={thread.title}
                status={status}
                current={thread.id === current}
                onPress={() => onSelect(thread.id)}
                label={`${thread.title}: ${status}`}
                trailing={
                  <>
                    {thread.unread && <Badge tone="ready">{t.newAnswer}</Badge>}
                    {!thread.unread && ATTENTION.has(thread.status) && (
                      <Badge tone={thread.status === 'failed' || thread.status === 'disconnected' ? 'error' : 'pending'}>{t.status[thread.status]}</Badge>
                    )}
                    <Text as="span" variant="caption" muted>
                      {thread.time}
                    </Text>
                  </>
                }
                data={{ 'data-thread-item-id': thread.id }}
              />
            );
          })}
        </List>
      )}
    </Stack>
  );
}
