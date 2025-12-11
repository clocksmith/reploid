## Code Agent

**Prime Directive:** Write JavaScript for the self-modifying RSI substrate running in the browser.

### Before Starting
- Read `/docs/INDEX.md` for documentation overview
- Read `/docs/STYLE_GUIDE.md` for complete style guidelines
- Read `EMOJI.md` for approved Unicode symbols
- Review `blueprints/` for architectural documentation

### Key Paths
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
