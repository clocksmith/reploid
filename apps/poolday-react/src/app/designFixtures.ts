// Fixed records for the design page's still specimens: parts shown in one state each, worded as the host's
// decisions word them. Live specimens run on the controller instead (designSpecimens.tsx).
import type { ComposerView, DownloadView, PrivacyView } from '../features/chat/domain/conversation';
import type { ComputersView, CreditActivity, PairingTarget } from '../features/computers/domain/services';

export const composer: ComposerView = {
  draft: '',
  files: [],
  attachmentsPending: false,
  attachmentHelp: false,
  attachmentHelpText: 'TXT, Markdown, JSON, JS, TS, HTML and CSS. Up to 8, 64 KB each, 128 KB total.',
  placeholder: 'Message This device…',
  send: { visible: true, disabled: false },
  stop: { visible: false },
  chip: { visible: true, caption: false, findingFirst: false, source: 'This device', name: 'Qwen 3.5 2B', availability: 'ready', label: 'Answer on This device · Qwen 3.5 2B, Ready', activity: 'ready', executionSource: 'local', selectionId: 'qwen-2b' },
  privacy: { label: 'Who can read it: Only your devices', caption: 'Your devices', disabled: false },
  search: { visible: false, pressed: false },
  status: { text: 'Model downloaded.' },
  acquisition: { text: '', progress: null },
  nextAction: null,
  nextLabels: { join: 'Join', reviewShared: '', downloadLocal: 'Review local download', retry: 'Retry connection', retryPending: false },
  disclosure: 'Nothing leaves this device.',
  routeAlternatives: [],
  executionSettingsReset: false,
  startingPrompt: {
    text: 'Suggest 3 clever sci-fi movies under two hours.',
    texts: ['Suggest 3 clever sci-fi movies under two hours.', 'Pick 3 podcasts for a long drive.', 'Recommend 3 board games for four players.'],
    inert: false,
  },
  error: '',
  answerLimit: '',
};

export const composerFinding: ComposerView = {
  ...composer,
  placeholder: 'Message…',
  chip: { ...composer.chip, findingFirst: true, source: '', name: 'Finding computers…', availability: 'waiting', label: 'Answer on, Finding computers', activity: 'idle' },
  status: { text: 'Finding computers…' },
};

export const composerQueued: ComposerView = {
  ...composer,
  draft: 'Explain ocean tides.',
  placeholder: 'Message a contributor…',
  chip: { ...composer.chip, source: 'Contributors', name: 'Gemma 27B', availability: 'waiting', label: 'Answer on Contributors · Gemma 27B, Finding computers', activity: 'idle' },
  privacy: { label: 'Who can read it: Standard', caption: '', disabled: false },
  status: { text: 'Waiting for a computer running Gemma 27B…' },
  nextAction: 'cancel-queued',
  disclosure: 'A network provider could read your prompt.',
  startingPrompt: composer.startingPrompt ? { ...composer.startingPrompt, inert: true } : null,
};

export const composerDownloading: ComposerView = {
  ...composer,
  chip: { ...composer.chip, name: 'Qwen 3.5 0.8B', availability: 'unavailable', label: 'Answer on This device · Qwen 3.5 0.8B, Unavailable', activity: 'idle' },
  status: { text: '' },
  acquisition: { text: 'Downloading Qwen 3.5 0.8B · 35%', progress: { value: 224000000, max: 640000000 } },
  nextAction: 'cancel-download',
  send: { visible: true, disabled: true },
};

export const composerRunning: ComposerView = {
  ...composer,
  status: { text: '' },
  send: { visible: false, disabled: true },
  stop: { visible: true },
  privacy: { ...composer.privacy, disabled: true },
  startingPrompt: null,
};

const fixed = 'This conversation’s requirements are fixed.';
export const privacyFixed: PrivacyView = {
  open: true,
  editable: false,
  error: 'This conversation has requirements these choices cannot express. It is read-only here.',
  applying: false,
  protection: 'plaintext',
  route: 'auto',
  ownDevices: false,
  protections: [
    { value: 'plaintext', title: 'Standard', status: fixed, disabled: true },
    { value: 'secret-sharing', title: 'Secret sharing', status: 'Each peer gets one share. Two peers on the same stage can combine their shares to read intermediate data. Your device recombines the intermediate results. Unavailable: Secret-shared execution is unreviewed and off by default.', disabled: true },
    { value: 'homomorphic', title: 'Compute on encrypted data', status: 'Your device keeps the key. Remote computers compute on encrypted values. Unavailable: Awaiting independent security review.', disabled: true },
    { value: 'attested', title: 'Verified hardware', status: 'Approved software can read your data inside protected hardware. You\'re trusting that hardware and software. Unavailable: No attested route is enabled in this build, so no hardware or its software is verified.', disabled: true },
  ],
  routes: [
    { value: 'local', title: 'This device', status: fixed, disabled: true },
    { value: 'remote', title: 'One computer', status: fixed, disabled: true },
    { value: 'split', title: 'Several computers', status: 'Unavailable: Only a model that runs in stages uses several computers.', disabled: true },
    { value: 'split-local-edges', title: 'Several computers, your devices at both ends', status: 'Unavailable: This browser cannot bind both edge devices to you.', disabled: true },
    { value: 'auto', title: 'Let it choose', status: fixed, disabled: true },
  ],
  ownDevicesOption: { value: 'own-devices', title: 'Only your devices', status: 'Unavailable: Pair a desktop in Computers to add it.', disabled: true },
  splitNote: '',
  preset: 'standard',
  note: '',
  notes: { standard: '', 'own-devices': '' },
};

