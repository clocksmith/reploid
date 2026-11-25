// Synthetic records for the design page. No real accounts, prompts or computers.
import type { ChatMessage, ComposerState, ModelSheetState, ThreadSummary } from '../features/chat/domain/chat';
import type { ComputersState, PairingState } from '../features/computers/domain/computers';
import type { SettingsState } from '../features/settings/domain/settings';

export const receipt = {
  computer: 'This device',
  model: 'Qwen 3.5 2B',
  readBy: 'Only this device',
  duration: '1.4 s',
  tokens: '212 in · 96 out',
  settlement: 'Local, no credits',
} as const;

export const messages: ReadonlyArray<ChatMessage> = [
  { id: 'm1', role: 'user', text: 'What does WebGPU change for running models in a browser?' },
  {
    id: 'm2',
    role: 'assistant',
    text: 'It gives the page direct access to the GPU for compute, so a model can run where the page runs, without a server.',
    status: 'completed',
    receipt,
  },
];

export const streaming: ReadonlyArray<ChatMessage> = [
  messages[0]!,
  { id: 'm3', role: 'assistant', text: 'It gives the page direct access', status: 'executing' },
];

export const failed: ReadonlyArray<ChatMessage> = [
  messages[0]!,
  {
    id: 'm4',
    role: 'assistant',
    text: '',
    status: 'interrupted',
    systemNote: 'Interrupted. That computer went away before finishing, so any text above is unverified. Nothing was resent.',
  },
];

export const composer: ComposerState = {
  draft: '',
  running: false,
  answerOn: 'This device · Qwen 3.5 2B',
  status: '',
  error: null,
  progress: null,
  suggestion: 'Explain WebGPU in two sentences',
};

const computers = [
  { id: 'local', title: 'This device', status: 'Ready' },
  { id: 'desktop', title: 'Studio desktop', status: 'Offline', disabled: true },
  { id: 'network', title: 'Contributors', status: 'Ready' },
] as const;

export const sheetReady: ModelSheetState = {
  computers,
  computer: 'local',
  models: [
    { id: 'qwen-2b', name: 'Qwen 3.5 2B', status: 'On this device' },
    { id: 'qwen-0-8b', name: 'Qwen 3.5 0.8B', status: 'Download 0.6 GB' },
    { id: 'gemma-27b', name: 'Gemma 27B', status: 'Contributors only' },
  ],
  model: 'qwen-2b',
  disclosure: 'Only this device reads your prompt.',
  facts: '2.1 GB · Q4K · 32K context',
  outcome: { issue: null, action: 'commit', label: 'Answer on this device' },
  searching: false,
};

export const sheetDownload: ModelSheetState = {
  ...sheetReady,
  model: 'qwen-0-8b',
  outcome: { issue: 'Not on this device yet. You see its size before it downloads.', action: 'download', label: 'Download Qwen 3.5 0.8B' },
};

export const sheetSearching: ModelSheetState = {
  ...sheetReady,
  computer: 'network',
  computers: computers.map((computer) => (computer.id === 'network' ? { ...computer, status: 'Finding computers…' } : computer)),
  model: 'gemma-27b',
  disclosure: 'The answering contributor reads your prompt.',
  outcome: { issue: 'Finding computers… This model becomes Ready here when one shares it.', action: null, label: 'Answer with contributors' },
  searching: true,
};

export const sheetEmpty: ModelSheetState = {
  ...sheetReady,
  models: [],
  model: null,
  facts: '',
  outcome: { issue: 'No model is available right now. Models appear here as computers share them.', action: null, label: 'Answer on this device' },
};

export const threads: ReadonlyArray<ThreadSummary> = [
  { id: 't1', title: 'WebGPU in the browser', status: 'completed', time: '2m', unread: true },
  { id: 't2', title: 'Summarise the meeting notes', status: 'executing', time: 'now', unread: false },
  { id: 't3', title: 'Recipe for four', status: 'failed', time: '1h', unread: false },
  { id: 't4', title: 'Trip checklist', status: 'completed', time: '3d', unread: false },
];

export const computersState: ComputersState = {
  sharing: true,
  sharingFiles: false,
  thisDeviceStatus: 'Ready · shares Qwen 3.5 2B while this page is open',
  paired: [
    { id: 'studio', name: 'Studio desktop', status: 'Qwen 3.5 27B · last seen 4m ago', tone: 'ready', toneLabel: 'Ready' },
    { id: 'laptop', name: 'Laptop', status: 'Last seen 2d ago', tone: 'unavailable', toneLabel: 'Offline' },
  ],
  contributors: '3 computers share 2 models',
};

export const computersEmpty: ComputersState = { ...computersState, sharing: false, paired: [], contributors: 'Finding computers…' };

export const pairing: PairingState = { phase: 'waiting', command: 'npx reploid pair 7Q4M-2XKD', code: '7Q4M-2XKD', desktop: null };

export const settingsState: SettingsState = {
  appearance: 'system',
  networkAnswers: true,
  webSearch: false,
  recipients: 'anyone',
  storedModels: [{ id: 'qwen-2b', name: 'Qwen 3.5 2B', size: '2.1 GB' }],
  storageUsed: '2.1 GB of 40 GB available to this browser',
};
