## Code Agent

**Prime Directive:** Write JavaScript for the self-modifying RSI substrate running in the browser.

### Before Starting
- Read `README.md` for architecture and philosophy
- Read `docs/STYLE_GUIDE.md` for complete style guidelines
- Read `EMOJI.md` for approved Unicode symbols
- Review `blueprints/` for architectural documentation

### Key Paths
- `infrastructure/` - Core modules (VFS, EventBus, StateManager)
- `agents/` - Agent logic and tool definitions
- `ui/components/` - UI components
- `ui/dashboard/` - Dashboard panels
- `examples/` - Example scripts
- `tests/` - Test suites

### Guardrails
- Enforce `EMOJI.md`; use only approved Unicode symbols, no emojis
- All code changes must pass Verification Worker sandbox
- Preserve Genesis Kernel immutability for recovery
- Level 3 RSI (substrate modification) requires explicit approval
- Test in browser environment; uses IndexedDB for VFS

### Key Concepts
- **VFS:** Virtual file system in IndexedDB
- **RSI Levels:** L1 (tools), L2 (meta-tools), L3 (substrate)
- **Safety:** Verification Worker sandbox, Genesis snapshots