const sharing = [
  { value: 'compute', title: 'Answer other people’s requests', status: 'With downloaded models, while this page is open.', disabled: false },
  { value: 'files', title: 'Share cached model files', status: 'Other computers can download files stored here.', disabled: false },
];

export const downloadChecking: DownloadView = {
  open: true,
  modelId: 'qwen-0-8b',
  choose: false,
  title: 'Download Qwen 3.5 0.8B',
  models: [],
  explanation: 'Store this model on this device to answer when network capacity is unavailable. Sharing choices apply to cached models on this device when you confirm.',
  sharing,
  sharingValues: [],
  size: 'Checking download size…',
  ready: false,
  retry: false,
  fit: '',
  confirm: 'Download model',
};
export const downloadReady: DownloadView = {
  ...downloadChecking,
  size: '640 MB download',
  ready: true,
  fit: 'Download: 0.64 GB · 12.5 GB browser storage available. Working memory estimate unavailable for this model. Fit unknown. Available GPU memory is not reported. Usable context depends on the workload and available memory.',
};
export const downloadFailed: DownloadView = { ...downloadChecking, size: 'Could not check the model download', retry: true };
export const downloadShare: DownloadView = {
  ...downloadReady,
  title: 'Gemma 27B',
  explanation: 'Download a model to answer public requests while this page is open. Pause anytime.',
  sharingValues: ['compute'],
  confirm: 'Download & share',
  fit: '',
};

export const rename = { open: true, id: 'thread-1', value: 'Ocean tides' };

export const remotePermission = {
  key: 'attempt-1:approval-1',
  title: 'Send to another computer?',
  what: "To answer, this conversation is sent to contributors' computers on this network: your message, earlier messages in the thread, and the context prompt when it is on.",
  recipient: 'peer-b7f3c2',
};

export const pairingTarget: PairingTarget = { hostParticipantId: 'desktop-1', code: '482913', hostLabel: 'Studio desktop' };

export const activity: ReadonlyArray<CreditActivity> = [
  { key: 'a1', text: 'Answered 3 requests · +42 credits', at: '2026-11-25T14:02:00.000Z' },
  { key: 'a2', text: 'Asked Gemma 27B · −12 credits', at: '2026-11-25T13:40:00.000Z' },
];

export const fleetSignedIn = {
  available: true,
  busy: false,
  signedIn: true,
  hasAccount: true,
  status: 'Signed in · 1,240 service credits',
  starter: '',
  computers: [{ id: 'studio', name: 'Studio desktop', status: 'Online · serving Gemma 27B', removable: true }],
  activityKey: 'fleet-1',
  error: '',
  pairing: null,
};
export const fleetSignedOut = { ...fleetSignedIn, signedIn: false, hasAccount: false, status: 'Sign in to pair your computers and see your service credits.', computers: [] };

export const networkPeers: Partial<ComputersView> = {
  readiness: '2 computers ready',
  peers: [
    { id: 'peer-b', name: 'Contributor B', status: 'Ready · Gemma 27B', tone: 'ready', phase: 'ready', state: 'ready', model: 'Gemma 27B', hardware: 'Apple · M3 Max', detail: '', progress: null, quiet: false, blocked: false, reachable: true, eligibility: 'eligible', selection: [['Reachable', 'Yes'], ['Ready for Gemma 27B', 'Yes']], offers: 'Compute · Ready / Model files · Sharing', identity: '', members: [{ id: 'peer-b', identity: '' }], localName: '', blockNote: '', connection: [['Connection', 'Direct']], usage: [['Answers', '12']], ids: [['Computer', 'peer-b']] },
    { id: 'peer-c', name: 'Contributor C', status: 'Preparing · Gemma 27B', tone: 'pending', phase: 'loading', state: 'loading', model: 'Gemma 27B', hardware: null, detail: 'Loading weights', progress: { value: 40, max: 100 }, quiet: false, blocked: false, reachable: true, eligibility: 'loading', selection: [['Reachable', 'Yes'], ['Ready for Gemma 27B', 'No'], ['Why not used', 'Still loading the model']], offers: 'Compute · Preparing', identity: '', members: [{ id: 'peer-c', identity: '' }], localName: '', blockNote: '', connection: [], usage: [], ids: [['Computer', 'peer-c']] },
  ],
  empty: '',
};

export const yourComputers: Partial<ComputersView> = {
  ownerPairing: { status: 'Not paired', paired: false, busy: false, error: '' },
  privateComputers: { available: true, connected: false, hasRequester: false, status: 'Not connected', error: '', activityKey: '', computers: [] },
  circleInvites: true,
};
