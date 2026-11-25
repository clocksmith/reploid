import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  Badge,
  Button,
  Dialog,
  Disclosure,
  Field,
  FilePicker,
  List,
  ListItem,
  Row,
  Section,
  SingleChoice,
  Stack,
  StatusLine,
  Text,
  Toggle,
} from '@reploid/poolday-ui';
import type {
  AppearancePort,
  CreditAccountPort,
  FileMode,
  FileSharingSelection,
  ImportPlan,
  SettingsServices,
  Store,
  StoredDownload,
  WebSearchPort,
} from '../domain/services';
import { settingsStrings as t } from '../../../l10n/settings';

const useStore = <T,>(store: Store<T>) => useSyncExternalStore(store.subscribe, store.getState);
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/**
 * The Settings drawer: appearance, answer preference, storage and file sharing, this browser's data, credits, and
 * the advanced network answers, web search and app shortcuts. Every effect is the host's; this screen reports it.
 */
export function SettingsPanel({
  services,
  appearance,
}: {
  readonly services: SettingsServices;
  readonly appearance: AppearancePort;
  /** Opens Computers; the workspace shows its own Computers destination, so Settings offers no second one. */
  readonly onOpenComputers?: () => void;
}) {
  const snapshot = useStore(services.snapshot);
  // The Advanced disclosure opens when the answer preference's fix asks for Network answers.
  const [advanced, setAdvanced] = useState(0);
  return (
    <Stack gap="xl" data={{ 'data-settings': true }}>
      <AppearanceSection appearance={appearance} />
      <Section title={t.routing} note={t.routingNote} data={{ 'data-settings-routing': true }}>
        <SingleChoice
          layout="segmented"
          label={t.routingLabel}
          value={snapshot.routePreference.options.find((option) => option.checked)?.value ?? null}
          onChange={(value) => services.setRoutePreference(value)}
          options={snapshot.routePreference.options.map((option) => ({
            value: option.value,
            title: option.label,
            disabled: option.disabled,
            data: { 'data-route-preference': option.value },
          }))}
        />
        <Row justify="between" gap="sm">
          <StatusLine data={{ 'data-route-preference-reason': true }}>{snapshot.routePreference.reason}</StatusLine>
          {snapshot.routePreference.fix && (
            <Button variant="quiet" label={snapshot.routePreference.fix.label} onPress={() => setAdvanced((value) => value + 1)} data={{ 'data-route-preference-fix': true }} />
          )}
        </Row>
      </Section>
      <StorageSection services={services} />
      {services.localData && <LocalDataSection port={services.localData} />}
      <CreditsSection account={services.creditAccount} />
      <Section title={t.advanced}>
        <List>
          <Disclosure key={advanced} quiet defaultOpen={advanced > 0} summary={t.advancedSummary} data={{ 'data-settings-advanced': true }}>
            <Stack gap="md">
              {snapshot.remoteAnswers && (
                <Toggle
                  icon="peers"
                  title={t.networkAnswers}
                  status={snapshot.remoteAnswers.status}
                  checked={snapshot.remoteAnswers.enabled}
                  onChange={(on) => void services.setRemoteAnswersEnabled(on)}
                  data={{ 'data-remote-permission-settings': true, 'data-remote-answers-toggle': true }}
                />
              )}
              {services.webSearch && <WebSearchSettings port={services.webSearch} />}
              <AppShortcuts services={services} />
            </Stack>
          </Disclosure>
        </List>
      </Section>
    </Stack>
  );
}

function AppearanceSection({ appearance }: { readonly appearance: AppearancePort }) {
  const choice = useSyncExternalStore(appearance.subscribe, appearance.getChoice);
  return (
    <Section title={t.appearance} data={{ 'data-settings-appearance': true }}>
      <SingleChoice
        layout="segmented"
        label={t.appearance}
        value={choice}
        onChange={(value) => appearance.setChoice(value)}
        options={(['system', 'light', 'dark'] as const).map((value) => ({ value, title: t[value], data: { 'data-pool-theme-choice': value } }))}
      />
    </Section>
  );
}

