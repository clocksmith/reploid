## Reploid Code Agent

**Prime Directive:** Write JavaScript for the self-modifying RSI substrate running in the browser.

**See also:** [DOPPLER](https://github.com/clocksmith/doppler) for WebGPU inference engine (separate repo).

### Directory Structure
```
reploid/
├── README.md                 ← Overview and quick start
├── AGENTS.md                 ← Agent instructions
├── EMOJI.md                  ← Approved Unicode symbols
├── self/                     ← Browser code and public web root
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
- Read `docs/style-guide.md` for complete style guidelines
- Read `EMOJI.md` for approved Unicode symbols
- Review `self/blueprints/` for architectural documentation

### Key Paths
- `self/core/` - Agent loop, VFS, LLM client, tool runner
- `self/infrastructure/` - EventBus, DI container, HITL controller
- `self/tools/` - Agent tools (CamelCase naming)
- `self/ui/` - Proto UI components
- `self/config/` - Genesis levels, module registry
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

## Intent-First Operations

- Treat Reploid intent as distinct surfaces with distinct authority: Poolday, Zero, and X must not be mentally merged.
- If the user asks what a route or UI does, inspect the actual route files, boot profile, VFS seed, and rendered state before proposing names or navigation changes.
- The user controls public naming and product copy. Do not rename routes, labels, buttons, or trust language without direction.
- For Poolday, claim only browser inference backed by signed records, audits, reputation, policy, and deterministic comparison. Do not imply trustless compute, hardware attestation, or guaranteed honest browser/GPU execution.
- For Zero, operational questions require process parentage, provider status, VFS readability/writability, tool-call logs, and resume state before explanation.
- For X, keep self-modification, swarm, validation, and promotion evidence separate from Poolday inference records.
- If the user asks "deployed?", answer with deployed URL/build identifier, not general progress language.
- If provider/API errors occur, verify the HTTP status, retry/backoff state, and parked/resumable state before describing behavior.

### Capability Levels
| Level | Name | Scope | Gate |
|-------|------|-------|------|
| L0 | Basic Functions | CreateTool, Web APIs, new tools | Verification Worker |
| L1 | Meta Tooling | Modify tool-writer, improve CreateTool | Arena consensus |
| L2 | Self-Modification (Substrate) | Edit core modules, runtime patches | Arena + Genesis rollback |
| L3 | Weak RSI (Iterative) | Bounded feedback loops, self-improvement | Arena + Genesis rollback + iteration caps |
| L4 | Weak AGI | Broad autonomous planning, system-building, and self-directed experimentation | N/A |

### Key Concepts
- **VFS:** Virtual file system in IndexedDB
- **Genesis:** Immutable snapshot for rollback
- **HITL:** Human-in-the-loop approval gates
- **Arena:** Multi-model consensus for risky changes

## No time estimates

- never estimate work in hours, days, weeks, or any other time unit, in code, comments, commit messages, status updates, receipts, or chat replies
- do not say "~30 min", "~2 hr", "multi-day", "quick", "long-running" as size proxies for engineering work
- describe what the work IS — the file to change, the function to add, the schema field to extend, the named blocker to fix — not how long it should take
- if scope must be conveyed, list the concrete deltas (lines/files/symbols touched) instead of a duration

## Pick the real fix

- when you find a correctness bug, the default is to fix it, not to relabel it
- do not use effort or scope framing ("non-trivial", "real engineering effort", "worth its own thread", "we'll address later") as cover for choosing a lesser fix
- do not propose "mark experimental", "add a TODO", or "rewrite the misleading comment" as a substitute for the actual engineering work when the underlying behavior is wrong
- if scope genuinely must be split, describe the concrete deltas and ask the user which path to take, do not pre-decide a smaller version
