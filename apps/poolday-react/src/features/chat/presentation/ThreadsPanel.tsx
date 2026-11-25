import { Button, Menu, Row, SingleChoice, Stack, Text, ThreadItem } from '@reploid/poolday-ui';
import { conversation as t } from '../../../l10n/conversation';
import { useConversation } from './conversationContext';

/**
 * The Threads drawer: New thread, active or archived history, one row per conversation with its state and its
 * Rename and Archive actions. Selecting a thread never cancels work in another.
 */
export function ThreadsPanel({ onDone }: { readonly onDone: () => void }) {
  const [snapshot, port] = useConversation();
  const { threads } = snapshot;
  return (
    <Stack gap="md" data={{ 'data-thread-panel': true }}>
      <Row>
        <Button
          variant="quiet"
          icon="plus"
          label={t.threads.newThread}
          onPress={() => {
            port.newThread();
            onDone();
          }}
          data={{ 'data-new-thread': true }}
        />
      </Row>
      <SingleChoice<'active' | 'archived'>
        layout="segmented"
        label={t.threads.history}
        value={threads.archived ? 'archived' : 'active'}
        onChange={(view) => port.showArchived(view === 'archived')}
        options={[
          { value: 'active', title: t.threads.active, data: { 'data-show-active': true } },
          { value: 'archived', title: t.threads.archived, data: { 'data-show-archived': true } },
        ]}
      />
      {threads.items.length === 0 && (
        <Text variant="small" muted data={{ 'data-thread-empty': true }}>
          {threads.empty}
        </Text>
      )}
      <Stack gap="sm" data={{ 'data-thread-list': true }}>
        {threads.items.map((thread) => (
          <ThreadItem
            key={thread.id}
            title={thread.title}
            digest={thread.summary}
            monogram={thread.monogram}
            time={thread.time}
            timestamp={thread.timestamp === null ? null : { iso: new Date(thread.timestamp).toISOString(), title: t.threads.lastActivity(new Date(thread.timestamp).toLocaleString()) }}
            mark={thread.working ? 'working' : thread.unread ? 'unread' : thread.attention ? 'attention' : null}
            activity={thread.working ? 'executing' : 'idle'}
            current={thread.current}
            label={`${thread.title}: ${thread.summary}${thread.context ? t.threads.context(thread.context.text) : ''}`}
            onPress={() => {
              port.selectThread(thread.id);
              onDone();
            }}
            menu={
              <Menu
                label={t.threads.actions(thread.title)}
                items={[
                  { label: t.threads.rename, onPress: () => port.openRename(thread.id), data: { 'data-rename-thread': true, 'data-thread-id': thread.id } },
                  {
                    label: threads.archived ? t.threads.restore : t.threads.archive,
                    onPress: () => port.archiveThread(thread.id),
                    data: { 'data-archive-thread': true, 'data-thread-id': thread.id },
                  },
                ]}
              />
            }
            data={{ 'data-thread-item-id': thread.id }}
          />
        ))}
      </Stack>
    </Stack>
  );
}
