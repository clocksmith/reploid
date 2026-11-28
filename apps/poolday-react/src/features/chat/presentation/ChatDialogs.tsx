import { Button, Dialog, Disclosure, Field, MultiChoice, Section, SingleChoice, Stack, Text, Toggle } from '@reploid/poolday-ui';
import type { ConversationCommands, ConversationSnapshot, DownloadView, PrivacyView } from '../domain/conversation';
import { conversation as t } from '../../../l10n/conversation';

/**
 * "Who can read it?": shows the working route and participant choices up front with concise labels,
 * and folds unavailable/research-gated options and extended notes into disclosures so the dialog
 * stays scannable. Nothing changes until Apply.
 */
export function PrivacyDialog({ privacy, commands, presentation = 'modal' }: { readonly privacy: PrivacyView; readonly commands: ConversationCommands; readonly presentation?: 'modal' | 'inline' }) {
  const availableProtections = privacy.protections.filter((option) => !option.disabled || option.value === privacy.protection);
  const unavailableProtections = privacy.protections.filter((option) => option.disabled && option.value !== privacy.protection);
  const availableRoutes = privacy.routes.filter((option) => !option.disabled || option.value === privacy.route);
  const unavailableRoutes = privacy.routes.filter((option) => option.disabled && option.value !== privacy.route);
  const unavailableCount = unavailableProtections.length + unavailableRoutes.length;

  return (
    <Dialog
      title={t.privacy.title}
      open={privacy.open}
      presentation={presentation}
      onClose={commands.closePrivacy}
      closeLabel={t.close}
      data={{ 'data-privacy-dialog': true }}
      footerStatus={privacy.error ? <Text as="span" variant="small" data={{ 'data-privacy-error': true }}>{privacy.error}</Text> : undefined}
      footer={
        <>
          <Button variant="quiet" label={t.cancel} onPress={commands.closePrivacy} data={{ 'data-privacy-cancel': true }} />
          <Button
            variant="primary"
            label={t.privacy.apply}
            pending={privacy.applying}
            onPress={privacy.editable && !privacy.applying ? commands.applyPrivacy : undefined}
            data={{ 'data-privacy-apply': true }}
          />
        </>
      }
    >
      <Stack gap="md">
        <SingleChoice
          label={t.privacy.route}
          value={privacy.route}
          onChange={(value) => commands.pickRoute(value)}
          options={availableRoutes.map((option) => ({ ...option, inputData: { 'data-privacy-route': true }, statusData: { 'data-route-status': option.value } }))}
          data={{ 'data-privacy-controls': true, 'data-route-choices': true }}
        />
        <Section title={t.privacy.participants}>
          <Toggle
            title={privacy.ownDevicesOption.title}
            status={privacy.ownDevicesOption.status}
            checked={privacy.ownDevices}
            disabled={privacy.ownDevicesOption.disabled}
            onChange={commands.setOwnDevices}
            controlData={{ 'data-privacy-own-devices': true }}
            data={{ 'data-participant-choices': true }}
          />
        </Section>
        <SingleChoice
          label={t.privacy.protection}
          value={privacy.protection}
          onChange={(value) => commands.pickProtection(value)}
          options={availableProtections.map((option) => ({
            ...option,
            inputData: { 'data-privacy-protection': true },
            statusData: { 'data-protection-status': option.value },
          }))}
          data={{ 'data-privacy-controls': true, 'data-protection-choices': true }}
        />
        {privacy.splitNote !== '' && (
          <Text variant="caption" muted data={{ 'data-split-note': true }}>
            {privacy.splitNote}
          </Text>
        )}
        <Text variant="caption" muted>
          {t.privacy.newOnly}
        </Text>
        {unavailableCount > 0 && (
          <Disclosure quiet summary="Unavailable options" status={String(unavailableCount)} data={{ 'data-privacy-unavailable': true }}>
            <Stack gap="xs">
              {unavailableProtections.map((option) => (
                <Text key={option.value} variant="caption" muted data={{ 'data-protection-status': option.value }}>
                  {`${option.title} — ${option.status}`}
                </Text>
              ))}
              {unavailableRoutes.map((option) => (
                <Text key={option.value} variant="caption" muted data={{ 'data-route-status': option.value }}>
                  {`${option.title} — ${option.status}`}
                </Text>
              ))}
            </Stack>
          </Disclosure>
        )}
        <Disclosure quiet summary={t.privacy.whatElse} data={{ 'data-privacy-detail': true }}>
          {(['standard', 'own-devices'] as const).map((name) => (
            <Text key={name} variant="small" muted hidden={name !== privacy.preset} data={{ 'data-preset-note': name }}>
              {privacy.notes[name]}
            </Text>
          ))}
        </Disclosure>
      </Stack>
    </Dialog>
  );
}

