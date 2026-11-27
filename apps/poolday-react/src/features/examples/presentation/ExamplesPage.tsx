import { useSyncExternalStore } from 'react';
import { Button, Prism, Row, SingleChoice, Stack, StatusLine, Text } from '@reploid/poolday-ui';
import type { ExamplesServices } from '../domain/examples';
import { examples as t } from '../../../l10n/examples';
import { DocumentSearch } from './sections/ExamplesDocumentSearch';
import { SequenceRun } from './sections/ExamplesSequenceRun';

type Workflow = 'sequence' | 'documents';

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
