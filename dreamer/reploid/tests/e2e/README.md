# E2E Tests

End-to-end tests for REPLOID using Playwright.

## Test Files

| File | Description | Tests |
|------|-------------|-------|
| `boot.spec.js` | Boot screen, mode selection, goal input | 12 |
| `dashboard.spec.js` | Dashboard UI, tabs, VFS panel, controls | 16 |
| `workers.spec.js` | WorkerManager panel, indicators, events | 12 |
| `accessibility.spec.js` | Keyboard nav, ARIA, focus indicators | 8 |
| `modules.spec.js` | WebGPU, LLMR/HYBR module loading | 6 |
| `agent-goals.spec.js` | Challenging goals for stress testing | 12 |
| `debug-console.js` | Standalone debug utility (not a test) | - |

## Running Tests

```bash
# Run all tests
npx playwright test

# Run specific test file
npx playwright test boot.spec.js
npx playwright test workers.spec.js

# Run with visible browser
npx playwright test --headed

# Run with UI mode (interactive)
npx playwright test --ui

# Generate HTML report
npx playwright test --reporter=html
npx playwright show-report
```

## Debug Console

The `debug-console.js` script streams browser console output to your terminal. Useful for debugging agent behavior.

```bash
# Basic boot check (no agent run)
node tests/e2e/debug-console.js

# Run with visible browser
HEADLESS=false node tests/e2e/debug-console.js

# Run agent with a goal preset
GOAL=rsi TEST_AWAKEN=true node tests/e2e/debug-console.js

# Run with custom goal
GOAL="List all files" TEST_AWAKEN=true node tests/e2e/debug-console.js

# Extended timeout for complex goals
TIMEOUT=120000 GOAL=stress TEST_AWAKEN=true node tests/e2e/debug-console.js

# Show all available presets
node tests/e2e/debug-console.js --help
```

### Goal Presets

| Preset | Description |
|--------|-------------|
| `hello` | Create a simple hello.txt file |
| `list` | List all VFS files |
| `read` | Read and summarize a file |
| `rsi` | Meta tool factory (default) |
| `toolchain` | Recursive tool creation |
| `selfaudit` | Audit /tools/ implementations |
| `map` | Map codebase structure |
| `deps` | Analyze module dependencies |
| `security` | Security audit |
| `refactor` | VFS refactoring plan |
| `testgen` | Generate test cases |
| `docs` | Generate documentation |
| `parallel` | Spawn parallel workers |
| `workers` | Sequential worker test |
| `error` | Error handling test |
| `newtool` | Design new FileStats tool |
| `improve` | Suggest tool improvements |
| `stress` | Extended RSI stress test |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HEADLESS` | `true` | Run headless or visible |
| `TEST_AWAKEN` | `false` | Run the awaken flow |
| `GOAL` | `rsi` | Goal preset name or custom text |
| `TIMEOUT` | `60000` | ms to wait after awakening |
| `GENESIS` | `full` | Genesis level (minimal/default/full/tabula) |
| `BASE_URL` | `http://localhost:8080` | Server URL |
| `KEEP_OPEN` | `true` | Keep browser open after test |

## Genesis Levels

- **minimal** - Minimal RSI Core (basic tools only)
- **default** - Default Core (standard toolset)
- **full** - Full Substrate (includes WorkerManager, Arena, etc.)
- **tabula** - Tabula Rasa (empty slate, full RSI)

## Test Categories

### Quick Tests (< 10s)
- `boot.spec.js` - All tests
- `accessibility.spec.js` - Boot screen tests

### Medium Tests (10-30s)
- `dashboard.spec.js` - All tests
- `workers.spec.js` - UI tests
- `modules.spec.js` - All tests

### Long Tests (30-120s)
- `agent-goals.spec.js` - All tests (extended timeout)
- `accessibility.spec.js` - Dashboard tests

## CI Configuration

Tests run on GitHub Actions with:
- Chromium browser
- Python HTTP server on port 8000
- 60s default timeout per test
- HTML reporter
- Screenshots/video on failure

## Troubleshooting

### Tests timing out
```bash
# Increase timeout
npx playwright test --timeout=120000
```

### Server not starting
```bash
# Manual server start
python3 -m http.server 8000

# Then run tests with existing server
npx playwright test
```

### Debug mode
```bash
# Enable Playwright debug
PWDEBUG=1 npx playwright test boot.spec.js
```

## Best Practices

1. **Use data-testid attributes** for stable selectors
2. **Wait for elements** before interacting
3. **Test user flows**, not implementation details
4. **Keep tests independent** - don't rely on test execution order
5. **Clean up state** between tests using beforeEach/afterEach

## Resources

- [Playwright Documentation](https://playwright.dev/)
- [Best Practices](https://playwright.dev/docs/best-practices)
- [Debugging Guide](https://playwright.dev/docs/debug)
