import { useId, useState, useSyncExternalStore } from 'react';
import { Button, Card, CodeBlock, DataTable, Disclosure, Facts, Row, SingleChoice, Stack, StatusLine, Surface, Text, TextArea, Toggle } from '@reploid/poolday-ui';
import type { RunResultView, RunServices } from '../../domain/examples';
import { examples as t } from '../../../../l10n/examples';

/** Which contributor tabs were selected, matched, flagged or excluded, under which policy. */
function ContributorEvidence({ contributors }: { readonly contributors: NonNullable<RunResultView['contributors']> }) {
  return (
    <Stack gap="sm" data={{ 'data-pool-run-evidence': true }}>
      <Facts items={contributors.summary} />
      {contributors.note !== '' && (
        <Text variant="caption" muted>
          {contributors.note}
        </Text>
      )}
      {contributors.route && <Facts items={contributors.route} />}
      {contributors.excluded.length > 0 && (
        <Disclosure summary={t.contributors.excluded}>
          {contributors.excluded.map((line) => (
            <Text key={line} variant="small" mono>
              {line}
            </Text>
          ))}
        </Disclosure>
      )}
      {contributors.rows.length > 0 && (
        <DataTable
          label={t.contributors.tableLabel}
          columns={t.contributors.columns}
          rows={contributors.rows.map((row) => [row.provider, row.reason ? `${row.status} · ${row.reason}` : row.status, row.tokens, row.output])}
        />
      )}
    </Stack>
  );
}

/** A run's result: its summary, the embedding outcome, the answer text, recovery choices, proof and the raw record. */
function RunResult({ result, recordsHref, onRecover, onCopy }: {
  readonly result: RunResultView;
  readonly recordsHref: string;
  readonly onRecover: (actionId: string) => void;
  readonly onCopy: () => Promise<string>;
}) {
  const [copyStatus, setCopyStatus] = useState('');
  return (
    <Stack gap="md">
      {result.summary.length > 0 && (
        <Stack gap="xs" data={{ 'data-pool-run-summary': true }}>
          <Facts items={result.summary} />
        </Stack>
      )}
      {result.embedding && (
        <Card title={t.embedding.heading} status={t.embedding.kicker} data={{ 'data-pool-embedding-outcome': true }}>
          <Text variant="caption" muted mono data={{ 'data-pool-embedding-meta': true }}>
            {result.embedding.meta}
          </Text>
          <Text variant="small">{t.embedding.values}</Text>
          <Text variant="small">{t.embedding.notDiagnosis}</Text>
          <Row gap="sm">
            <Button
              variant="quiet"
              label={t.embedding.copy}
              onPress={result.embedding.permitted ? () => void onCopy().then(setCopyStatus) : undefined}
              data={{ 'data-pool-copy-embedding': true }}
            />
            <Button variant="quiet" label={t.embedding.recentJobs} href={recordsHref} />
          </Row>
          <StatusLine data={{ 'data-pool-embedding-copy-status': true }}>{copyStatus || result.embedding.withheld}</StatusLine>
        </Card>
      )}
      <Stack gap="xs">
        <Text variant="small" muted>
          {t.run.output}
        </Text>
        <CodeBlock label={t.run.output} data={{ 'data-pool-run-stream': true }}>
          {result.output}
        </CodeBlock>
      </Stack>
      {result.recovery && (
        <Card title={result.recovery.title} data={{ 'data-pool-run-recovery': result.recovery.kind }}>
          {result.recovery.message !== '' && <Text>{result.recovery.message}</Text>}
          {result.recovery.details.map((line) => (
            <Text key={line} variant="small" muted>
              {line}
            </Text>
          ))}
          <Row gap="sm">
            {result.recovery.actions.map((action) =>
              action.href ? (
                <Button key={action.id} variant="quiet" label={action.label} href={action.href} data={{ 'data-pool-recovery-action': action.id }} />
              ) : (
                <Button
                  key={action.id}
                  variant={action.primary ? 'primary' : 'quiet'}
                  label={action.label}
                  onPress={() => onRecover(action.id)}
                  data={{ 'data-pool-recovery-action': action.id }}
                />
              ),
            )}
          </Row>
        </Card>
      )}
      {result.contributors && (
        <Disclosure summary={t.run.proof}>
          <ContributorEvidence contributors={result.contributors} />
        </Disclosure>
      )}
      {result.embedding?.permitted && (
        <Disclosure summary={t.embedding.view} data={{ 'data-pool-embedding-details': true }}>
          <Text variant="caption">{result.embedding.detailMeta}</Text>
          <CodeBlock label={t.embedding.vectorLabel} data={{ 'data-pool-embedding-vector': true }}>
            {result.embedding.vector}
          </CodeBlock>
        </Disclosure>
      )}
      <Disclosure summary={t.run.raw}>
        <CodeBlock label={t.run.raw} data={{ 'data-pool-run-raw': true }}>
          {result.raw}
        </CodeBlock>
      </Disclosure>
    </Stack>
  );
}

