import { useId } from 'react';
import {
  Button, FilePicker, IconButton, InputGroup, Notice, Progress, Row, SelectorButton, Stack, Text, TextArea, Toolbar,
} from '@reploid/poolday-ui';
import type { ComposerView, ConversationCommands, NextAction } from '../domain/conversation';
import { conversation as t } from '../../../l10n/conversation';

const ACCEPT = '.txt,.md,.json,.js,.ts,.html,.css';

/** The one next useful action beside the status line, as the host decided it. */
function NextActionButton({ action, composer, commands }: { readonly action: NextAction; readonly composer: ComposerView; readonly commands: ConversationCommands }) {
  const labels = composer.nextLabels;
  switch (action) {
    case 'join':
      return <Button variant="primary" label={labels.join} onPress={commands.joinHost} data={{ 'data-join-host': true }} />;
    case 'cancel-download':
      return <Button variant="quiet" label={t.cancelDownload} onPress={commands.cancelDownload} data={{ 'data-cancel-download': true }} />;
    case 'cancel-queued':
      return <Button variant="quiet" label={t.cancel} onPress={commands.cancelQueuedSend} data={{ 'data-cancel-queued-send': true }} />;
    case 'review-shared':
      return <Button variant="quiet" label={labels.reviewShared} onPress={commands.reviewSharedModel} data={{ 'data-review-shared-model': true }} />;
    case 'network-opt-in':
      return <Button variant="quiet" label={t.chooseWhere} hasPopup="dialog" onPress={commands.reviewNetworkExecution} data={{ 'data-review-network-execution': true }} />;
    case 'download-local':
      return <Button variant="quiet" label={labels.downloadLocal} hasPopup="dialog" onPress={commands.downloadLocal} data={{ 'data-download-local': true }} />;
    case 'retry':
      return <Button variant="quiet" label={labels.retry} onPress={labels.retryPending ? undefined : commands.retryConnection} data={{ 'data-retry-connection': true }} />;
  }
}

/**
 * The message field with task-specific feedback and its controls below: attach, search,
 * "Answer on" (where and with which model, and whether it can answer), "Who can read it", and Send or Stop. Every line of status and every
 * action comes from the host's decisions; the status line keeps at most one next action.
 */
