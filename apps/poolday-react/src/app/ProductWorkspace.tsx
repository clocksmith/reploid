import { useCallback, useEffect, useRef, useState } from 'react';
import { BarButton, Drawer, Workspace, WorkspaceBar } from '@reploid/poolday-ui';
import { createConversation } from '../features/chat/infrastructure/conversation';
import { ConversationProvider } from '../features/chat/presentation/ConversationProvider';
import { ChatWorkspace } from '../features/chat/presentation/ChatWorkspace';
import { useConversation } from '../features/chat/presentation/conversationContext';
import { ThreadsPanel } from '../features/chat/presentation/ThreadsPanel';
import { createComputersServices } from '../features/computers/infrastructure/hostComputers';
import type { ComputersServices } from '../features/computers/domain/services';
import type { DetailsServices } from '../features/details/domain/services';
import type { SettingsServices } from '../features/settings/domain/services';
import { ComputersPanel, type ComputersFilter } from '../features/computers/presentation/ComputersPanel';
import { PairingLinkDialog } from '../features/computers/presentation/PairingLinkDialog';
import { createDetailsServices } from '../features/details/infrastructure/hostDetails';
import { ConversationDetailsPanel } from '../features/details/presentation/ConversationDetailsPanel';
import { createSettingsServices } from '../features/settings/infrastructure/hostSettings';
import { SettingsPanel } from '../features/settings/presentation/SettingsPanel';
import { close, endView, navigate, restore, threadsOpen, type EndView, type WorkspaceLocation, type WorkspaceView } from '../features/shell/domain/navigation';
import type { OpenedProduct } from '../features/shell/infrastructure/productHost';
import { hrefFor, isWide, readLocation, subscribeLocation, subscribeWidth, writeLocation } from '../features/shell/infrastructure/workspaceLocation';
import { strings } from '../l10n/strings';
import { HistoryHandoverNotice } from './HandedOver';
import type { AppServices } from './services';

const t = strings.workspace;

const END_TITLES: Record<EndView, string> = { conversation: t.conversation, computers: t.computers, settings: t.settings };
// The inspector pane each end drawer was in the vanilla shell; the e2e journeys address them by it.
const PANE: Record<EndView, string> = { conversation: 'conversation', computers: 'participants', settings: 'settings' };

/**
 * The open product: the bar of destinations, the conversation in the middle, Threads on the start
 * side and Conversation details, Computers or Settings on the end side. The address bar records
 * which drawers are open; each drawer's content stays mounted once opened, so its state survives.
 */
export function ProductWorkspace({ product, services }: { readonly product: OpenedProduct; readonly services: AppServices }) {
  const createChat = useCallback(() => createConversation(product, services.viewState), [product, services.viewState]);
  const computers = useOwned(useCallback(() => createComputersServices(product), [product]));
  const details = useOwned(useCallback(() => createDetailsServices(product), [product]));
  const settings = useOwned(useCallback(() => createSettingsServices(product), [product]));
  if (!computers || !details || !settings) return null;
  return (
    <>
      {/* A pairing link is read from the address on the first render, before the workspace rewrites the address. */}
      <PairingLinkDialog services={computers} />
      <ConversationProvider create={createChat}>
        <WorkspaceBody product={product} services={services} computers={computers} details={details} settings={settings} />
      </ConversationProvider>
    </>
  );
}

/**
 * Services the workspace owns for as long as it is mounted: created when it mounts and disposed when it goes away,
 * as ConversationProvider owns the controller. StrictMode's doubled mount gets a fresh set the second time.
 */
function useOwned<T extends { readonly dispose: () => void }>(create: () => T): T | null {
  const [owned, setOwned] = useState<T | null>(null);
  useEffect(() => {
    const made = create();
    setOwned(made);
    return () => made.dispose();
  }, [create]);
  return owned;
}

type WorkspaceBodyProps = {
  readonly product: OpenedProduct;
  readonly services: AppServices;
  readonly computers: ComputersServices;
  readonly details: DetailsServices;
  readonly settings: SettingsServices;
};

