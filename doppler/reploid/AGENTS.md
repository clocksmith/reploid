## Reploid Code Agent

**Prime Directive:** Write JavaScript for the self-modifying RSI substrate running in the browser.

**See also:** [DOPPLER](https://github.com/clocksmith/doppler) for WebGPU inference engine (separate repo).

### Directory Structure
```
reploid/
├── README.md                 ← Simple links (you are here at root)
├── AGENTS.md                 ← Symlink to doppler/reploid/AGENTS.md
├── CLAUDE.md                 ← Symlink to doppler/reploid/AGENTS.md
├── EMOJI.md                  ← Symlink to doppler/reploid/EMOJI.md
└── doppler/                  ← Intentionally empty
    └── reploid/              ← Actual project contents
        └── (core/, tools/, ui/, etc.)
```

### Before Starting
- Read `doppler/reploid/docs/INDEX.md` for documentation overview
- Read `doppler/reploid/docs/STYLE_GUIDE.md` for complete style guidelines
- Read `doppler/reploid/EMOJI.md` for approved Unicode symbols
- Review `doppler/reploid/blueprints/` for architectural documentation

### Key Paths (relative to `doppler/reploid/`)
- `core/` - Agent loop, VFS, LLM client, tool runner
- `infrastructure/` - EventBus, DI container, HITL controller
- `tools/` - Agent tools (CamelCase naming)
- `ui/` - Proto UI components
- `config/` - Genesis levels, module registry
- `tests/` - Test suites

### Guardrails
- Enforce `EMOJI.md`; use only approved Unicode symbols, no emojis
- All code changes must pass Verification Worker sandbox
- Preserve Genesis Kernel immutability for recovery
- Test in browser environment; uses IndexedDB for VFS

### RSI Levels
| Level | Scope | Examples | Safety Gate |
|-------|-------|----------|-------------|
| L1 | Tools | CreateTool, new tool in `/tools/` | Verification Worker |
| L2 | Meta | Modify tool-writer, improve CreateTool | Arena consensus |
| L3 | Substrate | Edit agent-loop.js, core modules | HITL approval required |

### Key Concepts
- **VFS:** Virtual file system in IndexedDB
- **Genesis:** Immutable snapshot for rollback
- **HITL:** Human-in-the-loop approval gates
- **Arena:** Multi-model consensus for risky changes
