// "Contribute this computer" and the composer's one model picker, as the React product shows them: the Computers pane
// (apps/poolday-react/src/features/computers) over the host's decisions (host/decisions/computers.js,
// contribution-models.js), and the conversation controller (host/decisions/conversation-controller.js).
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { PooldayRoot } from '@reploid/poolday-ui';
import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';
import { projectProduction } from '../../apps/poolday/ui/pool-home/contribution-models.js';
import { projectComputers } from '../../apps/poolday/host/decisions/computers.js';
import { createComputersServices } from '../../apps/poolday-react/src/features/computers/infrastructure/hostComputers';
import { ComputersPanel } from '../../apps/poolday-react/src/features/computers/presentation/ComputersPanel';
import { openConversation } from '../fixtures/conversation-view.js';

afterEach(cleanup);

const model = { id: 'm', name: 'Model', identity: 'fixture:model', provider: 'doppler', source: { baseUrl: 'fixture:' }, networkAvailability: 'ready' };
const state = () => ({ models: [model], network: { sharing: true, computeEnabled: true,
  contribution: { modelId: 'm', ready: true, phase: 'ready', completed: 2,
    production: { outputTokens: 14, missingTokenCounts: 0 } },
  files: { enabled: true, sharing: true, suppliedBytes: 394 } } });
type Snapshot = Record<string, unknown>;
const sessionOf = (snapshot: Snapshot, ports: Record<string, unknown> = {}) => ({ getState: () => snapshot, subscribe(fn: (value: Snapshot) => void) { fn(snapshot); return () => undefined; }, ...ports });
const metric = (view: ReturnType<typeof projectComputers>, name: string) => view.production.metrics.find(([term]: [string, string]) => term === name)?.[1];

function mount(session: object, onStartSharing = vi.fn()) {
  const services = createComputersServices({ host: { chat: session }, earning: Promise.resolve(null) });
  render(<PooldayRoot><ComputersPanel services={services} filter={null} onClearFilter={() => undefined} onStartSharing={onStartSharing} /></PooldayRoot>);
  return { services, onStartSharing };
}
const openDevice = () => userEvent.click(within(document.querySelector('[data-production-device]') as HTMLElement).getByText('Contribute this computer'));

it('does not confuse a ready network model with local preparation', () => {
  const view = projectProduction({ models: [model], network: {} });
  expect(view.available).toHaveLength(1);
  expect(view.local).toHaveLength(0);
  expect(view.configured).toBe(false);
});

it('keeps chat reachable with no capacity, downloaded models and busy peers', () => {
  const cold = { ...model, networkAvailability: 'unavailable' };
  for (const models of [[], [cold], [{ ...cold, localCached: true }], [{ ...model, networkAvailability: 'busy' }]]) {
    const view = openConversation(sessionOf({ models, network: {} }));
    expect(view.composer().send.visible).toBe(true);
    view.dispose();
  }
});

it('shows starter choices for saved sharing preferences with no downloaded models', () => {
  const snapshot = { models: [model], network: { sharing: false, computeEnabled: true,
    error: 'Peer connection timed out; check the invitation and network.',
    contribution: { modelId: 'm', ready: false, phase: 'idle', completed: 0 },
    files: { enabled: true, sharing: false, verifiedFiles: [], suppliedBytes: 0 } } };
  expect(projectProduction(snapshot).configured).toBeFalsy();
  expect(projectProduction(snapshot).local).toHaveLength(0);
  const view = projectComputers(snapshot);
  expect(view.production.setup).toBe(true);
  expect(view.production.metrics).toEqual([]);
  expect(view.production.error).toBe('');
});

it('uses shared preparation progress without treating a selected model as cached', () => {
  const snapshot = { models: [model], network: { contribution: { modelId: 'm', phase: 'loading',
    progress: { kind: 'downloading', receivedBytes: 50, totalBytes: 100 } } } };
  const view = projectProduction(snapshot);
  expect(view.local).toHaveLength(0);
  expect(view.status).toBe('Preparing');
  expect(view.progress).toMatchObject({ received: 50, total: 100 });
});

