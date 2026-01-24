# System Capabilities

Purpose: Substrate behavior and module-loading capabilities for full genesis.

## Scope

- SubstrateLoader and runtime module loading from VFS.
- Verification-aware loading and HITL gating.

Modules in this directory manage substrate behavior for full genesis.

## SubstrateLoader

Loads modules and widgets from VFS.

### Module Loading Notes

- Boot modules are imported from VFS in `boot.js` after `bootstrap.js` hydrates IndexedDB from `config/vfs-manifest.json`.
- The service worker `sw-module-loader.js` serves VFS files for standard module fetches with no network allowlist.
- SubstrateLoader uses `core/vfs-module-loader.js` to import modules via blob URLs from VFS content. These modules must be single-file or use absolute URLs because relative imports are not resolved.

### Verification

If `VerificationManager` is available, SubstrateLoader verifies module content before loading. When arena gating is enabled, critical paths are verified in a sandbox and may require HITL approval.
