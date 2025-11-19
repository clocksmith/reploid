# UI Directory

**Purpose**: User interface components for interacting with the REPLOID agent.

## Contents

| File | Purpose |
|------|---------|
| `chat.js` | Chat interface - conversation UI with message history |
| `code-viewer.js` | Code viewer - syntax-highlighted file browser with line numbers |

---

## Components

### chat.js

Interactive chat interface for conversing with the REPLOID agent.

**Features:**
- Message history with timestamps
- User input field with keyboard shortcuts
- Auto-scroll to latest message
- Markdown rendering (optional)
- Copy message functionality
- Clear history button

**Usage:**
```javascript
import createChatUI from './ui/chat.js';

const chat = createChatUI({
  containerId: 'chat-container',
  onSubmit: (message) => {
    // Handle user message
    agent.processMessage(message);
  }
});

// Add message to UI
chat.addMessage('user', 'Create a button that shows time');
chat.addMessage('assistant', 'I will create that for you...');
```

**Events:**
- `submit` - User sends message
- `clear` - User clears history

### code-viewer.js

Syntax-highlighted code viewer with file browsing capabilities.

**Features:**
- Syntax highlighting (JavaScript, HTML, CSS, JSON, Markdown)
- Line numbers
- File tree navigation
- Search/filter files
- Copy code to clipboard
- Download file
- View raw content

**Usage:**
```javascript
import createCodeViewer from './ui/code-viewer.js';

const viewer = createCodeViewer({
  containerId: 'code-viewer',
  vfs: vfsInstance, // VFS instance for reading files
  defaultFile: '/tools/my-tool.js'
});

// Show specific file
viewer.showFile('/core/agent-loop.js');

// Refresh file tree
viewer.refresh();
```

**Supported Languages:**
- JavaScript (`.js`)
- HTML (`.html`)
- CSS (`.css`)
- JSON (`.json`)
- Markdown (`.md`)
- Plain text (fallback)

---

## Styling

Both components use the REPLOID cyberpunk aesthetic:

**Color Palette:**
- Background: `#0a0e27` (dark blue-black)
- Accent: `#00ffff` (cyan)
- Text: `#e0e0e0` (light gray)
- Border: `rgba(255, 255, 255, 0.1)` (subtle)

**Typography:**
- Font: `'Courier New', monospace`
- Code: `'Fira Code', 'Consolas', monospace`

**Effects:**
- Glow effects on hover
- Smooth transitions
- Sharp corners (border-radius: 0)

---

## Integration

These UI components are loaded by the main application and integrated with the agent loop.

**Typical Flow:**

1. User types message in chat
2. Chat component emits submit event
3. Agent loop processes message
4. Agent creates/modifies code
5. Code viewer updates to show changes
6. Chat displays agent response

---

## Additional UI Components

Note: Many other UI components are located in the `upgrades/` directory:

- **Sentinel Panel** (`upgrades/sentinel-panel-widget.ts`) - Agent status and control
- **Diff Viewer** (`upgrades/diff-viewer-ui.js`) - Code change visualization
- **Dashboard** (various files in `upgrades/`) - Main application dashboard

See **[Upgrades README](../upgrades/README.md)** for complete list of UI-related upgrades.

---

## Development

### Adding New UI Components

1. Create file in `ui/` or `upgrades/` (depending on scope)
2. Use factory pattern:
```javascript
export default function createMyUI(config) {
  // Private state
  const container = document.getElementById(config.containerId);

  // Public API
  return {
    render() {
      // Render UI
    },
    update(data) {
      // Update UI with new data
    },
    destroy() {
      // Clean up event listeners
    }
  };
}
```
3. Import in main application
4. Add to this README

### Styling Guidelines

- Use CSS variables for colors
- Follow mobile-first responsive design
- Test in Chrome, Firefox, Edge
- Ensure keyboard accessibility
- Add aria-labels for screen readers

---

## See Also

- **[Core Modules](../core/README.md)** - Agent logic and tools
- **[Boot System](../boot/README.md)** - Initialization
- **[Upgrades](../upgrades/README.md)** - Additional UI components
- **[Main README](../README.md)** - Project overview

---

**Note:** UI components are stateless where possible and use event-driven communication with the agent loop to avoid tight coupling.
