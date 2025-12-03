# REPLOID

> Browser-native sandbox for safe AI agent development and research

A containment environment for AI agents that can write and execute code. Built for researchers, alignment engineers, and teams building autonomous systems who need **observability, rollback, and human oversight** — not black-box execution.

---

See [TODO.md](TODO.md) for roadmap | [AGENTS.md](AGENTS.md) for agent profile

## Why REPLOID?

AI agents that write code are powerful but dangerous. Most frameworks give agents unrestricted filesystem access, shell execution, or Docker root — then hope nothing goes wrong.

REPLOID takes a different approach: **everything runs in a browser sandbox** with transactional rollback, pre-flight verification, and human approval gates. The agent can modify its own tools, but every mutation is auditable and reversible.

**Use cases:**
- **AI safety research** — Study agent behavior in a contained environment
- **Model comparison** — Arena mode runs multiple LLMs against the same task, picks the best verified solution
- **Self-modification gating** — Test proposed code changes before committing them
- **Alignment prototyping** — Experiment with oversight patterns before deploying to production

## How It Works

The agent operates on a Virtual File System (VFS) backed by IndexedDB. It can read, write, and execute code — but only within the sandbox. All mutations pass through a verification layer that checks for syntax errors, dangerous patterns, and policy violations.

## Architecture

```mermaid
graph TD
    Agent[Agent Loop] --> LLM[LLM Client]
    Agent --> Tools[Tool Runner]
    Tools --> VFS[(Virtual File System)]

    subgraph Safety Layer
        Tools --> Verify[Verification Manager]
        Verify --> Worker(Web Worker Sandbox)
        Worker -.->|Check| VFS
        Arena[Arena Harness] --> Verify
    end

    subgraph Observability
        Agent --> Audit[Audit Logger]
        Agent --> Events[Event Bus]
    end
```

### Safety First

1.  **Verification Manager**: All code changes pass through pre-flight checks in an isolated Web Worker. Catches syntax errors, infinite loops, `eval()`, and other dangerous patterns before they reach the VFS.

2.  **VFS Snapshots**: Transactional rollback. Capture state before mutations, restore if verification fails. No permanent damage from bad agent decisions.

3.  **Arena Mode**: Test-driven selection for self-modifications. Multiple candidates compete, only verified solutions win. Located in `/testing/arena/`.

4.  **Circuit Breakers**: Rate limiting and iteration caps (default: 50 cycles) prevent runaway agents. Automatic recovery on failure.

5.  **Audit Logging**: Every tool call, VFS mutation, and agent decision is logged. Full replay capability for debugging and analysis.

6.  **VFS Explorer with Live Preview**: Sandboxed iframe execution for agent-created HTML/CSS/JS files. Operators can preview UIs the agent builds without leaving the browser.

7.  **Genesis Diff Visualization**: Color-coded comparison showing all changes from initial state (green = added, yellow = modified, red = deleted). Instant visibility into what the agent has modified.

8.  **Snapshot Timeline**: Browse, compare, and restore any of the last 10 VFS snapshots. Hot-load snapshots to test previous states without permanent rollback.

### Core Components

| Component | Purpose |
|-----------|---------|
| `agent-loop.js` | Cognitive cycle (Think → Act → Observe) with circuit breakers |
| `vfs.js` | Browser-native filesystem on IndexedDB |
| `llm-client.js` | Multi-provider LLM abstraction (WebLLM, Ollama, Cloud APIs) |
| `verification-manager.js` | Pre-flight safety checks in sandboxed worker |
| `arena-harness.js` | Competitive selection for code changes |

### Available Tools

REPLOID provides 19+ tools out of the box:

**Core VFS & Self-Modification:**
- `read_file`, `write_file`, `list_files`, `delete_file` - File operations
- `create_tool` - Dynamic tool creation at runtime
- `load_module` - Hot-reload capabilities and modules
- `code_intel` - Analyze code structure without reading full content

**Unix-like Shell Tools:**
- `shell_ls`, `shell_pwd`, `shell_cd` - Directory navigation
- `shell_cat`, `shell_grep`, `shell_find` - File search and inspection
- `shell_git` - Version control (status, log, diff, commit)
- `shell_mkdir`, `shell_rm`, `shell_mv`, `shell_cp` - File management

All shell tools operate within the VFS sandbox with no access to host filesystem.

---

## Why JavaScript, Not TypeScript?

**TL;DR:** JavaScript enables true browser-native self-modification without build toolchains.

REPLOID's genesis code is pure JavaScript because the agent needs to generate, modify, and execute code at runtime—entirely in the browser. TypeScript would break this core capability:

**Runtime Code Generation**: When the agent creates a new tool or modifies existing code, it writes JavaScript strings to the VFS and immediately imports them via Service Worker interception. TypeScript requires compilation, which creates a dependency problem: how does the agent compile TypeScript it just wrote, without Node.js or a build toolchain in the browser?

**True Browser-Native Execution**: Reploid runs 100% in the browser with zero external dependencies. TypeScript compilation requires either (1) a build step before deployment (defeating self-modification), (2) bundling the 10MB+ TypeScript compiler in-browser (massive overhead), or (3) maintaining separate TypeScript source and compiled JavaScript (the agent would modify JS artifacts, losing type safety for generated code anyway).

**Service Worker Module Loading**: The VFS Service Worker intercepts ES module imports and serves files from IndexedDB. This works seamlessly with JavaScript but TypeScript would require on-the-fly compilation for every module load, adding latency and complexity to the critical path.

