# REPLOID Testing Guide

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
| `npm test` | All tests | CI, before commits |
| `npm run test:unit` | Unit tests only | After core logic changes |
| `npm run test:integration` | Integration tests | After multi-module changes |
| `npm run test:e2e` | Browser E2E | After UI changes |
| `npm run test:watch` | Watch mode | During development |
| `npm run test:coverage` | Coverage report | Before PRs |

---

## Test Layers

### 1. Unit Tests (`tests/unit/`)

Isolated tests for individual modules with mocked dependencies.

**16 test files covering:**
- Infrastructure: `di-container.test.js`, `event-bus.test.js`, `context-manager.test.js`
- Core modules: `state-manager.test.js`, `utils.test.js`, `utils-core.test.js`
- Tools & execution: `tool-runner.test.js`, `response-parser.test.js`
- UI/UX: `confirmation-modal.test.js`, `toast.test.js`, `toast-notifications.test.js`
- Features: `audit-logger.test.js`, `rate-limiter.test.js`, `goal-history.test.js`
- Networking: `webrtc-swarm.test.js`, `swarm-sync.test.js`

**Run:**
```bash
npm run test:unit
```

**Framework:** Vitest 4.0.16 + happy-dom

### 2. Integration Tests (`tests/integration/`)

Multi-module workflow tests with realistic state management.

**12 test files covering:**
- Core cognitive loop: `agent-loop.test.js`, `fsm.test.js`
- LLM & inference: `llm-client.test.js`, `neural-compiler-lora.test.js`, `gepa-optimizer.test.js`
- Memory & state: `prompt-memory.test.js`, `reflection-system.test.js`, `replay-engine.test.js`, `vfs.test.js`
- Persistence: `long-session.test.js`
- Arena (safety): `arena-harness.test.js`
- Networking: `webrtc-swarm.test.js`

**Run:**
```bash
npm run test:integration
```

### 3. E2E Tests (`tests/e2e/`)

Full browser automation with Playwright.

**6 spec files:**
- `boot.spec.js` - Agent boot sequence
- `dashboard.spec.js` - Dashboard functionality
- `workers.spec.js` - Web worker integration
- `accessibility.spec.js` - A11y compliance
- `agent-goals.spec.js` - Goal completion flows
- `modules.spec.js` - Module loading

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
| `GENESIS` | Genesis level to use | `L1` |
| `BASE_URL` | Server URL | `http://localhost:3000` |

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

**See:** [testing/arena/README.md](../testing/arena/README.md)

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

GitHub Actions: `.github/workflows/test.yml`

**Matrix:**
- Node.js 18.x and 20.x

**Pipeline:**
1. Install dependencies
2. Run unit tests with coverage
3. Run integration tests
4. Upload coverage to Codecov
5. Lint and security checks

**Coverage Thresholds:**

| Metric | Threshold |
|--------|-----------|
| Lines | 60% |
| Functions | 60% |
| Branches | 60% |
| Statements | 60% |

---

## Configuration

### vitest.config.js

```javascript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
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

- [Ouroboros Architecture](../../ARCHITECTURE.md)
- [Arena System](../testing/arena/README.md)
- [Contributing Guide](CONTRIBUTING.md)
