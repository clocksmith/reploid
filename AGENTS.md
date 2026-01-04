## Reploid Code Agent

**Prime Directive:** Write JavaScript for the self-modifying RSI substrate running in the browser.

**See also:** [DOPPLER](https://github.com/clocksmith/doppler) for WebGPU inference engine (separate repo).

### Directory Structure
```
reploid/
├── README.md                 ← Overview and quick start
├── AGENTS.md                 ← Agent instructions (this file)
├── EMOJI.md                  ← Approved Unicode symbols
├── src/                      ← Browser code (served to client)
│   ├── core/                 ← Agent loop, VFS, LLM client
│   ├── tools/                ← Dynamic agent tools
│   ├── infrastructure/       ← EventBus, DI, HITL
│   ├── ui/                   ← Proto UI components
│   └── blueprints/           ← Architectural specs
├── server/                   ← Proxy server (Node.js)
├── tests/                    ← Test suites
├── bin/                      ← CLI tools
└── docs/                     ← Documentation
```

### Before Starting
- Read `docs/INDEX.md` for documentation overview
- Read `docs/STYLE_GUIDE.md` for complete style guidelines
- Read `EMOJI.md` for approved Unicode symbols
- Review `src/blueprints/` for architectural documentation

### Key Paths
- `src/core/` - Agent loop, VFS, LLM client, tool runner
- `src/infrastructure/` - EventBus, DI container, HITL controller
- `src/tools/` - Agent tools (CamelCase naming)
- `src/ui/` - Proto UI components
- `src/config/` - Genesis levels, module registry
- `server/` - Proxy server
- `tests/` - Test suites

### Architecture
```
User Input -> AgentLoop -> LLMClient -> Tool Selection
                  |             |
            StateManager   ToolRunner -> VFS (IndexedDB)
                  |             |
            ContextManager  SchemaRegistry
                  |
            EventBus <-> HITL Controller
                  |
            GenesisSnapshot (immutable rollback)
```

### Testing
```bash
npm test                    # Run all tests
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests
npm run test:e2e            # Playwright E2E tests
npm run test:watch          # Watch mode
npm run test:coverage       # With coverage report
```

### CLI
```bash
npm run cli                 # Start Reploid CLI
npm run build:genesis       # Build genesis manifest
npm start                   # Start server
```

### Debugging
- **Agent loop hangs:** Check `core/agent-loop.js` for stuck awaits, inspect EventBus listeners
- **Tool failures:** Check `core/tool-runner.js`, verify tool schema in `tools/`
- **VFS issues:** Check IndexedDB in browser devtools, verify `capabilities/system/substrate-loader.js`
- **HITL blocks:** Check `infrastructure/hitl-controller.js` approval state
- **State corruption:** Use GenesisSnapshot rollback via `infrastructure/genesis-snapshot.js`
- **LLM errors:** Check `core/llm-client.js`, verify API keys in `.env`

### Guardrails
- Enforce `EMOJI.md`; use only approved Unicode symbols, no emojis
- All code changes must pass Verification Worker sandbox
- Preserve Genesis Kernel immutability for recovery
- Test in browser environment; uses IndexedDB for VFS

### Capability Levels
| Level | Name | Scope | Safety Gate |
|-------|------|-------|-------------|
| L0 | Basic Functions | CreateTool, Web APIs, new tools | Verification Worker |
| L1 | Meta Tooling | Modify tool-writer, improve CreateTool | Arena consensus |
| L2 | Self-Modification (Substrate) | Edit core modules, runtime patches | HITL approval |
| L3 | Weak RSI (Iterative) | Bounded feedback loops, self-improvement | HITL + rollback |
| L4 | True RSI (Impossible) | Unbounded self-improvement, theoretical | N/A |

### Key Concepts
- **VFS:** Virtual file system in IndexedDB
- **Genesis:** Immutable snapshot for rollback
- **HITL:** Human-in-the-loop approval gates
- **Arena:** Multi-model consensus for risky changes
