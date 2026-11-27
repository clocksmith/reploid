import { useState, useSyncExternalStore } from 'react';
import { Badge, Button, Disclosure, Field, List, ListItem, Row, Stack, StatusLine, Text, Toggle } from '@reploid/poolday-ui';
import type { SettingsServices, Store, WebSearchPort } from '../../domain/services';
import { settingsStrings as t } from '../../../../l10n/settings';

const useStore = <T,>(store: Store<T>) => useSyncExternalStore(store.subscribe, store.getState);
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** Built-in search keeps per-answer confirmation; a configured personal MCP server uses the stored on/off permission. */
export function WebSearchSettings({ port }: { readonly port: WebSearchPort }) {
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
export function AppShortcuts({ services }: { readonly services: SettingsServices }) {
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
