// Composes each feature screen with synthetic records and local state for the design page.
import { useState } from 'react';
import type { ChatMessage, ComposerState, ModelSheetState, ThreadSummary } from '../features/chat/domain/chat';
import type { ComputersState, PairingState } from '../features/computers/domain/computers';
import type { SettingsState } from '../features/settings/domain/settings';
import { ChatThread } from '../features/chat/presentation/ChatThread';
import { ChatServicesContext } from '../features/chat/presentation/chatServices';
import { ChatWorkspace } from '../features/chat/presentation/ChatWorkspace';
import { DownloadReview } from '../features/chat/presentation/DownloadReview';
import { Composer } from '../features/chat/presentation/Composer';
import { MessageList } from '../features/chat/presentation/MessageList';
import { ModelSheet } from '../features/chat/presentation/ModelSheet';
import { Receipt } from '../features/chat/presentation/Receipt';
import { ThreadList } from '../features/chat/presentation/ThreadList';
import { Computers } from '../features/computers/presentation/Computers';
import { ConnectDesktop } from '../features/computers/presentation/ConnectDesktop';
import { Settings } from '../features/settings/presentation/Settings';
import type { CompositionSpecimen } from '../features/design/presentation/DesignPage';
import * as fixtures from './designFixtures';
import { createDemoChat } from './demoChat';

function ComposerDemo({ initial }: { readonly initial: ComposerState }) {
  const [state, setState] = useState(initial);
  return (
    <Composer
      state={state}
      onDraft={(draft) => setState({ ...state, draft })}
      onSend={() => setState({ ...state, draft: '', running: true, status: 'Generating on this device' })}
      onStop={() => setState({ ...state, running: false, status: 'Stopped' })}
      onOpenAnswerOn={() => undefined}
    />
  );
}

function SheetDemo({ initial }: { readonly initial: ModelSheetState }) {
  const [state, setState] = useState(initial);
  return (
    <ModelSheet
      presentation="inline"
      open
      state={state}
      onClose={() => undefined}
      onComputer={(computer) => setState({ ...state, computer })}
      onModel={(model) => setState({ ...state, model })}
      onCommit={() => undefined}
      onWhoCanRead={() => undefined}
    />
  );
}

function ThreadsDemo({ initial }: { readonly initial: ReadonlyArray<ThreadSummary> }) {
  const [current, setCurrent] = useState<string | null>(initial[0]?.id ?? null);
  const [view, setView] = useState<'active' | 'archived'>('active');
  return <ThreadList threads={view === 'active' ? initial : []} current={current} view={view} onView={setView} onSelect={setCurrent} onNew={() => setCurrent(null)} />;
}

function ChatDemo({ initial, composer }: { readonly initial: ReadonlyArray<ChatMessage>; readonly composer: ComposerState }) {
  const [state, setState] = useState(composer);
  return (
    <ChatThread
      messages={initial}
      composer={state}
      onDraft={(draft) => setState({ ...state, draft })}
      onSend={() => setState({ ...state, draft: '' })}
      onStop={() => setState({ ...state, running: false })}
      onOpenAnswerOn={() => undefined}
    />
  );
}

function ComputersDemo({ initial }: { readonly initial: ComputersState }) {
  const [state, setState] = useState(initial);
  return (
    <Computers
      state={state}
      onSharing={(sharing) => setState({ ...state, sharing })}
      onSharingFiles={(sharingFiles) => setState({ ...state, sharingFiles })}
      onConnectDesktop={() => undefined}
      onOpenComputer={() => undefined}
    />
  );
}

function ConnectDemo({ initial }: { readonly initial: PairingState }) {
  return <ConnectDesktop presentation="inline" open state={initial} onClose={() => undefined} onCopy={() => undefined} onNewCode={() => undefined} />;
}

function SettingsDemo({ initial }: { readonly initial: SettingsState }) {
  const [state, setState] = useState(initial);
  return (
    <Settings
      state={state}
      onAppearance={(appearance) => setState({ ...state, appearance })}
      onNetworkAnswers={(networkAnswers) => setState({ ...state, networkAnswers })}
      onWebSearch={(webSearch) => setState({ ...state, webSearch })}
      onRecipients={(recipients) => setState({ ...state, recipients })}
      onClearData={() => undefined}
    />
  );
}

function WorkspaceDemo() {
  const [services] = useState(() => createDemoChat());
  return (
    <ChatServicesContext.Provider value={services}>
      <ChatWorkspace />
    </ChatServicesContext.Provider>
  );
}