it('cancels an incoming model download without stopping existing sharing', async () => {
  const session = sessionOf({ ...state(), acquisition: { phase: 'downloading', modelId: 'second', progress: { receivedBytes: 10, totalBytes: 100 } } },
    { cancelModelDownload: vi.fn(), setSharing: vi.fn(), setFileSharing: vi.fn() });
  const { services } = mount(session);
  await services.device.cancelPreparation();
  expect(session.cancelModelDownload).toHaveBeenCalledOnce();
  expect(session.setSharing).not.toHaveBeenCalled(); expect(session.setFileSharing).not.toHaveBeenCalled();
});

it('shows waiting contribution capacity separately from completed work', () => {
  const snapshot = state(); snapshot.network.contribution.completed = 0;
  snapshot.network.contribution.production.outputTokens = 0;
  const view = projectComputers(snapshot);
  expect(view.production.work).toBe('Waiting for requests');
  expect(metric(view, 'Tokens produced')).toBe('0');
  expect(metric(view, 'Requests served')).toBe('0');
});

it('keeps missing output measurements unknown instead of reporting a partial total', () => {
  const snapshot = state(); snapshot.network.contribution.production.missingTokenCounts = 1;
  expect(projectProduction(snapshot).outputTokens).toBeNull();
});

it('opens reviewed setup without silently authorizing computation', async () => {
  const session = sessionOf({ models: [model], network: {} }, { setSharing: vi.fn() });
  const { onStartSharing } = mount(session);
  await openDevice();
  await userEvent.click(document.querySelector('[data-production-model="m"]') as HTMLElement);
  expect(onStartSharing).toHaveBeenCalledWith('m');
  expect(session.setSharing).not.toHaveBeenCalled();
});

it('starts with model actions and hides empty production counters', () => {
  const view = projectComputers({ models: [model], network: {} });
  expect(view.production.models.map((row: { name: string }) => row.name)).toEqual(['Model']);
  expect(view.production.metrics).toEqual([]);
  expect(view.production.local).toEqual([]);
  expect(view.device.summary).toBe('· Paused');
});

it('keeps one composer picker that changes the model and computer without starting work, preserving the draft', async () => {
  const local = { ...model, id: 'local', name: 'Local', networkAvailability: 'unavailable' };
  const snapshot = { models: [local, { ...model, quantization: 'q4f16_1', contextLength: 32768 }], network: {} };
  const session = sessionOf(snapshot, { createThread: vi.fn(async () => 'new-thread'), downloadLocalModel: vi.fn(), prepareLocalModel: vi.fn(), setSharing: vi.fn(),
    getModelDownload: vi.fn(), saveDraft: vi.fn(), select: vi.fn() });
  const view = openConversation(session, { viewState: { privacy: createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } }) } });
  view.controller.setDraft('Draft question');
  view.controller.openSheet();
  // Technical facts wait in the sheet's details; the computer is chosen directly.
  expect(view.sheet().detailsOpen).toBe(false);
  view.controller.pickComputer('network');
  view.controller.pickModel('m', { browsing: true });
  view.controller.commitSheet();
  await vi.waitFor(() => expect(view.sheet().open).toBe(false));
  expect(view.composer().draft).toBe('Draft question');
  expect(view.composer().chip.selectionId).toBe('m');
  expect(view.composer().chip.source).toBe('Contributors');
  expect(view.snapshot().focus.target).toBe('composer');
  expect(session.createThread).not.toHaveBeenCalled();
  expect(session.downloadLocalModel).not.toHaveBeenCalled();
  expect(session.prepareLocalModel).not.toHaveBeenCalled();
  expect(session.setSharing).not.toHaveBeenCalled();
  view.dispose();
});

