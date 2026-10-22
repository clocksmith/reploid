import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../self/ui/boot-wizard/detection.js', () => ({
  runDetection: vi.fn(async () => ({})),
  generateSeededGoalPrompt: vi.fn(async () => ({ goal: 'A generated objective', source: 'seed' }))
}));

vi.mock('../../self/boot-helpers/vfs-bootstrap.js', () => ({
  clearVfsStore: vi.fn(async () => {}),
  ensureVfsFileMirrors: vi.fn(async () => {}),
  loadVfsManifest: vi.fn(async () => ({ manifest: { files: [] }, text: '{}' })),
  seedVfsFromManifest: vi.fn(async () => {})
}));

const enabledResponse = (enabled = true) => ({
  ok: true,
  status: 200,
  json: async () => ({ enabled })
});

const deferred = () => {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
};

let state;
let home;
let root;
let fetchMock;

const click = (action) => {
  const button = root.querySelector(`[data-action="${action}"]`);
  expect(button, `Missing ${action} control`).not.toBeNull();
  button.click();
};

const importReplay = async (bundle, mode = 'x') => {
  home.initLockedBootHome(root, mode);
  await vi.waitFor(() => expect(root.querySelector('#run-replay-file-input')).not.toBeNull());
  const input = root.querySelector('#run-replay-file-input');
  Object.defineProperty(input, 'files', {
    value: [{ name: 'external-run.json', text: async () => JSON.stringify(bundle) }]
  });
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

const externalReplay = () => ({
  schema: 'reploid.run-replay.v1',
  mode: 'x',
  route: '/x',
  goal: 'Inspect the current workspace.',
  models: [{ id: 'external-brain', name: 'External brain', provider: 'external', hostType: 'direct' }],
  state: { externalConfig: { enabled: true, verifyState: 'verified' } }
});

const readySelection = async () => {
  home.initLockedBootHome(root, 'x');
  await vi.waitFor(() => expect(root.querySelector('[data-action="choose-external"]')).not.toBeNull());
  click('choose-external');
  await vi.waitFor(() => expect(state.canAwaken()).toBe(true));
  await vi.waitFor(() => expect(root.querySelector('#goal-input')).not.toBeNull());
};

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  window.REPLOID_INSTANCE_ID = null;
  window.getReploidRouteMode = () => 'x';
  window.getReploidBootProfile = () => 'x_home';
  window.triggerAwaken = vi.fn();
  vi.stubGlobal('location', new URL('http://localhost/x'));
  vi.stubGlobal('requestAnimationFrame', (callback) => {
    queueMicrotask(() => callback(0));
    return 1;
  });
  fetchMock = vi.fn(async () => enabledResponse());
  vi.stubGlobal('fetch', fetchMock);
  state = await import('../../self/ui/boot-wizard/state.js');
  home = await import('../../self/ui/boot-home/index.js');
  root = document.createElement('div');
  document.body.replaceChildren(root);
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  delete window.getReploidRouteMode;
  delete window.getReploidBootProfile;
  delete window.triggerAwaken;
  delete window.REPLOID_INSTANCE_ID;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('local X external brain selection', () => {
  it('keeps the external choice visible on local X when a proxy is detected', async () => {
    const { renderConnectionProviderOptions } = await import('../../self/ui/boot-wizard/steps/choose.js');
    const current = state.getState();
    const markup = renderConnectionProviderOptions({ ...current, mode: 'x', detection: {
      ...current.detection, proxy: { detected: true, url: 'http://localhost:8000' }
    } });
    root.innerHTML = markup;
    expect(root.querySelector('[data-action="choose-external"]')).not.toBeNull();
    expect(root.querySelector('[data-action="choose-proxy"]')).not.toBeNull();
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])('offers an explicit choice on %s without probing or starting automatically', async (hostname) => {
    vi.stubGlobal('location', new URL(`http://${hostname}/x`));
    home.initLockedBootHome(root, 'x');
    await vi.waitFor(() => expect(root.querySelector('[data-action="choose-external"]')).not.toBeNull());
    expect(state.getState().connectionType).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.triggerAwaken).not.toHaveBeenCalled();
  });

  it.each([
    ['zero', 'localhost'],
    ['reploid', 'localhost'],
    ['x', 'example.com'],
    ['x', 'localhost.example.com'],
    ['x', '192.168.1.20']
  ])('hides and rejects external inference for %s on %s', async (mode, hostname) => {
    vi.stubGlobal('location', new URL(`http://${hostname}/x`));
    window.getReploidRouteMode = () => mode;
    home.initLockedBootHome(root, mode);
    await vi.waitFor(() => expect(root.textContent).not.toBe(''));
    expect(root.querySelector('[data-action="choose-external"]')).toBeNull();
    state.setState({ connectionType: 'external' });
    state.setNestedState('externalConfig', { enabled: true, verifyState: state.VERIFY_STATE.VERIFIED });
    expect(state.canAwaken()).toBe(false);
    expect(state.saveConfig()).toBe(false);
    expect(localStorage.getItem('SELECTED_MODELS')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks only the same-origin mailbox and keeps the ordinary goal gate', async () => {
    await readySelection();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/external-brain/status', expect.objectContaining({
      method: 'GET',
      headers: { 'X-Reploid-External-Brain': '1' },
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error'
    }));
    expect(root.textContent).toContain('Mailbox ready. This does not mean dot is connected.');
    expect(root.querySelector('input[type="password"]')).toBeNull();
    expect(root.querySelector('#direct-base-url')).toBeNull();
    expect(root.querySelector('#awaken-btn').disabled).toBe(true);
    expect(window.triggerAwaken).not.toHaveBeenCalled();

    const goal = root.querySelector('#goal-input');
    goal.value = 'Inspect the current workspace without modifying it.';
    goal.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(root.querySelector('#awaken-btn').disabled).toBe(false));
    expect(window.triggerAwaken).not.toHaveBeenCalled();
  });

  it.each([
    ['disabled', () => enabledResponse(false)],
    ['unavailable', () => ({ ok: false, status: 503 })],
    ['malformed', () => ({ ok: true, status: 200, json: async () => ({ enabled: 'true' }) })],
    ['offline', () => { throw new TypeError('Failed to fetch'); }]
  ])('fails closed for a %s mailbox, shows setup, and permits an explicit retry', async (_name, response) => {
    fetchMock.mockImplementationOnce(async () => response());
    home.initLockedBootHome(root, 'x');
    await vi.waitFor(() => expect(root.querySelector('[data-action="choose-external"]')).not.toBeNull());
    click('choose-external');
    await vi.waitFor(() => expect(state.getState().externalConfig.verifyState).toBe(state.VERIFY_STATE.FAILED));
    expect(state.canAwaken()).toBe(false);
    await vi.waitFor(() => expect(root.textContent).toContain('REPLOID_EXTERNAL_BRAIN=true npm start'));
    expect(root.querySelector('#goal-input')).toBeNull();
    expect(window.triggerAwaken).not.toHaveBeenCalled();
    click('test-external-brain');
    await vi.waitFor(() => expect(state.canAwaken()).toBe(true));
  });

  it('times out a stalled mailbox check and leaves Awaken locked', async () => {
    fetchMock.mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    home.initLockedBootHome(root, 'x');
    await vi.waitFor(() => expect(root.querySelector('[data-action="choose-external"]')).not.toBeNull());
    vi.useFakeTimers();
    click('choose-external');
    await vi.advanceTimersByTimeAsync(3000);
    expect(state.getState().externalConfig.verifyState).toBe(state.VERIFY_STATE.FAILED);
    expect(state.getState().externalConfig.verifyError).toContain('timed out');
    expect(state.canAwaken()).toBe(false);
    expect(window.triggerAwaken).not.toHaveBeenCalled();
  });

  it.each([['zero', 'localhost'], ['reploid', 'localhost'], ['x', 'example.com']])(
    'does not hydrate saved external inference as a paid provider in %s on %s',
    async (mode, hostname) => {
      vi.stubGlobal('location', new URL(`http://${hostname}/x`));
      window.getReploidRouteMode = () => mode;
      localStorage.setItem('REPLOID_USE_OWN_INFERENCE', 'true');
      localStorage.setItem('SELECTED_MODELS', JSON.stringify([{
        id: 'external-brain', provider: 'external', hostType: 'direct'
      }]));
      home.initLockedBootHome(root, mode);
      state.hydrateSavedConfig(state.checkSavedConfig());
      await vi.waitFor(() => expect(root.textContent).not.toBe(''));
      expect(state.getState().connectionType).not.toBe('external');
      expect(state.getState().directConfig.provider).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(window.triggerAwaken).not.toHaveBeenCalled();
    }
  );

  it('persists only the external model, then reloads and rechecks without a key or autorun', async () => {
    await readySelection();
    state.setNestedState('directConfig', { provider: 'openai', model: 'paid-model', apiKey: 'unused-test-key' });
    state.setNestedState('externalConfig', { apiKey: 'ignore-me', endpoint: 'https://example.com/ignore' });
    state.setState({ goal: 'Inspect the current workspace.', cycleIntervalSeconds: 11 });
    const approvalState = { ...state.getState().advancedConfig };
    await vi.waitFor(() => expect(root.querySelector('#awaken-btn').disabled).toBe(false));
    click('awaken');
    await vi.waitFor(() => expect(window.triggerAwaken).toHaveBeenCalledTimes(1));

    const models = JSON.parse(localStorage.getItem('SELECTED_MODELS'));
    expect(models).toEqual([{
      id: 'external-brain',
      name: 'External brain',
      provider: 'external',
      hostType: 'direct',
      agentCycleThrottle: { cycleIntervalMs: 11000, cycleIntervalSeconds: 11 }
    }]);
    expect(localStorage.getItem('REPLOID_KEY_OPENAI')).toBeNull();
    expect(state.getState().advancedConfig).toEqual(approvalState);

    const nextProbe = deferred();
    fetchMock.mockImplementationOnce(() => nextProbe.promise);
    const nextRoot = document.createElement('div');
    document.body.replaceChildren(nextRoot);
    home.initLockedBootHome(nextRoot, 'x');
    expect(state.getState().connectionType).toBe('external');
    expect(state.canAwaken()).toBe(false);
    expect(state.getState().externalConfig.verifyState).toBe(state.VERIFY_STATE.TESTING);
    expect(window.triggerAwaken).toHaveBeenCalledTimes(1);
    nextProbe.resolve(enabledResponse());
    await vi.waitFor(() => expect(state.canAwaken()).toBe(true));
    expect(window.triggerAwaken).toHaveBeenCalledTimes(1);
  });

  it('rechecks the mailbox on Awaken and does not fall back when it becomes disabled', async () => {
    await readySelection();
    state.setState({ goal: 'Inspect the current workspace.' });
    await vi.waitFor(() => expect(root.querySelector('#awaken-btn').disabled).toBe(false));
    fetchMock.mockResolvedValueOnce(enabledResponse(false));
    click('awaken');
    await vi.waitFor(() => expect(state.getState().externalConfig.verifyState).toBe(state.VERIFY_STATE.FAILED));
    expect(state.getState().connectionType).toBe('external');
    expect(state.getState().isAwakening).toBe(false);
    expect(localStorage.getItem('SELECTED_MODELS')).toBeNull();
    expect(window.triggerAwaken).not.toHaveBeenCalled();
  });

  it('ignores a late probe after the user chooses another provider', async () => {
    const pending = deferred();
    fetchMock.mockImplementationOnce(() => pending.promise);
    home.initLockedBootHome(root, 'x');
    await vi.waitFor(() => expect(root.querySelector('[data-action="choose-external"]')).not.toBeNull());
    click('choose-external');
    expect(state.getState().externalConfig.verifyState).toBe(state.VERIFY_STATE.TESTING);
    click('choose-direct');
    pending.resolve(enabledResponse());
    await vi.waitFor(() => expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true));
    await Promise.resolve();
    expect(state.getState().connectionType).toBe('direct');
    expect(state.getState().externalConfig.enabled).toBe(false);
    expect(window.triggerAwaken).not.toHaveBeenCalled();
  });

  it('imports an external replay and probes locally rather than trusting its ready status', async () => {
    const pending = deferred();
    fetchMock.mockImplementationOnce(() => pending.promise);
    await importReplay(externalReplay());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(state.getState()).toMatchObject({
      connectionType: 'external',
      goal: 'Inspect the current workspace.',
      externalConfig: { enabled: false, verifyState: state.VERIFY_STATE.TESTING },
      runReplayImport: { status: 'ready' }
    });
    expect(state.getState().directConfig.provider).toBeNull();
    expect(state.canAwaken()).toBe(false);
    expect(window.triggerAwaken).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('SELECTED_MODELS'))).toEqual(externalReplay().models);
    pending.resolve(enabledResponse());
    await vi.waitFor(() => expect(state.canAwaken()).toBe(true));
    expect(window.triggerAwaken).not.toHaveBeenCalled();
  });

  it('keeps an imported external run selected but locked when the mailbox is disabled', async () => {
    fetchMock.mockResolvedValueOnce(enabledResponse(false));
    await importReplay(externalReplay());
    await vi.waitFor(() => expect(state.getState().externalConfig.verifyState).toBe(state.VERIFY_STATE.FAILED));
    expect(state.getState().connectionType).toBe('external');
    expect(state.canAwaken()).toBe(false);
    expect(state.getState().directConfig.provider).toBeNull();
    expect(window.triggerAwaken).not.toHaveBeenCalled();
  });

  it.each([
    ['zero', 'localhost', false],
    ['reploid', 'localhost', false],
    ['x', 'example.com', false],
    ['x', 'localhost', true]
  ])('rejects unsupported external import: mode=%s, host=%s, malformed=%s', async (mode, hostname, malformed) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('location', new URL(`http://${hostname}/x`));
    window.getReploidRouteMode = () => mode;
    const bundle = externalReplay();
    if (malformed) bundle.models[0].id = 'another-model';
    await importReplay(bundle, mode);
    await vi.waitFor(() => expect(state.getState().runReplayImport.status).toBe('error'));
    expect(state.getState().connectionType).not.toBe('external');
    expect(state.getState().directConfig.provider).toBeNull();
    expect(localStorage.getItem('SELECTED_MODELS')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.triggerAwaken).not.toHaveBeenCalled();
  });
});
