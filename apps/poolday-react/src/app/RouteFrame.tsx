import type { ReactNode } from 'react';
import { BarButton, BrandLink, Workspace, WorkspaceBar } from '@reploid/poolday-ui';
import type { PageRoute } from '../features/shell/domain/routes';
import type { OpenedProduct } from '../features/shell/infrastructure/productHost';
import { hrefFor } from '../features/shell/infrastructure/workspaceLocation';
import { strings } from '../l10n/strings';
import type { AppServices } from './services';

const t = strings.workspace;

/** Open a workspace destination from a page: it loads as the workspace with that drawer open. */
const go = (href: string) => () => window.location.assign(href);

/**
 * A specialist page beneath the app bar: the brand links home; Conversation details, Computers and
 * Settings open the workspace with that drawer, the one place each of them lives.
 */
export function RouteFrame({ route, children }: { readonly route: PageRoute; readonly product: OpenedProduct; readonly services: AppServices; readonly children: ReactNode }) {
  const home = hrefFor({ view: 'chat', threads: false });
  const destination = (view: 'conversation' | 'computers' | 'settings', icon: 'activity' | 'peers' | 'settings', label: string) => {
    const href = hrefFor({ view, threads: false });
    return <BarButton icon={icon} label={label} href={href} onPress={go(href)} data={{ 'data-workspace-view': view, 'data-open-network': view === 'computers' }} />;
  };
  return (
    <Workspace
      scroll
      data={{ 'data-route-page': route }}
      bar={
        <WorkspaceBar label={t.destinations} lead={<BrandLink href={home} label={strings.routes.brand} data={{ 'data-pool-route-link': '/' }} />} data={{ 'data-app-bar': true }}>
          {destination('conversation', 'activity', t.conversation)}
          {destination('computers', 'peers', t.computers)}
          {destination('settings', 'settings', t.settings)}
        </WorkspaceBar>
      }
    >
      {children}
    </Workspace>
  );
}
