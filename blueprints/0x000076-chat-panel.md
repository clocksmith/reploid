# Blueprint 0x00008D-CPNL: Chat Panel

**Objective:** Main chat interface panel for agent conversation with full message history and streaming support.

**Target Module:** `ChatPanel`

**Implementation:** `/ui/panels/chat-panel.js`

**Prerequisites:** `0x000003` (Core Utilities), `0x000058` (Event Bus)

**Category:** UI

---

## 1. Overview

The Chat Panel is the primary interface for agent-human conversation. It displays the full message history, handles user input, renders streaming responses, and shows tool call results. Unlike Inline Chat which provides quick context injection, Chat Panel is the full-featured conversation interface.

## 2. Module Structure

```javascript
const ChatPanel = {
  metadata: {
    id: 'ChatPanel',
    version: '1.0.0',
    dependencies: ['Utils', 'ChatUI?'],  // ChatUI is optional
    async: false,
    type: 'ui'
  },
  factory: (deps) => {
    const { Utils } = deps;
    const { logger } = Utils;

    const init = (containerId) => {
      const container = document.getElementById(containerId);
      if (!container) return;
      logger.info('[ChatPanel] Ready');
    };

    return { init };
  }
};
```

## 3. Public Interface

```javascript
const ChatPanel = {
  init(containerId)  // Initialize panel in DOM container
};
```

## 4. Current Implementation Status

The current ChatPanel implementation is a **thin layout wrapper** that delegates to ChatUI when available. Future enhancements will add full message history, streaming, and tool result rendering.

## 5. Planned Features

### 5.1 Message History Display

```javascript
// Message types to render
const messageTypes = {
  user: 'User message',
  assistant: 'Assistant response',
  tool_call: 'Tool invocation',
  tool_result: 'Tool execution result',
  error: 'Error message',
  system: 'System notification'
};
```

### 5.2 DOM Structure (Planned)

```html
<div class="chat-panel">
  <div class="chat-header">
    <span class="chat-title">Agent Conversation</span>
    <div class="chat-controls">
      <button class="chat-clear-btn" title="Clear history">[x]</button>
      <button class="chat-export-btn" title="Export">[^]</button>
    </div>
  </div>

  <div class="chat-messages">
    <!-- Message entries rendered here -->
  </div>

  <div class="chat-input-area">
    <textarea class="chat-input" placeholder="Type a message..."></textarea>
    <button class="chat-send-btn">Send</button>
  </div>
</div>
```

### 5.3 Message Entry Structure

```html
<div class="chat-message chat-message--user">
  <div class="chat-message-header">
    <span class="chat-message-role">User</span>
    <span class="chat-message-time">12:34:56</span>
  </div>
  <div class="chat-message-content">
    Message text here...
  </div>
</div>

<div class="chat-message chat-message--assistant">
  <div class="chat-message-header">
    <span class="chat-message-role">Assistant</span>
    <span class="chat-message-time">12:34:57</span>
  </div>
  <div class="chat-message-content">
    Response text with streaming support...
  </div>
</div>

<div class="chat-message chat-message--tool">
  <div class="chat-message-header">
    <span class="chat-message-role">Tool: ReadFile</span>
    <span class="chat-message-status">Completed</span>
  </div>
  <div class="chat-message-content">
    <pre class="chat-tool-result">
      { "success": true, "data": "..." }
    </pre>
  </div>
</div>
```

### 5.4 Streaming Response Display

```javascript
// Event listener for streaming tokens
EventBus.on('agent:token', (data) => {
  const messageEl = getOrCreateStreamingMessage(data.messageId);
  appendToken(messageEl, data.token);
  scrollToBottom();
});

EventBus.on('agent:message-complete', (data) => {
  const messageEl = getMessageElement(data.messageId);
  finalizeMessage(messageEl);
});
```

### 5.5 Tool Call Result Rendering

```javascript
// Render tool call with collapsible result
function renderToolCall(toolCall) {
  return `
    <div class="chat-tool-call">
      <div class="chat-tool-header" onclick="toggleToolResult(this)">
        <span class="chat-tool-name">${toolCall.name}</span>
        <span class="chat-tool-status ${toolCall.status}">${toolCall.status}</span>
      </div>
      <div class="chat-tool-args">
        <pre>${JSON.stringify(toolCall.args, null, 2)}</pre>
      </div>
      <div class="chat-tool-result collapsed">
        <pre>${formatToolResult(toolCall.result)}</pre>
      </div>
    </div>
  `;
}
```

