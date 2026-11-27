# REPLOID Testing Guide

Follow the [test-value rules](style-guide.md#test-value). Choose focused checks
under `AGENTS.md`; full suites are not a prerequisite for ordinary commits.

## Generated library delivery

`packages/reploid/src/` owns the browser library; `shared/vendor/reploid/`
is its served delivery, not a second implementation. Edit the source and run
`npm run sync:library`. `npm run verify:library` checks every generated asset
and package manifest without writing, and rejects missing, changed or unexpected
files. Inspect unexpected files before removing them; the sync command does not
delete files. CI checks this boundary before rebuilding browser delivery. Run
`node --test tests/scripts/sync-reploid-library.test.js` when changing the sync tool.

The application/native delivery version comes from the root package; the
browser library version comes from `packages/reploid/package.json`. They describe
different delivery artifacts and need not be bumped together. A version difference
is not evidence of stale bytes; the mirror check compares the library source and
its own metadata.

## Test Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    REPLOID Test Pyramid                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              End-to-End Browser Tests               │   │
│  │                tests/e2e/*.spec.js                  │   │
│  │         Boot → Agent → UI → Goal completion         │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Integration Tests                      │   │
│  │            tests/integration/*.test.js              │   │
│  │    AgentLoop, LLM client, GEPA, Arena harness       │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   Unit Tests                        │   │
│  │              tests/unit/*.test.js                   │   │
│  │     DI, EventBus, VFS, tools, state management      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Which checks to run

[AGENTS.md "Run and verify"](../AGENTS.md#run-and-verify) lists which check to run for which
change, the contract checks per behavior, and what opens a GPU device. The scripts are in
`package.json` (`test`, `test:unit`, `test:integration`, `test:heavy`, `test:e2e`,
`test:watch`, `test:coverage`, `test:scripts`).

---

## Runner ownership

| Scope | Entry | Boundary |
| --- | --- | --- |
| Default unit/integration checks | `tests/vitest.config.js` | happy-dom and explicit per-file Node environments |
| Retained-artifact/process checks | `tests/vitest.heavy.config.js` | Extends the default config; explicit `npm run test:heavy` |
| Tooling checks using `node:test` | `npm run test:scripts` | Native Node runner; excluded from Vitest |
| Cloudflare Worker contracts | `tests/cloudflare/vitest.config.js` | Worker runtime and bindings, separately opted in |
| Browser journeys | `tests/playwright.config.js` | Controlled browser/server fixture |
| External mailbox | `tests/playwright.external-brain.config.js` | Default-off local mailbox and loopback server fixture |
| Fresh visitor | `tests/first-visitor.playwright.config.js` | Separate clean visitor fixture |

Bare `.js` files under `tests/`, `tests/e2e/` and `tests/contracts/` are
standalone controllers or exported qualification harnesses. For example,
`tests/e2e/research-plugin-smoke.js` launches its own browser, while
`tests/contracts/doppler-partition-session.js` exports a caller-configured
qualification function. They are not Playwright specs to rename mechanically.
Physical controllers require their explicit model/device/environment inputs;
default software tests do not select or run them. Reploid tests and tools are
JavaScript only (`npm run verify:js-only`); a former Python reference stays only
as retained evidence, never as a runner.

Tests live under `tests/` and import the library, application or substrate owners.
A source directory without colocated tests does not imply that its code is
untested. Unit/integration files with the same stem protect different boundaries;
choose by the behavior being changed, not the basename alone.

## Test Layers

### 1. Unit Tests (`tests/unit/`)

Isolated tests for individual modules with mocked dependencies.

Representative test areas include:
- Infrastructure: `di-container.test.js`, `event-bus.test.js`, `context-manager.test.js`
- Core modules: `state-manager.test.js`, `utils-core.test.js`, `vfs-module-loader.test.js`
- Tools: `tools/read-file.test.js`, `tools/write-file.test.js`, `tools/edit-file.test.js`, `tools/list-files.test.js`, `tools/grep.test.js`, `tools/find.test.js`
- Execution: `tool-runner.test.js`, `response-parser.test.js`, `schema-validator.test.js`
- UI/UX: `toast.test.js`, `doppler-optimization-ui.test.js`
- Capabilities: `audit-logger.test.js`, `rate-limiter.test.js`, `rule-engine.test.js`, `policy-engine.test.js`, `gepa-engines.test.js`, `episodic-memory.test.js`, `hybrid-retrieval.test.js`, `knowledge-tree.test.js`, `observability.test.js`, `verification-manager.test.js`
- Browser: `browser-apis.test.js`, `core-hardening.test.js`
- Networking: `webrtc-swarm.test.js`, `swarm-sync.test.js`

**Run:**
```bash
npm run test:unit
```

**Framework:** Vitest 4.x + happy-dom

### 2. Integration Tests (`tests/integration/`)

Multi-module workflow tests with realistic state management.

Representative integration areas:
- Core cognitive loop: `agent-loop.test.js`, `fsm.test.js`, `rsi-loop.test.js`
- LLM & inference: `llm-client.test.js`, `gepa-optimizer.test.js`
- Memory & state: `prompt-memory.test.js`, `reflection-system.test.js`, `replay-engine.test.js`, `vfs.test.js`
- Persistence: `long-session.test.js`, `genesis-snapshot.test.js`
- Tool execution: `tool-runner.test.js`
- Arena (safety): `arena-harness.test.js`
- Networking: `webrtc-swarm.test.js`
- Routing: `websocket-routing.test.js`

**Run:**
```bash
npm run test:integration
```

### 3. E2E Tests (`tests/e2e/`)

Full browser automation with Playwright.

Representative browser specs:
- `boot.spec.js` - Agent boot sequence
- `dashboard.spec.js` - Dashboard functionality
- `workers.spec.js` - Web worker integration
- `accessibility.spec.js` - A11y compliance
- `agent-goals.spec.js` - Goal completion flows
- `modules.spec.js` - Module loading
- `rsi-loop.spec.js` - RSI loop validation

**Run:**
```bash
npm run test:e2e
```

**Debug console controller.** `node tests/e2e/debug-console.js` is a standalone script, not a
Playwright spec: it streams the browser console to the terminal. It reads these variables
(`npm run test:e2e` does not):

| Variable | Description | Default |
|----------|-------------|---------|
| `HEADLESS` | Run without visible browser | `true` |
| `TEST_AWAKEN` | Run with default goal | `false` |
| `GOAL` | Goal preset or custom text | - |
| `TIMEOUT` | Test timeout in ms | `60000` |
| `GENESIS` | Genesis level to use | `full` |
| `BASE_URL` | Server URL | `http://localhost:8080` |

**Goal Presets:**
- `hello` - Basic greeting
- `list` - List files
- `read` - Read a file
- `rsi` - Self-improvement test
- `toolchain` - Tool creation
- `selfaudit` - Self-audit
- `map` - Codebase mapping
- `deps` - Dependency analysis
- `security` - Security scan
- `refactor` - Code refactoring
- `testgen` - Test generation
- `docs` - Documentation
- `parallel` - Parallel tasks

**Example:**
```bash
# Run with visible browser and RSI goal
HEADLESS=false TEST_AWAKEN=true GOAL=rsi node tests/e2e/debug-console.js
```

### 4. Arena Testing (`self/testing/arena/`)

Multi-model consensus for RSI safety validation.

**Purpose:** Ensures risky L2/L3 operations are validated by multiple models before execution.

**See:** [Arena Source](../self/testing/arena/)

---

## Writing Tests

### Unit Test Template

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('ModuleName', () => {
  let mockDependency;
  let moduleUnderTest;

  beforeEach(() => {
    mockDependency = {
      method: vi.fn().mockReturnValue('mocked')
    };
    moduleUnderTest = createModule({ dependency: mockDependency });
  });

  it('should do something', () => {
    const result = moduleUnderTest.doSomething();
    expect(result).toBe('expected');
    expect(mockDependency.method).toHaveBeenCalled();
  });
});
```

### Integration Test Template

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('AgentLoop Integration', () => {
  let agent;
  let vfs;

  beforeEach(async () => {
    vfs = await createMockVFS();
    agent = await createAgent({ vfs });
  });

  afterEach(async () => {
    await agent.destroy();
  });

  it('should complete a goal', async () => {
    const result = await agent.runGoal('Create a file named test.txt');
    expect(result.success).toBe(true);
    expect(await vfs.exists('/test.txt')).toBe(true);
  });
});
```

---

## CI

The [Smoke workflow](../.github/workflows/test.yml) defines the automatic checks.
[AGENTS.md "Run and verify"](../AGENTS.md#run-and-verify) summarizes their scope.
Before a deployment, `npm run prepare:hosting` runs `verify:browser-bundle:local`
and `package:hosting`. These commands verify the hosting payload. Browser
execution, model and GPU qualification, physical peer acceptance, and production
deployment each require their own evidence.

---

## Configuration

### tests/vitest.config.js

Read the file for the exact settings. In outline:

- `root` is the repository root. A resolver plugin maps older test imports such as
  `../../core/...` to whichever served browser root (`BROWSER_ROOTS` in
  `server/browser-roots.js`) holds the path.
- `@reploid/poolday-ui` resolves to `packages/poolday-ui/src/index.ts`, with automatic JSX.
- `include`: `tests/**/*.test.js` and `tests/**/*.test.tsx`. `exclude`: `tests/scripts/**`
  (the `node:test` runner) and the exported `heavyTests` list, which
  `tests/vitest.heavy.config.js` runs.
- `environment: happy-dom`, `globals: true`, a 5 s test timeout (20 s under CI).
- Coverage (`npm run test:coverage`): provider `v8`, thresholds 60% for lines, functions,
  branches and statements.

---

## Troubleshooting

### Common Issues

**Tests hang on LLM calls:**
- Ensure mock LLM client is configured
- Check `TEST_MODE=true` environment variable

**VFS tests fail:**
- Clear IndexedDB between tests
- Use `createMockVFS()` helper

**E2E browser not launching:**
- Install Playwright browsers: `npx playwright install`
- Check DISPLAY variable on Linux

---

## Related Documentation

- Ouroboros Architecture (internal)
- [Arena Source](../self/testing/arena/)
- [Style Guide](./style-guide.md)
