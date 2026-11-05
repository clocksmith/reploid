import { beforeEach, expect, it, vi } from 'vitest';
import { renderProductionSurface, bindProductionSurface, projectProduction } from '../../self/ui/pool-home/production.js';

const model = { id: 'm', name: 'Model', identity: 'fixture:model', provider: 'doppler', source: { baseUrl: 'fixture:' }, networkAvailability: 'ready' };
const state = () => ({ models: [model], network: { sharing: true, computeEnabled: true,
  contribution: { modelId: 'm', ready: true, phase: 'ready', completed: 2,
    production: { outputTokens: 14, missingTokenCounts: 0 } },
  files: { enabled: true, sharing: true, suppliedBytes: 394 } } });

beforeEach(() => { document.body.innerHTML = '<main class="pool-home">' + renderProductionSurface() + '</main>'; });

it('does not confuse a ready network model with local preparation', () => {
  const view = projectProduction({ models: [model], network: {} });
  expect(view.available).toHaveLength(1);
  expect(view.local).toHaveLength(0);
  expect(view.configured).toBe(false);
});

it('keeps chat reachable with no capacity, downloaded models and busy peers', () => {
  const cold = { ...model, networkAvailability: 'unavailable' };
  for (const models of [[], [cold], [{ ...cold, localCached: true }], [{ ...model, networkAvailability: 'busy' }]]) {
    const snapshot = { models, network: {} };
    const session = { getState: () => snapshot, subscribe(fn) { fn(snapshot); return () => {}; } };
    const detach = bindProductionSurface(document.body, session);
    expect(document.querySelector('[data-composer-input]')).not.toBeNull();
    expect(document.querySelector('[data-chat-rail-toolbar]')).not.toBeNull();
    expect(document.querySelector('.production-utilities').hidden).toBe(false); detach();
  }
});

it('shows starter choices for saved sharing preferences with no downloaded models', () => {
  const snapshot = { models: [model], network: { sharing: false, computeEnabled: true,
    error: 'Peer connection timed out; check the invitation and network.',
    contribution: { modelId: 'm', ready: false, phase: 'idle', completed: 0 },
    files: { enabled: true, sharing: false, verifiedFiles: [], suppliedBytes: 0 } } };
  expect(projectProduction(snapshot).configured).toBeFalsy();
  expect(projectProduction(snapshot).local).toHaveLength(0);
  const session = { getState: () => snapshot, subscribe(fn) { fn(snapshot); return () => {}; } };
  const detach = bindProductionSurface(document.body, session, { inspector: {} });
  expect(document.querySelector('[data-production-status]').textContent).toBe('Put this device to work');
  expect(document.querySelector('[data-production-setup-actions]').hidden).toBe(false);
  expect(document.querySelector('[data-production-metrics]').hidden).toBe(true);
  expect(document.querySelector('[data-production-error]').hidden).toBe(true); detach();
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
  const snapshot = { ...state(), acquisition: { phase: 'downloading', modelId: 'second', progress: { receivedBytes: 10, totalBytes: 100 } } };
  const session = { getState: () => snapshot, subscribe(fn) { fn(snapshot); return () => {}; },
    cancelModelDownload: vi.fn(), setSharing: vi.fn(), setFileSharing: vi.fn() };
  const detach = bindProductionSurface(document.body, session, { inspector: {} });
  document.querySelector('[data-production-cancel]').click();
  await vi.waitFor(() => expect(session.cancelModelDownload).toHaveBeenCalledOnce());
  expect(session.setSharing).not.toHaveBeenCalled(); expect(session.setFileSharing).not.toHaveBeenCalled(); detach();
});

it('shows waiting contribution capacity separately from completed work', () => {
  const snapshot = state(); snapshot.network.contribution.completed = 0;
  snapshot.network.contribution.production.outputTokens = 0;
  const session = { getState: () => snapshot, subscribe(fn) { fn(snapshot); return () => {}; } };
  const detach = bindProductionSurface(document.body, session, { inspector: {} });
  expect(document.querySelector('[data-production-work]').textContent).toBe('Waiting for requests');
  expect(document.querySelector('[data-production-tokens]').textContent).toBe('0');
  expect(document.querySelector('[data-production-completed]').textContent).toBe('0'); detach();
});

