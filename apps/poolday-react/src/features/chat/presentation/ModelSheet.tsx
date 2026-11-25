import { Button, Disclosure, Section, Sheet, SingleChoice, Text } from '@reploid/poolday-ui';
import type { ComputerChoice, ModelSheetState } from '../domain/chat';
import { strings } from '../../../l10n/strings';

const t = strings.chat;

/**
 * "Answer on": one computer and one model, judged together. The reason the selection cannot answer
 * sits at the start of the footer and the primary says what it does, so the fix is never a second link.
 */
export function ModelSheet({
  state,
  open,
  onClose,
  onComputer,
  onModel,
  onCommit,
  onWhoCanRead,
  presentation = 'modal',
}: {
  readonly state: ModelSheetState;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onComputer: (computer: ComputerChoice) => void;
  readonly onModel: (model: string) => void;
  readonly onCommit: () => void;
  /** Omit where the privacy dialog is not available. */
  readonly onWhoCanRead?: () => void;
  readonly presentation?: 'modal' | 'inline';
}) {
  return (
    <Sheet
      title={t.answerOn}
      open={open}
      onClose={onClose}
      closeLabel={strings.common.close}
      presentation={presentation}
      footerStatus={state.outcome.issue}
      data={{ 'data-model-picker': true }}
      footer={
        <>
          {onWhoCanRead && <Button variant="quiet" label={t.whoCanRead} hasPopup="dialog" onPress={onWhoCanRead} />}
          <Button
            variant="primary"
            label={state.outcome.label}
            onPress={state.outcome.action ? onCommit : undefined}
            data={{ 'data-change-model': true, 'data-answer-action': state.outcome.action ?? '' }}
          />
        </>
      }
    >
      <Section title={t.computer} note={state.disclosure}>
        <SingleChoice
          label={t.computer}
          labelHidden
          value={state.computer}
          onChange={onComputer}
          options={state.computers.map((computer) => ({
            value: computer.id,
            title: computer.title,
            status: computer.status,
            disabled: computer.disabled ?? false,
            data: { 'data-execution-choice': computer.id },
          }))}
        />
      </Section>
      <Section title={t.model}>
        {state.models.length === 0 ? (
          <Text variant="small" muted>
            {state.outcome.issue}
          </Text>
        ) : (
          <SingleChoice
            label={t.model}
            labelHidden
            value={state.model}
            onChange={onModel}
            options={state.models.map((model) => ({
              value: model.id,
              title: model.name,
              status: model.status,
              disabled: model.disabled ?? false,
              data: { 'data-model-choice': model.id },
            }))}
          />
        )}
      </Section>
      {state.facts !== '' && (
        <Disclosure summary={t.modelDetails}>
          <Text variant="small" muted>
            {state.facts}
          </Text>
        </Disclosure>
      )}
    </Sheet>
  );
}