export function ComposerBar({
  composer,
  commands,
  focusSignal,
  answerOnFocus,
  stopCovered = false,
}: {
  /** The running answer's own Stop is in view, so the composer's steps aside. */
  readonly stopCovered?: boolean;
  readonly composer: ComposerView;
  readonly commands: ConversationCommands;
  readonly focusSignal: number;
  readonly answerOnFocus: number;
}) {
  const statusId = useId();
  const { chip, acquisition } = composer;
  const statusText = composer.status.text || acquisition.text;
  const showProgress = !composer.status.text && acquisition.progress !== null;
  const showStatus = !!statusText || showProgress || composer.nextAction !== null;
  const compactPicker = chip.caption || chip.availability !== 'ready' || composer.route.status === 'queued';
  // Send says what one press does: send now, wait for a computer (up to 30 s), ask where to run, or nothing.
  const sendMode = composer.send.disabled ? 'none' : composer.send.mode;
  const sendLabel = sendMode === 'queue' ? t.sendWhenFound : sendMode === 'choose' ? t.chooseWhere : t.send;
  return (
    <Stack gap="sm">
      {showStatus && (
        <Stack gap="xs" data={{ 'data-composer-status-row': true }}>
          {(statusText || composer.nextAction) && (
            <Notice
              tone={showProgress ? 'pending' : 'neutral'}
              action={composer.nextAction ? <NextActionButton action={composer.nextAction} composer={composer} commands={commands} /> : undefined}
            >
              {statusText ? (
                <Text as="span" variant="small" id={statusId} data={composer.status.text ? { 'data-model-status': true } : { 'data-acquisition-status': true }}>
                  {statusText}
                </Text>
              ) : null}
            </Notice>
          )}
          {showProgress && acquisition.progress && (
            <Progress
              label={t.modelDownload}
              value={acquisition.progress.value ?? undefined}
              max={acquisition.progress.max ?? undefined}
              data={{ 'data-acquisition-progress': true }}
            />
          )}
        </Stack>
      )}
      {composer.executionSettingsReset && (
        <Text variant="small" muted data={{ 'data-execution-settings-reset': true }}>
          {t.settingsReset}
        </Text>
      )}
      {composer.attachmentHelp && (
        <Text variant="small" muted data={{ 'data-attachment-help': true }}>
          {composer.attachmentHelpText}
        </Text>
      )}
      <InputGroup activity="idle" data={{ 'data-composer-field': true, 'data-execution-source': chip.executionSource }}>
        {composer.files.length > 0 && (
          <Row gap="sm" data={{ 'data-attachments-preview': true }}>
            {composer.files.map((file, index) => (
              <Button key={`${file.name}-${index}`} variant="quiet" icon="close" label={file.name} accessibleLabel={t.removeFile(file.name)} onPress={() => commands.removeFile(index)} data={{ 'data-remove-file': index }} />
            ))}
          </Row>
        )}
        <TextArea
          bare
          rows={1}
          label={t.message}
          labelHidden
          placeholder={composer.placeholder}
          value={composer.draft}
          onChange={commands.setDraft}
          onSubmit={commands.send}
          focusSignal={focusSignal}
          describedBy={statusText ? statusId : undefined}
          data={{ 'data-composer-input': true }}
        />
        <Toolbar compact data={{ 'data-composer-toolbar': true }}>
          <FilePicker label={t.attach} accept={ACCEPT} multiple onFiles={commands.attach} data={{ 'data-composer-files': true }}>
            {(open) => (
              <IconButton
                label={t.attach}
                icon="attach"
                onPress={() => {
                  commands.showAttachmentHelp();
                  open();
                }}
                data={{ 'data-composer-attach': true }}
              />
            )}
          </FilePicker>
          {composer.search.visible && (
            <Button
              variant="quiet"
              icon="search"
              label={''}
              accessibleLabel={t.searchToggle}
              pressed={composer.search.pressed}
              onPress={commands.toggleSearch}
              data={{ 'data-search-toggle': true }}
            />
          )}
          {chip.visible && (
            <SelectorButton
              label={chip.label}
              status={compactPicker ? undefined : chip.availability}
              placeholder={compactPicker ? t.answerOn : undefined}
              compactLabel={compactPicker ? undefined : t.answerOn}
              parts={compactPicker ? [] : [
                { text: chip.source, data: { 'data-composer-model-source': true } },
                { text: chip.name, data: { 'data-composer-model-name': true } },
              ]}
              onPress={commands.openSheet}
              describedBy={statusText ? statusId : undefined}
              activity={chip.activity}
              focusSignal={answerOnFocus}
              data={{ 'data-open-model': true }}
            />
          )}
          <Button
            variant="quiet"
            icon="privacy"
            label={''}
            accessibleLabel={composer.privacy.label}
            title={composer.privacy.label}
            hasPopup="dialog"
            onPress={composer.privacy.disabled ? undefined : commands.openPrivacy}
            data={{ 'data-open-privacy': true }}
          />
          {composer.stop.visible ? (
            !stopCovered && <IconButton variant="primary" label={t.stop} icon="stop" onPress={commands.stop} data={{ 'data-composer-stop': true }} />
          ) : (
            <IconButton
              variant={sendMode === 'dispatch' ? 'primary' : 'quiet'}
              label={sendLabel}
              icon="send"
              describedBy={statusText ? statusId : undefined}
              onPress={sendMode === 'none' ? undefined : commands.send}
              data={{ 'data-composer-send': true, 'data-send-mode': sendMode }}
            />
          )}
        </Toolbar>
      </InputGroup>
    </Stack>
  );
}