it('keeps missing output measurements unknown instead of reporting a partial total', () => {
  const snapshot = state(); snapshot.network.contribution.production.missingTokenCounts = 1;
  expect(projectProduction(snapshot).outputTokens).toBeNull();
});

it('opens reviewed setup without silently authorizing computation', () => {
  const snapshot = { models: [model], network: {} };
  const session = { getState: () => snapshot, subscribe(fn) { fn(snapshot); return () => {}; }, setSharing: vi.fn() };
  const inspector = { contribute: vi.fn() };
  const detach = bindProductionSurface(document.body, session, { inspector });
  document.querySelector('[data-production-model]').click();
  expect(inspector.contribute).toHaveBeenCalledOnce();
  expect(session.setSharing).not.toHaveBeenCalled(); detach();
});

it('starts with model actions and hides empty production counters', () => {
  const snapshot = { models: [model], network: {} };
  const session = { getState: () => snapshot, subscribe(fn) { fn(snapshot); return () => {}; } };
  const detach = bindProductionSurface(document.body, session, { inspector: {} });
  expect(document.querySelector('[data-production-model]').textContent).toBe('Model');
  expect(document.querySelector('[data-production-status]').textContent).toBe('Put this device to work');
  expect(document.querySelector('[data-production-metrics]').hidden).toBe(true);
  expect(document.querySelector('[data-production-local]').hidden).toBe(true);
  expect(document.querySelector('[data-production-pause]').hidden).toBe(true);
  expect(document.querySelector('[data-shared-model-name]').textContent).toBe('Model');
  expect(document.querySelector('[data-shared-model-status]').textContent).toBe('Ready'); detach();
});

