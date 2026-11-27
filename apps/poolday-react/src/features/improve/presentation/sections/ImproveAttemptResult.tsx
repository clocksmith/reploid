import { Badge, Button, CodeBlock, Disclosure, List, ListItem, Row, Stack, Text } from '@reploid/poolday-ui';
import type { ImproveServices, ResultView } from '../../domain/improve';
import { improve as t } from '../../../../l10n/improve';

/** The selected attempt's result: deliverables, outcome tags, review, activity and the audit details. */
export function AttemptResult({ result, status, services }: { readonly result: ResultView | null; readonly status: string; readonly services: ImproveServices }) {
  return (
    <Stack gap="md" data={{ 'data-work-output': true }}>
      <Row justify="between">
        <Stack gap="xs">
          {result?.title && (
            <Text variant="heading" as="h2" data={{ 'data-work-result-title': true }}>
              {t.results}
            </Text>
          )}
          <Row gap="xs" data={{ 'data-work-outcome-tags': true }}>
            {(result?.tags ?? []).map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </Row>
        </Stack>
        <Text as="span" variant="caption" data={{ 'data-work-review-status': true }}>
          {result?.reviewStatus || status}
        </Text>
      </Row>
      {result?.answer && <Text data={{ 'data-work-answer': true }}>{result.answer}</Text>}
      {result?.error && (
        <Text variant="subheading" data={{ 'data-work-result-error': true }}>
          {result.error}
        </Text>
      )}
      {result && result.artifacts.length > 0 && (
        <List data={{ 'data-work-artifacts': true }}>
          {result.artifacts.map((artifact) => (
            <ListItem key={artifact.id} icon="download" title={artifact.label} status={artifact.meta} label={artifact.title || undefined} onPress={() => services.downloadArtifact(artifact.id)} data={{ 'data-work-artifact': artifact.id }} />
          ))}
        </List>
      )}
      {result?.progress.visible && (
        <Disclosure summary={t.activity} defaultOpen={result.progress.open} data={{ 'data-work-progress': true }}>
          <Stack gap="xs" data={{ 'data-work-team': true }}>
            {result.progress.team.map((line, index) => (
              <Text key={index} variant="small">
                {line.text}
              </Text>
            ))}
          </Stack>
          <Stack gap="xs" data={{ 'data-work-events': true }}>
            {result.progress.events.map((line, index) => (
              <Text key={index} variant="small">
                {line}
              </Text>
            ))}
          </Stack>
          {result.progress.draft !== '' && <CodeBlock data={{ 'data-work-draft': true }}>{result.progress.draft}</CodeBlock>}
        </Disclosure>
      )}
      {result?.reviewActions && (
        <Row gap="sm" data={{ 'data-work-review-actions': true }}>
          <Button variant="quiet" label={t.accept} onPress={result.reviewActions.disabled ? undefined : () => services.review(true)} data={{ 'data-work-accept': true }} />
          <Button variant="quiet" label={t.reject} onPress={result.reviewActions.disabled ? undefined : () => services.review(false)} data={{ 'data-work-reject': true }} />
          <Button variant="quiet" label={t.reviseSelected} onPress={result.reviewActions.disabled ? undefined : () => services.revise(result.id)} data={{ 'data-work-revise-selected': true }} />
        </Row>
      )}
      {result && (
        <Disclosure summary={t.resultDetails} data={{ 'data-work-details': true }}>
          <Row>
            <Button variant="quiet" label={t.exportAll} onPress={services.exportRecords} data={{ 'data-work-export': true }} />
          </Row>
          {result.criteria !== '' && (
            <Text variant="caption" data={{ 'data-work-result-criteria': true }}>
              {result.criteria}
            </Text>
          )}
          <Stack gap="xs" data={{ 'data-work-audit-metadata': true }}>
            {result.audit.map((line) => (
              <Text key={line} variant="caption" mono={line.includes('SHA-256')}>
                {line}
              </Text>
            ))}
          </Stack>
        </Disclosure>
      )}
    </Stack>
  );
}
