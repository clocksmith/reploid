# Blueprint 0x00008F-LLMCFG: LLM Config Panel

**Objective:** Provide a comprehensive runtime configuration panel for LLM model selection, provider management, parameter tuning, and connection testing.

**Target Module:** `LLMConfigPanel`

**Implementation:** `/ui/panels/llm-config-panel.js`

**Prerequisites:** `0x000003` (Core Utilities), `0x000058` (Event Bus), `0x000007` (LLM Client), `0x000021` (Multi-Provider API Gateway)

**Category:** UI

---

## 1. The Strategic Imperative

Dynamic LLM configuration is essential for a flexible agent substrate:
- Users need to switch between providers (OpenAI, Anthropic, local) at runtime
- Model selection allows optimizing for cost, speed, or capability
- Parameter tuning enables experimentation with generation behavior
- Connection testing validates API keys and network connectivity

**The LLM Config Panel** provides:
- **Provider Selection**: Dropdown to choose between API providers
- **Model Selection**: Dynamic model list based on selected provider
- **Parameter Tuning**: Sliders/inputs for temperature, top_p, max_tokens
- **Test Connection**: Validate credentials and connectivity
- **Status Display**: Real-time model load state and WebGPU availability

This panel is the **control center** for LLM runtime configuration.

---

## 2. The Architectural Solution

The LLM Config Panel uses a **Web Component architecture** with Shadow DOM for encapsulated rendering and event-driven updates.

### Key Components

**1. Provider Configuration**

Supported providers with their capabilities:

```javascript
const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    icon: '☁',
    models: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    requiresApiKey: true,
    supportsStreaming: true
  },
  anthropic: {
    name: 'Anthropic',
    icon: '☁',
    models: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'],
    requiresApiKey: true,
    supportsStreaming: true
  },
  local: {
    name: 'Local (WebGPU)',
    icon: '[U+2699]',  // Settings symbol
    models: ['gemma-2b-q4', 'phi-2-q4', 'tinyllama-q4'],
    requiresApiKey: false,
    supportsStreaming: true,
    requiresWebGPU: true
  },
  ollama: {
    name: 'Ollama',
    icon: '☍',
    models: [],  // Fetched dynamically
    requiresApiKey: false,
    supportsStreaming: true,
    endpoint: 'http://localhost:11434'
  }
};
```

**2. Model Selection**

Dynamic model list based on provider:

```javascript
function updateModelList(provider) {
  const models = PROVIDERS[provider].models;
  modelSelect.innerHTML = models.map(m =>
    `<option value="${m}">${m}</option>`
  ).join('');

  // For Ollama, fetch available models
  if (provider === 'ollama') {
    fetchOllamaModels().then(models => {
      modelSelect.innerHTML = models.map(m =>
        `<option value="${m.name}">${m.name}</option>`
      ).join('');
    });
  }
}
```

**3. Parameter Configuration**

Tunable generation parameters:

```javascript
const PARAMETERS = {
  temperature: {
    label: 'Temperature',
    min: 0,
    max: 2,
    step: 0.1,
    default: 0.7,
    description: 'Controls randomness. Lower = more focused, higher = more creative'
  },
  top_p: {
    label: 'Top P',
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.9,
    description: 'Nucleus sampling threshold'
  },
  max_tokens: {
    label: 'Max Tokens',
    min: 64,
    max: 8192,
    step: 64,
    default: 2048,
    description: 'Maximum response length'
  },
  frequency_penalty: {
    label: 'Frequency Penalty',
    min: 0,
    max: 2,
    step: 0.1,
    default: 0,
    description: 'Reduces repetition of frequent tokens'
  },
  presence_penalty: {
    label: 'Presence Penalty',
    min: 0,
    max: 2,
    step: 0.1,
    default: 0,
    description: 'Reduces repetition of any used tokens'
  }
};
```

**4. Connection Testing**

Validate API connectivity:

```javascript
async function testConnection() {
  const config = getConfig();
  setStatus('testing');

  try {
    const result = await LLMClient.testConnection(config);

    if (result.success) {
      setStatus('connected', `Connected to ${config.provider}`);
      EventBus.emit('llm:connection-verified', { provider: config.provider });
    } else {
      setStatus('error', result.error);
    }
  } catch (error) {
    setStatus('error', error.message);
  }
}
```

**5. Web Component Widget**

