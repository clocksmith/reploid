# Blueprint 0x000037: Browser API Integration Layer

**Classification:** Canonical Full Specification

**Implementation Status:** In-Progress

**Verified Artifacts:** `/self/infrastructure/browser-apis.js`, `/tests/unit/browser-apis.test.js`

**Planned Artifacts:** None

**Owned Source Files:** `infrastructure/browser-apis.js`

**Former Blueprint Paths:** `self/blueprints/0x000037-browser-api-integration.md`
**Objective:** Wrap browser capabilities (File System Access, notifications, clipboard, Web Share, storage, wake lock, visibility, online state, fullscreen, permissions) behind one module that detects what is available and reports each operation on the event bus.

**Prerequisites:** [0x00004F](0x00004F-event-bus-infrastructure.md) (event bus), [0x000005](0x000005-state-management-architecture.md) (state)

---

### 1. Module

`self/infrastructure/browser-apis.js` registers `BrowserAPIs` (genesis level `substrate`, async, dependencies `Utils`, `EventBus`, `StateManager`). `init()` runs the detectors (`fileSystemAccess`, `notifications`, `clipboard`, `webShare`, `storageEstimation`, `wakeLock`, `visibility`, `online`, `vibration`, `fullscreen`, `permissions`, `deviceMemory`, `hardwareConcurrency`) and emits `browser-apis:initialized` with the result.

The factory returns:

| Area | Functions | Event |
| --- | --- | --- |
| Capabilities | `init`, `getCapabilities`, `generateReport` | `browser-apis:initialized` |
| File System Access | `requestDirectoryAccess(mode = 'readwrite')`, `getDirectoryHandle`, `writeFile(path, content)`, `readFile(path)`, `syncArtifactToFilesystem(artifactPath)` | `browser-apis:filesystem:granted`, `browser-apis:filesystem:write` |
| Notifications | `requestNotificationPermission`, `showNotification(title, options)` | `browser-apis:notifications:permission`, `browser-apis:notifications:shown` |
| Clipboard | `writeToClipboard(text)`, `readFromClipboard` | `browser-apis:clipboard:write` |
| Web Share | `share(data)` | `browser-apis:share:success` |
| Storage | `getStorageEstimate`, `requestPersistentStorage` | `browser-apis:storage:estimate`, `browser-apis:storage:persist` |
| Wake Lock | `requestWakeLock`, `releaseWakeLock` | `browser-apis:wakelock:acquired`, `browser-apis:wakelock:released` |
| Visibility, online | `isPageVisible`, `onVisibilityChange(cb)`, `isOnline`, `onOnlineChange(cb)` | `browser-apis:visibility`, `browser-apis:online` |
| Fullscreen | `requestFullscreen(element)`, `exitFullscreen`, `isFullscreen` | `browser-apis:fullscreen` |
| Other | `queryPermission(name)`, `getDeviceInfo`, `vibrate(pattern)` | |

File writes go only into the directory the user picked with `requestDirectoryAccess`; without a handle, `writeFile` and `readFile` log an error and return `false` or `null`. Directory access and notification permission need a user gesture, as the browser requires. The module has no UI of its own.

### 2. Known gaps

- `syncArtifactToFilesystem` reads the artifact through `VFS` (`VFS.exists`, then `VFS.read`) and returns `false` for a missing path; `tests/unit/browser-apis.test.js` covers it.
- No other module or tool calls `BrowserAPIs`; it is loaded by genesis level but unused.

### 3. Verification conditions

- Capability detection reflects the running browser and emits `browser-apis:initialized` once per `init()`.
- `writeFile` creates nested directories under the chosen handle and writes nowhere else.
- Clipboard, share and storage calls return `false` or `null` when the API is missing, without throwing.
