# Blueprint 0x00004B: Persona Management System

**Objective:** Implement a centralized persona lifecycle management system that elevates personas to first-class objects with dynamic loading, switching, and observability.

**Target Upgrade:** PMGR (`persona-manager.js`)

**Prerequisites:** 0x000003 (Core Utilities), 0x00004A (Config Management)

**Affected Artifacts:** `/upgrades/persona-manager.js`

---

### 1. The Strategic Imperative

**Project Phoenix Feature 2.3**: Elevate Personas to First-Class Objects

AI agents benefit from specialized "personalities" or "personas" for different tasks. A code refactorer thinks differently than a documentation writer. Without persona management:
- Persona switching is manual and error-prone
- No centralized tracking of which persona is active
- No observability into persona performance
- Difficult to add new personas dynamically

**The Persona Manager provides:**
- **Dynamic Loading**: Load persona modules on-demand from `/personas/` directory
- **Centralized Switching**: Single API for persona activation
- **Lifecycle Management**: Initialize, activate, deactivate personas
- **Observability**: Track switches, active persona, usage statistics
- **Event System**: Broadcast persona changes to other modules

This makes personas **first-class citizens** in the architecture.

---

### 2. The Architectural Solution

The Persona Manager uses a **registry pattern** with dynamic module loading:

**Key Components:**

**1. Persona Registry**

```javascript
let _personas = new Map();  // id -> { instance, config }
let _activePersonaId = null;
let _personaSwitchCount = 0;
```

**2. Dynamic Persona Loading**

```javascript
const loadPersonaModule = async (personaName) => {
  const module = await import(`/personas/${personaName}.js`);
  return module[personaName] || module.default;
};

const initializePersona = (personaModule) => {
  const instance = personaModule.factory();
  return {
    metadata: personaModule.metadata,
    ...instance
  };
};
```

**3. Persona Switching**

```javascript
const switchPersona = (personaId) => {
  const previousId = _activePersonaId;
  _activePersonaId = personaId;
  _personaSwitchCount++;

  EventBus.emit('persona:switched', {
    from: previousId,
    to: personaId,
    timestamp: Date.now()
  });
};
```

**4. Web Component Widget**

The widget uses a Web Component with Shadow DOM for persona management UI:

```javascript
class PersonaManagerWidget extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    // Auto-refresh every 2 seconds
    this._interval = setInterval(() => this.render(), 2000);
  }

  disconnectedCallback() {
    // Clean up interval to prevent memory leaks
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  getStatus() {
    const personas = listPersonas();
    const active = getActivePersona();

    return {
      state: active ? 'active' : 'disabled',
      primaryMetric: active ? active.metadata.id : 'No persona',
      secondaryMetric: `${personas.length} loaded`,
      lastActivity: _lastSwitchTime,
      message: null
    };
  }

  getControls() {
    const personas = listPersonas();

    return personas.map(p => ({
      id: `switch-${p.id}`,
      label: `Switch to ${p.id}`,
      icon: p.metadata.icon || '👤',
      action: () => {
        switchPersona(p.id);
        return { success: true, message: `Switched to ${p.id}` };
      }
    }));
  }

  render() {
    const personas = listPersonas();
    const active = getActivePersona();
    const stats = getStats();

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          background: rgba(255,255,255,0.05);
          border-radius: 8px;
          padding: 16px;
          font-family: monospace;
          font-size: 12px;
          color: #e0e0e0;
        }
        h3 {
          margin: 0 0 16px 0;
          color: #fff;
        }
        .persona-card {
          padding: 12px;
          margin-bottom: 8px;
          background: rgba(255,255,255,0.03);
          border-radius: 4px;
          cursor: pointer;
        }
        .persona-card.active {
          background: rgba(0,255,255,0.1);
          border-left: 3px solid #0ff;
        }
        .persona-name {
          font-weight: bold;
          color: #0ff;
        }
        .stat-value {
          color: #0ff;
        }
      </style>

      <div class="persona-panel">
        <h3>👤 Persona Manager</h3>

        <div class="stats">
          <div>Active: <span class="stat-value">${active ? active.metadata.id : 'None'}</span></div>
          <div>Loaded: <span class="stat-value">${personas.length}</span></div>
          <div>Switches: <span class="stat-value">${stats.switchCount}</span></div>
        </div>

        <h4>Available Personas</h4>
        <div class="persona-list">
          ${personas.map(p => `
            <div class="persona-card ${p.id === active?.metadata.id ? 'active' : ''}"
                 data-id="${p.id}">
              <div class="persona-name">${p.id}</div>
              <div class="persona-desc">${p.description || 'No description'}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // Attach click listeners to persona cards
    this.shadowRoot.querySelectorAll('.persona-card').forEach(card => {
      card.addEventListener('click', () => {
        const personaId = card.dataset.id;
        switchPersona(personaId);
        this.render();
      });
    });
  }
}

// Register custom element with duplicate check
if (!customElements.get('persona-manager-widget')) {
  customElements.define('persona-manager-widget', PersonaManagerWidget);
}

