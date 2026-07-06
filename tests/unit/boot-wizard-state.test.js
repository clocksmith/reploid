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

  it('persists Zero and X cycle throttling into the selected model config', async () => {
    vi.resetModules();
    const module = await import('../../self/ui/boot-wizard/state.js');

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
        serverType: 'reploid',
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
