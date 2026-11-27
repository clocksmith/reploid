import { useState } from 'react';
import { Button, Dialog, FilePicker, List, ListItem, Section, Stack, StatusLine, Text } from '@reploid/poolday-ui';
import type { ImportPlan, SettingsServices } from '../../domain/services';
import { settingsStrings as t } from '../../../../l10n/settings';

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export function LocalDataSection({ port }: { readonly port: NonNullable<SettingsServices['localData']> }) {
  const [status, setStatus] = useState('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const guard = (work: () => Promise<void> | void) => {
    Promise.resolve().then(work).catch((cause: unknown) => setStatus(message(cause)));
  };
  return (
    <Section title={t.yourData} note={t.dataNote} data={{ 'data-settings-data': true }}>
      <List>
        <ListItem icon="download" title={t.exportData} status={t.exportStatus} onPress={() => guard(() => setStatus(port.exportFile()))} data={{ 'data-data-export': true }} />
        <FilePicker
          label={t.dataFile}
          accept=".json,application/json"
          onFiles={([file]) =>
            guard(async () => {
              if (!file) return;
              const next = await port.plan(file);
              if (next.empty) {
                setPlan(null);
                setStatus(`${next.summary} ${t.nothingToImport}`);
                return;
              }
              setError(null);
              setPlan(next);
            })
          }
          data={{ 'data-data-file': true }}
        >
          {(open) => (
            <ListItem
              icon="upload"
              title={t.importData}
              status={t.importStatus}
              onPress={() => {
                setStatus('');
                open();
              }}
              data={{ 'data-data-import': true }}
            />
          )}
        </FilePicker>
      </List>
      {status !== '' && <StatusLine data={{ 'data-data-status': true }}>{status}</StatusLine>}
      <Dialog
        title={t.importTitle}
        open={plan !== null}
        onClose={() => setPlan(null)}
        closeLabel={t.close}
        data={{ 'data-data-dialog': true }}
        footerStatus={error}
        footer={
          <>
            <Button variant="quiet" label={t.cancel} onPress={() => setPlan(null)} data={{ 'data-data-cancel': true }} />
            <Button
              variant="primary"
              label={t.importConfirm}
              onPress={() => {
                if (!plan) return;
                try {
                  const done = plan.apply();
                  setPlan(null);
                  setStatus(done);
                } catch (cause) {
                  setError(message(cause));
                }
              }}
              data={{ 'data-data-confirm': true }}
            />
          </>
        }
      >
        <Stack gap="sm">
          <Text data={{ 'data-data-summary': true }}>{plan?.summary ?? ''}</Text>
          <Text variant="small" muted>
            {t.importNote}
          </Text>
        </Stack>
      </Dialog>
    </Section>
  );
}