```javascript
class LLMConfigPanelWidget extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {
      provider: 'openai',
      model: 'gpt-4',
      parameters: { ...DEFAULT_PARAMETERS }
    };
    this._status = 'idle';
    this._webgpuAvailable = false;
  }

  connectedCallback() {
    this._checkWebGPU();
    this.render();

    EventBus.on('llm:model-loaded', this._onModelLoaded.bind(this));
    EventBus.on('llm:model-error', this._onModelError.bind(this));
    EventBus.on('llm:connection-verified', this._onConnectionVerified.bind(this));
  }

  disconnectedCallback() {
    EventBus.off('llm:model-loaded', this._onModelLoaded);
    EventBus.off('llm:model-error', this._onModelError);
    EventBus.off('llm:connection-verified', this._onConnectionVerified);
  }

  async _checkWebGPU() {
    if (navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        this._webgpuAvailable = !!adapter;
      } catch (e) {
        this._webgpuAvailable = false;
      }
    }
    this.render();
  }

  getStatus() {
    return {
      state: this._status === 'connected' ? 'active' :
             this._status === 'error' ? 'error' : 'idle',
      primaryMetric: `${this._config.provider}/${this._config.model}`,
      secondaryMetric: this._webgpuAvailable ? 'WebGPU Ready' : 'CPU Only',
      lastActivity: this._lastConfigChange,
      message: this._statusMessage || 'Configure LLM settings'
    };
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: monospace;
          color: #e0e0e0;
        }
        .panel-content {
          padding: 16px;
          background: #1a1a1a;
          border-radius: 4px;
        }
        .section {
          margin-bottom: 20px;
        }
        .section-title {
          font-size: 14px;
          color: #8ab4f8;
          margin-bottom: 12px;
          border-bottom: 1px solid #333;
          padding-bottom: 4px;
        }
        .form-group {
          margin-bottom: 12px;
        }
        label {
          display: block;
          font-size: 12px;
          color: #aaa;
          margin-bottom: 4px;
        }
        select, input[type="text"], input[type="password"] {
          width: 100%;
          padding: 8px;
          background: #2a2a2a;
          border: 1px solid #444;
          border-radius: 3px;
          color: #e0e0e0;
          font-family: monospace;
        }
        select:focus, input:focus {
          border-color: #8ab4f8;
          outline: none;
        }
        .slider-group {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        input[type="range"] {
          flex: 1;
          accent-color: #8ab4f8;
        }
        .slider-value {
          min-width: 48px;
          text-align: right;
          color: #8ab4f8;
        }
        .description {
          font-size: 11px;
          color: #666;
          margin-top: 4px;
        }
        .status-bar {
          display: flex;
          align-items: center;
          padding: 8px 12px;
          background: #2a2a2a;
          border-radius: 3px;
          margin-bottom: 16px;
        }
        .status-icon {
          margin-right: 8px;
          font-size: 16px;
        }
        .status-icon.ready { color: #0c0; }
        .status-icon.error { color: #f00; }
        .status-icon.testing { color: #ff0; }
        .status-text {
          flex: 1;
        }
        .webgpu-badge {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 3px;
        }
        .webgpu-badge.available {
          background: #0a3d0a;
          color: #0f0;
        }
        .webgpu-badge.unavailable {
          background: #3d2a0a;
          color: #fa0;
        }
        button {
          padding: 8px 16px;
          background: #333;
          color: #e0e0e0;
          border: 1px solid #555;
          border-radius: 3px;
          cursor: pointer;
          font-family: monospace;
        }
        button:hover:not(:disabled) {
          background: #444;
        }
        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        button.primary {
          background: #1a4d1a;
          border-color: #2a6d2a;
        }
        button.primary:hover:not(:disabled) {
          background: #2a5d2a;
        }
        .button-row {
          display: flex;
          gap: 8px;
          margin-top: 16px;
        }
      </style>

      <div class="panel-content">
        <!-- Status Bar -->
        <div class="status-bar">
          <span class="status-icon ${this._status}">${this._getStatusIcon()}</span>
          <span class="status-text">${this._statusMessage || 'Not connected'}</span>
          <span class="webgpu-badge ${this._webgpuAvailable ? 'available' : 'unavailable'}">
            ${this._webgpuAvailable ? '[U+2713] WebGPU' : '[U+26A1] No WebGPU'}
          </span>
        </div>

        <!-- Provider Section -->
        <div class="section">
          <div class="section-title">Provider</div>
          <div class="form-group">
            <label>LLM Provider</label>
            <select id="provider-select">
              ${Object.entries(PROVIDERS).map(([key, p]) => `
                <option value="${key}" ${key === this._config.provider ? 'selected' : ''}>
                  ${p.icon} ${p.name}
                </option>
              `).join('')}
            </select>
          </div>
          <div class="form-group" id="api-key-group" style="display: ${PROVIDERS[this._config.provider].requiresApiKey ? 'block' : 'none'}">
            <label>API Key</label>
            <input type="password" id="api-key" placeholder="Enter API key..." />
          </div>
        </div>

        <!-- Model Section -->
        <div class="section">
          <div class="section-title">Model</div>
          <div class="form-group">
            <label>Select Model</label>
            <select id="model-select">
              ${PROVIDERS[this._config.provider].models.map(m => `
                <option value="${m}" ${m === this._config.model ? 'selected' : ''}>${m}</option>
              `).join('')}
            </select>
          </div>
        </div>

        <!-- Parameters Section -->
        <div class="section">
          <div class="section-title">Parameters</div>
          ${Object.entries(PARAMETERS).map(([key, param]) => `
            <div class="form-group">
              <label>${param.label}</label>
              <div class="slider-group">
                <input type="range"
                  id="param-${key}"
                  min="${param.min}"
                  max="${param.max}"
                  step="${param.step}"
                  value="${this._config.parameters[key] || param.default}" />
                <span class="slider-value" id="value-${key}">
                  ${this._config.parameters[key] || param.default}
                </span>
              </div>
              <div class="description">${param.description}</div>
            </div>
          `).join('')}
        </div>

        <!-- Actions -->
        <div class="button-row">
          <button id="test-btn" class="primary">[U+2713] Test Connection</button>
          <button id="apply-btn">Apply Settings</button>
          <button id="reset-btn">Reset Defaults</button>
        </div>
      </div>
    `;

    this._attachEventListeners();
  }

  _getStatusIcon() {
    switch (this._status) {
      case 'connected': return '[U+2605]';  // Star
      case 'error': return '[U+2612]';       // Ballot X
      case 'testing': return '[U+260D]';     // Opposition
      default: return '[U+2609]';            // Sun (idle)
    }
  }

  _attachEventListeners() {
    // Provider change
    this.shadowRoot.querySelector('#provider-select').addEventListener('change', (e) => {
      this._config.provider = e.target.value;
      this._updateModelList();
      this._toggleApiKeyField();
      this.render();
    });

    // Model change
    this.shadowRoot.querySelector('#model-select').addEventListener('change', (e) => {
      this._config.model = e.target.value;
    });

    // Parameter sliders
    Object.keys(PARAMETERS).forEach(key => {
      const slider = this.shadowRoot.querySelector(`#param-${key}`);
      const valueDisplay = this.shadowRoot.querySelector(`#value-${key}`);

      slider?.addEventListener('input', (e) => {
        this._config.parameters[key] = parseFloat(e.target.value);
        valueDisplay.textContent = e.target.value;
      });
    });

    // Test connection
    this.shadowRoot.querySelector('#test-btn').addEventListener('click', () => {
      this._testConnection();
    });

    // Apply settings
    this.shadowRoot.querySelector('#apply-btn').addEventListener('click', () => {
      this._applySettings();
    });

    // Reset defaults
    this.shadowRoot.querySelector('#reset-btn').addEventListener('click', () => {
      this._resetDefaults();
    });
  }

  async _testConnection() {
    this._status = 'testing';
    this._statusMessage = 'Testing connection...';
    this.render();

    try {
      const apiKey = this.shadowRoot.querySelector('#api-key')?.value;
      const result = await LLMClient.testConnection({
        provider: this._config.provider,
        model: this._config.model,
        apiKey: apiKey
      });

      if (result.success) {
        this._status = 'connected';
        this._statusMessage = `Connected to ${this._config.provider}`;
        EventBus.emit('toast:show', { message: 'Connection successful', type: 'success' });
      } else {
        this._status = 'error';
        this._statusMessage = result.error;
        EventBus.emit('toast:show', { message: result.error, type: 'error' });
      }
    } catch (error) {
      this._status = 'error';
      this._statusMessage = error.message;
    }

    this.render();
  }

  _applySettings() {
    const apiKey = this.shadowRoot.querySelector('#api-key')?.value;

    EventBus.emit('llm:config-changed', {
      provider: this._config.provider,
      model: this._config.model,
      parameters: { ...this._config.parameters },
      apiKey: apiKey
    });

    this._lastConfigChange = Date.now();
    EventBus.emit('toast:show', { message: 'Settings applied', type: 'success' });
  }

  _resetDefaults() {
    this._config = {
      provider: 'openai',
      model: 'gpt-4',
      parameters: { ...DEFAULT_PARAMETERS }
    };
    this.render();
    EventBus.emit('toast:show', { message: 'Settings reset to defaults', type: 'info' });
  }
}

