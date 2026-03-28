---
name: reploid-debug
description: Debug Reploid agent issues. Use when investigating agent loop problems, tool execution failures, VFS issues, or state management bugs in the browser-based RSI substrate. (project)
metadata:
  short-description: Debug Reploid agent issues
---

# Reploid Debug Skill

You are debugging Reploid, a browser-native self-modifying AI agent.

## Quick Start

```bash
# Run all tests
npm test

# Run specific test suites
npm test -- --unit
npm test -- --integration
npm test -- --e2e

# Debug mode
npm run debug
npm run debug -- --goal "test vfs operations"

# Benchmarks
npm run bench

# Start dev server
npm start
```

## Key Paths (from reploid root)

| Path | Description |
|------|-------------|
| `core/` | Agent loop, VFS, LLM client, tool runner |
| `infrastructure/` | EventBus, DI container, HITL controller |
| `tools/` | Agent tools (CamelCase naming) |
| `ui/` | Proto UI components |
| `tests/` | Test suites |

## Debug Commands

```bash
# Testing (unified CLI)
npm test                        # Run all tests
npm test -- --unit              # Unit tests only
npm test -- --integration       # Integration tests
npm test -- --e2e               # Playwright E2E
npm test -- --e2e --headed      # E2E with visible browser
npm test -- --watch             # Watch mode
npm test -- --coverage          # With coverage

# Debug mode
npm run debug                   # Interactive debug console
npm run debug -- --headed       # With visible browser
npm run debug -- --goal "chat"  # Debug specific goal

# Benchmarks
npm run bench                   # Performance benchmarks

# Development
npm start                       # Start dev server
npm run cli                     # Start Reploid CLI

# Ouroboros integration (from ouroboros root)
npm run bench -- memory         # Memory benchmarks
npm run bench -- atomics        # Atomics performance
npm run db validate -- --shards reploid  # Validate shards
```

## Debug Checklist

### Agent Loop Issues
- Check `core/agent-loop.js` for stuck awaits
- Inspect EventBus listeners for circular events
- Verify LLM client responses

```bash
DEBUG=reploid:agent-loop npm test
```

### Tool Failures
- Check `core/tool-runner.js` execution path
- Verify tool schema in `tools/`
- Check tool dependencies

```bash
npm run test:unit -- --filter ToolRunner
```

### VFS Issues
- Check IndexedDB in browser devtools
- Verify `capabilities/system/substrate-loader.js`
- Check VFS initialization

```bash
# List VFS contents
npm run cli -- --command "VFS.list('/')"
```

### State Problems
- Check `core/state-manager.js`
- Inspect EventBus for missed events
- Verify state snapshots

```bash
DEBUG=reploid:state npm test
```

## Architecture

```
User Input -> AgentLoop -> LLMClient -> Tool Selection
                  |             |
            StateManager   ToolRunner -> VFS (IndexedDB)
                  |             |
            ContextManager  SchemaRegistry
                  |
            EventBus <-> HITL Controller
                  |
            GenesisSnapshot (rollback)
```

## Async Utilities

Tools now include timeout and retry support:

```javascript
import { withTimeout, withRetry, withTimeoutAndRetry } from '../core/async-utils.js';

// Timeout protection
const result = await withTimeout(operation(), 30000, 'MyOperation');

// Retry with exponential backoff
const result = await withRetry(async () => operation(), {
  maxAttempts: 3,
  initialDelayMs: 1000
});

// Combined
const result = await withTimeoutAndRetry(operation, {
  timeoutMs: 30000,
  maxAttempts: 3
});
```

## Common Issues

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Agent loop hangs | Stuck await in LLM client | Check timeout config |
| Tool timeout | Missing timeout wrapper | Add `withTimeout()` |
| VFS not found | IndexedDB not initialized | Check substrate loader |
| State corruption | Missing rollback | Use GenesisSnapshot |

## Related Skills

- **doppler-debug**: Debug WebGPU inference issues
- **doppler-benchmark**: Run performance benchmarks
- **ouroboros**: Maintain feature database

## Documentation

- `docs/TESTING.md` - Full testing guide
- `ARCHITECTURE.md` - System architecture
- `core/async-utils.js` - Timeout/retry utilities