## 6. Event Subscriptions (Planned)

| Event | Handler | Description |
|-------|---------|-------------|
| `agent:history` | `addHistoryEntry` | Add entry to message list |
| `agent:token` | `appendStreamToken` | Append streaming token |
| `agent:message-complete` | `finalizeMessage` | Mark message complete |
| `agent:tool-start` | `showToolProgress` | Show tool execution start |
| `agent:tool-complete` | `showToolResult` | Show tool result |
| `agent:error` | `showError` | Display error message |

## 7. Integration Points

### 7.1 AgentLoop

```javascript
// AgentLoop emits events that ChatPanel consumes
EventBus.emit('agent:history', {
  type: 'assistant',
  content: 'Response text...',
  cycle: 42,
  timestamp: Date.now()
});
```

### 7.2 InlineChat

Messages from InlineChat appear in ChatPanel history:

```javascript
EventBus.on('human:message', (msg) => {
  addHistoryEntry({
    type: 'user',
    content: msg.content,
    source: 'inline-chat'
  });
});
```

### 7.3 ToolRunner

Tool execution results flow through:

```javascript
EventBus.emit('agent:tool-complete', {
  name: 'ReadFile',
  args: { path: '/code/module.js' },
  result: { success: true, data: '...' },
  duration: 45
});
```

## 8. Panel System Integration

ChatPanel follows the standard panel module pattern for registration:

```javascript
{
  metadata: {
    id: 'ChatPanel',
    version: '1.0.0',
    dependencies: ['Utils', 'ChatUI?'],
    type: 'ui'
  },
  factory: (deps) => {
    return { init };
  }
}
```

## 9. State Management (Planned)

```javascript
// Internal state
let _messages = [];
let _isStreaming = false;
let _activeStreamId = null;

// State accessors
const getMessages = () => [..._messages];
const clearMessages = () => { _messages = []; render(); };
const exportMessages = () => JSON.stringify(_messages, null, 2);
```

## 10. Input Handling (Planned)

```javascript
const handleSend = () => {
  const input = container.querySelector('.chat-input');
  const content = input.value.trim();
  if (!content) return;

  // Clear input
  input.value = '';

  // Emit to agent
  EventBus.emit('user:message', {
    content,
    timestamp: Date.now()
  });

  // Add to local history
  addHistoryEntry({
    type: 'user',
    content,
    timestamp: Date.now()
  });
};
```

## 11. Auto-Scroll Behavior

```javascript
const scrollToBottom = () => {
  const messagesEl = container.querySelector('.chat-messages');
  if (messagesEl) {
    // Only auto-scroll if near bottom
    const isNearBottom = messagesEl.scrollHeight - messagesEl.scrollTop
      < messagesEl.clientHeight + 100;

    if (isNearBottom) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }
};
```

## 12. CSS Requirements

```css
.chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.chat-message {
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: 8px;
}

.chat-message--user {
  background: var(--surface-2);
  margin-left: 48px;
}

.chat-message--assistant {
  background: var(--surface-1);
  margin-right: 48px;
}

.chat-message--tool {
  background: var(--surface-0);
  font-family: monospace;
  font-size: 12px;
}

.chat-input-area {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--border-1);
}

.chat-input {
  flex: 1;
  resize: none;
}
```

## 13. Comparison with Inline Chat

| Feature | Chat Panel | Inline Chat |
|---------|------------|-------------|
| Purpose | Full conversation | Quick context injection |
| Message history | Full display | Via EventBus only |
| Streaming | Supported | Not supported |
| Tool results | Rendered inline | Not displayed |
| Size | Full panel | Compact floating |
| User input | Textarea | Single-line input |

---

**Status:** Implemented (Layout Only)

**File:** `/ui/panels/chat-panel.js`

**Future Work:**
- Full message history rendering
- Streaming token display
- Tool call result visualization
- Export functionality
- Search/filter messages