it('puts network computers first and keeps usage and contribution in the owner disclosure', async () => {
  const snapshot = { ...state(), computerUsage: { supplied: { available: true, outputTokens: 14, unmeasured: 1, limit: 200 },
    consumed: { outputTokens: 9, unmeasured: 0 }, error: null } };
  const session = sessionOf(snapshot, { setComputeContribution: vi.fn(), setSharing: vi.fn() });
  const view = projectComputers(snapshot);
  expect(view.device.supplied).toBe('14 + unmeasured');
  expect(view.device.consumed).toBe('9');
  expect(view.device.computeOn).toBe(true);
  mount(session);
  // The device's contribution waits folded below the network computers.
  const pane = document.querySelector('[data-computers]') ?? document.body;
  const order = [...pane.querySelectorAll('[data-insp-device-list], [data-production-device]')].map(node => node.hasAttribute('data-insp-device-list') ? 'roster' : 'device');
  expect(order).toEqual(['roster', 'device']);
  await openDevice();
  await userEvent.click(screen.getByRole('switch', { name: 'Answer requests' }));
  await waitFor(() => expect(session.setComputeContribution).toHaveBeenCalledWith(false));
  expect(session.setSharing).not.toHaveBeenCalled();
});

it('keeps native service-credit debt and pending holds separate from browser token counts', async () => {
  const fleet = { connected: true, requester: { id: 'laptop', name: 'Native requester' }, computers: [], models: [] };
  const snapshot = { ...state(), privateComputers: fleet };
  const accounts = vi.fn(async () => ({ accounts: [{ id: 'mac', name: 'Mac', balance: -6, held: 2, available: -8 }] }));
  const { services } = mount(sessionOf(snapshot, { privateComputers: { state: () => fleet, accounts } }));
  const account = await services.privateComputers.account();
  expect(account.others).toBe('Other enrolled accounts: Mac · -6 credits · 2 credits held for unfinished answers · -8 credits available');
  // A host without the statement route says so instead of showing an empty history.
  expect(account.activity).toBeNull();
  expect(account.hasStatement).toBe(false);
  expect(projectComputers(snapshot).device.supplied).toBe('—');
});

it('shows the paying account, what it earned and spent, and saves the signed statement', async () => {
  const fleet = { connected: true, requester: { id: 'yours', name: 'Laptop' }, computers: [{ id: 'yours', activeRequests: 0 }],
    models: [{ id: 'small', name: 'Small model' }] };
  const snapshot = { ...state(), privateComputers: fleet };
  const accounts = vi.fn(async () => ({ accounts: [{ id: 'yours', name: 'Your computers', balance: 12, held: 0, available: 12 },
    { id: 'other', name: 'Another person', balance: -12, held: 0, available: -12 }] }));
  const statement = vi.fn(async () => ({ schema: 'reploid.fleet-credit-statement/v1', computerId: 'yours', balance: 12, held: 0,
    entries: [
      { sequence: 2, requestId: 'earned', delta: 32, at: 1000, request: { model: { id: 'small' } }, outcome: { outputTokens: 32 } },
      { sequence: 3, requestId: 'spent', delta: -20, at: 2000, request: { model: { id: 'small' } }, outcome: { outputTokens: 20 } }],
    expired: [{ requestId: 'dropped', request: { model: { id: 'small' }, createdAt: 3000 }, outcome: { status: 'expired', settledAt: 3500 } }] }));
  const { services } = mount(sessionOf(snapshot, { privateComputers: { state: () => fleet, accounts, statement } }));
  const account = await services.privateComputers.account();
  expect(account.own).toBe('Your account (Your computers): 12 credits');
  expect(account.activity?.map(row => row.text)).toEqual([
    'Hold released unclaimed for Small model · nothing charged',
    'Spent 20 credits asking Small model · 20 output tokens',
    'Earned 32 credits serving Small model · 32 output tokens']);
  expect(account.others).toBe('Other enrolled accounts: Another person · -12 credits');
  expect(account.hasStatement).toBe(true);
  URL.createObjectURL ??= () => 'blob:statement'; URL.revokeObjectURL ??= () => undefined;
  await services.privateComputers.saveStatement();
  expect(statement).toHaveBeenCalledTimes(2);
});

it('does not display zero consumption when another tab owns the conversation history', () => {
  const view = projectComputers({ ...state(), computerUsage: { consumed: { outputTokens: 0, available: false },
    error: 'Conversation usage is unavailable while another tab owns its history' } });
  expect(view.device.consumed).toBe('—');
  expect(view.device.usageError).not.toBe('');
});

