// Composes each shipped screen for the design page: the conversation screens run on the host's conversation
// controller over an in-memory session, and the Computers, Settings and details panels on their own
// infrastructure adapters over the same session, so every specimen is the shipped screen, not a copy.
import { useState, type ReactNode } from 'react';
import type { ConversationCommands, ConversationPort, ConversationSnapshot } from '../features/chat/domain/conversation';
import { createConversation } from '../features/chat/infrastructure/conversation';
import { AnswerOnSheet } from '../features/chat/presentation/AnswerOnSheet';
import { DownloadDialog, PrivacyDialog, RemotePermissionDialog, RenameDialog } from '../features/chat/presentation/ChatDialogs';
import { ChatWorkspace } from '../features/chat/presentation/ChatWorkspace';
import { ComposerBar } from '../features/chat/presentation/ComposerBar';
import { ConversationProvider } from '../features/chat/presentation/ConversationProvider';
import { useConversation } from '../features/chat/presentation/conversationContext';
import { ThreadsPanel } from '../features/chat/presentation/ThreadsPanel';
import type { ComputersServices, FleetAccountView } from '../features/computers/domain/services';
import { createComputersServices } from '../features/computers/infrastructure/hostComputers';
import { ComputersPanel } from '../features/computers/presentation/ComputersPanel';
import { ActivityList, FleetAccount } from '../features/computers/presentation/FleetAccount';
import { PairingLinkDialog } from '../features/computers/presentation/PairingLinkDialog';
import { PublicNetwork } from '../features/computers/presentation/PublicNetwork';
import { ThisComputer } from '../features/computers/presentation/ThisComputer';
import { YourComputers } from '../features/computers/presentation/YourComputers';
import type { CompositionSpecimen } from '../features/design/presentation/DesignPage';
import { createDetailsServices } from '../features/details/infrastructure/hostDetails';
import { ConversationDetailsPanel } from '../features/details/presentation/ConversationDetailsPanel';
import { createSettingsServices } from '../features/settings/infrastructure/hostSettings';
import { SettingsPanel } from '../features/settings/presentation/SettingsPanel';
import { createAppearanceStore } from '../features/shell/infrastructure/appearance';
import { createDemoChat, type DemoChat } from './demoChat';
import * as fixtures from './designFixtures';

type Setup = (port: ConversationPort, demo: DemoChat) => void;

/** A live conversation over a fresh in-memory session; `setup` stages the state the specimen shows. */
function Live({ options, setup, children }: { readonly options?: Parameters<typeof createDemoChat>[0]; readonly setup?: Setup; readonly children: ReactNode }) {
  const [create] = useState(() => () => {
    const demo = createDemoChat({ answerDelayMs: 900, ...options });
    const port = createConversation({ host: { chat: demo.chat } });
    setup?.(port, demo);
    return port;
  });
  return <ConversationProvider create={create}>{children}</ConversationProvider>;
}

/** Renders a part of the live snapshot with the controller's commands. */
function Part({ render }: { readonly render: (snapshot: ConversationSnapshot, commands: ConversationCommands) => ReactNode }) {
  const [snapshot, port] = useConversation();
  return <>{render(snapshot, port)}</>;
}

/** Commands that change nothing, for parts shown from a fixed record. */
const still = new Proxy({}, { get: () => () => undefined }) as ConversationCommands;

const selectSeeded: Setup = (port) => port.selectThread('seed-0');

function LiveComputers({ render }: { readonly render: (services: ComputersServices) => ReactNode }) {
  const [services] = useState(() => createComputersServices({ host: { chat: createDemoChat().chat }, earning: Promise.resolve(null) }));
  return <>{render(services)}</>;
}

function LiveDetails({ inspect = false }: { readonly inspect?: boolean }) {
  const [demo] = useState(() => {
    const chat = createDemoChat({ threads: 2 });
    chat.chat.select('seed-0');
    return chat;
  });
  const [services] = useState(() => createDetailsServices({ host: { chat: demo.chat } }));
  return <ConversationDetailsPanel services={services} attemptId={inspect ? 'seed-0-attempt' : null} />;
}