// Register custom element
if (!customElements.get('llm-config-panel-widget')) {
  customElements.define('llm-config-panel-widget', LLMConfigPanelWidget);
}

const widget = {
  element: 'llm-config-panel-widget',
  displayName: 'LLM Configuration',
  icon: '[U+2388]',  // Helm symbol
  category: 'config'
};
```

---

## 3. The Implementation Pathway

**Phase 1: Provider Framework**
1. [ ] Define provider configuration schema
2. [ ] Implement provider registry with capabilities
3. [ ] Create API key storage (secure, in-memory)
4. [ ] Build provider switching logic

**Phase 2: Model Selection**
1. [ ] Create dynamic model dropdown
2. [ ] Implement model list fetching for Ollama
3. [ ] Add model capability indicators
4. [ ] Cache available models per provider

**Phase 3: Parameter Tuning**
1. [ ] Build parameter slider components
2. [ ] Implement real-time value display
3. [ ] Add parameter validation
4. [ ] Create preset configurations

**Phase 4: Connection Testing**
1. [ ] Implement test endpoint calls
2. [ ] Add WebGPU capability detection
3. [ ] Create connection status display
4. [ ] Handle timeout and error states

**Phase 5: Web Component Widget**
1. [ ] Define LLMConfigPanelWidget class
2. [ ] Add Shadow DOM with encapsulated styles
3. [ ] Implement lifecycle methods with cleanup
4. [ ] Register custom element with duplicate check

---

## 4. UI Elements

| Element ID | Description |
|------------|-------------|
| `provider-select` | Provider dropdown selector |
| `api-key` | API key input (password masked) |
| `model-select` | Model dropdown selector |
| `param-temperature` | Temperature slider |
| `param-top_p` | Top P slider |
| `param-max_tokens` | Max tokens slider |
| `test-btn` | Test connection button |
| `apply-btn` | Apply settings button |
| `reset-btn` | Reset to defaults button |

---

## 5. Status States

| Icon | Status | Description |
|------|--------|-------------|
| [U+2605] (Star) | Ready | Model loaded and connected |
| [U+260D] (Opposition) | Testing | Connection test in progress |
| [U+2612] (Ballot X) | Error | Connection or load failed |
| [U+2609] (Sun) | Idle | Not connected |

---

## 6. Event System

**Emitted Events:**
```javascript
EventBus.emit('llm:config-changed', { provider, model, parameters, apiKey });
EventBus.emit('llm:connection-verified', { provider });
```

**Listened Events:**
```javascript
EventBus.on('llm:model-loaded', handleModelLoaded);
EventBus.on('llm:model-error', handleModelError);
```

---

## 7. Dependencies

- `Utils` - Core utilities (required)
- `EventBus` - Event communication (required)
- `LLMClient` - LLM API interface (required)
- `Storage` - For API key persistence (optional)

---

## 8. Success Criteria

**Provider Management:**
- [ ] Provider dropdown shows all supported providers
- [ ] API key field shows/hides based on provider requirements
- [ ] Local provider disabled when WebGPU unavailable

**Model Selection:**
- [ ] Model list updates when provider changes
- [ ] Ollama models fetched dynamically
- [ ] Currently loaded model indicated

**Parameter Tuning:**
- [ ] All sliders functional with real-time value display
- [ ] Parameters persist across sessions
- [ ] Reset restores default values

**Connection Testing:**
- [ ] Test validates API credentials
- [ ] WebGPU availability correctly detected
- [ ] Error messages displayed clearly

---

## 9. Known Limitations

1. **API key storage** - Keys stored in memory only (lost on refresh)
2. **No streaming preview** - Cannot test streaming without full request
3. **Model capabilities** - No context length or feature indicators
4. **Cost estimation** - No pricing information displayed

---

## 10. Future Enhancements

1. **Secure key storage** - Encrypted API key persistence
2. **Model comparison** - Side-by-side capability view
3. **Usage tracking** - Token count and cost estimates
4. **Preset profiles** - Save/load configuration presets
5. **A/B testing** - Compare outputs across models
6. **Rate limit display** - Show remaining API quota

---

**Status:** Planned

