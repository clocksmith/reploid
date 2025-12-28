# Blueprint 0x00008B-MCFG: Model Configuration UI

**Objective:** Pre-boot configuration screen for selecting and configuring LLM providers before agent initialization.

**Target Module:** `ModelConfig`

**Implementation:** `/ui/boot/model-config/`

**Prerequisites:** `0x000089` (Proxy Server), `0x000058` (Event Bus)

**Category:** UI

---

## 1. Overview

The Model Config UI is the pre-boot configuration screen that allows users to select LLM providers and models before the agent initializes. It provides a unified interface for configuring cloud APIs, local inference via Ollama, browser-based WebGPU models (WebLLM, Transformers.js), and DOPPLER WebGPU inference.

## 2. Module Structure

```
ui/boot/model-config/
  index.js     - Public API and initialization
  state.js     - Model selection state management
  providers.js - Provider availability checking and model catalogs
  cards.js     - Model card rendering and UI updates
  form.js      - Configuration form handling and GGUF import
```

## 3. Provider Support Matrix

| Provider | Type | Connection | Key Source |
|----------|------|------------|------------|
| Gemini | Cloud | browser-cloud, proxy-cloud | localStorage, proxy-env |
| OpenAI | Cloud | browser-cloud, proxy-cloud | localStorage, proxy-env |
| Anthropic | Cloud | browser-cloud, proxy-cloud | localStorage, proxy-env |
| Groq | Cloud | browser-cloud, proxy-cloud | localStorage, proxy-env |
| Ollama | Local | proxy-local | none |
| vLLM | Local | proxy-local | none |
| WebLLM | Browser | browser-local | none |
| Transformers.js | Browser | browser-local | none |
| DOPPLER | Browser | browser-local | none |

## 4. Public API

```javascript
import { initModelConfig, getSelectedModels, hasModelsConfigured } from './model-config';

// Initialize the config UI
await initModelConfig();

// Check if ready to proceed
if (hasModelsConfigured()) {
  const models = getSelectedModels();
  // [{ id, name, provider, hostType, queryMethod, keySource, keyId, modelUrl, localPath }, ...]
}
```

## 5. State Shape

```javascript
// state.js
{
  selectedModels: [
    {
      id: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      provider: 'gemini',
      hostType: 'proxy-cloud',      // browser-cloud | proxy-cloud | browser-local | proxy-local
      queryMethod: 'proxy',          // browser | proxy
      keySource: 'proxy-env',        // localStorage | proxy-env | none
      keyId: null,                   // localStorage key name if applicable
      modelUrl: null,                // Remote model URL (DOPPLER)
      localPath: null                // Local filesystem path (Native Bridge)
    }
  ],
  availableProviders: {
    ollama: { online: false, checked: false, models: [] },
    webgpu: { online: false, checked: false, models: [] },
    transformers: { online: false, checked: false, models: [] },
    doppler: { online: false, checked: false, models: [], capabilities: null },
    proxy: { online: false, checked: false, configuredProviders: [] }
  }
}
```

## 6. Provider Status Flow

```
1. Render initial UI (shows "Checking..." status for network providers)
2. Check WebGPU synchronously -> Update status dot
3. Check proxy /api/health -> Update status dot, get configured providers
4. Check Ollama /api/ollama/models -> Update status dot, get model list
5. Load WebLLM model catalog -> Populate browser model list
6. Check DOPPLER availability -> Get cached models from OPFS
7. Auto-populate defaults based on availability (Doppler Gemma 1B if available)
8. User makes selections -> Save to localStorage SELECTED_MODELS
9. Proceed to agent initialization
```

## 7. Connection Type Labels

```javascript
const CONNECTION_TYPE_LABELS = {
  'proxy-local': 'Proxy -> Local (Ollama)',
  'browser-local': 'Browser (WebLLM/Transformers)',
  'proxy-cloud': 'Via Proxy Server (Recommended)',
  'browser-cloud': 'Direct API (Requires Key)'
};
```

## 8. Cloud Provider Model Catalogs

```javascript
// providers.js - Updated Dec 2025
const cloudProviders = {
  gemini: {
    models: [
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
      { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro (Preview)' },
      { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (Preview)' }
    ]
  },
  openai: {
    models: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
      { id: 'gpt-4.1', name: 'GPT-4.1' },
      { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
      { id: 'gpt-5', name: 'GPT-5' },
      { id: 'o3', name: 'O3' },
      { id: 'o4-mini', name: 'O4 Mini' }
    ]
  },
  anthropic: {
    models: [
      { id: 'claude-sonnet-4-5-20250929', name: 'Claude 4.5 Sonnet' },
      { id: 'claude-opus-4-5-20251101', name: 'Claude 4.5 Opus' },
      { id: 'claude-sonnet-4-20250514', name: 'Claude 4 Sonnet' },
      { id: 'claude-opus-4-1-20250805', name: 'Claude 4.1 Opus' }
    ]
  }
};
```

