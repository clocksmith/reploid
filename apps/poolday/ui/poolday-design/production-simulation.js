/** Local presentation fixture. No GPU, network, storage, receipts or earning records. */
import { bindProductionSurface } from '../pool-home/production.js';
import { renderNetworkInspector, bindNetworkInspector } from '../pool-home/network-inspector.js';
import { bindMathematicalBackground } from '../components/mathematical-background.js';
import { bindThemeSelector } from '../pool-home/theme.js';

export function createProductionSimulation({ tickMs = 250 } = {}) {
  const listeners = new Set(), timers = new Set(), drafts = new Map();
  const catalog = [
    { id: 'simulation-small', name: 'Qwen 3.5 0.8B', downloadBytes: 512 * 1024 * 1024 },
    { id: 'simulation-medium', name: 'Qwen 3.5 2B', downloadBytes: 1400 * 1024 * 1024 }
  ].map(model => ({ ...model, identity: 'fixture:' + model.id, provider: 'doppler', source: { baseUrl: 'fixture:' }, availability: 'unavailable', networkAvailability: 'unavailable', contextLength: 4096 }));
  let model = catalog[0], downloadBytes = model.downloadBytes;
  let state = { models: catalog, defaultModel: model, threads: [], selectedId: null,
    activeThread: null, runningIds: [], remoteAnswersEnabled: true,
    network: { computeEnabled: false, sharing: false, files: { enabled: false, sharing: false, suppliedBytes: 0 },
      contribution: { phase: 'idle', completed: 0, production: { outputTokens: 0, missingTokenCounts: 0 } } } };
  const emit = () => listeners.forEach(listener => listener(structuredClone(state)));
  const later = fn => { const timer = setTimeout(() => { timers.delete(timer); fn(); }, tickMs); timers.add(timer); };
  const clear = () => { timers.forEach(clearTimeout); timers.clear(); };
  const produce = () => {
    state.network.contribution.phase = 'executing'; emit();
    later(() => {
      if (!state.network.sharing) return;
      state.network.contribution.completed++;
      state.network.contribution.production.outputTokens += 32;
      state.network.contribution.phase = 'ready'; emit();
    });
  };
  const prepare = (id = model.id) => {
    model = catalog.find(item => item.id === id) || model; downloadBytes = model.downloadBytes;
    clear(); state.network.computeEnabled = true; state.network.sharing = true;
    state.network.contribution = { phase: 'loading', modelId: model.id, completed: 0,
      production: { outputTokens: 0, missingTokenCounts: 0 }, progress: { loadedBytes: 0, totalBytes: downloadBytes, message: 'Downloading' } };
    let received = 0;
    const download = () => {
      if (!state.network.sharing) return;
      received = Math.min(downloadBytes, received + downloadBytes / 4);
      state.network.contribution.progress = { loadedBytes: received, totalBytes: downloadBytes, message: `${received / 1048576} / ${downloadBytes / 1048576} MB` };
      if (received === downloadBytes) {
        state.models = state.models.map(item => item.id === model.id ? { ...item, localCached: true, localReady: true, availability: 'ready' } : item); state.network.contribution.phase = 'ready';
        emit(); later(produce);
      } else { emit(); later(download); }
    };
    emit(); later(download);
  };
  const session = {
    getState: () => structuredClone(state),
    subscribe(listener) { listeners.add(listener); listener(session.getState()); return () => listeners.delete(listener); },
    async connect() {},
    async disconnect() { state.network.paused = true; emit(); },
    setRemoteAnswersEnabled(enabled) { state.remoteAnswersEnabled = enabled; emit(); },
    async getModelDownload(id) { return { sizeBytes: catalog.find(item => item.id === id)?.downloadBytes || downloadBytes }; },
    async setSharing(enabled, id = model.id) {
      const selected = state.models.find(item => item.id === id) || model;
      if (enabled && !selected.localCached) { prepare(selected.id); return; }
      model = selected; state.network.contribution.modelId = model.id;
      state.models = state.models.map(item => ({ ...item, localReady: enabled && item.id === model.id, availability: enabled && item.id === model.id ? 'ready' : item.localCached ? 'cached' : 'unavailable' }));
      clear(); state.network.sharing = enabled; state.network.computeEnabled = enabled; state.network.contribution.phase = enabled ? 'ready' : 'idle'; emit();
    },
    async setFileSharing(enabled) {
      const verifiedFiles = state.models.filter(item => item.localCached).map(item => ({ artifactId: item.id, sizeBytes: item.downloadBytes }));
      state.network.files = { enabled, sharing: enabled && verifiedFiles.length > 0, verifiedFiles,
        suppliedBytes: enabled && verifiedFiles.length ? 394 : state.network.files.suppliedBytes };
      emit();
    },
    cancelModelDownload() { clear(); },
    getDraft: id => drafts.get(id), saveDraft: (id, draft) => drafts.set(id, draft),
    select(id) { state.selectedId = id; state.activeThread = state.threads.find(thread => thread.id === id) || null; emit(); },
    createThread({ model: chosen }) {
      const thread = { id: `simulation-${state.threads.length}`, title: 'Simulated request', model: chosen,
        permissions: { sharingScope: 'mesh' }, messages: [], attempts: [], grants: [], createdAt: Date.now() };
      state.threads.push(thread); session.select(thread.id); return thread.id;
    },
    async send(id, prompt) {
      const thread = state.threads.find(item => item.id === id), attemptId = `simulation-${Date.now()}`;
      const answer = { id: attemptId, role: 'assistant', attemptId, content: '' };
      const attempt = { id: attemptId, status: 'executing', createdAt: Date.now() };
      thread.messages.push({ id: attemptId + '-input', role: 'user', content: prompt }, answer);
      thread.attempts.push(attempt); state.runningIds = [id]; emit();
      for (const text of ['Simulated ', 'streaming ', 'answer.']) {
        await new Promise(resolve => setTimeout(resolve, tickMs));
        if (attempt.status === 'cancelled') return;
        answer.content += text; emit();
      }
      attempt.status = 'completed'; state.runningIds = []; emit();
    },
    cancel() { const attempt = state.activeThread?.attempts.at(-1); if (attempt) attempt.status = 'cancelled'; state.runningIds = []; emit(); },
    fail() { clear(); state.network.contribution.phase = 'failed'; state.network.contribution.error = 'Simulated preparation failure'; emit(); },
    prepare, produce,
    dispose() { clear(); listeners.clear(); }
  };
  return session;
}

/** One catalog specimen combines download, preparation, production, streaming and cancellation. */
export function bindProductionSimulation(root) {
  document.title = 'Reploid · UI simulation';
  const detachBackground = bindMathematicalBackground(root);
  const session = createProductionSimulation();
  root.insertAdjacentHTML('beforeend', renderNetworkInspector());
  const inspector = bindNetworkInspector(root, session);
  let themeChoice = root.dataset.poolTheme;
  const theme = bindThemeSelector(root.parentElement, { storage: { getItem: () => themeChoice, setItem: (_, value) => { themeChoice = value; } } });
  const detach = bindProductionSurface(root, session, { inspector });
  window.addEventListener('pagehide', () => { theme.dispose(); detachBackground(); detach(); inspector.dispose(); session.dispose(); }, { once: true });
}
