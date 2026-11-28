import type { ReactNode } from 'react';
import { BarButton, Workspace, WorkspaceBar } from '@reploid/poolday-ui';
import type { PageRoute } from '../features/shell/domain/routes';
import type { OpenedProduct } from '../features/shell/infrastructure/productHost';
import { hrefFor } from '../features/shell/infrastructure/workspaceLocation';
import { strings } from '../l10n/strings';
import type { AppServices } from './services';

const t = strings.workspace;

/** Open a primary destination from a specialist route. */
const go = (href: string) => () => window.location.assign(href);

/**
 * A specialist page inside the same 3-destination frame (Chat, Computers, Settings).
 */
export function RouteFrame({ route, children }: { readonly route: PageRoute; readonly product: OpenedProduct; readonly services: AppServices; readonly children: ReactNode }) {
  const chatHref = hrefFor({ view: 'chat', threads: false });
  const computersHref = hrefFor({ view: 'computers', threads: false });
  const settingsHref = hrefFor({ view: 'settings', threads: false });
  return (
    <Workspace
      scroll
      data={{ 'data-route-page': route }}
      bar={
        <WorkspaceBar
          label={t.destinations}
          data={{ 'data-app-bar': true }}
          lead={
            <>
              <BarButton icon="chat" label={t.chat} href={chatHref} onPress={go(chatHref)} data={{ 'data-workspace-view': 'chat', 'data-pool-route-link': '/' }} />
              <BarButton icon="peers" label={t.computers} href={computersHref} onPress={go(computersHref)} data={{ 'data-workspace-view': 'computers', 'data-open-network': true }} />
            </>
          }
        >
          <BarButton icon="settings" label={t.settings} href={settingsHref} onPress={go(settingsHref)} data={{ 'data-workspace-view': 'settings' }} />
        </WorkspaceBar>
      }
    >
      {children}
    </Workspace>
  );
}
