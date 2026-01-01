# Contributing to REPLOID

Guidelines for contributing code, documentation, and blueprints.

---

## Quick Start

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/reploid
   cd reploid
   npm install
   ```
3. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```
4. Make changes, test, commit
5. Push and open a pull request

---

## Development Setup

### Prerequisites

- Node.js 18+
- Modern browser (Chrome 90+, Firefox 88+, Safari 14+)
- Git

### Running Locally

```bash
# Static server (landing + /r Reploid)
npm run serve              # http://localhost:8080

# Full dev server with API proxies
npm run dev                # http://localhost:8000

# Run tests
npm test                    # Quick kernel validation
npm run test:inference      # Model inference test
npm run test:vitest         # CPU unit tests

# Run specific kernel test
npm test -- --filter matmul
```

### Project Structure

```
reploid/
├── docs/                       # Human-facing documentation (you are here)
├── ./            # Main application
│   ├── core/                   # Core substrate modules
│   ├── infrastructure/         # Support services
│   ├── capabilities/           # Extended capabilities (swarm, etc.)
│   ├── tools/                  # Agent tools (CamelCase)
│   ├── ui/                     # Proto UI
│   ├── config/                 # Genesis levels, module registry
│   ├── blueprints/             # Architectural specifications
│   └── tests/                  # Test suites
└── server/                     # Proxy server for API routing
```

---

## Code Style

### General Rules

1. **No emoji in source code** - Use Unicode symbols from [STYLE_GUIDE.md](./STYLE_GUIDE.md)
2. **No emoji in documentation** - Use plain text or symbols
3. **CamelCase for tools** - `ReadFile.js`, not `read-file.js`
4. **Module pattern** - All modules use metadata + factory pattern

### Module Template

```javascript
/**
 * @fileoverview Brief description
 */

const ModuleName = {
  metadata: {
    id: 'ModuleName',
    version: '1.0.0',
    genesis: { introduced: 'tabula' },
    dependencies: ['Utils', 'EventBus'],
    type: 'core'  // or 'infrastructure', 'tool', 'ui'
  },

  factory: (deps) => {
    const { Utils, EventBus } = deps;
    const { logger } = Utils;

    // Implementation here

    return {
      // Public API
    };
  }
};

export default ModuleName;
```

### Tool Template

```javascript
export default async function(args, deps) {
  const { VFS, EventBus, AuditLogger } = deps;
  // Tool implementation
  return result;
}

export const schema = {
  name: "ToolName",
  description: "What this tool does",
  parameters: {
    type: "object",
    properties: {
      param1: { type: "string", description: "Param description" }
    },
    required: ["param1"]
  }
};
```

---

## Testing

### Test Structure

```
tests/
├── unit/                   # Unit tests (isolated modules)
├── integration/            # Integration tests (module interactions)
└── e2e/                    # End-to-end browser tests
```

### Writing Tests

```javascript
import { describe, it, expect, vi } from 'vitest';

describe('ModuleName', () => {
  it('should do something', () => {
    // Arrange
    const input = 'test';

    // Act
    const result = doSomething(input);

    // Assert
    expect(result).toBe('expected');
  });
});
```

### Running Tests

```bash
# All tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

---

## Documentation

### Where to Write

| Type | Location |
|------|----------|
| User guides | `docs/*.md` |
| Architecture specs | `blueprints/*.md` |
| In-substrate manual | `./docs/REPLOID.md` |
| Directory context | `*/README.md` |

### Blueprint Format

Blueprints follow a specific format with these sections:
- Strategic Imperative (why)
- Architectural Solution (how)
- Implementation Pathway (steps)
- Success Criteria (checklist)

File naming: `0x{HEX_ID}-{kebab-case-name}.md`

See existing blueprints in `./blueprints/` for examples.

---

## Pull Requests

### Before Submitting

1. Run tests: `npm test`
2. Check for lint errors
3. Update relevant documentation
4. Add tests for new functionality

### PR Title Format

```
type: short description

Examples:
feat: add circuit breaker to tool runner
fix: memory leak in event bus
docs: update troubleshooting guide
refactor: extract tool executor from agent loop
test: add integration tests for worker manager
```

### PR Description Template

```markdown
## Summary
Brief description of changes.

## Changes
- Change 1
- Change 2

## Testing
How to test these changes.

## Related Issues
Fixes #123
```

---

## Commit Messages

Use conventional commits:

```
type(scope): description

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Examples:
```
feat(tools): add Python runtime via Pyodide
fix(vfs): handle circular directory references
docs(api): document EventBus subscription tracking
```

---

## Architecture Decisions

### Adding a New Module

1. Create blueprint in `blueprints/` describing the design
2. Implement module following the module template
3. Add to `config/genesis-levels.json` at appropriate level
4. Register dependencies in metadata
5. Add tests
6. Update INDEX.md if user-facing

### Modifying Core Modules

1. Discuss in GitHub issue first
2. Consider backward compatibility
3. Update blueprints if architecture changes
4. Ensure all tests pass
5. Update SYSTEM_ARCHITECTURE.md if needed

---

## Bug Reports

### What to Include

1. Browser and version
2. Steps to reproduce
3. Expected behavior
4. Actual behavior
5. Console errors (full stack trace)
6. Debug report:
   ```javascript
   // Run in browser console
   const report = {
     userAgent: navigator.userAgent,
     state: StateManager.getState(),
     modules: DIContainer.getAllModules()
   };
   console.log(JSON.stringify(report, null, 2));
   ```

---

## Feature Requests

Open a GitHub issue with:

1. Problem description
2. Proposed solution
3. Alternatives considered
4. Use cases

For significant changes, consider writing a blueprint first.

---

## Code of Conduct

- Be respectful and constructive
- Focus on the code, not the person
- Help newcomers get started
- Credit others' contributions

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

*Last updated: December 2025*
