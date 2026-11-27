import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  Button,
  CodeBlock,
  Disclosure,
  Facts,
  IconButton,
  List,
  ListItem,
  Row,
  Section,
  ShareBar,
  SingleChoice,
  Stack,
  StatusLine,
  Text,
  Toggle,
} from '@reploid/poolday-ui';
import type { ContextSelection, DetailsServices, DetailsView } from '../domain/services';
import { detailsStrings as t } from '../../../l10n/details';

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

function LastAnswer({ services, view, act }: { readonly services: DetailsServices; readonly view: DetailsView; readonly act: (work: () => Promise<unknown>) => void }) {
  const [receiptStatus, setReceiptStatus] = useState<string | null>(null);
  const request = view.creditRequest;
  const key = `${view.activity?.attemptId ?? ''}:${request ?? ''}`;
  // A pending hold may have settled or been released since the answer recorded it: ask the ledger once per answer.
  useEffect(() => {
    setReceiptStatus(null);
    if (!request || !view.receiptAvailable || !view.creditPending) return undefined;
    let current = true;
    void services.ledgerNow(request).then((text) => current && text && setReceiptStatus(text));
    return () => {
      current = false;
    };
    // The key names the answer and its request; the flags are read once for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const activity = view.activity;
  return (
    <Section title={t.lastAnswer} data={{ 'data-last-answer': true }}>
      {view.route && (
        <List gap="xs" data={{ 'data-inspector-route': true }}>
          {view.route.requester && <ListItem icon="device" title={view.route.requester.label} status={view.route.requester.caption} />}
          {view.route.executors.map((node, index) => (
            <ListItem
              key={`${node.id}:${index}`}
              icon={node.caption ? 'device' : 'peers'}
              title={node.label}
              status={node.caption || view.route?.model || undefined}
            />
          ))}
        </List>
      )}
      <StatusLine muted={false} data={{ 'data-inspector-status': true }}>
        {view.statusLabel}
      </StatusLine>
      <Stack gap="sm" data={{ 'data-inspected-activity': true }}>
        {activity && (
          <>
            <Text variant="small">{activity.summary}</Text>
            {activity.distribution && activity.distributionLabel && (
              <ShareBar label={activity.distributionLabel} shares={activity.distribution.map((node) => node.share)} />
            )}
            {activity.nodes.length > 0 && (
              <Facts items={activity.nodes.map((node) => [node.label, node.gpu ? `${node.value} · ${node.gpu}` : node.value] as const)} />
            )}
            {activity.footnote && (
              <Text variant="caption" muted>
                {activity.footnote}
              </Text>
            )}
            {activity.attemptSupply && (
              <Text variant="caption" muted data={{ 'data-attempt-supply': true }}>
                {activity.attemptSupply}
              </Text>
            )}
            {activity.adapter && (
              <Text variant="caption" muted data={{ 'data-recorded-adapter': true }}>
                {activity.adapter}
              </Text>
            )}
            {activity.facts.length > 0 && <Facts items={activity.facts} />}
            {activity.error && (
              <Row gap="xs">
                <CodeBlock>{activity.error}</CodeBlock>
                <IconButton label={t.copyError} icon="copy" onPress={() => act(() => services.copyError(activity.attemptId))} data={{ 'data-copy-error': activity.attemptId }} />
              </Row>
            )}
          </>
        )}
      </Stack>
      {view.execution && (
        <List>
          <Disclosure quiet summary={t.executionDetails} data={{ 'data-attempt-details': true }}>
            <Stack gap="sm" data={{ 'data-ribbon-facts': true }}>
              {view.execution.error && (
                <Text variant="small" data={{ 'data-attempt-error': true }}>
                  {view.execution.error}
                </Text>
              )}
              <Facts items={view.execution.facts} />
              {view.execution.executors.map((node) => (
                <Stack key={node.id} gap="xs">
                  <Text variant="small" as="strong">
                    {node.label}
                  </Text>
                  <Text variant="caption" mono>
                    {node.id}
                  </Text>
                  <Facts items={node.facts} />
                </Stack>
              ))}
              {view.execution.noExecutor && <Text variant="small">{view.execution.noExecutor}</Text>}
              {view.execution.notes.map((note) => (
                <Text key={note} variant="small">
                  {note}
                </Text>
              ))}
              {view.execution.planId && (
                <Text variant="small">
                  {`${t.plan} `}
                  <Text as="code" variant="small" mono>
                    {view.execution.planId}
                  </Text>
                </Text>
              )}
            </Stack>
            {view.receiptAvailable && request && (
              <Button
                variant="quiet"
                label={t.saveReceipt}
                onPress={() => act(async () => setReceiptStatus(await services.saveReceipt(request)))}
                data={{ 'data-credit-receipt': true }}
              />
            )}
            {receiptStatus && (
              <Text variant="caption" muted data={{ 'data-credit-receipt-status': true }}>
                {receiptStatus}
              </Text>
            )}
            <Disclosure quiet summary={t.timeline}>
              <List data={{ 'data-ribbon-timeline': true }}>
                {view.timeline.map((event, index) => (
                  <ListItem key={`${index}:${event}`} title={event} />
                ))}
              </List>
            </Disclosure>
          </Disclosure>
        </List>
      )}
    </Section>
  );
}

function ContextSection({
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
