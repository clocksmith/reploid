# Blueprint 0x00008A: Model Config UI

**Objective:** Boot-time UI for selecting and configuring LLM providers before agent initialization.

**Target Module:** Model Config UI (`ui/boot/model-config/`)

**Prerequisites:** DOM, LocalStorage

**Affected Artifacts:**
- `/ui/boot/model-config/index.js` - Entry point
- `/ui/boot/model-config/cards.js` - Provider cards
- `/ui/boot/model-config/form.js` - Configuration form
- `/ui/boot/model-config/providers.js` - Provider definitions
- `/ui/boot/model-config/state.js` - State management

---

### 1. The Strategic Imperative

Before the agent can function, users must configure their LLM provider. The Model Config UI provides:

- Visual provider selection (cards with logos)
- API key input with validation
- Model selection per provider
- Persistent configuration in LocalStorage
- Clean boot flow before agent starts

### 2. The Architectural Solution

**Module Structure:**
```
ui/boot/model-config/
  index.js      - initModelConfig() entry point
  cards.js      - Provider card rendering
  form.js       - Configuration form handling
  providers.js  - Provider definitions and models
  state.js      - LocalStorage state management
```

### 3. Provider Definitions

```javascript
const PROVIDERS = {
  anthropic: {
    name: 'Anthropic',
    logo: '...',
    models: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', ...],
    requiresKey: true
  },
  openai: {
    name: 'OpenAI',
    models: ['gpt-4o', 'gpt-4-turbo', ...],
    requiresKey: true
  },
  ollama: {
    name: 'Ollama (Local)',
    models: ['llama3.1', 'codellama', ...],
    requiresKey: false
  },
  // ...
};
```

### 4. State Persistence

```javascript
// Stored in localStorage under 'REPLOID_LLM_CONFIG'
{
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  apiKey: 'sk-...',  // Stored securely
  temperature: 0.7,
  maxTokens: 4096
}
```

### 5. UI Components

**Provider Cards:**
- Grid layout of provider options
- Visual logo and name
- Click to select
- Active state indication

**Configuration Form:**
- API key input (password type)
- Model dropdown (filtered by provider)
- Temperature slider
- Max tokens input
- Save/Apply button

### 6. Boot Flow

1. Check localStorage for existing config
2. If valid config exists, proceed to agent boot
3. If no config, show Model Config UI
4. User selects provider and enters config
5. Save to localStorage
6. Trigger agent initialization

### 7. API Surface

| Function | Description |
|----------|-------------|
| `initModelConfig(container)` | Mount config UI to container |
| `getStoredConfig()` | Get config from localStorage |
| `saveConfig(config)` | Save config to localStorage |
| `validateConfig(config)` | Check if config is valid |
| `clearConfig()` | Clear stored configuration |

---

### 8. CSS Styling

Uses inline styles or CSS-in-JS for:
- Card grid layout
- Hover/active states
- Form styling
- Responsive design
