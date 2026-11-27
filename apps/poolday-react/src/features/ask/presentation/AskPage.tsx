import { useSyncExternalStore } from 'react';
import { Badge, Button, CodeBlock, DataTable, Disclosure, Facts, Row, Section, SingleChoice, Stack, Stats, StatusLine, Surface, Text, TextArea, Toggle } from '@reploid/poolday-ui';
import { askStrings as t } from '../../../l10n/ask';
import type { AskServices, AskSnapshot, ContributionView, RunRecovery, RunResultView } from '../domain/ask';

/** The recovery a result asks the person to act on: retry, run here, invite a contributor, or discard. */
function Recovery({ recovery, onAction }: { readonly recovery: RunRecovery; readonly onAction: (id: string) => void }) {
  return (
    <Surface variant="raised" as="section" data={{ 'data-pool-run-result-recovery': true, 'data-pool-run-recovery-kind': recovery.kind }}>
      <Stack gap="sm">
        {recovery.title && <Text variant="subheading" as="h3">{recovery.title}</Text>}
        {recovery.message && <Text variant="small">{recovery.message}</Text>}
        {recovery.details.map((detail) => (
          <Text key={detail} variant="small" muted>
            {detail}
          </Text>
        ))}
        {recovery.actions.length > 0 && (
          <Row>
            {recovery.actions.map((action) =>
              action.href ? (
                <Button key={action.id} label={action.label} href={action.href} variant={action.primary ? 'primary' : 'quiet'} data={{ 'data-pool-run-recovery-action': action.id }} />
              ) : (
                <Button key={action.id} label={action.label} variant={action.primary ? 'primary' : 'quiet'} onPress={() => onAction(action.id)} data={{ 'data-pool-run-recovery-action': action.id }} />
              ),
            )}
          </Row>
        )}
      </Stack>
    </Surface>
  );
}

/** Which contributor tabs answered, matched or were excluded, under which policy. */
function Proof({ contribution }: { readonly contribution: ContributionView }) {
  return (
    <Disclosure summary={t.proof} data={{ 'data-pool-run-result-evidence': true }}>
      <Facts items={contribution.summary} />
      {contribution.route && <Facts items={contribution.route} />}
      {contribution.rejected.length > 0 && (
        <Disclosure summary={t.excluded} quiet>
          {contribution.rejected.map((row) => (
            <Text key={row.providerId} variant="small">
              {row.providerId}: {row.reasons}
            </Text>
          ))}
        </Disclosure>
      )}
      {contribution.local || contribution.rows.length === 0 ? (
        <Text variant="caption">{contribution.note}</Text>
      ) : (
        <DataTable label={t.contributors} columns={t.contributorColumns} rows={contribution.rows.map((row) => [row.providerId, row.status, row.tokens, row.output])} />
      )}
    </Disclosure>
  );
}

/** The run's output: its summary, the embedding outcome, the answer or the recovery card, the proof and the raw record. */
function RunOutput({ result, snapshot, services }: { readonly result: RunResultView; readonly snapshot: AskSnapshot; readonly services: AskServices }) {
  const embedding = result.embedding;
  return (
    <Section title={t.output} data={{ 'data-pool-run-output': true }}>
      <Stack gap="md">
        {result.summary.length > 0 && <Stats label={t.result} items={result.summary} data={{ 'data-pool-run-result-summary': true }} />}
        {embedding && (
          <Surface variant="raised" as="section" data={{ 'data-pool-run-result-embedding-outcome': true }}>
            <Stack gap="sm">
              <Text variant="label" muted>{t.embeddingKicker}</Text>
              <Text variant="subheading" as="h3">{t.embeddingReady}</Text>
              <Text variant="caption" muted mono>{embedding.outcomeMeta}</Text>
              <Text variant="small">{t.embeddingValues}</Text>
              <Text variant="small">{t.embeddingLimit}</Text>
              <Row>
                <Button label={t.copyVector} variant="quiet" onPress={embedding.permitted ? services.copyEmbedding : undefined} data={{ 'data-pool-copy-embedding': true }} />
                <Button label={t.recentJobs} variant="quiet" href={snapshot.room.recordsHref} />
              </Row>
              <StatusLine data={{ 'data-pool-embedding-copy-status': true }}>{snapshot.copyStatus || embedding.withheld}</StatusLine>
            </Stack>
          </Surface>
        )}
        {!result.answerHidden && (
          <Stack gap="xs" data={{ 'data-pool-run-answer': true }}>
            <Text variant="label" muted>{t.result}</Text>
            <CodeBlock label={t.result} data={{ 'data-pool-run-result-stream': true }}>
              {result.output}
            </CodeBlock>
          </Stack>
        )}
        {result.recovery && <Recovery recovery={result.recovery} onAction={services.recover} />}
        <Proof contribution={result.contribution} />
        {embedding?.permitted && (
          <Disclosure summary={t.viewVector} data={{ 'data-pool-run-result-embedding-details': true }}>
            <Text variant="caption">{embedding.meta}</Text>
            <CodeBlock label={t.vectorLabel} data={{ 'data-pool-run-result-embedding': true }}>
              {embedding.vector}
            </CodeBlock>
          </Disclosure>
        )}
        <Disclosure summary={t.rawResult} data={{ 'data-pool-raw-details': true }}>
          <CodeBlock label={t.rawResult} data={{ 'data-pool-run-result-raw': true }}>
            {result.raw}
          </CodeBlock>
        </Disclosure>
      </Stack>
    </Section>
  );
}

