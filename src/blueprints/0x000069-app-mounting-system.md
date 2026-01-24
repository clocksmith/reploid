# Blueprint 0x000080: App Mounting System

**Target Upgrade:** APPM (`app-mount-manager.js`), APPB (`app-bridge.js`)

**Objective:** Enable agents to create persistent UI applications that live in VFS and mount into the proto via sandboxed iframes with controlled API access.

**Prerequisites:** 0x000048 (Module Widget Protocol), 0x000049 (Dependency Injection Container), 0x000047 (Verification Manager)

**Affected Artifacts:** `/core/app-mount-manager.js`, `/core/app-bridge.js`, `/ui/panels/apps-panel.js`, `/apps/*/manifest.json`

---

## 1. The Strategic Imperative

**The Problem:**
REPLOID can generate tools and modify its own code, but lacks a first-class mechanism for agents to create persistent interactive UI applications. Current limitations:

- Modules can only expose widgets via the fixed Module Widget Protocol
- No way for agents to dynamically create rich, standalone UI experiences
- Custom UI requires modifying core files (index.html, CSS)
- No isolation between agent-created UI and core system
- No permission model for what agent apps can access

**The Solution:**
A formal App Mounting System that:
1. Defines a manifest format for apps stored in VFS at `/apps/{app-id}/`
2. Auto-discovers and lists apps in a dedicated Apps panel
3. Mounts apps in sandboxed iframes with CSP restrictions
4. Provides a postMessage-based API bridge for controlled VFS/EventBus access
5. Enforces a permission model (read, write, network, notifications)

This enables:
- **Agent creativity** - Build custom dashboards, visualizations, games, utilities
- **Isolation** - Apps cannot crash or corrupt the core system
- **Persistence** - Apps survive reboots (stored in VFS)
- **Security** - Explicit permission grants, audit logging

---

## 2. App Manifest Format

### 2.1 Location and Structure

Apps live at `/apps/{app-id}/` with this structure:
```
/apps/
  my-dashboard/
    manifest.json
    index.html
    style.css
    app.js
    assets/
      icon.svg
```

### 2.2 Manifest Schema

```javascript
{
  // REQUIRED
  "id": "my-dashboard",           // Unique identifier (kebab-case)
  "name": "My Dashboard",         // Display name
  "version": "1.0.0",             // Semantic version
  "entry": "index.html",          // Entry point (relative to app dir)

  // OPTIONAL
  "description": "A custom monitoring dashboard",
  "icon": "assets/icon.svg",      // 64x64 recommended
  "author": "Agent",
  "created": 1703500000000,       // Timestamp
  "updated": 1703600000000,

  // PERMISSIONS (default: none)
  "permissions": {
    "vfs": {
      "read": ["/docs/*", "/.memory/*"],   // Glob patterns
      "write": ["/apps/my-dashboard/*"]     // Usually only own directory
    },
    "eventbus": {
      "subscribe": ["agent:*", "artifact:*"],
      "emit": ["app:my-dashboard:*"]
    },
    "network": false,             // External fetch (default: false)
    "notifications": false,       // Browser notifications
    "clipboard": false,           // Clipboard access
    "storage": "1MB"              // localStorage quota for app
  },

  // UI HINTS
  "display": {
    "width": "800px",             // Preferred width
    "height": "600px",            // Preferred height
    "resizable": true,
    "position": "center"          // center, top-left, etc.
  },

  // LIFECYCLE
  "autoMount": false              // Mount on boot (default: false)
}
```

---

## 3. Dashboard Integration

### 3.1 Apps Panel

A new `apps-panel.js` in `/ui/panels/` provides:

```
+------------------------------------------------------------------+
| APPS                                                    [+] [...]  |
+------------------------------------------------------------------+
| +----------------+  +----------------+  +----------------+        |
| |   [icon]       |  |   [icon]       |  |   [icon]       |        |
| | My Dashboard   |  | Task Tracker   |  | Code Metrics   |        |
| | v1.0.0         |  | v2.1.0         |  | v1.2.3         |        |
| |                |  |                |  |                |        |
| | [Mount] [...]  |  | [Mounted]  [x] |  | [Mount] [...]  |        |
| +----------------+  +----------------+  +----------------+        |
+------------------------------------------------------------------+
```

**Features:**
- Grid of app cards with icons, names, versions
- Mount/Unmount buttons
- Context menu: Edit, Delete, Export, Permissions
- [+] button opens app creation wizard (or links to CreateApp tool)
- [...] menu: Refresh, Import App, Settings

