import { useId, useState, useSyncExternalStore } from 'react';
import {
  Button, Card, CodeBlock, DataTable, Disclosure, Facts, FilePicker, Field, Prism, Row, SingleChoice, Stack, StatusLine, Surface, Text, TextArea, Toggle,
} from '@reploid/poolday-ui';
import type { DocumentServices, ExamplesServices, RunResultView, RunServices, TaskClass } from '../domain/examples';
import { examples as t } from '../../../l10n/examples';

type Workflow = 'sequence' | 'documents';
const TASK_CLASSES: ReadonlyArray<TaskClass> = ['local-only', 'derived-remote', 'public-remote'];

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
function SequenceRun({ run, recordsHref, onCopy }: { readonly run: RunServices; readonly recordsHref: string; readonly onCopy: () => Promise<string> }) {
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

/** Local document search: models, documents, the question and its options, an optional shared task, results. */
function DocumentSearch({ documents }: { readonly documents: DocumentServices }) {
  const view = useSyncExternalStore(documents.subscribe, documents.getSnapshot);
  const heading = useId();
  return (
    <Surface as="section" labelledBy={heading} data={{ 'data-document-search': true }}>
      <Stack gap="md">
        <Text variant="heading" as="h2" id={heading}>
          {t.documents.heading}
        </Text>
        <Text variant="caption">{t.documents.intro}</Text>
        <StatusLine muted={false} data={{ 'data-document-status': true }}>
          {view.status}
        </StatusLine>
        <Disclosure summary={t.documents.models} open={view.setupOpen} onToggle={documents.setSetupOpen} data={{ 'data-document-setup': true }}>
          <FilePicker label={t.documents.settings} accept=".json" onFiles={(files) => documents.setModelsFile(files[0] ?? null)} data={{ 'data-document-models': true }}>
            {(open) => <Button label={t.documents.chooseSettings} onPress={view.busy ? undefined : open} />}
          </FilePicker>
          <Toggle title={t.documents.trust} checked={view.trusted} onChange={documents.setTrusted} controlData={{ 'data-document-trust': true }} />
          <Row gap="sm">
            <Button variant="primary" label={t.documents.useModels} onPress={view.busy ? undefined : documents.configure} data={{ 'data-document-configure': true }} />
          </Row>
          <Text variant="caption" data={{ 'data-document-model-status': true }}>
            {view.modelStatus}
          </Text>
          <Button variant="quiet" label={t.documents.whereSettings} href={t.documents.settingsHelp} external />
        </Disclosure>
        <FilePicker label={t.documents.files} accept=".txt,.md" multiple onFiles={documents.addDocuments} data={{ 'data-document-files': true }}>
          {(open) => <Button label={t.documents.chooseFiles} onPress={view.busy ? undefined : open} />}
        </FilePicker>
        <Text variant="caption" data={{ 'data-document-corpus': true }}>
          {view.corpus}
        </Text>
        <Field label={t.documents.question} value={view.query} onChange={documents.setQuery} required maxLength={4096} autoComplete="off" data={{ 'data-document-query': true }} />
        <Toggle title={t.documents.rerank} checked={view.rerank} onChange={documents.setRerank} disabled={!view.rerankAvailable} controlData={{ 'data-document-rerank': true }} />
        <Toggle title={t.documents.answer} checked={view.answerRequested} onChange={documents.setAnswer} disabled={!view.answerAvailable} controlData={{ 'data-document-answer': true }} />
        <Row gap="sm">
          <Button variant="primary" label={t.documents.search} onPress={view.submitDisabled ? undefined : documents.search} data={{ 'data-document-submit': true }} />
          {view.cancelVisible && <Button variant="quiet" label={t.documents.cancel} onPress={documents.cancel} data={{ 'data-document-cancel': true }} />}
          <Button variant="quiet" label={t.documents.clear} onPress={documents.clear} data={{ 'data-document-clear': true }} />
        </Row>
        <Disclosure summary={t.documents.share} data={{ 'data-document-share': true }}>
          <SingleChoice<TaskClass>
            label={t.documents.taskClass}
            value={view.taskClass}
            onChange={documents.setTaskClass}
            disabled={view.busy}
            options={TASK_CLASSES.map((value) => ({ value, title: t.documents.taskClasses[value], inputData: { 'data-document-task-class': value } }))}
          />
          <StatusLine data={{ 'data-document-share-status': true }}>{view.shareStatus}</StatusLine>
          <TextArea
            label={t.documents.shareTask}
            rows={3}
            maxLength={16384}
            value={view.shareTask}
            onChange={documents.setShareTask}
            placeholder={t.documents.sharePlaceholder}
            disabled={view.taskDisabled}
            data={{ 'data-document-share-task': true }}
          />
          <Row gap="sm">
            <Button variant="quiet" label={t.documents.review} onPress={view.reviewDisabled ? undefined : documents.reviewShare} data={{ 'data-document-review-share': true }} />
          </Row>
          {view.preview && (
            <Stack gap="sm" data={{ 'data-document-share-preview': true }}>
              <Text variant="small">{view.preview.scope}</Text>
              <Text variant="small">{view.preview.recipient}</Text>
              <Disclosure summary={t.documents.reviewInput}>
                <CodeBlock>{view.preview.input}</CodeBlock>
              </Disclosure>
              <Disclosure summary={t.documents.technical}>
                <CodeBlock>{view.preview.technical}</CodeBlock>
              </Disclosure>
              <Toggle title={t.documents.shareConsent} checked={view.shareConsent} onChange={documents.setShareConsent} controlData={{ 'data-document-share-consent': true }} />
              <Row gap="sm">
                <Button variant="primary" label={t.documents.send} onPress={view.sendDisabled ? undefined : documents.sendShare} data={{ 'data-document-send-share': true }} />
              </Row>
            </Stack>
          )}
        </Disclosure>
        {view.answer !== '' && (
          <Stack gap="xs" data={{ 'data-document-answer-output': true }}>
            <Text variant="small" muted>
              {t.documents.answerLabel}
            </Text>
            <Text>{view.answer}</Text>
          </Stack>
        )}
        {view.matches.length > 0 && (
          <Stack gap="sm" data={{ 'data-document-results': true }}>
            <Text variant="small" muted>
              {t.documents.resultsLabel}
            </Text>
            {view.matches.map((match, index) => (
              <Card key={index} title={match.title} data={{ 'data-document-result': index }}>
                <Text variant="small">{match.text}</Text>
              </Card>
            ))}
          </Stack>
        )}
        {view.evidence !== '' && (
          <Disclosure summary={t.documents.evidence} data={{ 'data-document-evidence': true }}>
            <CodeBlock>{view.evidence}</CodeBlock>
          </Disclosure>
        )}
      </Stack>
    </Surface>
  );
}

/**
 * The Examples page (/examples): protein-sequence and document-search examples of specific model operations, under
 * the product's name, its promise and a decorative prism, with links to the experimental surfaces.
 */
export function ExamplesPage({ services }: { readonly services: ExamplesServices }) {
  const run = useSyncExternalStore(services.run.subscribe, services.run.getSnapshot);
  const documents = services.documents;
  const docs = useSyncExternalStore(documents?.subscribe ?? services.run.subscribe, () => documents?.getSnapshot() ?? null);
  const workflow: Workflow = docs?.workflow ?? 'sequence';
  const working = run.visual.state === 'running' || run.visual.state === 'submitting';
  return (
    <Stack gap="lg" data={{ 'data-route-page-content': 'examples', 'data-pool-run-surface': 'examples', 'data-run-state': run.visual.state, 'data-run-phase': run.visual.phase }}>
      <Row gap="md">
        <Stack gap="xs">
          <Text variant="title" as="h1">
            {services.copy.name}
          </Text>
          <Text variant="caption">{services.copy.body}</Text>
          {working && <StatusLine data={{ 'data-pool-brand-status': true }}>{run.visual.message}</StatusLine>}
        </Stack>
        <Prism enhance={services.enhancePrism} />
      </Row>
      <Stack gap="sm">
        <Text variant="heading" as="h2">
          {t.heading}
        </Text>
        <Text variant="caption">{t.intro}</Text>
        <Row>
          <Button variant="quiet" label={t.startWithGoal} href="/" />
        </Row>
      </Stack>
      {documents && (
        <SingleChoice<Workflow>
          label={t.chooseExample}
          layout="segmented"
          value={workflow}
          onChange={(value) => documents.setWorkflow(value, { runBusy: run.busy })}
          options={(['sequence', 'documents'] as const).map((value) => ({ value, title: t.workflows[value], inputData: { 'data-pool-workflow': value } }))}
          data={{ 'data-pool-workflow-switcher': true }}
        />
      )}
      {documents && workflow === 'documents' ? (
        <DocumentSearch documents={documents} />
      ) : (
        <SequenceRun run={services.run} recordsHref={services.recordsHref} onCopy={services.copyVector} />
      )}
      <Row gap="sm" data={{ 'data-pool-experiments-footer': true }}>
        <Text variant="small" muted>
          {t.experiments}
        </Text>
        {services.copy.experiments.map((surface) => (
          <Button key={surface.id} variant="quiet" label={surface.label} href={surface.href} data={{ 'data-pool-substrate-route': surface.id }} />
        ))}
      </Row>
    </Stack>
  );
}
