import { Button, Disclosure, Facts, Field, Row, SingleChoice, Stack, StatusLine, Text, TextArea, Toggle } from '@reploid/poolday-ui';
import type { RoomServices, RoomSnapshot } from '../../domain/rooms';
import { rooms as t } from '../../../../l10n/rooms';

/** The research request: sequence, model, publication consent, the bounded question and verification. */
export function RoomRequest({ view, services }: { readonly view: RoomSnapshot; readonly services: RoomServices }) {
  const draft = view.draft;
  return (
    <Stack gap="md" data={{ 'data-pool-room-1-request': true, 'data-pool-run': true }}>
      <Text variant="heading" as="h2">
        {t.request}
      </Text>
      <TextArea label={t.sequence} rows={3} value={draft.sequence} onChange={(value) => services.setDraft('sequence', value)} data={{ 'data-pool-run-prompt': true }} />
      <SingleChoice label={t.model} value={draft.model} onChange={(value) => services.setDraft('model', value)} options={view.models} data={{ 'data-pool-run-model': true }} />
      <Disclosure summary={t.modelDetails} quiet data={{ 'data-pool-pack-summary': true }}>
        <Facts items={view.pack} />
      </Disclosure>
      <Stack gap="xs">
        <Text variant="label" muted>
          {t.publication}
        </Text>
        <Toggle title={t.sequencePublic} checked={draft.sequencePublic} onChange={(value) => services.setDraft('sequencePublic', value)} controlData={{ 'data-pool-run-sequence-public': true }} />
        <Toggle title={t.researchPublic} checked={draft.researchPublic} onChange={(value) => services.setDraft('researchPublic', value)} controlData={{ 'data-pool-run-research-public': true }} />
        <Text variant="small" muted>
          {t.publicationNote}
        </Text>
      </Stack>
      <SingleChoice label={t.intent} value={draft.intentKind} onChange={(value) => services.setDraft('intentKind', value)} options={view.intentKinds} data={{ 'data-pool-run-intent-kind': true }} />
      <Field label={t.shortLabel} value={draft.intentLabel} maxLength={240} placeholder={t.shortLabelPlaceholder} onChange={(value) => services.setDraft('intentLabel', value)} data={{ 'data-pool-run-intent-label': true }} />
      <TextArea label={t.intentText} rows={3} maxLength={8000} value={draft.intentText} placeholder={t.intentTextPlaceholder} onChange={(value) => services.setDraft('intentText', value)} data={{ 'data-pool-run-intent-text': true }} />
      <Disclosure summary={t.bound} quiet>
        <Stack gap="sm">
          {t.bounds.map(([field, label, placeholder]) => (
            <TextArea key={field} label={label} rows={2} maxLength={2000} value={draft[field]} placeholder={placeholder} onChange={(value) => services.setDraft(field, value)} data={{ 'data-pool-run-bound': field }} />
          ))}
        </Stack>
      </Disclosure>
      <SingleChoice label={t.verification} value={draft.policy} onChange={(value) => services.setDraft('policy', value)} options={view.policies} data={{ 'data-pool-run-policy': true }} />
      <Row justify="between">
        <StatusLine data={{ 'data-pool-run-status': true }}>{view.status}</StatusLine>
        <Button variant="primary" size="action" label={t.submit} disabled data={{ 'data-pool-run-submit': true }} />
      </Row>
    </Stack>
  );
}