it('keeps an exact model roster filtered as offers change and restores all computers on clear', () => {
  const selected = { ...model, providerIds: ['ready-a'], adapters: [{ id: 'variant', identity: 'adapter-a' }] };
  const peers = [
    { peerId: 'ready-a', model: model.id, modelIdentity: model.identity, readiness: 'ready', adapterIdentities: ['adapter-a', 'adapter-b'] },
    { peerId: 'other', model: 'other-model', modelIdentity: 'other-identity', readiness: 'ready' }];
  const ids = (view: ReturnType<typeof projectComputers>) => view.peers.map((row: { id: string }) => row.id);
  const snapshot = { models: [selected], network: { consumer: { peers } } };
  const filtered = projectComputers(snapshot, { filter: { model: selected } });
  expect(ids(filtered)).toEqual(['ready-a']);
  expect(filtered.filterLabel).toContain('Model');
  const changed = projectComputers({ ...snapshot, models: [{ ...selected, adapters: [{ id: 'other', identity: 'adapter-b' }] }] }, { filter: { model: selected } });
  expect(ids(changed)).toEqual([]);
  expect(changed.empty).toContain('No computer offers this model right now');
  expect(ids(projectComputers(snapshot))).toEqual(['ready-a', 'other']);
});

it('the sole picker shows one shared row per exact model variant, using its ready route', () => {
  const route = { ...model, selectionId: 'm/route', networkAvailability: 'ready', partition: { planId: 'plan' } };
  let snapshot: Snapshot = { models: [{ ...model, networkAvailability: 'unavailable' }, route], network: {} };
  const listeners = new Set<(value: Snapshot) => void>();
  const session = { getState: () => snapshot, subscribe(fn: (value: Snapshot) => void) { listeners.add(fn); return () => listeners.delete(fn); } };
  const view = openConversation(session);
  view.controller.openSheet();
  expect(view.modelRows()).toHaveLength(1);
  expect(view.sheet().routes.map((row: { selectionId: string }) => row.selectionId)).toContain('m/route');
  view.controller.pickModel('m/route', { browsing: true });
  expect(view.sheet().selectedKey).toBe('m/route');
  // Two ready execution routes still belong to one model variant.
  snapshot = { ...snapshot, models: [model, route] }; listeners.forEach(fn => fn(snapshot));
  expect(view.modelRows()).toHaveLength(1);
  expect(view.sheet().routes.map((row: { selectionId: string }) => row.selectionId)).toEqual(['m', 'm/route']);
  view.dispose();
});

it('loads model sizes without starting work and confirms the exact selected model', async () => {
  const session = sessionOf({ models: [model, { ...model, id: 'second', name: 'Second' },
    { id: 'remote', name: 'Remote only', networkAvailability: 'ready' }], network: {} },
  { getModelDownload: vi.fn(async (id: string) => ({ sizeBytes: id === 'm' ? 512000000 : 1200000000 })), setSharing: vi.fn() });
  const { onStartSharing } = mount(session);
  await openDevice();
  await waitFor(() => expect(document.querySelector('[data-production-model="second"]')?.textContent).toContain('1.2 GB'));
  expect(document.querySelectorAll('[data-production-model]')).toHaveLength(2);
  await userEvent.click(document.querySelector('[data-production-model="second"]') as HTMLElement);
  expect(onStartSharing).toHaveBeenCalledWith('second');
  expect(session.setSharing).not.toHaveBeenCalled();
});

it('offers a catalog adapter for this device to serve with its base model, by its exact selection', async () => {
  const adapted = { ...model, selectionId: 'm/specialist', name: 'Specialist', adapters: [{ identity: 'sha256:' + 'b'.repeat(64) }] };
  const session = sessionOf({ models: [model, adapted], network: {} },
    { getModelDownload: vi.fn(async (id: string) => ({ sizeBytes: id === 'm' ? 512000000 : 555000000 })), setSharing: vi.fn() });
  const { onStartSharing } = mount(session);
  await openDevice();
  await waitFor(() => expect(document.querySelector('[data-production-model="m/specialist"]')?.textContent).toContain('Specialist'));
  expect([...document.querySelectorAll('[data-production-model]')].map(node => (node as HTMLElement).dataset.productionModel)).toEqual(['m', 'm/specialist']);
  await userEvent.click(document.querySelector('[data-production-model="m/specialist"]') as HTMLElement);
  expect(onStartSharing).toHaveBeenCalledWith('m/specialist');
  expect(session.setSharing).not.toHaveBeenCalled();
});

