import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Dialog, Disclosure, Field, List, ListItem, Section, SingleChoice, Stack, StatusLine, Text, Toggle } from '@reploid/poolday-ui';
import type { FileMode, FileSharingSelection, SettingsServices, Store, StoredDownload } from '../../domain/services';
import { settingsStrings as t } from '../../../../l10n/settings';

const useStore = <T,>(store: Store<T>) => useSyncExternalStore(store.subscribe, store.getState);
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export function StorageSection({ services }: { readonly services: SettingsServices }) {
  const snapshot = useStore(services.snapshot);
  const storage = services.storage;
  const [rows, setRows] = useState<ReadonlyArray<StoredDownload>>([]);
  const [status, setStatus] = useState('');
  const [revision, setRevision] = useState(0);
  const [removing, setRemoving] = useState<StoredDownload | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<FileSharingSelection>({ modelId: null, mode: 'cached-only', allowance: null });
  const files = snapshot.fileSharing(selection);

  // Settings measures storage each time it opens, and on Refresh.
  useEffect(() => {
    if (!storage) return undefined;
    let current = true;
    setStatus('Checking stored files…');
    storage.list().then(
      (list) => {
        if (!current) return;
        setRows(list);
        setStatus(list.length ? 'Measured stored files, including partial downloads. Shared files may count toward more than one model.' : 'No model downloads stored. Choose a model in Answer on to download one.');
      },
      (cause: unknown) => current && setStatus(message(cause)),
    );
    return () => {
      current = false;
    };
  }, [storage, revision]);

  const confirmRemove = () => {
    if (!storage || !removing || busy) return;
    setBusy(true);
    storage.remove(removing.id).then(
      () => {
        setRemoving(null);
        setRevision((value) => value + 1);
      },
      (cause: unknown) => setRemoveError(message(cause)),
    ).finally(() => setBusy(false));
  };

  return (
    <Section title={t.storage} data={{ 'data-settings-storage': true }}>
      <List>
        {storage ? (
          <Stack gap="sm" data={{ 'data-model-storage': true }}>
            {rows.length > 0 && (
              <Stack gap="sm" data={{ 'data-stored-models': true }}>
                {rows.map((row) => (
                  <ListItem
                    key={row.id}
                    title={row.label}
                    trailing={
                      <Button
                        variant="quiet"
                        label={t.remove}
                        accessibleLabel={t.removeModel(row.name)}
                        onPress={() => {
                          setRemoveError(null);
                          setRemoving(row);
                        }}
                        data={{ 'data-storage-remove': row.id }}
                      />
                    }
                    data={{ 'data-stored-model': row.id }}
                  />
                ))}
              </Stack>
            )}
            <ListItem
              title={<StatusLine data={{ 'data-storage-status': true }}>{status}</StatusLine>}
              trailing={<Button variant="quiet" label={t.refresh} onPress={() => setRevision((value) => value + 1)} data={{ 'data-storage-refresh': true }} />}
            />
          </Stack>
        ) : (
          <Text variant="small" muted data={{ 'data-settings-storage-summary': true }}>
            {snapshot.storageSummary}
          </Text>
        )}
        {files && (
          <>
            <Toggle
              icon="copy"
              title={t.shareFiles}
              status={files.status}
              checked={files.enabled}
              disabled={files.toggleDisabled}
              onChange={() => void services.toggleFileSharing({ ...selection, modelId: files.modelId, allowance: files.allowance })}
              controlData={{ 'data-toggle-file-contribution': true }}
              data={{ 'data-file-sharing-row': true }}
            />
            {files.progress !== '' && (
              <StatusLine muted={false} data={{ 'data-file-progress': true }}>
                {files.progress}
              </StatusLine>
            )}
            <Disclosure quiet summary={t.downloadOptions} data={{ 'data-model-sharing-limits': true }}>
              <Stack gap="md">
                <SingleChoice
                  label={t.model}
                  value={files.modelId}
                  disabled={files.modelDisabled}
                  onChange={(modelId) => setSelection((current) => ({ ...current, modelId }))}
                  options={files.models.map((model) => ({ value: model.id, title: model.name, data: { 'data-contribution-model': model.id } }))}
                  data={{ 'data-contribution-models': true }}
                />
                <SingleChoice<FileMode>
                  label={t.filesToShare}
                  value={files.mode}
                  onChange={(mode) => setSelection((current) => ({ ...current, mode }))}
                  options={files.modes.map((mode) => ({ value: mode.value, title: mode.title, status: mode.status, disabled: mode.disabled, inputData: { 'data-file-mode': mode.value } }))}
                />
                {files.allowanceShown && (
                  <Field
                    type="number"
                    label={t.allowance}
                    value={files.allowance}
                    disabled={files.allowanceDisabled}
                    onChange={(allowance) => setSelection((current) => ({ ...current, allowance }))}
                    data={{ 'data-file-download': true }}
                  />
                )}
                <Text variant="caption" muted data={{ 'data-file-download-policy': true }}>
                  {t.allowancePolicy}
                </Text>
                <Text variant="small" data={{ 'data-file-limits': true }}>
                  {files.limits}
                </Text>
              </Stack>
            </Disclosure>
          </>
        )}
      </List>
      <Dialog
        title={t.removeTitle}
        open={removing !== null}
        onClose={() => setRemoving(null)}
        closeLabel={t.close}
        data={{ 'data-storage-dialog': true }}
        footerStatus={removeError ? <Text as="span" variant="small" data={{ 'data-storage-remove-error': true }}>{removeError}</Text> : undefined}
        footer={
          <>
            <Button variant="quiet" label={t.cancel} onPress={() => setRemoving(null)} data={{ 'data-storage-cancel': true }} />
            <Button variant="primary" label={t.removeConfirm} onPress={busy ? undefined : confirmRemove} data={{ 'data-storage-confirm': true }} />
          </>
        }
      >
        <Stack gap="sm">
          <Text data={{ 'data-storage-remove-name': true }}>{removing?.name ?? ''}</Text>
          <Text variant="small" muted>
            {t.removeNote}
          </Text>
        </Stack>
      </Dialog>
    </Section>
  );
}