function LiveSettings() {
  const [services] = useState(() => createSettingsServices({ host: { chat: createDemoChat().chat } }));
  const [appearance] = useState(() => createAppearanceStore(null));
  return <SettingsPanel services={services} appearance={appearance} />;
}

/** A pairing link opened on this device, as the Computers adapter reads it from the address. */
function LivePairingLink() {
  const [services] = useState(() => {
    const base = createComputersServices({ host: { chat: createDemoChat().chat }, earning: Promise.resolve(null) });
    return { ...base, owner: { ...base.owner, linkTarget: () => fixtures.pairingTarget, forgetLink: () => undefined } };
  });
  return <PairingLinkDialog services={services} presentation="inline" />;
}

export const compositionSpecimens: ReadonlyArray<CompositionSpecimen> = [
  {
    name: 'ComposerBar',
    states: [
      { id: 'ready', label: 'Ready on this device', render: () => <ComposerBar composer={fixtures.composer} commands={still} focusSignal={0} answerOnFocus={0} /> },
      { id: 'finding', label: 'Finding computers', render: () => <ComposerBar composer={fixtures.composerFinding} commands={still} focusSignal={0} answerOnFocus={0} /> },
      { id: 'queued', label: 'Send waits for a computer', render: () => <ComposerBar composer={fixtures.composerQueued} commands={still} focusSignal={0} answerOnFocus={0} /> },
      { id: 'download', label: 'Downloading', render: () => <ComposerBar composer={fixtures.composerDownloading} commands={still} focusSignal={0} answerOnFocus={0} /> },
      { id: 'running', label: 'Generating', render: () => <ComposerBar composer={fixtures.composerRunning} commands={still} focusSignal={0} answerOnFocus={0} /> },
    ],
  },
  {
    name: 'AnswerOnSheet',
    states: [
      {
        id: 'device',
        label: 'This device',
        render: () => (
          <Live setup={(port) => port.openSheet()}>
            <Part render={(snapshot, port) => <AnswerOnSheet presentation="inline" sheet={snapshot.sheet} commands={port} onInspectProviders={() => undefined} />} />
          </Live>
        ),
      },
      {
        id: 'contributors',
        label: 'Contributors',
        render: () => (
          <Live setup={(port) => { port.openSheet(); port.pickComputer('network'); }}>
            <Part render={(snapshot, port) => <AnswerOnSheet presentation="inline" sheet={snapshot.sheet} commands={port} onInspectProviders={() => undefined} />} />
          </Live>
        ),
      },
      {
        id: 'searching',
        label: 'Finding computers',
        render: () => (
          <Live options={{ searching: true }} setup={(port) => { port.openSheet(); port.pickComputer('network'); }}>
            <Part render={(snapshot, port) => <AnswerOnSheet presentation="inline" sheet={snapshot.sheet} commands={port} onInspectProviders={() => undefined} />} />
          </Live>
        ),
      },
    ],
  },
  {
    name: 'PrivacyDialog',
    states: [
      {
        id: 'device',
        label: 'Only your devices',
        render: () => (
          <Live setup={(port) => port.openPrivacy()}>
            <Part render={(snapshot, port) => <PrivacyDialog presentation="inline" privacy={snapshot.privacy} commands={port} />} />
          </Live>
        ),
      },
      { id: 'fixed', label: 'Fixed requirements', render: () => <PrivacyDialog presentation="inline" privacy={fixtures.privacyFixed} commands={still} /> },
    ],
  },
  {
    name: 'DownloadDialog',
    states: [
      { id: 'checking', label: 'Checking size', render: () => <DownloadDialog presentation="inline" download={fixtures.downloadChecking} commands={still} /> },
      { id: 'ready', label: 'Size shown', render: () => <DownloadDialog presentation="inline" download={fixtures.downloadReady} commands={still} /> },
      { id: 'failed', label: 'Check failed', render: () => <DownloadDialog presentation="inline" download={fixtures.downloadFailed} commands={still} /> },
      { id: 'share', label: 'Start sharing', render: () => <DownloadDialog presentation="inline" download={fixtures.downloadShare} commands={still} /> },
    ],
  },
  { name: 'RenameDialog', states: [{ id: 'open', label: 'Open', render: () => <RenameDialog presentation="inline" rename={fixtures.rename} commands={still} /> }] },
  { name: 'RemotePermissionDialog', states: [{ id: 'open', label: 'Asking', render: () => <RemotePermissionDialog presentation="inline" permission={fixtures.remotePermission} commands={still} /> }] },
  {
    name: 'ThreadsPanel',
    states: [
      { id: 'threads', label: 'Threads', render: () => <Live options={{ threads: 4 }} setup={selectSeeded}><ThreadsPanel onDone={() => undefined} /></Live> },
      { id: 'empty', label: 'No threads yet', render: () => <Live><ThreadsPanel onDone={() => undefined} /></Live> },
    ],
  },
  {
    name: 'ChatWorkspace',
    states: [
      { id: 'new', label: 'New conversation', render: () => <Live><ChatWorkspace /></Live> },
      { id: 'answered', label: 'Answered', render: () => <Live options={{ threads: 2 }} setup={selectSeeded}><ChatWorkspace /></Live> },
      { id: 'searching', label: 'Finding computers', render: () => <Live options={{ searching: true }}><ChatWorkspace /></Live> },
    ],
  },
  {
    name: 'ConversationProvider',
    states: [{ id: 'live', label: 'A live conversation', render: () => <Live><Part render={(snapshot, port) => <ComposerBar composer={snapshot.composer} commands={port} focusSignal={0} answerOnFocus={0} />} /></Live> }],
  },
  {
    name: 'ActivityList',
    states: [
      { id: 'rows', label: 'Recent activity', render: () => <ActivityList rows={fixtures.activity} empty="No service-credit activity yet." /> },
      { id: 'empty', label: 'Empty', render: () => <ActivityList rows={[]} empty="No service-credit activity yet." /> },
    ],
  },
  {
    name: 'FleetAccount',
    states: [
      { id: 'signed-in', label: 'Signed in', render: () => <LiveComputers render={(services) => <FleetAccount view={fixtures.fleetSignedIn as FleetAccountView} services={services} />} /> },
      { id: 'signed-out', label: 'Signed out', render: () => <LiveComputers render={(services) => <FleetAccount view={fixtures.fleetSignedOut as FleetAccountView} services={services} />} /> },
    ],
  },
  { name: 'YourComputers', states: [{ id: 'none', label: 'Nothing paired', render: () => <LiveComputers render={(services) => <YourComputers view={{ ...services.getView(), ...fixtures.yourComputers }} services={services} />} /> }] },
  {
    name: 'PublicNetwork',
    states: [
      { id: 'empty', label: 'No computers yet', render: () => <LiveComputers render={(services) => <PublicNetwork view={services.getView()} services={services} onClearFilter={() => undefined} onError={() => undefined} />} /> },
      { id: 'peers', label: 'Computers ready', render: () => <LiveComputers render={(services) => <PublicNetwork view={{ ...services.getView(), ...fixtures.networkPeers }} services={services} onClearFilter={() => undefined} onError={() => undefined} />} /> },
    ],
  },
  { name: 'ThisComputer', states: [{ id: 'idle', label: 'Not sharing', render: () => <LiveComputers render={(services) => <ThisComputer view={services.getView()} services={services} onStartSharing={() => undefined} />} /> }] },
  { name: 'PairingLinkDialog', states: [{ id: 'request', label: 'Connect', render: () => <LivePairingLink /> }] },
  { name: 'ComputersPanel', states: [{ id: 'live', label: 'This page', render: () => <LiveComputers render={(services) => <ComputersPanel services={services} filter={null} onClearFilter={() => undefined} />} /> }] },
  {
    name: 'ConversationDetailsPanel',
    states: [
      { id: 'last', label: 'Last answer', render: () => <LiveDetails /> },
      { id: 'inspected', label: 'An inspected answer', render: () => <LiveDetails inspect /> },
    ],
  },
  { name: 'SettingsPanel', states: [{ id: 'default', label: 'This page', render: () => <LiveSettings /> }] },
];