/** The reviewed download: its size is checked and shown before anything downloads, and the sharing choices apply with it. */
export function DownloadDialog({ download, commands, presentation = 'modal' }: { readonly download: DownloadView | null; readonly commands: ConversationCommands; readonly presentation?: 'modal' | 'inline' }) {
  return (
    <Dialog
      title={download?.title ?? ''}
      open={!!download?.open}
      onClose={commands.closeDownload}
      closeLabel={t.close}
      presentation={presentation}
      headingData={{ 'data-download-title': true }}
      data={{ 'data-model-dialog': true }}
      footerStatus={<Text as="span" variant="small" muted data={{ 'data-download-size': true }}>{download?.size ?? ''}</Text>}
      footer={
        <>
          {download?.retry && <Button variant="quiet" label={t.download.retry} onPress={commands.retryDownloadCheck} data={{ 'data-retry-download-check': true }} />}
          <Button variant="quiet" label={t.cancel} onPress={commands.closeDownload} data={{ 'data-download-cancel': true }} />
          <Button variant="primary" label={download?.confirm ?? ''} onPress={download?.ready ? commands.confirmDownload : undefined} data={{ 'data-download-confirm': true }} />
        </>
      }
    >
      {download && (
        <Stack gap="md">
          {download.choose && (
            <SingleChoice
              label={t.download.model}
              value={download.modelId}
              onChange={(value) => commands.selectDownloadModel(value)}
              options={download.models.map((model) => ({ value: model.value, title: model.title }))}
              data={{ 'data-download-model': true }}
            />
          )}
          <MultiChoice
            label={t.download.sharing}
            values={download.sharingValues}
            onChange={(values) => commands.setDownloadSharing(values)}
            options={download.sharing.map((option) => ({ ...option, data: { [`data-download-${option.value}`]: true } }))}
            data={{ 'data-download-sharing': true }}
          />
          <Text variant="small" muted data={{ 'data-download-explanation': true }}>
            {download.explanation}
          </Text>
          {download.fit !== '' && (
            <Text variant="small" muted data={{ 'data-download-fit': true }}>
              {download.fit}
            </Text>
          )}
        </Stack>
      )}
    </Dialog>
  );
}

/** Rename a thread: one field, Save or Cancel. */
export function RenameDialog({ rename, commands, presentation = 'modal' }: { readonly rename: ConversationSnapshot['rename']; readonly commands: ConversationCommands; readonly presentation?: 'modal' | 'inline' }) {
  return (
    <Dialog
      title={t.rename.title}
      open={rename.open}
      onClose={commands.closeRename}
      closeLabel={t.close}
      presentation={presentation}
      data={{ 'data-rename-dialog': true }}
      footer={
        <>
          <Button variant="quiet" label={t.cancel} onPress={commands.closeRename} data={{ 'data-rename-cancel': true }} />
          <Button variant="primary" label={t.rename.save} onPress={rename.value.trim() ? commands.saveRename : undefined} data={{ 'data-rename-save': true }} />
        </>
      }
    >
      <Field label={t.rename.name} value={rename.value} onChange={commands.setRenameValue} required maxLength={256} autoFocus={presentation !== 'inline'} data={{ 'data-thread-name': true }} />
    </Dialog>
  );
}

/** A conversation that needs permission to reach another computer: what is sent, to whom, Allow or Cancel. */
export function RemotePermissionDialog({ permission, commands, presentation = 'modal' }: { readonly permission: ConversationSnapshot['remotePermission']; readonly commands: ConversationCommands; readonly presentation?: 'modal' | 'inline' }) {
  return (
    <Dialog
      title={permission?.title ?? ''}
      open={!!permission}
      onClose={commands.declineRemote}
      closeLabel={t.cancel}
      presentation={presentation}
      data={{ 'data-remote-permission': true }}
      footer={
        <>
          <Button variant="quiet" label={t.cancel} onPress={commands.declineRemote} data={{ 'data-remote-permission-decline': true }} />
          <Button variant="primary" label={t.remote.allow} onPress={commands.allowRemote} data={{ 'data-remote-permission-allow': true }} />
        </>
      }
    >
      {permission && (
        <Stack gap="sm">
          <Text>{permission.what}</Text>
          <Text variant="small" muted>
            {`${t.remote.recipient} `}
            <Text as="code" variant="small" mono>
              {permission.recipient}
            </Text>
          </Text>
        </Stack>
      )}
    </Dialog>
  );
}
