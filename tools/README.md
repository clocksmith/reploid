# Tools Directory

**Purpose**: Agent tools and runtime environments.

## Active Tools

| File | Purpose |
|------|---------|
| `code_intel.js` | Structural analysis of code files (imports, exports, AST summary) |
| `python/` | Python execution environment (via Pyodide) |

---

## Python Integration

The `python/` directory contains the WebAssembly-based Python runtime:

- `python-tool.js`: The tool definition exposed to the LLM (`execute_python`, `install_package`).
- `pyodide-runtime.js`: Main thread controller that manages the worker.
- `pyodide-worker.js`: Sandboxed Web Worker running the actual Python interpreter.

## Usage

Tools are loaded by `core/tool-runner.js`.
- `code_intel` is seeded automatically on boot if missing.
- Python tools require `PyodideRuntime` to be initialized.
