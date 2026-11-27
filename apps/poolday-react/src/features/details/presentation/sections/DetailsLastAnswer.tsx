import { useEffect, useState } from 'react';
import { Button, CodeBlock, Disclosure, Facts, IconButton, List, ListItem, Row, Section, ShareBar, Stack, StatusLine, Text } from '@reploid/poolday-ui';
import type { DetailsServices, DetailsView } from '../../domain/services';
import { detailsStrings as t } from '../../../../l10n/details';

export function LastAnswer({ services, view, act }: { readonly services: DetailsServices; readonly view: DetailsView; readonly act: (work: () => Promise<unknown>) => void }) {
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