function WorkspaceBody({ product, services, computers, details, settings }: WorkspaceBodyProps) {
  const [location, setLocation] = useState<WorkspaceLocation>(() => restore(readLocation(), isWide()));
  const [visited, setVisited] = useState<ReadonlySet<EndView>>(() => new Set(endView(location) ? [endView(location) as EndView] : []));
  const [computersFilter, setComputersFilter] = useState<ComputersFilter | null>(null);
  const [inspected, setInspected] = useState<string | null>(null);
  const [conversation, port] = useConversation();

  const go = useCallback((next: WorkspaceLocation, { replace = false } = {}) => {
    writeLocation(next, { replace });
    setLocation(next);
    const end = endView(next);
    if (end) setVisited((current) => (current.has(end) ? current : new Set([...current, end])));
  }, []);

  useEffect(() => {
    writeLocation(location, { replace: true });
    const offLocation = subscribeLocation(() => go(restore(readLocation(), isWide()), { replace: true }));
    const offWidth = subscribeWidth((wide) =>
      setLocation((current) => {
        const next = restore(current, wide);
        if (next !== current) writeLocation(next, { replace: true });
        return next;
      }),
    );
    return () => {
      offLocation();
      offWidth();
    };
    // The location is read once here; later changes go through `go`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [go]);

  const press = (view: WorkspaceView) => go(navigate(location, view, isWide()));
  const current = useRef(location);
  current.current = location;
  // Stable, so the transcript's messages keep their memoized rendering across workspace updates.
  const openEnd = useCallback(
    (view: EndView) => go(navigate({ view: 'chat', threads: threadsOpen(current.current) && isWide() }, view, isWide())),
    [go],
  );
  const openComputers = useCallback(
    (filter?: ComputersFilter) => {
      setComputersFilter(filter ?? null);
      openEnd('computers');
    },
    [openEnd],
  );
  const openDetails = useCallback(
    (attemptId?: string) => {
      setInspected(attemptId ?? null);
      openEnd('conversation');
    },
    [openEnd],
  );
  const hrefOf = (view: WorkspaceView) => hrefFor(navigate(location, view, isWide()));
  const end = endView(location);
  const threads = threadsOpen(location);

  const destination = (view: EndView, icon: 'activity' | 'peers' | 'settings') => (
    <BarButton
      icon={icon}
      label={END_TITLES[view]}
      href={hrefOf(view)}
      onPress={() => press(view)}
      current={end === view}
      controls={`workspace-${view}`}
      data={{ 'data-workspace-view': view, 'data-inspector-section': PANE[view] }}
    />
  );

  return (
    <Workspace
      startOpen={threads}
      endOpen={end !== null}
      data={{ 'data-chat-workspace': true, 'data-threads-open': threads, 'data-end-view': end ?? undefined }}
      bar={
        <WorkspaceBar
          label={t.destinations}
          data={{ 'data-thread-sidebar': true, 'data-chat-rail-toolbar': true }}
          lead={
            <BarButton
              icon="threads"
              label={t.threads}
              href={hrefOf('threads')}
              onPress={() => press('threads')}
              current={threads}
              controls="workspace-threads"
              data={{ 'data-workspace-view': 'threads', 'data-toggle-thread-rail': true }}
            />
          }
        >
          {destination('conversation', 'activity')}
          {destination('computers', 'peers')}
          {destination('settings', 'settings')}
        </WorkspaceBar>
      }
      start={
        <Drawer
          id="workspace-threads"
          side="start"
          title={t.threads}
          open={threads}
          onClose={() => go(close(location, 'threads'))}
          closeLabel={strings.common.close}
          closeData={{ 'data-close-threads': true }}
          data={{ 'data-threads-dialog': true }}
        >
          <ThreadsPanel onDone={() => (isWide() ? undefined : go(close(location, 'threads')))} />
        </Drawer>
      }
      end={(['conversation', 'computers', 'settings'] as const).map((view) => (
        <Drawer
          key={view}
          id={`workspace-${view}`}
          side="end"
          title={END_TITLES[view]}
          open={end === view}
          onClose={() => go(close(location, 'end'))}
          closeLabel={strings.common.close}
          closeData={{ 'data-close-inspector': true }}
          data={{ 'data-inspector-pane': PANE[view], 'data-network-workspace': true, 'data-contextual-inspector': true }}
        >
          {visited.has(view) && view === 'conversation' && (
            <ConversationDetailsPanel services={details} attemptId={inspected} draftContext={conversation.draftContext} onDraftContext={port.setDraftContext} />
          )}
          {visited.has(view) && view === 'computers' && (
            <ComputersPanel services={computers} filter={computersFilter} selectedModel={conversation.composer.chip.selectionId} onClearFilter={() => setComputersFilter(null)} onStartSharing={port.startSharing} />
          )}
          {visited.has(view) && view === 'settings' && <SettingsPanel services={settings} appearance={services.appearance} />}
        </Drawer>
      ))}
    >
      <ChatWorkspace
        handover={<HistoryHandoverNotice handover={product.handover} />}
        onOpenComputers={openComputers}
        onOpenDetails={openDetails}
      />
    </Workspace>
  );
}