### 3.2 App Discovery

On boot and on-demand:
```javascript
const discoverApps = async () => {
  const apps = [];
  const appDirs = await VFS.list('/apps/');

  for (const dir of appDirs) {
    const manifestPath = `${dir}/manifest.json`;
    if (await VFS.exists(manifestPath)) {
      try {
        const manifest = JSON.parse(await VFS.read(manifestPath));
        apps.push({ dir, manifest });
      } catch (e) {
        logger.warn(`Invalid manifest: ${manifestPath}`);
      }
    }
  }

  return apps;
};
```

### 3.3 Auto-Mount

Apps with `"autoMount": true` are mounted during boot:
```javascript
// In entry/start-app.js or AppMountManager.init()
const apps = await discoverApps();
for (const { manifest } of apps) {
  if (manifest.autoMount) {
    await mountApp(manifest.id);
  }
}
```

---

## 4. Sandbox API Bridge

### 4.1 Iframe Sandboxing

Apps mount in iframes with strict sandbox attributes:

```html
<iframe
  id="app-frame-my-dashboard"
  src="blob:..."
  sandbox="allow-scripts allow-same-origin"
  csp="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"
></iframe>
```

**Sandbox Restrictions:**
- `allow-scripts` - Execute JavaScript
- `allow-same-origin` - Access sessionStorage (NOT parent window)
- NO `allow-top-navigation` - Cannot navigate parent
- NO `allow-popups` - Cannot open new windows
- NO `allow-forms` - Forms use API bridge instead

### 4.2 API Bridge Protocol

Communication via `postMessage`:

**App to Host (Request):**
```javascript
// In app's app.js
window.parent.postMessage({
  type: 'REPLOID_API_REQUEST',
  id: crypto.randomUUID(),
  method: 'vfs.read',
  args: ['/docs/README.md']
}, '*');
```

**Host to App (Response):**
```javascript
// AppBridge handles and responds
window.addEventListener('message', async (event) => {
  if (event.data.type !== 'REPLOID_API_REQUEST') return;

  const { id, method, args } = event.data;
  const appId = getAppIdFromFrame(event.source);

  // Permission check
  if (!hasPermission(appId, method, args)) {
    event.source.postMessage({
      type: 'REPLOID_API_RESPONSE',
      id,
      error: 'Permission denied'
    }, '*');
    return;
  }

  try {
    const result = await executeMethod(method, args);
    event.source.postMessage({
      type: 'REPLOID_API_RESPONSE',
      id,
      result
    }, '*');
  } catch (e) {
    event.source.postMessage({
      type: 'REPLOID_API_RESPONSE',
      id,
      error: e.message
    }, '*');
  }
});
```

### 4.3 API Methods

**VFS Operations:**
- `vfs.read(path)` - Read file content
- `vfs.write(path, content)` - Write file (permission required)
- `vfs.list(path)` - List directory
- `vfs.exists(path)` - Check existence
- `vfs.delete(path)` - Delete file (permission required)

**EventBus Operations:**
- `eventbus.subscribe(eventName)` - Subscribe to event (returns subscription ID)
- `eventbus.unsubscribe(subscriptionId)` - Unsubscribe
- `eventbus.emit(eventName, data)` - Emit event (permission required)

**System Operations:**
- `system.getState()` - Get agent state (read-only)
- `system.getConfig()` - Get relevant config
- `system.notify(title, body)` - Show notification (permission required)

### 4.4 Client SDK

A minimal SDK for apps to include:

