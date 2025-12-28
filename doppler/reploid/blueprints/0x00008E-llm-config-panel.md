# Blueprint 0x00008E: LLM Config Panel

**Objective:** Runtime panel for monitoring and configuring LLM providers.

**Target Module:** LLMConfigPanel (`ui/panels/llm-config-panel.js`)

**Prerequisites:** Utils, EventBus, LLMClient, ToastNotifications (optional)

**Affected Artifacts:** `/ui/panels/llm-config-panel.js`

---

### 1. The Strategic Imperative

During agent operation, users need:
- LLM connection status visibility
- Model selection and switching
- WebGPU availability indication
- Runtime reconfiguration

### 2. The Architectural Solution

A panel that interfaces with LLMClient for status and control:

**Module Structure:**
```javascript
const LLMConfigPanel = {
  metadata: {
    id: 'LLMConfigPanel',
    version: '1.0.0',
    dependencies: ['Utils', 'EventBus', 'LLMClient', 'ToastNotifications?'],
    async: false,
    type: 'ui'
  },

  factory: (deps) => {
    const init = async (containerId) => {
      // Bind to DOM elements
      // Setup status updates
      // Wire button handlers
    };

    const updateStatus = () => {
      const status = LLMClient.getWebLLMStatus();
      // Update UI based on status
    };

    return { init };
  }
};
```

### 3. UI Elements

| Element | Purpose |
|---------|---------|
| Status Icon | Green/white circle for loaded/not loaded |
| Status Text | "Ready (WebGPU)" or "Not loaded" |
| Model Label | Current model name |
| Model Select | Dropdown for model selection |
| Load Button | Trigger model initialization |
| WebGPU Status | Availability indicator |

### 4. Status States

| State | Icon | Text |
|-------|------|------|
| Not loaded | ⚪ | "Not loaded" |
| Loading | ⏳ | "Initializing..." |
| Ready | 🟢 | "Ready (WebGPU)" |
| Error | 🔴 | Error message |

### 5. WebGPU Detection

```javascript
if (navigator.gpu) {
  statusEl.innerHTML = '✅ WebGPU available';
} else {
  statusEl.textContent = '⚠️ WebGPU not supported';
}
```

### 6. API Surface

| Method | Description |
|--------|-------------|
| `init(containerId)` | Mount panel to container |
| `updateStatus()` | Refresh status display |

### 7. Events

Listens to:
- `llm:loading` - Model loading started
- `llm:ready` - Model loaded successfully
- `llm:error` - Load/inference error

---

### 8. Model Selection

Dropdown populated from LLMClient.getAvailableModels() or hardcoded list based on provider.
