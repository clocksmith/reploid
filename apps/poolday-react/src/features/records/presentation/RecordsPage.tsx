import { useSyncExternalStore } from 'react';
import { Button, CodeBlock, DataTable, Disclosure, Field, List, Row, SingleChoice, Stack, StatusLine, Text } from '@reploid/poolday-ui';
import type { RecordFacet, RecordsServices, RecordsSnapshot } from '../domain/records';
import { records as t } from '../../../l10n/records';

/** The unified timeline: one choice of record type, then each record as a remembered disclosure with its JSON. */
function RecordLedger({ view, services }: { readonly view: RecordsSnapshot; readonly services: RecordsServices }) {
  return (
    <Stack gap="sm" data={{ 'data-pool-record-ledger': true, 'data-record-facet': view.facet }}>
      {view.hasRecords && (
        <SingleChoice<RecordFacet>
          label={t.facets}
          labelHidden
          layout="segmented"
          value={view.facet}
          onChange={services.setFacet}
          options={view.facets.map((facet) => ({ value: facet.id, title: t.facetLabel(facet.label, facet.count) }))}
          data={{ 'data-pool-record-facets': true }}
        />
      )}
      {!view.hasRecords ? (
        <Text variant="small" muted>
          {t.empty}
        </Text>
      ) : view.records.length === 0 ? (
        <Text variant="small" muted>
          {t.emptyFacet}
        </Text>
      ) : (
        <List>
          {view.records.map((record) => (
            <Disclosure
              key={record.id}
              summary={t.recordSummary(record.time, record.title)}
              status={record.meta}
              open={record.open}
              onToggle={(open) => open !== record.open && services.setDisclosure(`record:${record.id}`, open)}
              data={{ 'data-pool-record-disclosure': `record:${record.id}`, 'data-record-type': record.type }}
            >
              <CodeBlock>{record.detail}</CodeBlock>
            </Disclosure>
          ))}
        </List>
      )}
    </Stack>
  );
}

/** Shared-room activity, local contributor scores, saved receipts and the receipt lookup, folded away by default. */
function RecordTools({ view, services }: { readonly view: RecordsSnapshot; readonly services: RecordsServices }) {
  const activity = view.roomActivity;
  const toggle = (id: string) => (open: boolean) => open !== (view.open[id] === true) && services.setDisclosure(id, open);
  return (
    <Disclosure summary={t.advanced} quiet open={view.open['technical-tools'] === true} onToggle={toggle('technical-tools')} data={{ 'data-pool-record-disclosure': 'technical-tools' }}>
      <Stack gap="md">
        <Stack gap="xs" data={{ 'data-pool-room-activity': activity.state }}>
          <Text variant="subheading" as="h2">
            {t.activity}
          </Text>
          {activity.state === 'ready' ? (
            <>
              <DataTable label={t.activityLabel} columns={t.activityColumns} rows={[activity.row]} />
              <Text variant="caption" muted>
                {activity.recent}
              </Text>
            </>
          ) : (
            <Text variant="small" muted>
              {activity.text}
            </Text>
          )}
        </Stack>
        <Stack gap="xs" data={{ 'data-pool-peer-ledger': true }}>
          <Text variant="subheading" as="h2">
            {t.identities}
          </Text>
          {view.peerScores.length ? (
            <DataTable label={t.scoresLabel} columns={t.scoreColumns} rows={view.peerScores} />
          ) : (
            <Text variant="small" muted>
              {t.noScores}
            </Text>
          )}
        </Stack>
        <Stack gap="xs" data={{ 'data-pool-receipt-ledger': true }}>
          <Text variant="subheading" as="h2">
            {t.receipts}
          </Text>
          {view.receipts.length ? (
            <DataTable label={t.receiptsLabel} columns={t.receiptColumns} rows={view.receipts} />
          ) : (
            <Text variant="small" muted>
              {t.noReceipts}
            </Text>
          )}
        </Stack>
        <Disclosure summary={t.lookup} quiet open={view.open['receipt-lookup'] === true} onToggle={toggle('receipt-lookup')} data={{ 'data-pool-record-disclosure': 'receipt-lookup' }}>
          <Stack gap="sm">
            <Row gap="sm">
              <Field label={t.receiptHash} labelHidden value={view.lookup.hash} onChange={services.setLookupHash} placeholder={t.receiptPlaceholder} spellCheck={false} data={{ 'data-pool-receipt-hash': true }} />
              <Button label={t.lookupButton} pending={view.lookup.pending} pendingLabel={t.lookupPending} onPress={() => void services.lookupReceipt()} data={{ 'data-pool-receipt-lookup': true }} />
            </Row>
            {view.lookup.result ? (
              <CodeBlock label={t.lookupResult} data={{ 'data-pool-receipt-result': true }}>
                {services.resultText(view.lookup.result)}
              </CodeBlock>
            ) : (
              <Text variant="small" muted data={{ 'data-pool-receipt-result': true }}>
                {t.noLookup}
              </Text>
            )}
          </Stack>
        </Disclosure>
        <Stack gap="xs">
          <Text variant="subheading" as="h2">
            {t.recovery}
          </Text>
          <Text variant="small" muted>
            {t.recoveryBody}
          </Text>
        </Stack>
        <Text variant="caption" muted>
          {view.protocol}
        </Text>
      </Stack>
    </Disclosure>
  );
}

/** Recent jobs: the record timeline, this tab's document searches, and the folded technical tools. */
export function RecordsPage({ services }: { readonly services: RecordsServices }) {
  const view = useSyncExternalStore(services.subscribe, services.getSnapshot);
  return (
    <Stack gap="lg" data={{ 'data-route-page-content': 'records', 'data-pool-record-room': view.roomId }}>
      <Stack gap="xs" data={{ 'data-pool-page-heading': true }}>
        <Text variant="title" as="h1">
          {view.title}
        </Text>
        <Text muted>{view.body}</Text>
      </Stack>
      <RecordLedger view={view} services={services} />
      {view.documentHistory.length > 0 && (
        <Stack gap="sm" data={{ 'data-pool-document-history': true }}>
          <Text variant="subheading" as="h2">
            {t.documents}
          </Text>
          <StatusLine>{t.documentsNote}</StatusLine>
          <List>
            {view.documentHistory.map((entry, index) => (
              <Disclosure key={index} summary={entry.summary}>
                <CodeBlock>{entry.detail}</CodeBlock>
              </Disclosure>
            ))}
          </List>
        </Stack>
      )}
      <RecordTools view={view} services={services} />
    </Stack>
  );
}
