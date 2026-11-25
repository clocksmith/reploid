import { Badge, Button, List, ListItem, Section, Stack, Text, Toggle } from '@reploid/poolday-ui';
import type { ComputersState } from '../domain/computers';
import { strings } from '../../../l10n/strings';

const t = strings.computers;

/** This device's sharing, paired desktops and the contributor pool, as three sections. */
export function Computers({
  state,
  onSharing,
  onSharingFiles,
  onConnectDesktop,
  onOpenComputer,
}: {
  readonly state: ComputersState;
  readonly onSharing: (on: boolean) => void;
  readonly onSharingFiles: (on: boolean) => void;
  readonly onConnectDesktop: () => void;
  readonly onOpenComputer: (id: string) => void;
}) {
  return (
    <Stack gap="lg" data={{ 'data-computers': true }}>
      <Text variant="heading" as="h2">
        {t.title}
      </Text>
      <Section title={t.thisDevice} note={state.thisDeviceStatus}>
        <List>
          <Toggle title={t.shareConnection} status={t.shareConnectionStatus} checked={state.sharing} onChange={onSharing} icon="peers" />
          <Toggle title={t.shareFiles} status={t.shareFilesStatus} checked={state.sharingFiles} onChange={onSharingFiles} icon="download" />
        </List>
      </Section>
      <Section title={t.yours}>
        <List>
          {state.paired.length === 0 && <ListItem title={t.noneYet} icon="device" />}
          {state.paired.map((computer) => (
            <ListItem
              key={computer.id}
              icon="device"
              title={computer.name}
              status={computer.status}
              trailing={<Badge tone={computer.tone}>{computer.toneLabel}</Badge>}
              onPress={() => onOpenComputer(computer.id)}
              data={{ 'data-paired-computer': computer.id }}
            />
          ))}
        </List>
      </Section>
      <Stack gap="sm">
        <Button label={t.connectDesktop} icon="link" onPress={onConnectDesktop} data={{ 'data-connect-desktop': true }} />
      </Stack>
      <Section title={t.contributors} note={t.contributorsNote}>
        <List>
          <ListItem icon="peers" title={t.contributors} status={state.contributors} />
        </List>
      </Section>
    </Stack>
  );
}