/**
 * "Run a model": a public protein sequence, a model and a verification policy, then the verified
 * embedding with its proof, or the recovery choices when no contributor can answer.
 */
export function AskPage({ services }: { readonly services: AskServices }) {
  const snapshot = useSyncExternalStore(services.subscribe, services.getSnapshot);
  const { form, run, result } = snapshot;
  const locked = !snapshot.canRequest;
  return (
    <Stack
      gap="lg"
      data={{
        'data-pool-run': true,
        'data-pool-run-surface': 'run',
        'data-run-state': run.state,
        'data-run-phase': run.phase,
        'data-pool-room-id': snapshot.room.id,
        'data-pool-relay-mode': snapshot.room.relay,
      }}
    >
      <Stack gap="xs">
        <Text variant="title" as="h1">{t.title}</Text>
        <Text variant="caption">{t.body}</Text>
      </Stack>
      <Text variant="caption" muted mono data={{ 'data-pool-participation': true, 'data-pool-device-identity': true, 'data-identity-protection': snapshot.identity.protection ?? undefined }}>
        {snapshot.identity.label}
      </Text>
      <Section title={t.sequence}>
        <Stack gap="md">
          <TextArea label={t.sequence} labelHidden rows={6} value={form.prompt} onChange={services.setPrompt} disabled={locked} data={{ 'data-pool-run-prompt': true }} />
          <Row>
            <SingleChoice label={t.model} value={form.modelId} options={snapshot.models} onChange={services.setModel} disabled={locked} data={{ 'data-pool-run-model': true }} />
            <Badge data={{ 'data-pool-run-workload': true }}>{snapshot.workload}</Badge>
          </Row>
          <Disclosure summary={t.modelDetails} data={{ 'data-pool-pack-summary': true }}>
            <Facts items={snapshot.facts} />
          </Disclosure>
          <Stack gap="xs">
            <Text variant="small" muted>{t.disclosure}</Text>
            <Toggle title={t.sequencePublic} checked={form.sequencePublic} onChange={services.setSequencePublic} disabled={locked} controlData={{ 'data-pool-run-sequence-public': true }} />
            <Text variant="caption">{t.sequenceNote}</Text>
          </Stack>
          <Disclosure summary={t.settings} data={{ 'data-pool-run-settings': true }}>
            <SingleChoice label={t.verification} value={form.policyId} options={snapshot.policies} onChange={services.setPolicy} disabled={locked} data={{ 'data-pool-run-policy': true }} />
          </Disclosure>
          <StatusLine data={{ 'data-pool-run-status': true }}>{run.message}</StatusLine>
          <Row>
            <Button label={t.run} variant="primary" size="action" onPress={locked || snapshot.busy ? undefined : services.run} data={{ 'data-pool-run-submit': true }} />
          </Row>
        </Stack>
      </Section>
      {snapshot.outputVisible && <RunOutput result={result} snapshot={snapshot} services={services} />}
    </Stack>
  );
}