function StorageSection({ services }: { readonly services: SettingsServices }) {
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
              data={{ 'data-file-sharing-row': true, 'data-toggle-file-contribution': true }}
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

function LocalDataSection({ port }: { readonly port: NonNullable<SettingsServices['localData']> }) {
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

/** Credits appear only when the page's server publishes an earning service (host/credits/browser.js). */
function CreditsSection({ account }: { readonly account: Promise<CreditAccountPort | null> }) {
  const [port, setPort] = useState<CreditAccountPort | null>(null);
  const [failure, setFailure] = useState('');
  useEffect(() => {
    let current = true;
    account.then(
      (opened) => current && setPort(opened),
      (cause: unknown) => current && setFailure(message(cause)),
    );
    return () => {
      current = false;
    };
  }, [account]);
  if (!port) return failure ? <StatusLine data={{ 'data-earning-status': true }}>{failure}</StatusLine> : null;
  return <CreditAccount port={port} />;
}

function CreditAccount({ port }: { readonly port: CreditAccountPort }) {
  const account = useStore(port.account);
  const [limit, setLimit] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const report = (work: Promise<unknown>) => void work.catch((cause: unknown) => setStatus(message(cause)));
  return (
    <Section title={t.credits} data={{ 'data-earning-account': true }}>
      <List>
        <Stack gap="sm" data={{ 'data-earning-sign-in': true }}>
          {port.local ? <LocalSignIn port={port} onError={setStatus} /> : <EmailSignIn port={port} />}
        </Stack>
        {account.ready && (
          <Stack gap="sm" data={{ 'data-earning-ready': true }}>
            <StatusLine muted={false} data={{ 'data-earning-balance': true }}>
              {account.balance}
            </StatusLine>
            {account.topUps.length > 0 && (
              <Row data={{ 'data-earning-top-ups': true }}>
                {account.topUps.map((topUp) => (
                  <Button key={topUp.id} label={topUp.label} onPress={() => report(port.topUp(topUp.id))} data={{ 'data-earning-top-up': topUp.id }} />
                ))}
              </Row>
            )}
            {account.checkout && (
              <Text variant="small" muted data={{ 'data-earning-checkout': true }}>
                {account.checkout}
              </Text>
            )}
            <Field
              type="number"
              label={t.spendLimit}
              hint={t.spendLimitNote}
              value={limit ?? (account.spendingLimit === null ? '' : String(account.spendingLimit))}
              onChange={setLimit}
              data={{ 'data-earning-limit': true }}
            />
            <Row>
              <Button
                label={t.saveLimit}
                onPress={() => {
                  port.setSpendingLimit(limit ?? (account.spendingLimit === null ? '' : String(account.spendingLimit)));
                  setLimit(null);
                }}
                data={{ 'data-earning-limit-save': true }}
              />
            </Row>
            {account.quote !== '' && (
              <Text variant="small" muted data={{ 'data-earning-quote': true }}>
                {account.quote}
              </Text>
            )}
            <Disclosure quiet summary={t.recentActivity} data={{ 'data-earning-activity': true }}>
              <List data={{ 'data-earning-journal': true }}>
                {account.journal.length === 0 ? (
                  <ListItem title={t.noActivity} />
                ) : (
                  account.journal.map((entry) => <ListItem key={entry.id} title={entry.text} data={{ 'data-earning-entry': entry.type }} />)
                )}
              </List>
            </Disclosure>
            {port.local && (
              <Row>
                <Button variant="quiet" label={t.signOut} onPress={() => report(port.accountSignOut())} data={{ 'data-earning-sign-out': true }} />
              </Row>
            )}
          </Stack>
        )}
      </List>
      <StatusLine data={{ 'data-earning-status': true }}>{status || account.status}</StatusLine>
    </Section>
  );
}

function LocalSignIn({ port, onError }: { readonly port: CreditAccountPort; readonly onError: (text: string) => void }) {
  const signedIn = useStore(port.localSignedIn);
  const [name, setName] = useState('');
  if (signedIn)
    return (
      <Text variant="small" muted data={{ 'data-earning-local-signed-in': true }}>
        {signedIn}
      </Text>
    );
  return (
    <Stack gap="xs" data={{ 'data-earning-local-form': true }}>
      <Text variant="small" muted>
        {t.localSignInNote}
      </Text>
      <Field label={t.name} value={name} onChange={setName} autoComplete="username" required data={{ 'data-earning-local-subject': true }} />
      <Row>
        <Button label={t.signIn} onPress={() => void port.useSubject(name).catch((cause: unknown) => onError(message(cause)))} data={{ 'data-earning-local-submit': true }} />
      </Row>
    </Stack>
  );
}

/** Sign-in through a one-time link sent to the person's email; the address goes to Supabase, which sends it. */
function EmailSignIn({ port }: { readonly port: CreditAccountPort }) {
  const view = useStore(port.signIn);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  return (
    <Stack gap="sm" data={{ 'data-account-sign-in': true }}>
      <Text variant="subheading" as="h3">
        {t.account}
      </Text>
      <Text variant="small" muted data={{ 'data-account-sign-in-summary': true }}>
        {view.summary}
      </Text>
      {view.formShown && (
        <Stack gap="xs" data={{ 'data-account-sign-in-form': true }}>
          <Field type="email" label={t.email} value={email} onChange={setEmail} autoComplete="email" required data={{ 'data-account-sign-in-email': true }} />
          <Row>
            <Button
              label={t.sendLink}
              onPress={view.sendDisabled ? undefined : () => void port.requestLink(email).catch((cause: unknown) => setStatus(message(cause)))}
              data={{ 'data-account-sign-in-send': true }}
            />
          </Row>
        </Stack>
      )}
      {view.signedIn && (
        <Row data={{ 'data-account-signed-in': true }}>
          <Button variant="quiet" label={t.signOut} onPress={() => void port.signOut().catch((cause: unknown) => setStatus(message(cause)))} data={{ 'data-account-sign-out': true }} />
        </Row>
      )}
      <StatusLine data={{ 'data-account-sign-in-status': true }}>{status ?? view.message}</StatusLine>
    </Stack>
  );
}

/** Built-in search keeps per-answer confirmation; a configured personal MCP server uses the stored on/off permission. */
function WebSearchSettings({ port }: { readonly port: WebSearchPort }) {
  const view = useStore(port);
  const [url, setUrl] = useState<string | null>(null);
  const [tool, setTool] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [config, setConfig] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const attempt = (work: () => void) => {
    try {
      setStatus(null);
      work();
    } catch (cause) {
      setStatus(message(cause));
    }
  };
  return (
    <Stack gap="sm" data={{ 'data-web-search-settings': true }}>
      <Toggle
        icon="search"
        title={t.webSearch}
        status={view.reason}
        checked={view.enabled}
        disabled={view.disabled}
        onChange={(on) => attempt(() => port.setEnabled(on))}
        data={{ 'data-web-search-toggle': true }}
      />
      {view.fix && (
        <Row>
          <Button variant="quiet" label={view.fix} onPress={() => setConfig((value) => value + 1)} data={{ 'data-web-search-fix': true }} />
        </Row>
      )}
      <Disclosure key={`disclosure-${view.enabled}`} quiet defaultOpen={view.enabled} summary={t.whoReceivesSearch} data={{ 'data-search-disclosure-details': true }}>
        <Text variant="small" muted data={{ 'data-web-search-disclosure': true }}>
          {view.disclosure}
        </Text>
      </Disclosure>
      <Disclosure key={`config-${config}`} quiet defaultOpen={config > 0} summary={t.searchServer} data={{ 'data-web-search-config': true }}>
        <Stack gap="sm">
          <Field type="url" label={t.serverUrl} placeholder="https://" value={url ?? view.url} onChange={setUrl} autoComplete="off" autoFocus={config > 0} data={{ 'data-web-search-url': true }} />
          <Field type="password" label={t.token} placeholder={view.tokenPlaceholder} value={token} onChange={setToken} autoComplete="off" data={{ 'data-web-search-token': true }} />
          <Field label={t.tool} placeholder={t.toolPlaceholder} value={tool ?? view.tool} onChange={setTool} autoComplete="off" data={{ 'data-web-search-tool': true }} />
          <Row justify="end">
            <Button variant="quiet" label={t.checkServer} onPress={() => attempt(port.check)} data={{ 'data-web-search-check': true }} />
            <Button
              label={t.save}
              onPress={() =>
                attempt(() => {
                  port.configure({ url: url ?? view.url, tool: tool ?? view.tool, token });
                  setToken('');
                  setUrl(null);
                  setTool(null);
                })
              }
              data={{ 'data-web-search-save': true }}
            />
          </Row>
          <StatusLine data={{ 'data-web-search-status': true }}>{status ?? view.status}</StatusLine>
        </Stack>
      </Disclosure>
    </Stack>
  );
}

/** Changes, Examples and Experiments: routes outside the workspace. */
function AppShortcuts({ services }: { readonly services: SettingsServices }) {
  const awaiting = useStore(services.changesAwaiting);
  const titles = { improve: t.changes, examples: t.examples, experiments: t.experiments } as const;
  const icons = { improve: 'activity', examples: 'copy', experiments: 'model' } as const;
  return (
    <Stack gap="xs" data={{ 'data-settings-apps': true }}>
      <Text variant="label" muted>
        {t.apps}
      </Text>
      <List>
        {services.apps.map((app) => (
          <ListItem
            key={app.id}
            icon={icons[app.id]}
            title={titles[app.id]}
            href={app.href}
            label={app.id === 'improve' && awaiting > 0 ? t.changesAwaiting(awaiting) : undefined}
            trailing={app.id === 'improve' && awaiting > 0 ? <Badge tone="pending">{String(awaiting)}</Badge> : undefined}
            data={{ 'data-pool-route-link': app.href, 'data-pool-nav-id': app.id, 'data-pool-changes': app.id === 'improve' }}
          />
        ))}
      </List>
    </Stack>
  );
}
