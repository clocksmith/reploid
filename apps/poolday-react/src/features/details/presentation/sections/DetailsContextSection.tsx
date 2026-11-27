import { useState } from 'react';
import { List, Section, SingleChoice, Stack, Text, Toggle } from '@reploid/poolday-ui';
import type { ContextSelection, DetailsServices, DetailsView } from '../../domain/services';
import { detailsStrings as t } from '../../../../l10n/details';

export function ContextSection({
  services,
  view,
  draft,
  onDraft,
  act,
}: {
  readonly services: DetailsServices;
  readonly view: DetailsView;
  readonly draft: ContextSelection | null;
  readonly onDraft: ((selection: ContextSelection) => void) | undefined;
  readonly act: (work: () => Promise<unknown>) => void;
}) {
  // Without a composition root holding the new conversation's context, this pane holds it.
  const [ownDraft, setOwnDraft] = useState<ContextSelection | null>(null);
  const selection = draft ?? ownDraft;
  const context = services.context(selection);
  const change = (next: ContextSelection) => {
    if (view.threadId) act(() => services.setContext(view.threadId as string, next));
    else if (onDraft) onDraft(next);
    else setOwnDraft(next);
  };
  const locked = view.busy || view.closed;
  return (
    <Section title={t.context} data={{ 'data-conversation-context': true }}>
      <Text variant="caption" muted data={{ 'data-inspector-context-detail': true }}>
        {view.contextDetail}
      </Text>
      {context && (
        <List gap="sm" data={{ 'data-context-controls': true }}>
          <Toggle
            title={t.includeContext}
            status={t.includeContextStatus}
            checked={context.enabled}
            disabled={locked}
            onChange={(enabled) => change({ enabled, maxWords: context.maxWords })}
            data={{ 'data-context-enabled': true }}
          />
          <Stack gap="xs">
            <Text variant="small">{t.wordCap}</Text>
            <Text variant="caption" muted>
              {t.wordCapStatus}
            </Text>
          </Stack>
          <SingleChoice
            layout="segmented"
            label={t.wordCap}
            value={String(context.maxWords)}
            disabled={locked || !context.enabled}
            onChange={(value) => change({ enabled: context.enabled, maxWords: Number(value) })}
            options={services.wordLimits.map((limit) => ({ value: String(limit), title: String(limit), data: { 'data-context-cap': limit } }))}
            data={{ 'data-context-caps': true }}
          />
          <Stack gap="xs">
            <Text variant="caption" muted data={{ 'data-context-count': true }}>
              {t.contextCount(context.wordCount, context.maxWords)}
            </Text>
            <Text variant="caption" muted wrapAnywhere data={{ 'data-context-preview': true }}>
              {context.content || t.contextOff}
            </Text>
          </Stack>
        </List>
      )}
    </Section>
  );
}