const widget = {
  element: 'persona-manager-widget',
  displayName: 'Persona Manager',
  icon: '👤',
  category: 'core'
};
```

**Key architectural improvements:**
- Shadow DOM provides style encapsulation
- Lifecycle methods ensure proper cleanup of intervals
- Closure access to module state (personas, active persona) eliminates injection complexity
- Interactive persona cards for easy switching
- getControls() provides programmatic switching actions

---

### 3. The Implementation Pathway

**Phase 1: Core Persona Management (Complete)**
1. [x] Implement persona registry (Map-based)
2. [x] Dynamic persona module loading
3. [x] Persona initialization and lifecycle
4. [x] Switch persona functionality
5. [x] Event emission for persona changes

**Phase 2: Web Component Widget (Complete)**
1. [x] **Define Web Component class** `PersonaManagerWidget` extending HTMLElement inside factory function
2. [x] **Add Shadow DOM** using `attachShadow({ mode: 'open' })` in constructor
3. [x] **Implement lifecycle methods**:
   - `connectedCallback()`: Initial render and 2-second auto-refresh setup
   - `disconnectedCallback()`: Clean up interval to prevent memory leaks
4. [x] **Implement getStatus()** as class method with closure access to:
   - Module state (personas, active persona, stats)
   - Returns state based on active persona presence
5. [x] **Implement getControls()** as class method:
   - Returns array of persona switching actions
   - Each control switches to a different persona
6. [x] **Implement render()** method:
   - Set `this.shadowRoot.innerHTML` with encapsulated styles
   - Use template literals for dynamic content (persona cards, stats)
   - Include `<style>` tag with `:host` selector
   - Attach event listeners to persona cards for switching
7. [x] **Register custom element**:
   - Use kebab-case naming: `persona-manager-widget`
   - Add duplicate check: `if (!customElements.get(...))`
   - Call `customElements.define('persona-manager-widget', PersonaManagerWidget)`
8. [x] **Return widget object** with new format:
   - `{ element: 'persona-manager-widget', displayName, icon, category }`
   - No `renderPanel`, `getStatus`, `getControls`, `updateInterval` in widget object
9. [x] **Test** Shadow DOM rendering and lifecycle cleanup

**Phase 3: Integration (Pending)**
1. [ ] Integrate with StructuredCycle for persona-aware execution
2. [ ] Add persona performance tracking
3. [ ] Implement persona recommendation system

**Phase 4: Observability (Future)**
1. [ ] Track which personas are most effective for which tasks
2. [ ] Auto-suggest persona switches based on task type
3. [ ] Persona usage analytics dashboard

---

## Module Interface

### Initialization

```javascript
await PersonaManager.loadPersonas();
// Loads all personas from config
// Sets default active persona
// Emits 'persona:loaded' event
```

### Get Active Persona

```javascript
const persona = PersonaManager.getActivePersona();
// Returns: { metadata, ...instance } or null
```

### Switch Persona

```javascript
PersonaManager.switchPersona('CodeRefactorerPersona');
// Emits 'persona:switched' event
```

### List All Personas

```javascript
const personas = PersonaManager.listPersonas();
// Returns: [{ id, description, ... }]
```

### Get Statistics

```javascript
const stats = PersonaManager.getStats();
// Returns: { switchCount, lastSwitchTime, activePersonaId }
```

---

## Event System

**Emitted Events:**

```javascript
EventBus.emit('persona:loaded', {
  personas: ['PersonaA', 'PersonaB'],
  active: 'PersonaA'
});

EventBus.emit('persona:switched', {
  from: 'PersonaA',
  to: 'PersonaB',
  timestamp: Date.now()
});
```

---

## Success Criteria

**Immediate (Testing):**
- [x] Loads all persona modules dynamically
- [x] Switches between personas successfully
- [x] Emits events on persona changes
- [x] Tracks switch count and last switch time
- [x] Widget displays all loaded personas
- [x] Click persona card to switch

**Integration:**
- [x] Web Component renders in widget panel
- [x] Real-time updates via auto-refresh
- [x] Shadow DOM prevents style conflicts
- [x] Event listeners cleaned up on disconnect

**Future:**
- [ ] StructuredCycle uses active persona for execution
- [ ] Performance tracking per persona
- [ ] Auto-recommendation based on task type

---

## Known Limitations

1. **No persistence** - Active persona resets on page reload
2. **No lazy loading** - All personas loaded at startup
3. **No persona validation** - Assumes personas follow expected structure
4. **No error recovery** - Failed persona load is logged but doesn't retry

---

## Future Enhancements

1. **Persona Persistence** - Store active persona in StateManager
2. **Lazy Loading** - Load personas only when needed
3. **Persona Validation** - Validate persona structure on load
4. **Performance Tracking** - Track success rates per persona
5. **Auto-Switching** - Suggest persona based on task analysis
6. **Persona Inheritance** - Allow personas to extend base personas

---

**Remember:** Personas are **first-class objects** - they have lifecycle, state, and behavior like any other module.

The Persona Manager makes the agent **multi-faceted** and **adaptive**.
