import { getState, setNestedState, VERIFY_STATE } from './state.js';
import { testApiKey, testProxyConnection, testLocalConnection, testProxyModel, testDirectModel } from './detection.js';
import { CLOUD_MODELS } from './steps/direct.js';
import { isZeroGeminiFunctionServer } from '../../config/zero-inference.js';

export function createConnectionTestHandlers({ onTesting = () => {} } = {}) {
  async function handleTestDirectKey() {
    const state = getState();
    let { provider, apiKey, baseUrl } = state.directConfig;

    const keyInput = document.getElementById('direct-key');
    const urlInput = document.getElementById('direct-base-url');
    if (keyInput?.value) apiKey = keyInput.value;
    if (urlInput?.value) baseUrl = urlInput.value;

    if (keyInput?.value) setNestedState('directConfig', { apiKey });
    if (urlInput?.value) setNestedState('directConfig', { baseUrl });

    if (!provider) {
      setNestedState('directConfig', {
        verifyState: VERIFY_STATE.FAILED,
        verifyError: 'Select a provider first'
      });
      return;
    }

    if (!apiKey) {
      setNestedState('directConfig', {
        verifyState: VERIFY_STATE.FAILED,
        verifyError: 'Enter an API key first'
      });
      return;
    }

    if (provider === 'other' && !baseUrl) {
      setNestedState('directConfig', {
        verifyState: VERIFY_STATE.FAILED,
        verifyError: 'Enter a base URL for custom provider'
      });
      return;
    }

    setNestedState('directConfig', { verifyState: VERIFY_STATE.TESTING, verifyError: null });
    onTesting();

    const result = await testApiKey(provider, apiKey, baseUrl);
    if (result.success) {
      const currentModel = getState().directConfig.model;
      const models = CLOUD_MODELS[provider] || [];
      const autoModel = !currentModel && models.length > 0 ? models[0].id : currentModel;
      setNestedState('directConfig', {
        verifyState: VERIFY_STATE.VERIFIED,
        verifyError: null,
        model: autoModel
      });
    } else {
      setNestedState('directConfig', {
        verifyState: VERIFY_STATE.FAILED,
        verifyError: result.error
      });
    }
  }

  async function handleTestProxy() {
    const state = getState();
    const { url, serverType } = state.proxyConfig;
    if (!url) return;

    setNestedState('proxyConfig', { verifyState: VERIFY_STATE.TESTING });
    onTesting();
    let result = await testProxyConnection(url, serverType);

    if (!result.success && !isZeroGeminiFunctionServer(serverType)) {
      result = await testLocalConnection(url);
      if (result.success) {
        setNestedState('proxyConfig', {
          serverType: 'ollama',
          availableModels: result.models || []
        });
      }
    } else if (result.success) {
      setNestedState('proxyConfig', {
        serverType: serverType || 'reploid',
        availableProviders: result.providers || []
      });
    }

    setNestedState('proxyConfig', {
      verifyState: result.success ? VERIFY_STATE.VERIFIED : VERIFY_STATE.FAILED,
      verifyError: result.error
    });
  }

  async function handleTestProxyModel() {
    const state = getState();
    const { url, provider, model, serverType } = state.proxyConfig;
    if (!model) return;

    setNestedState('proxyConfig', { modelVerifyState: VERIFY_STATE.TESTING, modelVerifyError: null });
    onTesting();

    const result = serverType === 'ollama'
      ? await testProxyModel(url, 'ollama', model)
      : await testProxyModel(url, provider, model, serverType);

    setNestedState('proxyConfig', {
      modelVerifyState: result.success ? VERIFY_STATE.VERIFIED : VERIFY_STATE.FAILED,
      modelVerifyError: result.error
    });
  }

  async function handleTestDirectModel() {
    const state = getState();
    const { provider, apiKey, model, baseUrl } = state.directConfig;
    if (!model || !apiKey) return;

    setNestedState('directConfig', { modelVerifyState: VERIFY_STATE.TESTING, modelVerifyError: null });
    onTesting();
    const result = await testDirectModel(provider, apiKey, model, baseUrl);
    setNestedState('directConfig', {
      modelVerifyState: result.success ? VERIFY_STATE.VERIFIED : VERIFY_STATE.FAILED,
      modelVerifyError: result.error
    });
  }
    return { handleTestDirectKey, handleTestProxy, handleTestProxyModel, handleTestDirectModel };
}
