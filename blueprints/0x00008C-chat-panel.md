# Blueprint 0x00008C: Chat Panel

**Objective:** UI panel for displaying agent conversation history.

**Target Module:** ChatPanel (`ui/panels/chat-panel.js`)

**Prerequisites:** Utils, ChatUI (optional)

**Affected Artifacts:** `/ui/panels/chat-panel.js`

---

### 1. The Strategic Imperative

Users need visibility into:
- Agent messages and reasoning
- Tool calls and results
- Error messages and warnings
- Full conversation history

### 2. The Architectural Solution

A panel wrapper that hosts the ChatUI component:

**Module Structure:**
```javascript
const ChatPanel = {
  metadata: {
    id: 'ChatPanel',
    version: '1.0.0',
    dependencies: ['Utils', 'ChatUI?'],
    async: false,
    type: 'ui'
  },

  factory: (deps) => {
    const init = (containerId) => {
      const container = document.getElementById(containerId);
      if (!container) return;
      // ChatUI handles actual rendering
    };

    return { init };
  }
};
```

### 3. Panel Layout

The ChatPanel provides:
- Scrollable message container
- Message bubbles (user/agent/system)
- Tool call collapsible sections
- Timestamps and metadata

### 4. Message Types

| Type | Styling | Description |
|------|---------|-------------|
| `user` | Right-aligned, blue | User input |
| `assistant` | Left-aligned, gray | Agent response |
| `system` | Centered, muted | System messages |
| `tool` | Collapsible, code | Tool call + result |
| `error` | Red border | Error messages |

### 5. API Surface

| Method | Description |
|--------|-------------|
| `init(containerId)` | Mount panel to container |
| `scrollToBottom()` | Scroll to latest message |
| `clear()` | Clear all messages |

### 6. Integration

ChatPanel is typically mounted in the Proto UI layout:
```javascript
ChatPanel.init('chat-container');
```

The actual message rendering is delegated to ChatUI component for separation of concerns.

---

### 7. Future Enhancements

- Message search/filter
- Export conversation
- Branch/fork conversations
- Message editing
