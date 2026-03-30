# Blueprint 0x00008B: Inline Chat

**Objective:** Human-in-the-loop message injection during agent execution.

**Target Module:** InlineChat (`ui/components/inline-chat.js`)

**Prerequisites:** Utils, EventBus

**Affected Artifacts:** `/ui/components/inline-chat.js`, `/styles/proto/inline-chat.css`

---

### 1. The Strategic Imperative

During agent execution, humans need to:
- Inject guidance or corrections into the agent context
- Provide clarification when the agent is stuck
- Redirect agent focus without stopping execution
- Collaborate in real-time with the agent

### 2. The Architectural Solution

A simple input component that emits messages via EventBus:

**Module Structure:**
```javascript
const InlineChat = {
  metadata: {
    id: 'InlineChat',
    version: '1.0.0',
    dependencies: ['Utils', 'EventBus'],
    async: false,
    type: 'ui'
  },

  factory: (deps) => {
    let _container = null;
    let _input = null;

    const init = (containerId) => { ... };
    const render = () => { ... };
    const bindEvents = () => { ... };
    const sendMessage = () => { ... };

    return { init, destroy };
  }
};
```

### 3. UI Structure

```html
<div class="inline-chat">
  <div class="inline-chat-input-row">
    <input type="text"
           class="inline-chat-input"
           placeholder="Type a message to inject into agent context..." />
    <button class="inline-chat-send" title="Send (Enter)">
      ➤
    </button>
  </div>
</div>
```

### 4. Event Flow

1. User types message in input
2. Presses Enter or clicks Send button
3. Component emits `chat:inject` event via EventBus
4. Agent loop receives event and adds to context
5. Input clears for next message

### 5. Events Emitted

| Event | Payload | Description |
|-------|---------|-------------|
| `chat:inject` | `{ message, timestamp }` | User message to inject |
| `chat:clear` | - | Input cleared |

### 6. API Surface

| Method | Description |
|--------|-------------|
| `init(containerId)` | Mount component to container |
| `destroy()` | Cleanup and remove component |
| `focus()` | Focus the input field |
| `clear()` | Clear input content |

### 7. Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Enter | Send message |
| Escape | Clear input |

---

### 8. Styling

CSS classes:
- `.inline-chat` - Container
- `.inline-chat-input-row` - Flexbox row
- `.inline-chat-input` - Text input field
- `.inline-chat-send` - Send button
