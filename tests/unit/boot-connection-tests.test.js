import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createConnectionTestHandlers } from '../../self/ui/boot-wizard/connection-tests.js';
import { getState, resetWizard, setNestedState, VERIFY_STATE } from '../../self/ui/boot-wizard/state.js';
import { ZERO_GEMINI_SERVER_TYPE } from '../../self/config/zero-inference.js';
import * as probes from '../../self/ui/boot-wizard/detection.js';

vi.mock('../../self/ui/boot-wizard/detection.js', () => ({
  testApiKey: vi.fn(), testProxyConnection: vi.fn(), testLocalConnection: vi.fn(),
  testProxyModel: vi.fn(), testDirectModel: vi.fn()
}));

beforeEach(() => { vi.clearAllMocks(); resetWizard(); });
afterEach(() => { document.body.innerHTML = ''; });

it('reads current form values before probing and updates the same shared state', async () => {
  document.body.innerHTML = '<input id="direct-key" value="test-key"><input id="direct-base-url" value="http://localhost:1234">';
  setNestedState('directConfig', { provider: 'other', apiKey: 'stale', baseUrl: 'stale' });
  probes.testApiKey.mockResolvedValue({ success: true });
  const onTesting = vi.fn();
  await createConnectionTestHandlers({ onTesting }).handleTestDirectKey();
  expect(probes.testApiKey).toHaveBeenCalledWith('other', 'test-key', 'http://localhost:1234');
  expect(getState().directConfig.verifyState).toBe(VERIFY_STATE.VERIFIED);
  expect(onTesting).toHaveBeenCalledTimes(1);
});

it('never substitutes a local provider for a failed managed Gemini probe', async () => {
  setNestedState('proxyConfig', { url: '/zero/gemini', serverType: ZERO_GEMINI_SERVER_TYPE });
  probes.testProxyConnection.mockResolvedValue({ success: false, error: 'unauthorized' });
  await createConnectionTestHandlers().handleTestProxy();
  expect(probes.testLocalConnection).not.toHaveBeenCalled();
  expect(getState().proxyConfig.verifyError).toBe('unauthorized');
});

it('preserves the ordinary proxy probe fallback without changing managed policy', async () => {
  setNestedState('proxyConfig', { url: 'http://localhost:11434', serverType: 'reploid' });
  probes.testProxyConnection.mockResolvedValue({ success: false });
  probes.testLocalConnection.mockResolvedValue({ success: true, models: ['local-model'] });
  await createConnectionTestHandlers().handleTestProxy();
  expect(getState().proxyConfig).toMatchObject({ serverType: 'ollama', availableModels: ['local-model'], verifyState: VERIFY_STATE.VERIFIED });
});
