# Blueprint 0x000082-SREG: Schema Registry

**Module:** `SchemaRegistry`
**File:** `core/schema-registry.js`
**Purpose:** Central registry for tool input schemas and worker type definitions

**Genesis Level:** spark

---

## Purpose

The Schema Registry serves as the central source of truth for all tool input schemas and worker type definitions in the REPLOID system. It distinguishes between built-in schemas (immutable) and dynamically created schemas (persisted to VFS), and tracks which tools are read-only for parallel execution decisions.

---

## API / Interface

### Tool Schema Management

```javascript
// Register a new tool schema
await SchemaRegistry.registerToolSchema('MyTool', {
  description: 'Does something useful',
  parameters: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'The input value' }
    },
    required: ['input']
  },
  readOnly: false
});

// Get schema for a specific tool
const schema = await SchemaRegistry.getToolSchema('ReadFile');
// Returns: { description, parameters, readOnly, builtin }

// List all registered tool schemas
const schemas = SchemaRegistry.listToolSchemas();
// Returns: ['ReadFile', 'WriteFile', 'Grep', 'MyTool', ...]
```

### Worker Type Management

```javascript
// Register a worker type definition
await SchemaRegistry.registerWorkerTypes({
  'verification': {
    description: 'Sandboxed code verification worker',
    timeout: 30000,
    memory: '256MB'
  }
});

// Get a specific worker type
const workerType = SchemaRegistry.getWorkerType('verification');
// Returns: { description, timeout, memory }

// List all worker types
const types = SchemaRegistry.listWorkerTypes();
// Returns: ['verification', 'computation', ...]
```

### Read-Only Check

```javascript
// Check if tool is read-only (safe for parallel execution)
const canParallel = SchemaRegistry.isToolReadOnly('ReadFile');
// Returns: true

const cannotParallel = SchemaRegistry.isToolReadOnly('WriteFile');
// Returns: false
```

---

## Implementation Details

### Schema Storage Structure

```javascript
{
  tools: {
    'ReadFile': {
      description: 'Read file contents from VFS',
      parameters: { /* JSON Schema */ },
      readOnly: true,
      builtin: true
    },
    'WriteFile': {
      description: 'Write content to VFS file',
      parameters: { /* JSON Schema */ },
      readOnly: false,
      builtin: true
    },
    // ... dynamic tools added at runtime
  },
  workerTypes: {
    'verification': { /* definition */ },
    'computation': { /* definition */ }
  }
}
```

### VFS Persistence

Non-builtin schemas are persisted to `/.system/schemas.json`:

```javascript
const SCHEMA_PATH = '/.system/schemas.json';

const persist = async () => {
  const dynamicSchemas = filterNonBuiltin(schemas);
  await VFS.write(SCHEMA_PATH, JSON.stringify(dynamicSchemas, null, 2));
};

const load = async () => {
  try {
    const content = await VFS.read(SCHEMA_PATH);
    const dynamic = JSON.parse(content);
    mergeSchemas(dynamic);
  } catch (e) {
    // First run or corrupted - start fresh
  }
};
```

### Built-in Tool Categories

| Category | Tools | Read-Only |
|----------|-------|-----------|
| Read | ReadFile, ListFiles, Grep, Find | Yes |
| Write | WriteFile, Edit, DeleteFile | No |
| System | SpawnWorker, LoadModule | No |
| Meta | CreateTool, DescribeTool | No |

### Parallel Execution Support

Tools marked `readOnly: true` can be executed in parallel by the ToolRunner since they don't mutate VFS state:

```javascript
const isToolReadOnly = (toolName) => {
  const schema = schemas.tools[toolName];
  return schema?.readOnly === true;
};

// Used by ToolRunner for parallel batching
const parallelizable = toolCalls.filter(c => isToolReadOnly(c.name));
const sequential = toolCalls.filter(c => !isToolReadOnly(c.name));
```

---

## Dependencies

| Blueprint | Module | Purpose |
|-----------|--------|---------|
| 0x000003 | Utils | Logging, error handling |
| 0x000011 | VFS | Persistence of dynamic schemas |

---

## Genesis Level

**spark** - Core agent module, part of the minimal agent core. Cannot be modified without HITL approval.

---

**Status:** Implemented