/** The protein-sequence run: model, the public sequence and its consent, verification, Run model and the result. */
export function SequenceRun({ run, recordsHref, onCopy }: { readonly run: RunServices; readonly recordsHref: string; readonly onCopy: () => Promise<string> }) {
  const view = useSyncExternalStore(run.subscribe, run.getSnapshot);
  const heading = useId();
  const resultHeading = useId();
  return (
    <Stack gap="md">
      <Surface as="section" labelledBy={heading} data={{ 'data-pool-home-ask-form': true }}>
        <Stack gap="md">
          <Text variant="heading" as="h2" id={heading}>
            {t.run.heading}
          </Text>
          <SingleChoice
            label={t.run.model}
            value={view.modelId}
            onChange={run.setModel}
            disabled={view.busy}
            options={view.models.map((model) => ({ value: model.value, title: model.label }))}
            data={{ 'data-pool-request-model': true }}
          />
          <TextArea
            label={t.run.sequence}
            rows={4}
            value={view.sequence}
            onChange={run.setSequence}
            placeholder={view.suggestion}
            disabled={view.busy}
            focusSignal={view.focusSequence}
            {...(view.feedback.invalid ? { error: view.feedback.message } : { hint: view.feedback.message })}
            data={{ 'data-pool-sequence-input': true, 'data-pool-suggested-prompt': view.suggestion }}
          />
          <Row gap="sm">
            <Text variant="small" muted data={{ 'data-pool-sequence-count': true }}>
              {view.feedback.count}
            </Text>
            <Button variant="quiet" label={t.run.useExample} onPress={view.busy ? undefined : run.useExample} data={{ 'data-pool-use-example': true }} />
          </Row>
          {view.consentSaved && view.consent ? (
            <Text variant="small" muted data={{ 'data-pool-sequence-consent-saved': true }}>
              {t.run.saved}
            </Text>
          ) : (
            <Toggle title={t.run.consent} checked={view.consent} onChange={run.setConsent} disabled={view.busy} controlData={{ 'data-pool-sequence-public': true }} />
          )}
          <Disclosure summary={t.run.options}>
            <Facts items={view.pack} />
            <SingleChoice
              label={t.run.verification}
              value={view.policyId}
              onChange={run.setPolicy}
              disabled={view.busy}
              options={view.policies.map((policy) => ({ value: policy.value, title: policy.label, inputData: { 'data-pool-policy': policy.value } }))}
              data={{ 'data-pool-request-policy': true }}
            />
          </Disclosure>
          <Row gap="sm">
            <Button variant="primary" size="action" label={t.run.submit} onPress={run.submit} pending={view.busy} data={{ 'data-pool-run-submit': true }} />
            <StatusLine data={{ 'data-pool-run-status': true }}>{view.visual.message}</StatusLine>
          </Row>
        </Stack>
      </Surface>
      {view.outputVisible && view.result && (
        <Surface as="section" labelledBy={resultHeading} data={{ 'data-pool-run-output': true }}>
          <Stack gap="md">
            <Text variant="subheading" as="h2" id={resultHeading}>
              {t.run.resultLabel}
            </Text>
            <RunResult result={view.result} recordsHref={recordsHref} onRecover={run.recover} onCopy={onCopy} />
          </Stack>
        </Surface>
      )}
    </Stack>
  );
}
