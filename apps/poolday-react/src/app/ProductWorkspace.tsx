import { useCallback, useEffect, useRef, useState } from 'react';
import { BarButton, Button, Drawer, Row, Sheet, Stack, Text, Workspace, WorkspaceBar } from '@reploid/poolday-ui';
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
import { close, navigate, restore, threadsOpen, type WorkspaceLocation, type WorkspaceView } from '../features/shell/domain/navigation';
import type { OpenedProduct } from '../features/shell/infrastructure/productHost';
import { hrefFor, isWide, readLocation, subscribeLocation, subscribeWidth, writeLocation } from '../features/shell/infrastructure/workspaceLocation';
import { strings } from '../l10n/strings';
import { HistoryHandoverNotice } from './HandedOver';
import type { AppServices } from './services';

const t = strings.workspace;

type PrimaryDestination = 'chat' | 'computers' | 'settings';
const primaryOf = (view: WorkspaceView): PrimaryDestination => {
  if (view === 'computers') return 'computers';
  if (view === 'settings') return 'settings';
  return 'chat';
};

function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 760 : false));
  useEffect(() => {
    const onResize = () => setPhone(window.innerWidth <= 760);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return phone;
}

/**
 * The open product: three real full-page destinations (Chat, Computers, Settings) driven by the
 * navigation rail (desktop) and visible bottom bar (mobile). Threads lives inside Chat, and Details
 * is a contextual inspector (side pane on desktop, bounded sheet on mobile) that closes whenever
 * the user switches destinations.
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
  const [computersFilter, setComputersFilter] = useState<ComputersFilter | null>(null);
  const [inspected, setInspected] = useState<string | null>(null);
  const [conversation, port] = useConversation();
  const isPhone = useIsPhone();

  const go = useCallback((next: WorkspaceLocation, { replace = false } = {}) => {
    writeLocation(next, { replace });
    setLocation(next);
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

  const openComputers = useCallback(
    (filter?: ComputersFilter) => {
      setComputersFilter(filter ?? null);
      go({ view: 'computers', threads: false });
    },
    [go],
  );
  const openDetails = useCallback(
    (attemptId?: string) => {
      setInspected(attemptId ?? null);
      go(navigate(current.current, 'conversation', isWide()));
    },
    [go],
  );

  const page = primaryOf(location.view);
  const inChat = page === 'chat';
  const threads = inChat && threadsOpen(location);
  const detailsOpen = inChat && location.view === 'conversation';
  const hrefOf = (view: WorkspaceView) => hrefFor(navigate(location, view, isWide()));

  const detailsBody = (
    <ConversationDetailsPanel
      services={details}
      attemptId={inspected}
      draftContext={conversation.draftContext}
      onDraftContext={port.setDraftContext}
    />
  );

  return (
    <Workspace
      scroll={!inChat}
      startOpen={threads}
      endOpen={detailsOpen && !isPhone}
      data={{ 'data-chat-workspace': true, 'data-destination': page, 'data-threads-open': threads, 'data-end-view': detailsOpen ? 'conversation' : undefined }}
      bar={
        <WorkspaceBar
          label={t.destinations}
          data={{ 'data-thread-sidebar': true, 'data-chat-rail-toolbar': true }}
          lead={
            <>
              <BarButton
                icon="chat"
                label={t.chat}
                href={hrefOf('chat')}
                onPress={() => press('chat')}
                current={page === 'chat'}
                data={{ 'data-workspace-view': 'chat' }}
              />
              <BarButton
                icon="peers"
                label={t.computers}
                href={hrefOf('computers')}
                onPress={() => press('computers')}
                current={page === 'computers'}
                data={{ 'data-workspace-view': 'computers', 'data-inspector-section': 'participants' }}
              />
            </>
          }
        >
          <BarButton
            icon="settings"
            label={t.settings}
            href={hrefOf('settings')}
            onPress={() => press('settings')}
            current={page === 'settings'}
            data={{ 'data-workspace-view': 'settings', 'data-inspector-section': 'settings' }}
          />
        </WorkspaceBar>
      }
      start={
        inChat ? (
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
        ) : undefined
      }
      end={
        inChat && !isPhone ? (
          <Drawer
            id="workspace-conversation"
            side="end"
            title={t.conversation}
            open={detailsOpen}
            onClose={() => go(close(location, 'end'))}
            closeLabel={strings.common.close}
            closeData={{ 'data-close-inspector': true }}
            data={{ 'data-inspector-pane': 'conversation', 'data-contextual-inspector': true }}
          >
            {detailsOpen && detailsBody}
          </Drawer>
        ) : undefined
      }
    >
      {page === 'chat' && (
        <>
          <ChatWorkspace
            header={
              <Row justify="between" gap="sm">
                <Button
                  variant="quiet"
                  icon="threads"
                  label={t.threads}
                  pressed={threads}
                  onPress={() => press('threads')}
                  data={{ 'data-toggle-thread-rail': true, 'data-workspace-view': 'threads' }}
                />
              </Row>
            }
            handover={<HistoryHandoverNotice handover={product.handover} />}
            onOpenComputers={openComputers}
            onOpenDetails={openDetails}
          />
          {isPhone && (
            <Sheet
              title={t.conversation}
              open={detailsOpen}
              onClose={() => go(close(location, 'end'))}
              closeLabel={strings.common.close}
              data={{ 'data-inspector-pane': 'conversation', 'data-contextual-inspector': true }}
            >
              {detailsBody}
            </Sheet>
          )}
        </>
      )}
      {page === 'computers' && (
        <Stack gap="lg" data={{ 'data-inspector-pane': 'participants', 'data-network-workspace': true }}>
          <Text as="h1" variant="title">
            {t.computers}
          </Text>
          <ComputersPanel
            services={computers}
            filter={computersFilter}
            selectedModel={conversation.composer.chip.selectionId}
            onClearFilter={() => setComputersFilter(null)}
            onStartSharing={port.startSharing}
          />
        </Stack>
      )}
      {page === 'settings' && (
        <Stack gap="lg" data={{ 'data-inspector-pane': 'settings' }}>
          <Text as="h1" variant="title">
            {t.settings}
          </Text>
          <SettingsPanel services={settings} appearance={services.appearance} />
        </Stack>
      )}
    </Workspace>
  );
}