it('puts usable shared models above the composer and collapsed contribution below, preserving drafts on selection', () => {
  const local = { ...model, id: 'local', name: 'Local', networkAvailability: 'unavailable' };
  const snapshot = { models: [local, { ...model, quantization: 'q4f16_1', contextLength: 32768 }], network: {} };
  const session = { getState: () => snapshot, subscribe(fn) { fn(snapshot); return () => {}; },
    createThread: vi.fn(async () => 'new-thread'), downloadLocalModel: vi.fn(), prepareLocalModel: vi.fn(), setSharing: vi.fn(),
    getModelDownload: vi.fn(), saveDraft: vi.fn() };
  const detach = bindProductionSurface(document.body, session);
  const shared = document.querySelector('[data-production-shared]');
  const composer = document.querySelector('[data-composer-area]');
  const device = document.querySelector('[data-production-device]');
  expect(shared.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(composer.compareDocumentPosition(device) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(device.open).toBe(false);
  expect(document.querySelector('[data-production-summary-status]').textContent).toBe('Not set up');
  // The chooser is a heading, one status line and the rows; routes, providers, limits and execution location are read in the picker.
  expect(shared.querySelector('[data-model-providers]')).toBeNull();
  expect(shared.querySelector('[data-execution-location]')).toBeNull();
  expect(shared.querySelector('button:not([data-production-use])')).toBeNull();
  // Weights, context and availability are read once, on each choice; the picker repeats none of them below the list.
  expect(document.querySelector('[data-model-facts]')).toBeNull();
  expect(document.querySelector('[data-model-picker] [data-model-providers]')).not.toBeNull();
  expect(document.querySelector('[data-model-picker] [data-execution-location]')).not.toBeNull();
  const input = document.querySelector('[data-composer-input]');
  input.value = 'Draft question';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  session.getModelDownload.mockClear();
  document.querySelector('[data-production-use="m"]').click();
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe('Draft question');
  expect(document.querySelector('[data-active-model-select]').value).toBe('m');
  expect(document.querySelector('[data-execution-choice="network"]').getAttribute('aria-pressed')).toBe('true');
  expect(session.createThread).not.toHaveBeenCalled();
  expect(session.downloadLocalModel).not.toHaveBeenCalled();
  expect(session.prepareLocalModel).not.toHaveBeenCalled();
  expect(session.getModelDownload).not.toHaveBeenCalled();
  expect(session.setSharing).not.toHaveBeenCalled(); detach();
});

it('removes departed shared models and hides the shared chooser when a thread is active', () => {
  const snapshot = { models: [model], network: {} }; let update;
  const session = { getState: () => snapshot, subscribe(fn) { update = fn; fn(snapshot); return () => {}; } };
  const detach = bindProductionSurface(document.body, session);
  expect(document.querySelector('[data-production-shared]').hidden).toBe(false);
  snapshot.models = [{ ...model, networkAvailability: 'unavailable' }]; update(snapshot);
  expect(document.querySelector('[data-production-use]')).toBeNull();
  snapshot.activeThread = { id: 'thread-1', model, messages: [], attempts: [] }; update(snapshot);
  expect(document.querySelector('[data-production-shared]').hidden).toBe(true); detach();
});

it('shows one shared row per exact model variant, using its ready route', () => {
  const route = { ...model, selectionId: 'm/route', networkAvailability: 'ready', partition: { planId: 'plan' } };
  const snapshot = { models: [{ ...model, networkAvailability: 'unavailable' }, route], network: {} }; let update;
  const session = { getState: () => snapshot, subscribe(fn) { update = fn; fn(snapshot); return () => {}; } };
  const detach = bindProductionSurface(document.body, session);
  expect([...document.querySelectorAll('[data-production-use]')].map(node => node.dataset.productionUse)).toEqual(['m/route']);
  expect(document.querySelector('[data-production-network-status]').textContent).toBe('1 shared model');
  // With the whole model ready too, the same row stands for both routes and prefers the whole model.
  snapshot.models = [model, route]; update(snapshot);
  expect([...document.querySelectorAll('[data-production-use]')].map(node => node.dataset.productionUse)).toEqual(['m']);
  expect(document.querySelector('[data-production-network-status]').textContent).toBe('1 shared model'); detach();
});

it('loads model sizes without starting work and confirms the exact selected model', async () => {
  const snapshot = { models: [model, { ...model, id: 'second', name: 'Second' },
    { id: 'remote', name: 'Remote only', networkAvailability: 'ready' }], network: {} };
  const session = { getState: () => snapshot, subscribe(fn) { fn(snapshot); return () => {}; },
    getModelDownload: vi.fn(async id => ({ sizeBytes: id === 'm' ? 512000000 : 1200000000 })), setSharing: vi.fn() };
  const inspector = { contribute: vi.fn() };
  const detach = bindProductionSurface(document.body, session, { inspector });
  await vi.waitFor(() => expect(document.querySelector('[data-production-model="second"]').textContent).toContain('1.2 GB'));
  expect(document.querySelectorAll('[data-production-model]')).toHaveLength(2);
  const button = document.querySelector('[data-production-model="second"]'); button.click();
  expect(inspector.contribute).toHaveBeenCalledWith('second', button);
  expect(session.setSharing).not.toHaveBeenCalled(); detach();
});

it('offers a catalog adapter for this device to serve with its base model, by its exact selection', async () => {
  const adapted = { ...model, selectionId: 'm/specialist', name: 'Specialist', adapters: [{ identity: 'sha256:' + 'b'.repeat(64) }] };
  const snapshot = { models: [model, adapted], network: {} };
  const session = { getState: () => snapshot, subscribe(fn) { fn(snapshot); return () => {}; },
    getModelDownload: vi.fn(async id => ({ sizeBytes: id === 'm' ? 512000000 : 555000000 })), setSharing: vi.fn() };
  const inspector = { contribute: vi.fn() };
  const detach = bindProductionSurface(document.body, session, { inspector });
  await vi.waitFor(() => expect(document.querySelector('[data-production-model="m/specialist"]').textContent).toContain('Specialist'));
  expect([...document.querySelectorAll('[data-production-model]')].map(node => node.dataset.productionModel)).toEqual(['m', 'm/specialist']);
  const button = document.querySelector('[data-production-model="m/specialist"]'); button.click();
  expect(inspector.contribute).toHaveBeenCalledWith('m/specialist', button);
  expect(session.setSharing).not.toHaveBeenCalled(); detach();
});

it('blocks local model actions when the host reports missing browser support', () => {
  const snapshot = { models: [model], network: {}, localDownloadIssue: 'WebGPU unavailable' };
  const session = { getState: () => snapshot, subscribe(fn) { fn(snapshot); return () => {}; }, getModelDownload: vi.fn() };
  const inspector = { contribute: vi.fn() };
  const detach = bindProductionSurface(document.body, session, { inspector });
  const button = document.querySelector('[data-production-model]'); button.click();
  expect(button.disabled).toBe(true);
  expect(inspector.contribute).not.toHaveBeenCalled(); expect(session.getModelDownload).not.toHaveBeenCalled(); detach();
});

it('keeps pause available for storage-only sharing', () => {
  const snapshot = { models: [], network: { files: { enabled: true, sharing: true, suppliedBytes: 10, verifiedFiles: [{ artifactId: 'file' }] } } };
  const session = { getState: () => snapshot, subscribe(fn) { fn(snapshot); return () => {}; } };
  const detach = bindProductionSurface(document.body, session, { inspector: {} });
  expect(document.querySelector('[data-production-pause]').hidden).toBe(false);
  expect(document.querySelector('[data-production-file-metric]').hidden).toBe(false); detach();
});

it('attempts to stop files even when compute cleanup fails and keeps the failure visible', async () => {
  const snapshot = state();
  const session = { getState: () => snapshot, subscribe(fn) { fn(snapshot); return () => {}; },
    setSharing: vi.fn(async () => { throw new Error('Unsettled GPU owner'); }), setFileSharing: vi.fn(async () => {}) };
  const detach = bindProductionSurface(document.body, session, { inspector: {} });
  document.querySelector('[data-production-pause]').click();
  await vi.waitFor(() => expect(document.querySelector('[data-production-error]').textContent).toContain('Could not pause all sharing'));
  expect(session.setSharing).toHaveBeenCalledWith(false, 'm', false);
  expect(session.setFileSharing).toHaveBeenCalledWith(false, 'm', false);
  expect(document.querySelector('[data-production-tokens]').textContent).toBe('14'); detach();
});

it('resumes only the previously selected model after an explicit pause', async () => {
  const snapshot = state(), listeners = new Set();
  const emit = () => listeners.forEach(fn => fn(snapshot));
  const session = { getState: () => snapshot, subscribe(fn) { listeners.add(fn); fn(snapshot); return () => listeners.delete(fn); },
    setSharing: vi.fn(async enabled => { snapshot.network.sharing = enabled; snapshot.network.computeEnabled = enabled; emit(); }),
    setFileSharing: vi.fn(async enabled => { snapshot.network.files.sharing = enabled; snapshot.network.files.enabled = enabled; emit(); }) };
  const detach = bindProductionSurface(document.body, session, { inspector: {} });
  const pause = document.querySelector('[data-production-pause]'); pause.click();
  await vi.waitFor(() => expect(pause.disabled).toBe(false)); expect(pause.textContent).toBe('Resume');
  pause.click(); await vi.waitFor(() => expect(pause.textContent).toBe('Pause'));
  expect(session.setSharing).toHaveBeenLastCalledWith(true, 'm', true); detach();
});

it('renders session measurements and keeps requester navigation available', () => {
  const snapshot = state(), session = { getState: () => snapshot, subscribe(fn) { fn(snapshot); return () => {}; } };
  const detach = bindProductionSurface(document.body, session, { inspector: {} });
  expect(document.querySelector('[data-production-tokens]').textContent).toBe('14');
  expect(document.querySelector('[data-production-completed]').textContent).toBe('2');
  expect(document.querySelector('[data-production-summary-status]').textContent).toBe('Sharing');
  expect(document.querySelector('[data-composer-input]')).not.toBeNull();
  expect(document.querySelector('[data-production-metrics]').textContent).not.toMatch(/earnings|\$/i); detach();
});

it('distinguishes downloaded idle files from an explicit sharing opt-out', () => {
  const cached = { ...model, localCached: true, networkAvailability: 'unavailable' };
  expect(projectProduction({ models: [cached], network: {} }).status).toBe('Downloaded · not sharing');
  expect(projectProduction({ models: [cached], network: { computeEnabled: false, files: { enabled: false } } }).status).toBe('Paused');
});

it('shows retained executions while inactive without inventing earnings or token counts', () => {
  const snapshot = { models: [model], network: { contributionHistory: { records: [
    { id: 'saved', modelId: 'm', modelIdentity: model.identity, completedAt: 1000, outputTokens: null }
  ] } } };
  const session = { getState: () => snapshot, subscribe(fn) { fn(snapshot); return () => {}; } };
  const detach = bindProductionSurface(document.body, session);
  expect(document.querySelector('[data-production-history-records]').textContent).toContain('Model');
  expect(document.querySelector('[data-production-history-records]').textContent).toContain('Token count unavailable');
  expect(document.querySelector('[data-production-history-count]').textContent).toBe('1'); detach();
});