export const compositionSpecimens: ReadonlyArray<CompositionSpecimen> = [
  {
    name: 'Receipt',
    states: [
      { id: 'open', label: 'Expanded', render: () => <Receipt receipt={fixtures.receipt} defaultOpen /> },
      { id: 'folded', label: 'Folded under an answer', render: () => <Receipt receipt={fixtures.receipt} /> },
    ],
  },
  {
    name: 'MessageList',
    states: [
      { id: 'answered', label: 'Answered', render: () => <MessageList messages={fixtures.messages} /> },
      { id: 'streaming', label: 'Generating', render: () => <MessageList messages={fixtures.streaming} /> },
      { id: 'failed', label: 'Disconnected', render: () => <MessageList messages={fixtures.failed} /> },
      { id: 'empty', label: 'Empty', render: () => <MessageList messages={[]} /> },
    ],
  },
  {
    name: 'Composer',
    states: [
      { id: 'idle', label: 'Idle', render: () => <ComposerDemo initial={fixtures.composer} /> },
      { id: 'running', label: 'Generating', render: () => <ComposerDemo initial={{ ...fixtures.composer, running: true, suggestion: null, status: 'Generating on this device' }} /> },
      { id: 'download', label: 'Downloading', render: () => <ComposerDemo initial={{ ...fixtures.composer, suggestion: null, progress: 0.35, status: 'Downloading Qwen 3.5 0.8B · 0.2 of 0.6 GB' }} /> },
      { id: 'error', label: 'Error', render: () => <ComposerDemo initial={{ ...fixtures.composer, suggestion: null, error: 'The contributor disconnected before answering.' }} /> },
    ],
  },
  {
    name: 'DownloadReview',
    states: [
      { id: 'checking', label: 'Checking size', render: () => <DownloadReview presentation="inline" open state={{ model: 'Qwen 3.5 0.8B', size: null, error: null }} onApprove={() => undefined} onCancel={() => undefined} /> },
      { id: 'ready', label: 'Size shown', render: () => <DownloadReview presentation="inline" open state={{ model: 'Qwen 3.5 0.8B', size: '0.64 GB', error: null }} onApprove={() => undefined} onCancel={() => undefined} /> },
      { id: 'failed', label: 'Check failed', render: () => <DownloadReview presentation="inline" open state={{ model: 'Qwen 3.5 0.8B', size: null, error: 'Could not check the model download' }} onApprove={() => undefined} onCancel={() => undefined} /> },
    ],
  },
  {
    name: 'ModelSheet',
    states: [
      { id: 'ready', label: 'Ready', render: () => <SheetDemo initial={fixtures.sheetReady} /> },
      { id: 'download', label: 'Download needed', render: () => <SheetDemo initial={fixtures.sheetDownload} /> },
      { id: 'searching', label: 'Finding computers', render: () => <SheetDemo initial={fixtures.sheetSearching} /> },
      { id: 'empty', label: 'No models', render: () => <SheetDemo initial={fixtures.sheetEmpty} /> },
    ],
  },
  {
    name: 'ThreadList',
    states: [
      { id: 'threads', label: 'Threads', render: () => <ThreadsDemo initial={fixtures.threads} /> },
      { id: 'empty', label: 'Empty', render: () => <ThreadsDemo initial={[]} /> },
    ],
  },
  {
    name: 'ChatThread',
    states: [
      { id: 'answered', label: 'Answered', render: () => <ChatDemo initial={fixtures.messages} composer={fixtures.composer} /> },
      { id: 'new', label: 'New thread', render: () => <ChatDemo initial={[]} composer={fixtures.composer} /> },
      { id: 'generating', label: 'Generating', render: () => <ChatDemo initial={fixtures.streaming} composer={{ ...fixtures.composer, running: true, suggestion: null }} /> },
    ],
  },
  {
    name: 'Computers',
    states: [
      { id: 'paired', label: 'Paired', render: () => <ComputersDemo initial={fixtures.computersState} /> },
      { id: 'empty', label: 'Nothing paired', render: () => <ComputersDemo initial={fixtures.computersEmpty} /> },
    ],
  },
  {
    name: 'ConnectDesktop',
    states: [
      { id: 'waiting', label: 'Waiting', render: () => <ConnectDemo initial={fixtures.pairing} /> },
      { id: 'connected', label: 'Connected', render: () => <ConnectDemo initial={{ ...fixtures.pairing, phase: 'connected', desktop: 'Studio desktop' }} /> },
      { id: 'failed', label: 'Expired', render: () => <ConnectDemo initial={{ ...fixtures.pairing, phase: 'failed' }} /> },
    ],
  },
  { name: 'Settings', states: [{ id: 'default', label: 'Default', render: () => <SettingsDemo initial={fixtures.settingsState} /> }] },
  { name: 'ChatWorkspace', states: [{ id: 'demo', label: 'Synthetic session', render: () => <WorkspaceDemo /> }] },
];
