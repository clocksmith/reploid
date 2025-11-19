# Tools Directory

**Purpose**: Tool utilities, documentation generation, and Python integration.

## Contents

| File/Directory | Purpose |
|----------------|---------|
| `tool-evaluator.js` | Self-evaluation tool package |
| `tool-doc-generator.js` | Automatic markdown documentation for tools |
| `tool-worker.js` | Sandboxed Web Worker for tool execution |
| `python/` | Python/Pyodide integration |

---

## Components

### tool-evaluator.js

Self-evaluation framework for assessing code quality and improvements.

### tool-doc-generator.js

Generates markdown documentation from tool schemas automatically.

### tool-worker.js

Sandboxed Web Worker environment for safe tool execution.

### python/

Python code execution via Pyodide (WebAssembly Python):

- `python-tool.js` - Agent interface for Python execution
- `pyodide-runtime.js` - Pyodide WebAssembly runtime
- `pyodide-worker.js` - Web Worker for Python isolation

---

## See Also

- **[Core Modules](../core/README.md)** - Tool runner and writer
- **[Capabilities](../capabilities/README.md)** - Tool analytics
