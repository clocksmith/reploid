import { useState, useSyncExternalStore } from 'react';
import { Button, Card, Columns, DataTable, Dialog, Disclosure, Notice, RangeField, Row, SingleChoice, Stack, Text } from '@reploid/poolday-ui';
import type { ExperimentsServices, ExperimentsSnapshot, Judgment } from '../domain/experiments';
import { experiments as t } from '../../../l10n/experiments';

const JUDGMENTS: ReadonlyArray<Judgment> = ['A', 'B', 'same', 'unsure'];

/** The phase-specific body: set-up and consent, blind judging, preparation, a stopped study or the results. */
function StudyBody({ view, services }: { readonly view: ExperimentsSnapshot; readonly services: ExperimentsServices }) {
  switch (view.phase) {
    case 'setup':
      return (
        <Stack gap="md">
          <Text>{t.question}</Text>
          <Columns>
            <SingleChoice label={t.target} value={view.targetId} onChange={services.setTarget} options={view.models} data={{ 'data-study-target': true }} />
            <SingleChoice label={t.imitator} value={view.imitatorId} onChange={services.setImitator} options={view.models} data={{ 'data-study-imitator': true }} />
          </Columns>
          <Text muted>{t.protocol}</Text>
          <Text variant="small" muted>
            {t.disclosure}
          </Text>
          <Disclosure summary={t.recipients}>
            {view.recipients.length ? (
              view.recipients.map((line) => (
                <Text key={line} variant="small" mono>
                  {line}
                </Text>
              ))
            ) : (
              <Text variant="small" muted>
                {t.noRecipients}
              </Text>
            )}
          </Disclosure>
          {view.waiting !== '' && (
            <Text variant="small" data={{ 'data-study-waiting': true }}>
              {view.waiting}
            </Text>
          )}
          <Row gap="sm">
            <Button variant="primary" label={t.start} onPress={view.canStart ? services.start : undefined} data={{ 'data-study-start': true }} />
            {view.canRestore !== null && <Button label={t.restore} onPress={view.canRestore ? services.restore : undefined} data={{ 'data-study-restore': true }} />}
          </Row>
        </Stack>
      );
    case 'complete':
      return (
        <Stack gap="md">
          <Text variant="heading" as="h2">
            {t.complete}
          </Text>
          <Text>{view.identified}</Text>
          <Text>{view.controls}</Text>
          <Text muted>{t.pilotNote}</Text>
          <DataTable label={t.resultsLabel} columns={t.columns} rows={view.rows} data={{ 'data-study-results': true }} />
        </Stack>
      );
    case 'stopped':
      return (
        <Stack gap="sm">
          <Text variant="heading" as="h2">
            {t.stopped(view.status)}
          </Text>
          <Text>{t.retained}</Text>
        </Stack>
      );
    case 'judging':
      return (
        <Stack gap="md">
          <Text variant="small" muted>
            {t.round(view.round, view.total)}
          </Text>
          <Text variant="heading" as="h2">
            {view.prompt}
          </Text>
          {view.followup !== '' && <Text>{t.followupLabel(view.followup)}</Text>}
          <Columns>
            {view.answers.map((answer) => (
              <Card key={answer.side} title={answer.side} data={{ 'data-study-answer': answer.side }}>
                {answer.turns.map((turn, index) => (
                  <Stack key={index} gap="xs">
                    <Text variant="small" muted>
                      {turn.label}
                    </Text>
                    <Text>{turn.text}</Text>
                  </Stack>
                ))}
              </Card>
            ))}
          </Columns>
          <SingleChoice<Judgment>
            label={t.which}
            value={(view.choice as Judgment | null) ?? null}
            onChange={services.setJudgment}
            options={JUDGMENTS.map((value) => ({ value, title: t.choices[value], inputData: { 'data-judgment': value } }))}
            data={{ 'data-study-judgment': true }}
          />
          <RangeField label={t.confidence} value={view.confidence} min={0} max={100} step={10} format={(value) => `${value}%`} onChange={services.setConfidence} data={{ 'data-study-confidence': true }} />
          <Row gap="sm">
            <Button variant="primary" label={t.judge} onPress={services.judge} data={{ 'data-study-judge': true }} />
            {view.canFollowup && <Button label={t.askFollowup} onPress={services.followup} data={{ 'data-study-followup': true }} />}
          </Row>
        </Stack>
      );
    case 'preparing':
      return (
        <Stack gap="sm">
          <Text data={{ 'data-study-preparing': true }}>{t.preparing}</Text>
          <Text variant="small" muted>
            {t.preparingNote}
          </Text>
          <Row>
            <Button label={t.stop} onPress={services.stop} data={{ 'data-study-stop': true }} />
          </Row>
        </Stack>
      );
  }
}

/**
 * The Experiments page (/experiments): the built-in "Spot the imitation" study. Starting is the consent to send the
 * frozen public prompts to the reviewed recipients; judging stays blind until the study completes.
 */
export function ExperimentsPage({ services }: { readonly services: ExperimentsServices }) {
  const view = useSyncExternalStore(services.subscribe, services.getSnapshot);
  const [confirming, setConfirming] = useState(false);
  const exportRecord = () => (services.exportNeedsConfirmation() ? setConfirming(true) : services.exportRecord());
  return (
    <Stack gap="lg" data={{ 'data-plugin-root': true, 'data-route-page-content': 'experiments' }}>
      <Stack gap="xs">
        <Text variant="small" muted>
          {t.eyebrow}
        </Text>
        <Text variant="title" as="h1">
          {t.title}
        </Text>
      </Stack>
      <StudyBody view={view} services={services} />
      <Notice tone="error" data={{ 'data-study-error': true }}>
        {view.error || null}
      </Notice>
      {view.footer?.visible && (
        <Row gap="sm">
          <Button label={t.exportRecord} icon="download" onPress={exportRecord} data={{ 'data-study-export': true }} />
          <Button label={t.newStudy} onPress={services.newStudy} data={{ 'data-study-new': true }} />
        </Row>
      )}
      <Disclosure summary={t.whatTitle}>
        <Text variant="small" muted>
          {t.what}
        </Text>
      </Disclosure>
      <Dialog
        title={t.confirmTitle}
        open={confirming}
        onClose={() => setConfirming(false)}
        closeLabel={t.close}
        data={{ 'data-study-export-confirm': true }}
        footer={
          <>
            <Button variant="quiet" label={t.cancel} onPress={() => setConfirming(false)} />
            <Button
              variant="primary"
              label={t.confirm}
              onPress={() => {
                setConfirming(false);
                services.exportRecord();
              }}
            />
          </>
        }
      >
        <Text>{t.confirmBody}</Text>
      </Dialog>
    </Stack>
  );
}
