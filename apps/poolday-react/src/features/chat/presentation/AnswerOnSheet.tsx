import { Button, Disclosure, Section, Sheet, SingleChoice, Stack, Text, type ChoiceGroup } from '@reploid/poolday-ui';
import type { ComputerChoice, ConversationCommands, SheetView } from '../domain/conversation';
import { conversation as t } from '../../../l10n/conversation';

type OpenSheet = Extract<SheetView, { readonly open: true }>;

/**
 * "Answer on": one computer and one model, judged together. A computer tap applies at once and keeps the sheet
 * open on that computer; a model tap that can answer applies and returns to the draft; arrow keys only browse.
 * The reason the selection cannot answer sits at the start of the footer and the primary says what it does.
 */
export function AnswerOnSheet({
  sheet,
  commands,
  onInspectProviders,
  presentation = 'modal',
}: {
  /** `inline` shows the sheet in the page flow, for the design page. */
  readonly presentation?: 'modal' | 'inline';
  readonly sheet: SheetView;
  readonly commands: ConversationCommands;
  /** Opens the computers serving one model (Computers, narrowed to them). */
  readonly onInspectProviders: (key: string) => void;
}) {
  const open = sheet.open ? (sheet as OpenSheet) : null;
  const groups: ReadonlyArray<ChoiceGroup<string>> = open
    ? open.sections.map((section) => ({
        id: section.id,
        label: section.label,
        folded: section.folded,
        open: section.open,
        empty: section.empty,
        options: section.rows.map((row) => ({
          value: row.value,
          title: row.title,
          status: row.status,
          disabled: row.disabled,
          data: { 'data-model-choice': row.value, 'data-choice-key': row.key, 'data-choice-adapter': row.nested },
          ...(row.providers ? { action: { label: row.providers.label, icon: 'next' as const, onPress: () => onInspectProviders(row.value), data: { 'data-inspect-model-providers': row.value } } } : {}),
        })),
      }))
    : [];
  return (
    <Sheet
      title={open?.title ?? t.answerOn}
      open={!!open}
      onClose={commands.closeSheet}
      closeLabel={t.close}
      presentation={presentation}
      footerStatus={open?.outcome.issue ? <Text as="span" variant="small" muted data={{ 'data-next-model-status': true }}>{open.outcome.issue}</Text> : undefined}
      headingData={{ 'data-picker-title': true }}
      closeData={{ 'data-model-picker-close': true }}
      data={{ 'data-model-picker': true }}
      footer={
        <Button
          variant="primary"
          label={open?.outcome.label ?? ''}
          onPress={open && !open.outcome.disabled ? commands.runSheetAction : undefined}
          data={{ 'data-change-model': true, 'data-answer-action': open?.outcome.action ?? '' }}
        />
      }
    >
      {open && (
        <Stack gap="lg">
          <Section title={t.sheet.computer} note={<Text as="span" variant="small" muted data={{ 'data-sheet-disclosure': true }}>{open.disclosure}</Text>}>
            <SingleChoice<ComputerChoice>
              label={t.sheet.computer}
              labelHidden
              value={open.computers.find((computer) => computer.checked)?.choice ?? null}
              onChange={(choice) => commands.pickComputer(choice)}
              options={open.computers.map((computer) => ({
                value: computer.choice,
                title: computer.title,
                status: computer.status,
                disabled: computer.disabled,
                data: { 'data-execution-choice': computer.choice },
              }))}
              data={{ 'data-execution-location': true }}
            />
          </Section>
          {open.threadNote && (
            <Text variant="small" muted data={{ 'data-picker-thread-note': true }}>
              {t.sheet.threadNote}
            </Text>
          )}
          <Section title={t.sheet.model}>
            <SingleChoice<string>
              label={t.sheet.model}
              labelHidden
              value={open.selectedKey}
              onChange={(value, input) => commands.pickModel(value, input)}
              onCommit={(value) => (value === open.selectedKey ? commands.commitSheet() : commands.pickModel(value))}
              groups={groups}
              autoFocusChecked
              data={{ 'data-next-model': true }}
            />
          </Section>
          <Disclosure summary={t.sheet.details} onToggle={commands.setSheetDetails} data={{ 'data-model-details': true }}>
            {open.adapter && (
              <Stack gap="xs" data={{ 'data-model-adapter-details': true }}>
                <Text variant="small">{open.adapter.title}</Text>
                <Text variant="small" data={{ 'data-adapter-purpose': true }}>
                  {open.adapter.purpose}
                </Text>
                <Text variant="small" data={{ 'data-adapter-evidence': true, 'data-evidence-status': open.adapter.evidenceStatus }}>
                  {open.adapter.evidence}
                </Text>
                <Text variant="small" data={{ 'data-adapter-availability': true }}>
                  {open.adapter.availability}
                </Text>
                <Text variant="caption" muted>
                  {open.adapter.identities}
                </Text>
              </Stack>
            )}
            {open.facts !== '' && (
              <Text variant="small" muted data={{ 'data-model-facts': true }}>
                {open.facts}
              </Text>
            )}
            {open.localFit !== '' && (
              <Text variant="small" muted data={{ 'data-local-fit': true }}>
                {open.localFit}
              </Text>
            )}
            <Stack gap="xs" data={{ 'data-model-providers': true }}>
              {open.routes.length > 1 || (open.routes.length === 1 && open.routes[0]?.selectionId !== open.selectedKey) ? (
                <SingleChoice<string>
                  label={t.sheet.routes}
                  value={open.selectedKey}
                  onChange={(value) => commands.pickModel(value)}
                  options={open.routes.map((route) => ({ value: route.selectionId, title: route.type, status: route.status, data: { 'data-model-route-choice': route.selectionId } }))}
                />
              ) : (
                open.routes.map((route) => (
                  <Text key={route.selectionId} variant="small" muted data={{ 'data-model-route': route.selectionId }}>
                    {`${route.type} · ${route.status}`}
                  </Text>
                ))
              )}
              <Button variant="quiet" label={t.sheet.adapterGuide} href={open.adapterGuide} external data={{ 'data-adapter-guide': true }} />
            </Stack>
          </Disclosure>
        </Stack>
      )}
    </Sheet>
  );
}
