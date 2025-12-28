# Blueprint 0x00008C-ICHAT: Inline Chat Component

**Objective:** Human-in-the-loop message injection for real-time agent context modification.

**Target Module:** `InlineChat`

**Implementation:** `/ui/components/inline-chat.js`

**Prerequisites:** `0x000058` (Event Bus), `0x000003` (Core Utilities)

**Category:** UI

---

## 1. Overview

The Inline Chat component provides a compact floating input for humans to inject messages into the agent's context during execution. This is essential for HITL (Human-In-The-Loop) intervention, allowing users to provide guidance, corrections, or additional context without interrupting the agent loop.

Unlike the full Chat Panel, Inline Chat:
- Bypasses tool execution
- Provides direct LLM communication
- Renders in a compact floating panel
- Used for quick queries and clarifications

## 2. Module Structure

```javascript
const InlineChat = {
  metadata: {
    id: 'InlineChat',
    version: '1.0.0',
    dependencies: ['Utils', 'EventBus'],
    async: false,
    type: 'ui'
  },
  factory: (deps) => { ... }
};
```

## 3. Public Interface

```javascript
const InlineChat = {
  init(containerId),  // Initialize in DOM container (string ID or Element)
  render(),           // Re-render component
  focus(),            // Focus input field
  cleanup()           // Remove references and cleanup
};
```

## 4. DOM Structure

```html
<div class="inline-chat">
  <div class="inline-chat-input-row">
    <input
      type="text"
      class="inline-chat-input"
      placeholder="Type a message to inject into agent context..."
      autocomplete="off"
    />
    <button class="inline-chat-send" title="Send (Enter)">
      &#x27A4;  <!-- Right arrow symbol -->
    </button>
  </div>
</div>
```

## 5. Event Flow

```
User types message -> Enter key or Click Send button
                              |
                              v
              EventBus.emit('human:message', {
                content: '...',
                type: 'context',
                timestamp: Date.now()
              })
                              |
                              v
              EventBus.emit('agent:history', {
                type: 'human',
                cycle: '-',
                content: '...',
                messageType: 'context',
                pending: true
              })
                              |
                              v
              AgentLoop picks up on next cycle
```

## 6. Message Types

| Type | Description | Priority |
|------|-------------|----------|
| `context` | Added to agent context (default) | Normal |
| `directive` | High-priority instruction | High |
| `correction` | Override previous output | High |

## 7. Event Payloads

### Outgoing: `human:message`

```javascript
{
  content: string,      // Message text
  type: 'context',      // Message type
  timestamp: number     // Unix timestamp
}
```

### Outgoing: `agent:history`

```javascript
{
  type: 'human',        // Entry type for history panel
  cycle: '-',           // Not associated with agent cycle
  content: string,      // Message text
  messageType: string,  // context | directive | correction
  pending: true         // Shows as pending until processed
}
```

## 8. Visual Feedback

On successful send:
1. Input field cleared immediately
2. Send button changes to checkmark
3. Button gets `.sent` class for 1 second
4. Input refocused for continued typing

```javascript
const sendBtn = _container?.querySelector('.inline-chat-send');
if (sendBtn) {
  sendBtn.textContent = '\u2713';  // Checkmark
  sendBtn.classList.add('sent');
  setTimeout(() => {
    sendBtn.innerHTML = '&#x27A4;';  // Arrow
    sendBtn.classList.remove('sent');
  }, 1000);
}
```

## 9. AgentLoop Integration

The AgentLoop listens for `human:message` events and incorporates them into the next inference cycle:

```javascript
// In agent-loop.js
EventBus.on('human:message', (msg) => {
  context.push({
    role: 'user',
    content: `[Human Intervention]: ${msg.content}`
  });
});
```

## 10. Initialization Flow

```javascript
const init = (containerId) => {
  // 1. Resolve container (string ID or Element)
  _container = typeof containerId === 'string'
    ? document.getElementById(containerId)
    : containerId;

  // 2. Guard against missing container
  if (!_container) {
    logger.warn('[InlineChat] Container not found');
    return false;
  }

  // 3. Render DOM structure
  render();

  // 4. Bind event listeners
  bindEvents();

  logger.info('[InlineChat] Initialized');
  return true;
};
```

## 11. Event Binding

```javascript
const bindEvents = () => {
  // Send button click
  const sendBtn = _container.querySelector('.inline-chat-send');
  if (sendBtn) {
    sendBtn.addEventListener('click', (e) => {
      e.preventDefault();
      sendMessage();
    });
  }

  // Enter key to send
  if (_input) {
    _input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }
};
```

## 12. Error Handling

```javascript
const sendMessage = () => {
  const input = _input || _container?.querySelector('.inline-chat-input');
  if (!input) {
    console.warn('[InlineChat] Input not found');
    return;
  }

  const content = input.value.trim();
  if (!content) return;

  try {
    if (EventBus?.emit) {
      EventBus.emit('human:message', { ... });
      EventBus.emit('agent:history', { ... });
    } else {
      console.warn('[InlineChat] EventBus not available');
    }
  } catch (e) {
    console.error('[InlineChat] Error emitting events:', e);
  }
};
```

## 13. Cleanup

```javascript
const cleanup = () => {
  _container = null;
  _input = null;
};
```

## 14. CSS Styling Requirements

```css
.inline-chat {
  /* Compact floating panel styling */
}

.inline-chat-input-row {
  display: flex;
  gap: 8px;
}

.inline-chat-input {
  flex: 1;
  /* Input styling */
}

.inline-chat-send {
  /* Button styling */
}

.inline-chat-send.sent {
  /* Visual feedback for sent state */
  color: var(--success-color, #4caf50);
}
```

## 15. Usage Example

```javascript
// Initialize in a container
const InlineChat = DIContainer.resolve('InlineChat');
InlineChat.init('inline-chat-container');

// Focus programmatically
InlineChat.focus();

// Cleanup when done
InlineChat.cleanup();
```

## 16. Comparison with Chat Panel

| Feature | Inline Chat | Chat Panel |
|---------|-------------|------------|
| Purpose | Quick context injection | Full conversation |
| Size | Compact floating | Full panel |
| Tool execution | Bypassed | Full support |
| History display | Via EventBus | Built-in |
| Streaming | No | Yes |

---

**Status:** Implemented

**File:** `/ui/components/inline-chat.js`
