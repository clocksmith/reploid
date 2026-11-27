import { useSyncExternalStore } from 'react';
import { Stack, Text } from '@reploid/poolday-ui';
import type { RoomServices } from '../domain/rooms';
import { rooms as t } from '../../../l10n/rooms';
import { ResearchRoom } from './sections/ResearchRoom';
import { ResearchWorkspace } from './ResearchWorkspace';
import { RoomRequest } from './sections/RoomRequest';

/** Research Room-1: the request, the active room, any opened review or discovery panel, and the research workspace. */
export function RoomPage({ services }: { readonly services: RoomServices }) {
  const view = useSyncExternalStore(services.subscribe, services.getSnapshot);
  return (
    <Stack gap="lg" data={{ 'data-route-page-content': 'room-1' }}>
      <Stack gap="xs" data={{ 'data-pool-page-heading': true }}>
        <Text variant="title" as="h1">
          {view.title}
        </Text>
        <Text muted>{view.body}</Text>
      </Stack>
      <RoomRequest view={view} services={services} />
      <ResearchRoom room={view.room} view={view} services={services} />
      {view.contextual && (
        <Stack gap="xs" data={{ 'data-pool-room-contextual-panel': view.panel }}>
          <Text variant="subheading" as="h2">
            {view.contextual.title}
          </Text>
          <Text variant="small">{view.contextual.body}</Text>
        </Stack>
      )}
      <Stack gap="md" data={{ 'data-pool-room-panel': 'research', 'data-pool-room-panel-open': String(view.panel !== 'overview') }}>
        <Text variant="heading" as="h2">
          {t.workspace}
        </Text>
        <ResearchWorkspace view={view} services={services} />
      </Stack>
    </Stack>
  );
}
