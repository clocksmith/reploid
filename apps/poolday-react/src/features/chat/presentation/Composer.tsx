import { Button, Chip, Grow, IconButton, InputGroup, Notice, Progress, Row, Stack, StatusLine, TextArea } from '@reploid/poolday-ui';
import type { ComposerState } from '../domain/chat';
import { strings } from '../../../l10n/strings';

const t = strings.chat;

/**
 * The message field with its toolbar: attach, Answer on (opens the model sheet) and Send or Stop.
 * Status and errors sit above the field in regions that are always present.
 */
export function Composer({
  state,
  onDraft,
  onSend,
  onStop,
  onOpenAnswerOn,
  onAttach,
  onCancelDownload,
  onCancelQueued,
}: {
  readonly state: ComposerState;
  readonly onDraft: (text: string) => void;
  readonly onSend: () => void;
  readonly onStop: () => void;
  readonly onOpenAnswerOn: () => void;
  readonly onAttach?: () => void;
  readonly onCancelDownload?: () => void;
  /** Present while a Send waits for a computer; cancelling returns the draft to editing. */
  readonly onCancelQueued?: (() => void) | undefined;
}) {
  const canSend = state.draft.trim() !== '' && !state.running;
  return (
    <Stack gap="sm" data={{ 'data-composer-area': true }}>
      {state.suggestion && state.draft === '' && (
        <Row>
          <Chip label={state.suggestion} onPress={() => onDraft(state.suggestion ?? '')} data={{ 'data-starting-prompt': true }} />
        </Row>
      )}
      <Notice tone="error">{state.error}</Notice>
      {state.progress !== null && (
        <Row gap="sm">
          <Grow>
            <Progress label={t.modelDownload} value={state.progress === 'unknown' ? undefined : state.progress} />
          </Grow>
          {onCancelDownload && <Button variant="quiet" label={strings.download.cancel} onPress={onCancelDownload} data={{ 'data-cancel-download': true }} />}
        </Row>
      )}
      <Row justify="between" gap="sm">
        <Grow>
          <StatusLine data={{ 'data-model-status': true }}>{state.status}</StatusLine>
        </Grow>
        {onCancelQueued && <Button variant="quiet" label={strings.common.cancel} onPress={onCancelQueued} data={{ 'data-cancel-queued-send': true }} />}
      </Row>
      <InputGroup activity={state.running ? 'executing' : 'idle'} data={{ 'data-composer-field': true }}>
        <TextArea
          bare
          rows={1}
          label={t.message}
          labelHidden
          placeholder={t.messagePlaceholder}
          value={state.draft}
          onChange={onDraft}
          onSubmit={canSend ? onSend : undefined}
          data={{ 'data-composer-input': true }}
        />
        <Row gap="xs">
          <IconButton label={t.attach} icon="attach" onPress={onAttach} />
          <Button
            variant="quiet"
            label={`${t.answerOn} · ${state.answerOn}`}
            icon="model"
            hasPopup="dialog"
            onPress={onOpenAnswerOn}
            data={{ 'data-open-model': true }}
          />
          <Grow />
          {state.running ? (
            <IconButton variant="primary" label={t.stop} icon="stop" onPress={onStop} data={{ 'data-composer-stop': true }} />
          ) : (
            <IconButton variant="primary" label={t.send} icon="send" onPress={canSend ? onSend : undefined} data={{ 'data-composer-send': true }} />
          )}
        </Row>
      </InputGroup>
    </Stack>
  );
}
