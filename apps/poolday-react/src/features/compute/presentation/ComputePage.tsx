import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, CodeBlock, DataTable, Disclosure, Facts, Field, Notice, Row, Section, SingleChoice, Stack, Stats, StatusLine, Text, Toggle } from '@reploid/poolday-ui';
import { computeStrings as t } from '../../../l10n/compute';
import type { ComputeServices, ComputeSnapshot, HealthRow, LimitKey } from '../domain/compute';

const LIMITS: ReadonlyArray<LimitKey> = ['maxConcurrentJobs', 'maxTokensPerJob', 'storageBudgetMiB', 'bandwidthBudgetMbps'];

/** One sharing limit: the draft shows what is typed, and only a value inside its bounds is saved. */
function LimitField({ name, value, bounds, onCommit }: { readonly name: LimitKey; readonly value: number; readonly bounds: { readonly min: number; readonly max: number }; readonly onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const change = (next: string) => {
    setDraft(next);
    const number = Number(next);
    if (next.trim() !== '' && Number.isFinite(number) && number >= bounds.min && number <= bounds.max) onCommit(number);
  };
  return <Field type="number" label={t[name]} value={draft ?? String(value)} min={bounds.min} max={bounds.max} onChange={change} data={{ 'data-pool-limit': name }} />;
}

const healthFacts = (rows: ReadonlyArray<HealthRow>) => rows.map(([label, value]) => [label, value] as const);

/** The Debug event box: the session's last event as a sentence, its fields, and the full record. */
function DebugEvent({ result }: { readonly result: ComputeSnapshot['result'] }) {
  return (
    <Disclosure summary={t.debugEvent}>
      {result.summary.length > 0 && <Stats label={t.debugEvent} items={result.summary} data={{ 'data-pool-provider-result-summary': true }} />}
      <Text variant="small" data={{ 'data-pool-provider-result': true }}>{result.message || t.noActivity}</Text>
      {result.recovery && (
        <Stack gap="xs" data={{ 'data-pool-provider-result-recovery': true }}>
          {result.recovery.title && <Text variant="subheading" as="h3">{result.recovery.title}</Text>}
          {result.recovery.message && <Text variant="small">{result.recovery.message}</Text>}
        </Stack>
      )}
      <Disclosure summary={t.fullEvent} data={{ 'data-pool-raw-details': true }}>
        <CodeBlock label={t.fullEvent} data={{ 'data-pool-provider-result-raw': true }}>
          {result.raw}
        </CodeBlock>
      </Disclosure>
    </Disclosure>
  );
}

/**
 * "Sequence provider": share this tab's browser for public protein sequence work within limits the
 * person sets, see its readiness and recent receipts, and stop at any time.
 */
export function ComputePage({ services }: { readonly services: ComputeServices }) {
  const snapshot = useSyncExternalStore(services.subscribe, services.getSnapshot);
  const toggleLabel = snapshot.starting ? t.starting : snapshot.active ? t.stop : t.start;
  const boundary: ReadonlyArray<ReactNode> = snapshot.boundary.map((line) =>
    line.strong ? (
      <>
        <Text as="strong" variant="small">{line.strong}</Text>
        {line.text}
      </>
    ) : (
      line.text
    ),
  );
  return (
    <Stack gap="lg" data={{ 'data-pool-provider': true, 'data-pool-room-id': snapshot.room.id, 'data-pool-relay-mode': snapshot.room.relay }}>
      <Stack gap="xs">
        <Text variant="title" as="h1">{t.title}</Text>
        <Text variant="caption">{t.body}</Text>
      </Stack>
      <Section title={t.model}>
        <Stack gap="md">
          <Text variant="label" data={{ 'data-pool-provider-status': true, 'data-provider-state': snapshot.state }}>{snapshot.status}</Text>
          {snapshot.contribution.optedIn && <Stats label={t.thisTab} items={snapshot.contribution.stats} data={{ 'data-pool-provider-node-stats': true }} />}
          <SingleChoice label={t.model} labelHidden value={snapshot.modelId} options={snapshot.models} onChange={services.setModel} disabled={snapshot.modelLocked} data={{ 'data-pool-provider-model': true }} />
          <Disclosure summary={t.modelDetails} data={{ 'data-pool-pack-summary': true }}>
            <Facts items={snapshot.facts} />
          </Disclosure>
          <Stack gap="xs" data={{ 'data-pool-sharing-boundary': true }}>
            <Text variant="subheading" as="h2">{t.beforeYouShare}</Text>
            {boundary.map((line, index) => (
              <Text key={index} variant="small">{line}</Text>
            ))}
          </Stack>
          <Disclosure summary={t.sharingLimits} data={{ 'data-pool-sharing-limits': true }}>
            <Toggle title={t.relayArtifacts} checked={snapshot.permissions.relayArtifacts} onChange={(on) => services.setPermission('relayArtifacts', on)} controlData={{ 'data-pool-permission': 'relayArtifacts' }} />
            <Toggle title={t.verifyResults} checked={snapshot.permissions.verifyResults} onChange={(on) => services.setPermission('verifyResults', on)} controlData={{ 'data-pool-permission': 'verifyResults' }} />
            {LIMITS.map((name) => (
              <LimitField key={name} name={name} value={snapshot.limits[name]} bounds={snapshot.limitBounds[name]} onCommit={(value) => services.setLimit(name, value)} />
            ))}
            <Row>
              <Button label={snapshot.passkey.label} variant="quiet" onPress={snapshot.passkey.disabled ? undefined : services.enrollPasskey} data={{ 'data-pool-passkey': true }} />
            </Row>
            {snapshot.passkey.status ? <StatusLine data={{ 'data-pool-passkey-status': true }}>{snapshot.passkey.status}</StatusLine> : null}
          </Disclosure>
          {snapshot.notice && (
            <Notice tone={snapshot.notice.state === 'error' ? 'error' : 'neutral'} data={{ 'data-pool-provider-notice': true, 'data-notice-state': snapshot.notice.state }}>
              {snapshot.notice.title} {snapshot.notice.message}
            </Notice>
          )}
          <Row>
            <Button
              label={toggleLabel}
              variant={snapshot.active ? 'quiet' : 'primary'}
              pressed={snapshot.active}
              onPress={snapshot.starting || snapshot.stopping ? undefined : services.toggle}
              data={{ 'data-pool-provider-worker-toggle': true, 'data-contribution-action': snapshot.active ? 'stop' : 'start' }}
            />
          </Row>
        </Stack>
      </Section>
      {snapshot.contribution.recent.length > 0 && (
        <Section title={t.recentReceipts} data={{ 'data-pool-contribution-history': true }}>
          <DataTable label={t.recentWork} columns={t.receiptColumns} rows={snapshot.contribution.recent.map((row) => [row.answer, row.model, row.tokens, row.room])} />
        </Section>
      )}
      <Disclosure summary={t.advanced} data={{ 'data-pool-provider-details': true }}>
        <Text variant="caption" muted mono data={{ 'data-pool-participation': true, 'data-pool-device-identity': true, 'data-identity-protection': snapshot.identity.protection ?? undefined }}>
          {snapshot.identity.label}
        </Text>
        <Section title={t.readiness} data={{ 'data-pool-provider-health': true }}>
          <Stats label={t.readinessLabel} items={healthFacts(snapshot.health.primary)} />
          <Disclosure summary={t.deviceDetails}>
            <Stats label={t.deviceDetailsLabel} items={healthFacts(snapshot.health.details)} />
          </Disclosure>
        </Section>
        <DebugEvent result={snapshot.result} />
      </Disclosure>
    </Stack>
  );
}
