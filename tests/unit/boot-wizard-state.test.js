import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createMemoryStorage = () => {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    key(index) {
      return Array.from(values.keys())[index] || null;
    },
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
};

describe('boot wizard state persistence', () => {
  let storage;

  beforeEach(() => {
    storage = createMemoryStorage();
    vi.stubGlobal('localStorage', storage);
    window.REPLOID_INSTANCE_ID = null;
    window.getReploidRouteMode = () => 'zero';
  });

  afterEach(() => {
    delete window.REPLOID_INSTANCE_ID;
    delete window.getReploidRouteMode;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('defaults Zero cycle throttling to 7.7 seconds when no saved value exists', async () => {
    vi.resetModules();
    const module = await import('../../self/ui/boot-wizard/state.js');
    const {
      ZERO_GEMINI_MODEL,
      ZERO_GEMINI_SERVER_TYPE,
      buildZeroGeminiProxyConfig
    } = await import('../../self/config/zero-inference.js');

    expect(module.DEFAULT_CYCLE_INTERVAL_SECONDS).toBe(7.7);
    expect(ZERO_GEMINI_MODEL).toBe('gemini-3.1-flash-lite');
    expect(buildZeroGeminiProxyConfig({
      serverType: ZERO_GEMINI_SERVER_TYPE,
      model: 'gemini-3.5-flash'
    }).model).toBe('gemini-3.1-flash-lite');
    expect(module.normalizeCycleIntervalSeconds(null)).toBe(7.7);
    expect(module.normalizeCycleIntervalSeconds(undefined)).toBe(7.7);
    expect(module.normalizeCycleIntervalSeconds('')).toBe(7.7);
    expect(module.normalizeCycleIntervalSeconds('0')).toBe(0);
    expect(module.normalizeCycleIntervalSeconds('7.74')).toBe(7.7);
    expect(module.normalizeCycleIntervalSeconds('7.76')).toBe(7.8);
    expect(module.getState().cycleIntervalSeconds).toBe(7.7);

    module.setState({
      mode: 'zero',
      connectionType: 'proxy'
    });
    module.setNestedState('proxyConfig', {
      url: '/zero/gemini',
      endpoint: '/zero/gemini',
      serverType: ZERO_GEMINI_SERVER_TYPE,
      provider: 'gemini',
      model: 'gemini-3.1-flash-lite'
    });

    module.saveConfig();

    const selectedModels = JSON.parse(storage.getItem('SELECTED_MODELS'));
    expect(storage.getItem('REPLOID_CYCLE_INTERVAL_SECONDS')).toBe('7.7');
    expect(selectedModels[0].agentCycleThrottle).toEqual({
      cycleIntervalMs: 7700,
      cycleIntervalSeconds: 7.7
    });
  });

  it('persists Zero and X cycle throttling into the selected model config', async () => {
    vi.resetModules();
    const module = await import('../../self/ui/boot-wizard/state.js');
    const {
      ZERO_GEMINI_AGENT_THROTTLE,
      ZERO_GEMINI_SERVER_TYPE,
      ZERO_MANAGED_MAX_ITERATIONS
    } = await import('../../self/config/zero-inference.js');

    for (const [mode, cycleIntervalSeconds] of [['zero', 17], ['x', 23]]) {
      window.getReploidRouteMode = () => mode;
      module.resetWizard();
      module.setState({
        mode,
        connectionType: 'proxy',
        cycleIntervalSeconds
      });
      module.setNestedState('proxyConfig', {
        url: mode === 'zero' ? '/zero/gemini' : '/api/chat',
        endpoint: mode === 'zero' ? '/zero/gemini' : null,
        serverType: mode === 'zero' ? ZERO_GEMINI_SERVER_TYPE : 'reploid',
        provider: 'gemini',
        model: 'gemini-3.1-flash-lite'
      });

      module.saveConfig();

      const selectedModels = JSON.parse(storage.getItem('SELECTED_MODELS'));
      expect(storage.getItem('REPLOID_MODE')).toBe(mode);
      expect(storage.getItem('REPLOID_CYCLE_INTERVAL_SECONDS')).toBe(String(cycleIntervalSeconds));
      expect(selectedModels).toHaveLength(1);
      expect(selectedModels[0].agentCycleThrottle).toEqual({
        cycleIntervalMs: cycleIntervalSeconds * 1000,
        cycleIntervalSeconds
      });
      if (mode === 'zero') {
        expect(selectedModels[0]).toMatchObject({
          endpoint: '/zero/gemini',
          managedServerProxy: true,
          maxIterations: ZERO_MANAGED_MAX_ITERATIONS,
          agentThrottle: ZERO_GEMINI_AGENT_THROTTLE
        });
      }
    }
  });

  it('removes every cycle throttle key when forgetting the device', async () => {
    vi.resetModules();
    const module = await import('../../self/ui/boot-wizard/state.js');

    storage.setItem('REPLOID_CYCLE_INTERVAL_SECONDS', '9');
    storage.setItem('REPLOID_AGENT_CYCLE_THROTTLE', '{"cycleIntervalMs":9000}');
    storage.setItem('SELECTED_MODELS', '[]');

    module.forgetDevice();

    expect(storage.getItem('REPLOID_CYCLE_INTERVAL_SECONDS')).toBeNull();
    expect(storage.getItem('REPLOID_AGENT_CYCLE_THROTTLE')).toBeNull();
    expect(storage.getItem('SELECTED_MODELS')).toBeNull();
  });
});