```javascript
// /apps/_sdk/reploid-app-sdk.js
class ReploidAppSDK {
  constructor() {
    this._pending = new Map();
    this._subscriptions = new Map();
    window.addEventListener('message', this._handleMessage.bind(this));
  }

  _handleMessage(event) {
    const { type, id, result, error, eventName, data } = event.data;

    if (type === 'REPLOID_API_RESPONSE') {
      const pending = this._pending.get(id);
      if (pending) {
        this._pending.delete(id);
        if (error) pending.reject(new Error(error));
        else pending.resolve(result);
      }
    }

    if (type === 'REPLOID_EVENT') {
      const handlers = this._subscriptions.get(eventName) || [];
      handlers.forEach(h => h(data));
    }
  }

  async call(method, ...args) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      this._pending.set(id, { resolve, reject });

      window.parent.postMessage({
        type: 'REPLOID_API_REQUEST',
        id,
        method,
        args
      }, '*');

      // Timeout after 30s
      setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  // Convenience methods
  vfs = {
    read: (path) => this.call('vfs.read', path),
    write: (path, content) => this.call('vfs.write', path, content),
    list: (path) => this.call('vfs.list', path),
    exists: (path) => this.call('vfs.exists', path),
    delete: (path) => this.call('vfs.delete', path)
  };

  eventbus = {
    subscribe: async (eventName, handler) => {
      const subId = await this.call('eventbus.subscribe', eventName);
      if (!this._subscriptions.has(eventName)) {
        this._subscriptions.set(eventName, []);
      }
      this._subscriptions.get(eventName).push(handler);
      return subId;
    },
    emit: (eventName, data) => this.call('eventbus.emit', eventName, data)
  };

  system = {
    getState: () => this.call('system.getState'),
    notify: (title, body) => this.call('system.notify', title, body)
  };
}

window.reploid = new ReploidAppSDK();
```

---

## 5. Permission Model

### 5.1 Permission Checking

```javascript
const hasPermission = (appId, method, args) => {
  const manifest = getManifest(appId);
  const perms = manifest.permissions || {};

  if (method.startsWith('vfs.')) {
    const path = args[0];
    const isWrite = ['vfs.write', 'vfs.delete'].includes(method);
    const patterns = isWrite ? perms.vfs?.write : perms.vfs?.read;
    return matchesAnyPattern(path, patterns || []);
  }

  if (method.startsWith('eventbus.')) {
    const eventName = args[0];
    if (method === 'eventbus.subscribe') {
      return matchesAnyPattern(eventName, perms.eventbus?.subscribe || []);
    }
    if (method === 'eventbus.emit') {
      return matchesAnyPattern(eventName, perms.eventbus?.emit || []);
    }
  }

  if (method === 'system.notify') {
    return perms.notifications === true;
  }

  return false;
};

const matchesAnyPattern = (value, patterns) => {
  return patterns.some(pattern => {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(value);
  });
};
```

### 5.2 Permission Prompts

When an app requests elevated permissions (first use):

```
+------------------------------------------+
|  App Permission Request                   |
+------------------------------------------+
|  "My Dashboard" wants to:                 |
|                                           |
|  [x] Read files in /docs/*                |
|  [x] Read files in /.memory/*             |
|  [x] Write to its own directory           |
|  [ ] Send browser notifications           |
|                                           |
|  [Deny]                    [Allow Once]   |
|                            [Always Allow] |
+------------------------------------------+
```

### 5.3 Audit Logging

All API bridge calls are logged:

```javascript
// In AppBridge
if (AuditLogger) {
  await AuditLogger.logEvent('APP_API_CALL', {
    appId,
    method,
    args: sanitizeArgs(args),
    allowed: hasPermission(appId, method, args),
    timestamp: Date.now()
  }, hasPermission(...) ? 'INFO' : 'WARN');
}
```

---

## 6. Implementation Phases

### Phase 1: Static App Loading
1. Create manifest schema and validation
2. Implement `discoverApps()` in AppMountManager
3. Create apps-panel.js with grid display
4. Basic iframe mounting (no API bridge yet)
5. Add to genesis-levels.json under `full`

### Phase 2: API Bridge
1. Create app-bridge.js with postMessage handler
2. Implement VFS read-only methods
3. Implement EventBus subscribe (receive only)
4. Create reploid-app-sdk.js for apps to include
5. Permission checking infrastructure

### Phase 3: Write Permissions and Events
1. Add VFS write/delete with permission checks
2. Add EventBus emit with permission checks
3. Permission prompt UI
4. Audit logging integration

### Phase 4: Agent Tool Integration
1. CreateApp tool - scaffold new app from template
2. UpdateApp tool - modify app files
3. DeleteApp tool - remove app safely
4. Integration with HITL for app creation approval

### Phase 5: Advanced Features
1. App-to-app communication
2. Shared SDK updates (hot reload SDK)
3. App marketplace (export/import bundles)
4. Performance monitoring per-app

---

## 7. Security Considerations

### 7.1 Threat Model

| Threat | Mitigation |
|--------|------------|
| XSS in app affecting host | Iframe sandbox, separate origin |
| App reading sensitive VFS paths | Permission whitelist, pattern matching |
| App spamming EventBus | Rate limiting, permission restrictions |
| App consuming excessive resources | localStorage quota, CPU throttling |
| Malicious app installation | HITL approval for CreateApp tool |
| App phishing (fake REPLOID UI) | Visual indicator showing app boundaries |

