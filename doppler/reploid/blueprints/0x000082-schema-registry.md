# Blueprint 0x000082: Schema Registry

**Objective:** Centralize tool input schemas and worker type definitions for validation and documentation.

**Target Module:** SchemaRegistry (`core/schema-registry.js`)

**Prerequisites:** Utils, VFS

**Affected Artifacts:** `/core/schema-registry.js`, `/.system/schemas.json`

---

### 1. The Strategic Imperative

Tools require input validation to prevent errors and ensure type safety. Worker types need configuration schemas for capability restrictions. A central registry provides:

- Single source of truth for all tool schemas
- Runtime schema registration for dynamic tools
- ReadOnly flags for parallel execution optimization
- VFS persistence for schema recovery

### 2. The Architectural Solution

The SchemaRegistry maintains two collections:

1. **Tool Schemas:** JSON Schema definitions for tool parameters with metadata
2. **Worker Schemas:** Configuration for worker types (explore, analyze, execute)

**Module Structure:**
```javascript
const SchemaRegistry = {
  metadata: {
    id: 'SchemaRegistry',
    version: '1.0.0',
    genesis: { introduced: 'tabula' },
    dependencies: ['Utils', 'VFS'],
    async: true,
    type: 'service'
  },

  factory: (deps) => {
    const _toolSchemas = new Map();   // name -> { schema, builtin }
    const _workerSchemas = new Map(); // name -> { config, builtin }

    const DEFAULT_TOOL_SCHEMAS = {
      ReadFile: { description: '...', readOnly: true, parameters: {...} },
      WriteFile: { description: '...', readOnly: false, parameters: {...} },
      // ... 20+ builtin tool schemas
    };

    return {
      init,
      getToolSchema, setToolSchema,
      getWorkerSchema, setWorkerSchema,
      getAllToolSchemas, getAllWorkerSchemas,
      isReadOnlyTool
    };
  }
};
```

### 3. Schema Properties

**Tool Schema Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `description` | string | Human-readable tool purpose |
| `readOnly` | boolean | Safe for parallel execution (no side effects) |
| `parameters` | object | JSON Schema for input validation |
| `builtin` | boolean | Whether schema is part of genesis |

**Worker Schema Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Worker type identifier |
| `description` | string | Purpose of this worker type |
| `tools` | array/string | Allowed tools (`*` for all) |
| `canSpawnWorkers` | boolean | Permission to spawn sub-workers |
| `defaultModelRole` | string | Model role hint (fast, primary, code) |

### 4. API Surface

| Method | Description |
|--------|-------------|
| `init()` | Load schemas from VFS, populate defaults |
| `getToolSchema(name)` | Get schema for tool |
| `setToolSchema(name, schema)` | Register dynamic tool schema |
| `isReadOnlyTool(name)` | Check if tool is safe for parallel execution |
| `getAllToolSchemas()` | Get all registered tool schemas |
| `getWorkerSchema(type)` | Get worker type configuration |

### 5. Genesis Level

**TABULA** - Required for tool execution and validation.

---

### 6. Built-in Tool Schemas

ReadOnly (parallel-safe): `ReadFile`, `ListFiles`, `Cat`, `Head`, `Tail`, `Grep`, `Find`, `Ls`, `Pwd`, `FileOutline`, `ListTools`, `ListWorkers`, `ListMemories`, `ListKnowledge`

Mutating (sequential): `WriteFile`, `DeleteFile`, `CreateTool`, `Edit`, `Mkdir`, `Rm`, `Mv`, `Cp`, `Touch`, `Sed`, `Git`, `SpawnWorker`
