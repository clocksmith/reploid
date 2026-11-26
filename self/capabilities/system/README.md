# System Capabilities

Purpose: Substrate behavior, module loading and Doppler tooling capabilities.

## Scope

- SubstrateLoader and runtime module loading from VFS.
- Verification-aware loading and HITL gating.

Modules in this directory manage substrate behavior and Doppler tooling. Which genesis level loads each one is declared in [genesis-levels.json](../../config/genesis-levels.json); SubstrateLoader loads from `reflection` up.

## SubstrateLoader

Loads modules and widgets from VFS.

### Module Loading Notes

- Boot modules are imported from VFS in `host/start-app.js` after `host/seed-vfs.js` hydrates IndexedDB from `config/vfs-manifest.json`. `entry/start-app.js` and `entry/seed-vfs.js` only import those two files.
- The service worker `sw-module-loader.js` serves VFS files for standard module fetches with no network allowlist.
- SubstrateLoader uses `core/vfs-module-loader.js` to import modules via blob URLs from VFS content. These modules must be single-file or use absolute URLs because relative imports are not resolved.

### Verification

If `VerificationManager` is available, SubstrateLoader verifies module content before loading. When arena gating is enabled, critical paths are verified in a sandbox and may require HITL approval.
