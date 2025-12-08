# REPLOID App Mounting System - Design Specification

**Status:** Proposed (not yet implemented)

> **Note:** This is a design specification for a planned feature. For architectural blueprints, see `dreamer/reploid/blueprints/`.

## Overview

Enable agents to create self-contained UI applications that integrate into the REPLOID dashboard, providing custom visualizations, tools, and interfaces.

## Current State

**Existing VFS Preview:**
- Agent creates HTML/CSS/JS in VFS
- User manually clicks file → Preview button → Opens in sandboxed iframe
- Isolated from REPLOID internals
- No dashboard integration

**Limitations:**
- Manual activation (not automatic)
- No communication with agent
- No access to VFS, state, or tools
- Lives in overlay panel, not as dashboard tab

## Proposed Enhancement

### 1. App Manifest Format

Agents create apps in `/apps/` with a manifest:

```javascript
// /apps/my-viz/manifest.json
{
  "id": "my-viz",
  "name": "Performance Visualizer",
  "version": "1.0.0",
  "entry": "/apps/my-viz/index.html",
  "icon": "perf",
  "autoMount": true,
  "permissions": ["vfs.read", "state.read", "events.subscribe"],
  "api": "v1"
}
```

### 2. App Structure

```
/apps/
  my-viz/
    manifest.json       # App metadata
    index.html          # Entry point
    styles.css          # Styles
    app.js              # Logic
```

### 3. Dashboard Integration

**Apps Tab:**
- New sidebar tab (Apps)
- Lists all installed apps from `/apps/*/manifest.json`
- Click app → Mounts in workspace as new tab
- Apps can be pinned/unpinned

**Auto-Mount:**
- If `manifest.autoMount: true`, app loads on boot
- Appears as permanent tab in workspace
- Survives page refresh

### 4. Sandbox API Bridge

Apps run in sandboxed iframe but get access to safe APIs via `postMessage`:

```javascript
// Inside agent-created app.js
window.REPLOID_APP = {
  // VFS access (if permitted)
  vfs: {
    read: (path) => sendMessage('vfs.read', { path }),
    list: (path) => sendMessage('vfs.list', { path }),
    watch: (path, callback) => subscribe('vfs.changed', { path }, callback)
  },

  // State access (if permitted)
  state: {
    get: () => sendMessage('state.get'),
    subscribe: (callback) => subscribe('state.changed', callback)
  },

  // Event subscription (if permitted)
  events: {
    on: (event, callback) => subscribe(event, callback)
  },

  // Tool execution (if permitted)
  tools: {
    execute: (name, args) => sendMessage('tool.execute', { name, args })
  }
};

// Usage in app
const files = await REPLOID_APP.vfs.list('/tools');
REPLOID_APP.events.on('agent:history', (entry) => {
  updateVisualization(entry);
});
```

**Permission Model:**
```javascript
// manifest.json permissions
{
  "permissions": [
    "vfs.read",           // Read VFS files
    "vfs.write",          // Write VFS files (dangerous!)
    "state.read",         // Read agent state
    "events.subscribe",   // Subscribe to EventBus
    "tools.execute"       // Execute tools (very dangerous!)
  ]
}
```

### 5. Implementation Plan

**Phase 1: App Discovery**
- AppLoader module scans `/apps/*/manifest.json`
- Validates manifest schema
- Registers apps in registry

**Phase 2: UI Integration**
- Add Apps tab to sidebar
- Render app list with icons/names
- Mount apps in workspace on click

**Phase 3: Sandbox Bridge**
- Create postMessage API bridge
- Implement permission checks
- Proxy VFS/state/events to iframe

**Phase 4: Auto-Mount**
- Check `autoMount` on boot
- Restore pinned apps from localStorage
- Handle app lifecycle (mount/unmount)

### 6. Security Considerations

**Isolation:**
- Apps run in `<iframe sandbox="allow-scripts allow-same-origin">`
- No direct access to `window.REPLOID`
- All communication via postMessage

**Permission Gating:**
- Apps declare permissions in manifest
- User approves on first run (or auto-approve for agent-created apps)
- Runtime permission checks on every API call

**Dangerous Permissions:**
- `vfs.write` - Can modify system files
- `tools.execute` - Can run arbitrary tools
- Require explicit user approval

**CSP (Content Security Policy):**
```html
<iframe sandbox="allow-scripts allow-same-origin"
        csp="default-src 'self'; script-src 'unsafe-inline';">
```

### 7. Example Use Cases

**Performance Monitor:**
```javascript
// Agent creates /apps/perf-monitor/
// Subscribes to 'tool:slow' events
// Visualizes slow tool execution over time
```

**VFS Explorer:**
```javascript
// Agent creates /apps/vfs-explorer/
// Interactive file tree with search
// File dependency graph visualization
```

**Goal Tracker:**
```javascript
// Agent creates /apps/goal-tracker/
// Shows goal progress, sub-tasks
// Kanban board for recursive goals
```

**Debug Console:**
```javascript
// Agent creates /apps/debug-console/
// Real-time LLM response streaming
// Context inspection, token analysis
```

### 8. Agent Tool Integration

**New Tool: `create_app`**
```javascript
TOOL_CALL: create_app
ARGS: {
  "id": "my-viz",
  "name": "Performance Visualizer",
  "files": {
    "/apps/my-viz/manifest.json": "{...}",
    "/apps/my-viz/index.html": "<!DOCTYPE html>...",
    "/apps/my-viz/app.js": "..."
  },
  "autoMount": true,
  "permissions": ["vfs.read", "events.subscribe"]
}
```

**Tool writes files to VFS, emits event:**
```javascript
EventBus.emit('app:installed', { id: 'my-viz', name: '...' });
// AppLoader auto-discovers and mounts app
```

### 9. Migration Path

**Backward Compatibility:**
- Existing VFS preview still works
- Apps are opt-in enhancement
- `/apps/` directory convention

**Gradual Rollout:**
1. Implement AppLoader (discovery only)
2. Add Apps tab (manual mounting)
3. Add sandbox bridge (API access)
4. Add auto-mount (persistence)
5. Add create_app tool (agent integration)

## Open Questions

1. **Should apps be isolated from each other?**
   - Currently: Yes, separate iframes
   - Alternative: Shared iframe context?

2. **How to handle app updates?**
   - Agent overwrites files → App reloads?
   - Version management?

3. **App marketplace/sharing?**
   - Export apps as `.reploid-app.json`
   - Import from file or URL?

4. **Multi-agent apps?**
   - Can multiple agents collaborate on one app?
   - Conflict resolution?

## Success Metrics

- Agent can create functional UI in < 5 tool calls
- App renders within 500ms of mounting
- No security escapes (sandboxing holds)
- User can pin/unpin apps without restart

## Implementation Status

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | App Discovery | Planned |
| Phase 2 | UI Integration | Planned |
| Phase 3 | Sandbox Bridge | Planned |
| Phase 4 | Auto-Mount | Planned |

## References

- **Jupyter Widgets**: Similar concept of kernel-created UIs
- **VS Code Extensions**: Webview API for custom panels
- **Observable Framework**: Reactive notebooks with custom visualizations

---

*Last updated: December 2025*