## 9. Browser Local Models

```javascript
// Transformers.js models (WebGPU accelerated)
const transformersModels = [
  { id: 'qwen3-0.6b', name: 'Qwen3 0.6B', vram: 800, context: 32768 },
  { id: 'qwen3-1.7b', name: 'Qwen3 1.7B', vram: 2000, context: 32768 },
  { id: 'gemma3-1b', name: 'Gemma3 1B', vram: 1500, context: 8192 },
  { id: 'smollm2-360m', name: 'SmolLM2 360M', vram: 400, context: 8192 },
  { id: 'smollm2-1.7b', name: 'SmolLM2 1.7B', vram: 2000, context: 8192 },
  { id: 'deepseek-r1-1.5b', name: 'DeepSeek-R1 1.5B', vram: 2000, context: 32768 },
  { id: 'phi4-mini', name: 'Phi-4 Mini', vram: 4000, context: 16384 }
];
```

## 10. GGUF Import Feature

The form supports importing GGUF model files directly into OPFS for DOPPLER inference:

```javascript
// form.js - GGUF Import Flow
1. User clicks "Import Model" button
2. Show choice dialog: Select Files vs Select Folder
3. Use File System Access API to pick files
4. Categorize files (weights, config, tokenizer)
5. For single GGUF: Parse header, shard to OPFS, write manifest
6. Auto-add imported model to selection list
7. Model ready for DOPPLER inference
```

### Import Progress States

| Stage | Description |
|-------|-------------|
| `parsing` | Parsing GGUF header |
| `sharding` | Copying weight data to OPFS |
| `writing` | Writing manifest file |
| `complete` | Import successful |
| `error` | Import failed |

## 11. Native Bridge Integration

When DOPPLER Native Bridge extension is available, enables local filesystem browsing:

```javascript
// form.js - Browse Modal
async function openBrowseModal() {
  const { createBridgeClient } = await import('@clocksmith/doppler/bridge/index.js');
  browseClient = await createBridgeClient();
  await navigateToPath('/Users');
}
```

## 12. Storage Keys

| Key | Type | Description |
|-----|------|-------------|
| `SELECTED_MODELS` | JSON Array | Full model configuration array |
| `CONSENSUS_TYPE` | String | Multi-model consensus strategy (arena, majority, weighted) |
| `SELECTED_MODEL` | String | Legacy: Primary model ID |
| `AI_PROVIDER` | String | Legacy: Primary provider name |
| `{PROVIDER}_API_KEY` | String | API key for browser-cloud connections |

## 13. UI Components

### Model Cards
- Displays selected models in card format
- Shows provider, model name, connection type
- Edit and Remove buttons per card
- "Add Model" card when under MAX_MODELS (4)

### Provider Status Panel
- Status dots for each connection type
- Progressive updates as availability is checked
- "Checking...", "Available", "Unavailable" states

### Configuration Form Modal
- Provider dropdown (filtered by availability)
- Model dropdown (populated per provider)
- Connection type dropdown
- API key input (for browser-cloud)
- Model URL input (for DOPPLER remote models)
- Local path input + Browse button (for Native Bridge)
- GGUF Import button (for DOPPLER)

### Consensus Section
- Hidden when < 2 models selected
- Strategy dropdown: Arena, Majority, Weighted

## 14. Auto-Population Logic

```javascript
// cards.js
function autoPopulateDefaultModels() {
  // Only auto-populate if:
  // 1. No models currently selected
  // 2. DOPPLER is available
  // 3. Gemma 1B is in cached models

  if (selectedModels.length > 0) return;
  if (!providers.doppler?.online) return;

  const gemmaModel = dopplerModels.find(m =>
    m.id.toLowerCase().includes('gemma') && m.id.includes('1b')
  );

  if (gemmaModel) {
    addModel({ ...gemmaModel, provider: 'doppler', hostType: 'browser-local' });
  }
}
```

## 15. URL Parameter Handling

Supports auto-opening form from external tools (e.g., serve-cli):

```
?provider=doppler&modelUrl=http://localhost:8001/models/gemma-2b-q4
```

---

**Status:** Implemented

**Files:**
- `/ui/boot/model-config/index.js` - Public API
- `/ui/boot/model-config/state.js` - State management
- `/ui/boot/model-config/providers.js` - Provider detection
- `/ui/boot/model-config/cards.js` - Card rendering
- `/ui/boot/model-config/form.js` - Form handling
