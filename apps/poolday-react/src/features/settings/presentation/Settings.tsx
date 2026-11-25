import { Badge, Button, List, ListItem, Section, SingleChoice, Stack, Text, Toggle } from '@reploid/poolday-ui';
import type { Appearance, Recipients, SettingsState } from '../domain/settings';
import { strings } from '../../../l10n/strings';

const t = strings.settings;

/** Appearance, privacy, who can read prompts and storage, one section each. */
export function Settings({
  state,
  onAppearance,
  onNetworkAnswers,
  onWebSearch,
  onRecipients,
  onClearData,
}: {
  readonly state: SettingsState;
  readonly onAppearance: (value: Appearance) => void;
  readonly onNetworkAnswers: (on: boolean) => void;
  readonly onWebSearch: (on: boolean) => void;
  readonly onRecipients: (value: Recipients) => void;
  readonly onClearData: () => void;
}) {
  return (
    <Stack gap="lg" data={{ 'data-settings': true }}>
      <Text variant="heading" as="h2">
        {t.title}
      </Text>
      <Section title={t.appearance}>
        <SingleChoice
          layout="segmented"
          label={t.appearance}
          value={state.appearance}
          onChange={onAppearance}
          options={[
            { value: 'system', title: t.system },
            { value: 'light', title: t.light },
            { value: 'dark', title: t.dark },
          ]}
        />
      </Section>
      <Section title={t.privacy}>
        <List>
          <Toggle title={t.networkAnswers} status={t.networkAnswersStatus} checked={state.networkAnswers} onChange={onNetworkAnswers} />
          <Toggle title={t.webSearch} status={t.webSearchStatus} checked={state.webSearch} onChange={onWebSearch} icon="search" />
        </List>
      </Section>
      <Section title={t.whoCanRead}>
        <SingleChoice
          label={t.whoCanRead}
          labelHidden
          value={state.recipients}
          onChange={onRecipients}
          options={[
            { value: 'anyone', title: t.anyone, status: t.anyoneStatus, icon: 'peers' },
            { value: 'own-devices', title: t.ownDevices, status: t.ownDevicesStatus, icon: 'privacy' },
          ]}
        />
      </Section>
      <Section title={t.storage} note={t.clearDataNote}>
        <List>
          {state.storedModels.map((model) => (
            <ListItem key={model.id} icon="model" title={model.name} status={model.size} trailing={<Badge>{t.storedModels}</Badge>} />
          ))}
          <ListItem title={t.storedModels} status={state.storageUsed} />
        </List>
        <Stack gap="sm">
          <Button label={t.clearData} onPress={onClearData} />
        </Stack>
      </Section>
    </Stack>
  );
}
