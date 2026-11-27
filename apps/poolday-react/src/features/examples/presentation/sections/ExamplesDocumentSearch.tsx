import { useId, useSyncExternalStore } from 'react';
import { Button, Card, CodeBlock, Disclosure, Field, FilePicker, Row, SingleChoice, Stack, StatusLine, Surface, Text, TextArea, Toggle } from '@reploid/poolday-ui';
import type { DocumentServices, TaskClass } from '../../domain/examples';
import { examples as t } from '../../../../l10n/examples';

const TASK_CLASSES: ReadonlyArray<TaskClass> = ['local-only', 'derived-remote', 'public-remote'];

/** Local document search: models, documents, the question and its options, an optional shared task, results. */
export function DocumentSearch({ documents }: { readonly documents: DocumentServices }) {
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
