import { useState, useSyncExternalStore } from 'react';
import { Button, Disclosure, List, Row, Section, SingleChoice, Stack, StatusLine, Toggle } from '@reploid/poolday-ui';
import type { AppearancePort, SettingsServices, Store } from '../domain/services';
import { settingsStrings as t } from '../../../l10n/settings';
import { AppShortcuts, WebSearchSettings } from './sections/SettingsAdvancedSection';
import { CreditsSection } from './sections/SettingsCreditsSection';
import { LocalDataSection } from './sections/SettingsLocalDataSection';
import { StorageSection } from './sections/SettingsStorageSection';

const useStore = <T,>(store: Store<T>) => useSyncExternalStore(store.subscribe, store.getState);

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
