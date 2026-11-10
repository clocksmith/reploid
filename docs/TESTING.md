# REPLOID Testing Guide

Follow the [test-value rules](style-guide.md#test-value). Choose focused checks
under `AGENTS.md`; full suites are not a prerequisite for ordinary commits.

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

## Quick Reference

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `npm test` | All Vitest tests | Explicit full-suite validation |
| `npx vitest run --config tests/vitest.config.js <file>` | Focused tests | Changed behavior |
| `npm run test:integration` | Integration suite | Explicit integration-wide validation |
| `npm run test:e2e` | Browser E2E suite | Explicit browser-wide validation |
| `npm run test:watch` | Watch mode | During development |
| `npm run test:coverage` | Coverage report | A named coverage question |

---

## Test Layers

### 1. Unit Tests (`tests/unit/`)

Isolated tests for individual modules with mocked dependencies.

Representative test areas include:
- Infrastructure: `di-container.test.js`, `event-bus.test.js`, `context-manager.test.js`
- Core modules: `state-manager.test.js`, `utils.test.js`, `utils-core.test.js`, `vfs-module-loader.test.js`
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

**18 test files covering:**
- Core cognitive loop: `agent-loop.test.js`, `fsm.test.js`, `rsi-loop.test.js`
- LLM & inference: `llm-client.test.js`, `neural-compiler-lora.test.js`, `gepa-optimizer.test.js`
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

**7 spec files:**
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

**Environment Variables:**

| Variable | Description | Default |
|----------|-------------|---------|
| `HEADLESS` | Run without visible browser | `true` |
| `TEST_AWAKEN` | Run with default goal | `false` |
| `GOAL` | Goal preset or custom text | - |
| `TIMEOUT` | Test timeout in ms | `60000` |
| `GENESIS` | Genesis level to use | `full` |
| `BASE_URL` | Server URL | `http://localhost:8000` |

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
HEADLESS=false GOAL=rsi npm run test:e2e
```

### 4. Arena Testing (`testing/arena/`)

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

## CI/CD

GitHub Actions: `.github/workflows/test.yml` has one automatic job on Ubuntu
and Node.js 22. It installs the non-optional dependencies, runs
`npm run build:browser-bundle` to rebuild the product entry bundle, module
inventory and browser manifest from the commit's source, then runs
`npm run package:hosting` to build the Firebase hosting payload from that
output. The packager parses the Doppler module dependency closure, rejects
missing assets, verifies the pinned archive and projected bytes, validates the
browser manifest, and writes exactly the validated bytes to
`.firebase-hosting/reploid`. A build or packaging failure fails CI. The job
does not deploy, and it does not check whether the committed bundle and
manifest are current: a stale committed bundle passes CI.

Reproduce the job on Node.js 22 (the build rewrites the tracked bundle,
inventory and manifest in the working tree):

```bash
npm ci --omit=optional --no-audit --no-fund
npm run build:browser-bundle
npm run package:hosting
```

Freshness of the committed bundle is checked before a deployment by
`npm run prepare:hosting`, which runs `npm run verify:browser-bundle:local` and
fails on a stale bundle or manifest. For changes to browser assets, update them
with `npm run build:browser-bundle` and review the generated diff.
A successful packaging check is not browser execution, model/GPU qualification,
physical peer acceptance, or production deployment evidence.

Lint, Vitest, installed-package acceptance, browser journeys, heavy tests and
release qualification remain available on demand, not on every push. Install
full dependencies with `npm ci`, then choose the checks relevant to the change:
`npm run lint`, `npm test`, `node tests/library-package-acceptance.js`, or
`npm run test:e2e:smoke` (the latter two require
`npx playwright install --with-deps chromium`). Existing release acceptance
thresholds remain unchanged. Run `verify:*` config, mirror and freshness checks
when editing what they check, not as a blanket gate. The separate blueprint
snapshot workflow is manual-only via `workflow_dispatch`.

**Coverage Thresholds:**

| Metric | Threshold |
|--------|-----------|
| Lines | 60% |
| Functions | 60% |
| Branches | 60% |
| Statements | 60% |

---

## Configuration

### tests/vitest.config.js

```javascript
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

const src = resolve('src');

export default defineConfig({
  resolve: {
    alias: [
      // Tests import ../../core/ etc. — rewrite to self/
      { find: /^(\.\.\/)+(?=(core|infrastructure|capabilities|testing|tools|ui)\/)/, replacement: src + '/' },
    ]
  },
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'happy-dom',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60
      }
    }
  }
});
```

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
