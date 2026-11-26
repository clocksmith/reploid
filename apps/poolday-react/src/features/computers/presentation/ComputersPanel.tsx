import { useEffect, useState, useSyncExternalStore } from 'react';
import { Notice, Stack } from '@reploid/poolday-ui';
import type { ComputersFilter, ComputersServices } from '../domain/services';
import { FleetAccount } from './FleetAccount';
import { PublicNetwork } from './PublicNetwork';
import { ThisComputer } from './ThisComputer';
import { YourComputers } from './YourComputers';

export type { ComputersFilter };
export { PairingLinkDialog } from './PairingLinkDialog';

/**
 * The Computers drawer: your account, your computers, the public network and this computer. `filter` narrows the
 * roster to the computers serving one model (from Answer on); Show all computers clears it. `onStartSharing` opens
 * the reviewed download and sharing dialog for a model, or for no model in particular. `selectedModel` is the
 * selection the composer would send with: each computer on the public network is judged against it.
 */
export function ComputersPanel({
  services,
  filter,
  selectedModel = null,
  onClearFilter,
  onStartSharing = () => undefined,
}: {
  readonly services: ComputersServices;
  readonly filter: ComputersFilter | null;
  readonly selectedModel?: string | null;
  readonly onClearFilter: () => void;
  readonly onStartSharing?: (modelId: string | null) => void;
}) {
  useEffect(() => services.setFilter(filter), [services, filter]);
  useEffect(() => services.setSelectedModel(selectedModel), [services, selectedModel]);
  const view = useSyncExternalStore(services.subscribe, services.getView);
  const [error, setError] = useState('');
  return (
    <Stack gap="xl" data={{ 'data-computers': true }}>
      <FleetAccount view={view.fleet} services={services} />
      <YourComputers view={view} services={services} />
      <PublicNetwork view={view} services={services} onClearFilter={onClearFilter} onError={setError} />
      <ThisComputer view={view} services={services} onStartSharing={onStartSharing} />
      <Notice data={{ 'data-network-message': true }}>{view.message || null}</Notice>
      <Notice tone="error" data={{ 'data-inspector-error': true }}>
        {error || null}
      </Notice>
    </Stack>
  );
}