it('blocks local model actions when the host reports missing browser support', async () => {
  const session = sessionOf({ models: [model], network: {}, localDownloadIssue: 'WebGPU unavailable' }, { getModelDownload: vi.fn() });
  const { onStartSharing } = mount(session);
  await openDevice();
  const button = document.querySelector('[data-production-model]') as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(onStartSharing).not.toHaveBeenCalled(); expect(session.getModelDownload).not.toHaveBeenCalled();
});

it('places compute sharing under Computers; file sharing is Settings storage', async () => {
  mount(sessionOf({ models: [], network: { files: { enabled: true, sharing: true, suppliedBytes: 10, verifiedFiles: [{ artifactId: 'file' }] } } }));
  await openDevice();
  const device = document.querySelector('[data-this-computer]') as HTMLElement;
  expect(within(device).queryByRole('switch', { name: 'Share model files' })).toBeNull();
  expect(within(device).getByRole('switch', { name: 'Answer requests' })).toBeTruthy();
  expect(projectComputers({ models: [], network: { files: { enabled: true, sharing: true, suppliedBytes: 10 } } }).production.metrics.map(([term]: [string]) => term)).toContain('Files sent');
});

it('stops compute independently, keeps cleanup errors visible, and leaves file sharing alone', async () => {
  const session = sessionOf(state(), { setComputeContribution: vi.fn(async () => { throw new Error('Unsettled GPU owner'); }), setFileSharing: vi.fn(async () => undefined) });
  mount(session);
  await openDevice();
  await userEvent.click(screen.getByRole('switch', { name: 'Answer requests' }));
  await waitFor(() => expect(document.querySelector('[data-network-message]')?.textContent).toContain('Unsettled GPU owner'));
  expect(session.setComputeContribution).toHaveBeenCalledWith(false);
  expect(session.setFileSharing).not.toHaveBeenCalled();
  expect(metric(projectComputers(state()), 'Tokens produced')).toBe('14');
});

it('enables compute through its host port independently of adapter setup and file selection', async () => {
  const adapted = { ...model, selectionId: 'm-adapted', adapters: [{ identity: 'adapter' }] };
  const session = sessionOf({ models: [model, adapted], network: { computeEnabled: false,
    contribution: { modelId: 'm', adapterIdentities: ['adapter'] }, files: { enabled: true, sharing: true } } },
  { getModelDownload: vi.fn(async () => ({ sizeBytes: 100 })), setComputeContribution: vi.fn(), setSharing: vi.fn(), setFileSharing: vi.fn() });
  mount(session);
  await openDevice();
  await userEvent.click(screen.getByRole('switch', { name: 'Answer requests' }));
  await waitFor(() => expect(session.setComputeContribution).toHaveBeenCalledWith(true));
  expect(session.setSharing).not.toHaveBeenCalled();
  expect(session.setFileSharing).not.toHaveBeenCalled();
});

it('renders session measurements without inventing earnings', () => {
  const view = projectComputers(state());
  expect(metric(view, 'Tokens produced')).toBe('14');
  expect(metric(view, 'Requests served')).toBe('2');
  expect(JSON.stringify(view.production.metrics)).not.toMatch(/earnings|\$/i);
});

it('distinguishes downloaded idle files from an explicit sharing opt-out', () => {
  const cached = { ...model, localCached: true, networkAvailability: 'unavailable' };
  expect(projectProduction({ models: [cached], network: {} }).status).toBe('Downloaded · not sharing');
  expect(projectProduction({ models: [cached], network: { computeEnabled: false, files: { enabled: false } } }).status).toBe('Paused');
});

it('shows retained executions while inactive without inventing earnings or token counts', () => {
  const view = projectComputers({ models: [model], network: { contributionHistory: { records: [
    { id: 'saved', modelId: 'm', modelIdentity: model.identity, completedAt: 1000, outputTokens: null }
  ] } } });
  expect(view.production.history.records.map((row: { model: string; tokens: string }) => `${row.model} ${row.tokens}`)).toEqual(['Model Token count unavailable']);
  expect(view.production.history.count).toBe('1');
});
