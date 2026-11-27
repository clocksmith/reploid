import { useSyncExternalStore } from 'react';
import { Badge, Button, Card, CodeBlock, Disclosure, Notice, Row, Section, Stack, Text } from '@reploid/poolday-ui';
import type { ImproveServices } from '../domain/improve';
import { improve as t } from '../../../l10n/improve';
import { AttemptResult } from './sections/ImproveAttemptResult';
import { ToolUpdates } from './sections/ImproveToolUpdates';
import { TrainingPanel } from './sections/ImproveTrainingPanel';

/**
 * The Changes page (/improve): LoRA adapter training, tool updates and their handoff, and past attempts, each of
 * which opens its result on selection. The host runs, evaluates and records; this page shows its decisions and
 * asks for the person's.
 */
export function ImprovePage({ services }: { readonly services: ImproveServices }) {
  const view = useSyncExternalStore(services.subscribe, services.getSnapshot);
  const { history, inspection } = view;
  return (
    <Stack gap="lg" data={{ 'data-work-surface': true, 'data-route-page-content': 'improve' }}>
      <Notice tone="error" data={{ 'data-work-error': true }}>
        {view.error || null}
      </Notice>
      <Text variant="title" as="h1">
        {t.title}
      </Text>
      {view.training && <TrainingPanel training={view.training} services={services} />}
      {view.tools && <ToolUpdates tools={view.tools} services={services} />}
      {history?.visible && (
        <Section title={t.pastAttempts} data={{ 'data-work-history-section': true }}>
          <Row justify="end">
            <Button variant="quiet" label={t.export} onPress={services.exportRecords} data={{ 'data-work-export': true }} />
          </Row>
          <Stack gap="md" data={{ 'data-work-history': true }}>
            {history.records.map((attempt) => (
              <Card key={attempt.id} status={attempt.meta} data={{ 'data-change-card': true, 'data-work-attempt': attempt.id }}>
                <Row justify="between">
                  <Button
                    variant="quiet"
                    label={attempt.goal}
                    pressed={attempt.selected}
                    onPress={() => {
                      services.select(attempt.id);
                    }}
                    data={{ 'data-work-select': attempt.id }}
                  />
                  <Badge>{attempt.badge}</Badge>
                </Row>
                <Row>
                  <Button variant="quiet" label={t.revise} onPress={attempt.reviseDisabled ? undefined : () => services.revise(attempt.id)} data={{ 'data-work-revise': attempt.id }} />
                </Row>
                {attempt.error !== '' && <Text variant="subheading">{attempt.error}</Text>}
              </Card>
            ))}
          </Stack>
        </Section>
      )}
      {inspection.open && (
        <Disclosure summary={t.selectedAttempt} open onToggle={services.setInspectionOpen} data={{ 'data-change-inspection': true }}>
          {inspection.result?.comparison && (
            <Stack gap="sm" data={{ 'data-work-comparison': true }}>
              <Text variant="heading" as="h2">
                {t.earlierAttempt}
              </Text>
              <Text data={{ 'data-work-parent-feedback': true }}>{inspection.result.comparison.feedback}</Text>
              <CodeBlock data={{ 'data-work-parent-output': true }}>{inspection.result.comparison.output}</CodeBlock>
            </Stack>
          )}
          <AttemptResult result={inspection.result} status={inspection.status} services={services} />
        </Disclosure>
      )}
    </Stack>
  );
}