TypeScript excels at developer tooling and compile-time safety, but Reploid prioritizes runtime flexibility. The agent's verification system (syntax checks, sandboxed execution, arena testing) provides runtime safety that type checking can't offer for dynamically generated code. [SW] logs you see (Service Worker) show this system in action—modules loading from VFS, some from network, all without a build step.

---

## Self-Modification Research

REPLOID is designed to study [recursive self-improvement](https://en.wikipedia.org/wiki/Recursive_self-improvement) (RSI) safely. The agent can modify its own code, but every change is verified, logged, and reversible.

### Modification Levels

| Level | Description | Safety Gate |
|-------|-------------|-------------|
| **L1: Tools** | Agent creates new tools at runtime | Verification Worker |
| **L2: Meta** | Agent improves its tool-creation mechanism | Arena Mode |
| **L3: Substrate** | Agent modifies core loop or memory | Human Approval (planned) |

### Example: Tool Creation (L1)
**Goal:** "Create a tool that adds two numbers"

```
[Agent] Iteration 1: Analyzing goal...
[Agent] I need a tool to add numbers
[TOOL_CALL] create_tool
[ARGS] {
  name: "add_numbers",
  code: "export default async function({a, b}) { return a + b; }"
}
[TOOL_RESULT] ✓ Tool created: /tools/add_numbers.js
[Agent] Testing new tool...
[TOOL_CALL] add_numbers
[ARGS] {a: 5, b: 3}
[TOOL_RESULT] 8
[Agent] ✓ Goal complete
```

### Example: Meta-Tool Creation (L2)
**Goal:** "Build a system that creates tools from descriptions"

```
[Agent] Iteration 1: I need a meta-tool
[TOOL_CALL] create_tool
[ARGS] {
  name: "create_tool_from_description",
  code: `export default async function({description}) {
    // Call LLM to generate code from description
    const code = await call_llm({
      prompt: "Generate JavaScript function: " + description
    });

    // Create the tool
    const toolName = description.split(' ')[0].toLowerCase();
    await executeTool('create_tool', {name: toolName, code});
    return {success: true, tool: toolName};
  }`
}
[TOOL_RESULT] ✓ Meta-tool created
[Agent] Iteration 2: Testing meta-tool...
[TOOL_CALL] create_tool_from_description
[ARGS] {description: "Parse JSON and extract errors"}
[TOOL_RESULT] ✓ Created tool: parse
[Agent] I just created a tool-creating tool! (Level 2 RSI)
```

### Example: Substrate Modification (L3)
**Goal:** "Analyze your tool creation process and optimize it"

```
[Agent] Iteration 1: Reading my own tool-writer...
[TOOL_CALL] read_file
[ARGS] {path: "/core/tool-writer.js"}
[TOOL_RESULT] [1200 lines of code]
[Agent] I see the bottleneck: validation runs on every call
[Agent] Iteration 2: Improving myself...
[TOOL_CALL] improve_core_module
[ARGS] {
  module: "tool-writer",
  code: "... version with AST caching ..."
}
[TOOL_RESULT] ✓ Backed up /core/tool-writer.js.backup.1763000000
[TOOL_RESULT] ✓ Module hot-reloaded
[Agent] Iteration 3: Testing improvement...
[TOOL_CALL] create_tool
[ARGS] {name: "test_tool", code: "..."}
[TOOL_RESULT] ✓ Created in 0.3s (was 2.1s before)
[Agent] I just made myself faster! (Level 3 RSI)
```

---

## Comparison

| Capability | REPLOID | OpenHands | Claude Code | Devin |
|------------|---------|-----------|-------------|-------|
| **Execution** | Browser sandbox | Docker/Linux | Local shell | Cloud SaaS |
| **Rollback** | VFS snapshots | Container reset | Git | N/A |
| **Verification** | Pre-flight checks | None | None | Unknown |
| **Self-modification** | Gated by arena | Unrestricted | N/A | N/A |
| **Offline capable** | Yes (WebLLM) | Yes | Yes | No |
| **Inspectable** | Full source | Full source | Partial | Closed |

**REPLOID's niche:** Safe experimentation with self-modifying agents. Not the most powerful agent framework — the most observable and recoverable one.

---

## Research Questions

REPLOID exists to study:

1. **Containment** — Can browser sandboxing provide meaningful safety guarantees for code-writing agents?
2. **Verification** — What static/dynamic checks catch dangerous mutations before execution?
3. **Selection** — Does arena-style competition improve agent outputs vs. single-model generation?
4. **Oversight** — What human-in-the-loop patterns balance safety with agent autonomy?

These are open questions. REPLOID is infrastructure for exploring them, not answers.

---

## Quick Start

```bash
git clone https://github.com/clocksmith/reploid
cd reploid
npm install
npm run dev
# Open http://localhost:8080
```

### Boot Modes

REPLOID offers 3 genesis configurations:

1. **TABULA RASA** - Blank slate, core agent only (minimal tools)
2. **MINIMAL AXIOMS** - Core + basic reflection and learning
3. **FULL SUBSTRATE** - All capabilities including cognition, testing, and Unix-like shell tools

Select "FULL SUBSTRATE" for RSI experiments with maximum tool availability.

**Example Goals:**
- "Create a recursive tool chain: a tool that builds tools that enhance tools"
- "Analyze your source code in /core and identify bottlenecks"
- "Build a tool that generates test cases from function signatures"

The VFS Explorer (right panel) provides:
- **Preview (▶)** - Execute HTML/CSS/JS files in sandboxed iframe
- **Diff (⊟)** - Compare current VFS to genesis state
- **Snapshots (◷)** - Timeline of all saved states with restore capability

---

## License

MIT — Use freely, but read the safety warnings first.
