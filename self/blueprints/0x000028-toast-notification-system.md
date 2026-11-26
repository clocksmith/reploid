# Blueprint 0x000028: Toast Notification System

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/ui/toast.js`, `/tests/unit/toast.test.js`

**Planned Artifacts:** None

**Owned Source Files:** `ui/toast.js`

**Former Blueprint Paths:** `self/blueprints/0x000028-toast-notification-system.md`

**Module:** `Toast` (default export of `self/ui/toast.js`; a plain singleton object, not a DI-container module)

---

## Purpose

`Toast` shows short, non-blocking notices for transient information and success, so the proto UI can confirm an action without a modal. It deliberately has no error or warning toasts: errors and warnings go to `ErrorStore` ([0x00006C](0x00006C-error-store.md)) and appear in the Status tab (`toast.js:3-4`).

An earlier version of this blueprint described a `ToastNotifications` module with `show(message, type, duration)`, error and warning types, and a statistics widget. That module does not exist; this blueprint now describes `self/ui/toast.js`.

## Interface

| Member | Behavior |
| --- | --- |
| `init()` | Creates one `div.toast-container` with `role="alert"` and `aria-live="polite"` and appends it to `document.body`. Later calls do nothing. |
| `show(options)` | Calls `init()`, builds a `div.toast.toast-<type>` with an icon, optional title and message, optional action buttons and a dismiss button, appends it and returns its ID (`toast-<n>`). |
| `dismiss(id)` | Plays a 0.2 s `fadeOut` animation, then removes the element. Unknown IDs are ignored. |
| `dismissAll()` | Dismisses every open toast. |
| `info(title, message, options?)` | `show({ type: 'info', title, message, ...options })`. |
| `success(title, message, options?)` | `show({ type: 'success', title, message, ...options })`. |

`show` options and defaults: `type = 'info'` (`'info'` or `'success'`; other values fall back to the info icon), `title = ''`, `message = ''`, `duration = 5000` ms (`0` disables auto-dismiss), `actions = []` of `{ label, onClick, primary }`. Clicking an action calls `onClick` and dismisses the toast.

Importing the module appends a `<style>` element that defines the `fadeOut` keyframes. Layout and colors come from `.toast-container` and `.toast` rules in `shared/styles/rd.css` and `self/styles/proto/responsive.css`.

## Consumers

`self/ui/proto/index.js` imports it and shows toasts for agent stop, missing goal, goal completion, agent error (pointing to the Status tab), export completion and context compaction (`index.js:913-1115`). `self/host/sw-module-loader.js:27` and `self/boot-helpers/vfs-hydrate.js:51` keep `/ui/toast.js` among the UI files preserved across VFS hydration.

## Invariants

- Title and message are inserted as text (escaped through `textContent`), so they cannot inject markup.
- A toast never blocks input and never requires a response; anything that needs a decision uses a different surface.
- No error or warning toast exists; failure reporting belongs to `ErrorStore`.

## Known gaps

- Action `label` values are inserted into the markup without escaping. Callers must pass fixed strings, not model or peer text.
- The glyphs used for the icons and the close button are not checked against [docs/EMOJI.md](../../docs/EMOJI.md) here.

## Verification

`tests/unit/toast.test.js` covers container creation, type classes, title and message, icons, unique IDs, auto-dismiss and `duration: 0`, actions, the close button, `dismiss`, `dismissAll` and the convenience methods. Its error-history and error-modal suites are skipped because those features moved to `ErrorStore`.

## Related blueprints

- [0x00006C Error Store](0x00006C-error-store.md): where errors and warnings go instead.
- [0x00003A Context Management](0x00003A-context-management.md): emits the `context:compacted` event behind the "Context Compacted" toast.