### 7.2 CSP Policy

```
default-src 'self';
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
connect-src 'none';
frame-ancestors 'none';
```

Apps requesting `network: true` get a relaxed `connect-src`.

### 7.3 Origin Isolation

Each app gets a unique blob URL origin:
```javascript
const blob = new Blob([appHtml], { type: 'text/html' });
const blobUrl = URL.createObjectURL(blob);
iframe.src = blobUrl;
```

This prevents apps from accessing each other's storage or the host's storage.

---

## 8. Module Interface

### 8.1 AppMountManager API

```javascript
const AppMountManager = {
  // Discovery
  discoverApps: () => Promise<App[]>,
  getApp: (appId) => Promise<App | null>,

  // Lifecycle
  mountApp: (appId, container?) => Promise<void>,
  unmountApp: (appId) => Promise<void>,
  isAppMounted: (appId) => boolean,
  getMountedApps: () => string[],

  // Management
  createApp: (manifest, files) => Promise<string>,  // Returns appId
  updateApp: (appId, changes) => Promise<void>,
  deleteApp: (appId) => Promise<void>,
  exportApp: (appId) => Promise<Blob>,              // ZIP bundle
  importApp: (bundle) => Promise<string>,

  // Events
  // Emits: app:discovered, app:mounted, app:unmounted, app:error
};
```

### 8.2 AppBridge API (Internal)

```javascript
const AppBridge = {
  registerApp: (appId, iframe) => void,
  unregisterApp: (appId) => void,
  handleMessage: (event) => Promise<void>,
  getPermissions: (appId) => Permissions,
  setPermissions: (appId, permissions) => void
};
```

---

## 9. Example App

### manifest.json
```json
{
  "id": "vfs-usage-monitor",
  "name": "VFS Usage Monitor",
  "version": "1.0.0",
  "entry": "index.html",
  "description": "Real-time VFS storage visualization",
  "permissions": {
    "vfs": {
      "read": ["/*"]
    },
    "eventbus": {
      "subscribe": ["artifact:*"]
    }
  },
  "display": {
    "width": "600px",
    "height": "400px"
  }
}
```

### index.html
```html
<!DOCTYPE html>
<html>
<head>
  <title>VFS Usage Monitor</title>
  <script src="../_sdk/reploid-app-sdk.js"></script>
  <style>
    body { font-family: system-ui; padding: 16px; }
    .bar { height: 20px; background: #4CAF50; margin: 4px 0; }
  </style>
</head>
<body>
  <h2>VFS Usage by Directory</h2>
  <div id="chart"></div>

  <script>
    async function refresh() {
      const files = await reploid.vfs.list('/');
      const usage = {};

      for (const path of files) {
        const dir = '/' + path.split('/')[1];
        const content = await reploid.vfs.read(path);
        usage[dir] = (usage[dir] || 0) + content.length;
      }

      const chart = document.getElementById('chart');
      const max = Math.max(...Object.values(usage));

      chart.innerHTML = Object.entries(usage)
        .sort((a, b) => b[1] - a[1])
        .map(([dir, bytes]) => `
          <div>${dir}: ${(bytes / 1024).toFixed(1)} KB</div>
          <div class="bar" style="width: ${(bytes / max) * 100}%"></div>
        `).join('');
    }

    refresh();
    reploid.eventbus.subscribe('artifact:*', refresh);
  </script>
</body>
</html>
```

---

## 10. Success Criteria

**Functionality:**
- [ ] Apps discoverable from `/apps/` directory
- [ ] Apps mount in sandboxed iframes
- [ ] API bridge enables VFS read/write
- [ ] API bridge enables EventBus subscribe/emit
- [ ] Permission model enforced

**Security:**
- [ ] Apps cannot access host DOM
- [ ] Apps cannot read unauthorized VFS paths
- [ ] All API calls audit logged
- [ ] CSP prevents external resource loading

**Integration:**
- [ ] Apps panel in proto UI
- [ ] CreateApp tool for agent use
- [ ] Auto-mount on boot works
- [ ] HITL approval for app creation

---

**Status:** Phase 1 - Design complete, implementation pending.

**See Also:**
- [Blueprint 0x000048: Module Widget Protocol](0x000048-module-widget-protocol.md)
- [Blueprint 0x000047: Verification Manager](0x000047-verification-manager.md)
- [docs/security.md](../docs/security.md)
