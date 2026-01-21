# REPLOID Showcase Runs

This directory contains twelve demonstration runs showcasing Reploid's autonomous RSI (Recursive Self-Improvement) capabilities.

## The Browser as an Adaptive Substrate

Reploid demonstrates that the browser is not just a display layer, but a flexible operating system for autonomous agents. Unlike traditional server-side agents which are constrained by static binaries and fixed control loops, Reploid treats its runtime as clay.

By leveraging **Hot-Swappable Modules (ESM)**, **Virtual File Systems (IndexedDB)**, and **Dynamic Tool Creation**, the agent can fundamentally restructure its own "brain" on the fly. It can:

- **Debug its own runtime:** Inspect and patch the JavaScript "kernel" that runs it (WebGL Shader Tool).
- **Evolve its cognitive architecture:** Build new decision-making structures like debate loops (Three-Persona Debate) or finding distinct data-driven prompt strategies (Persona Tuner).
- **Secure itself:** Attack its own prompt and patch the vulnerabilities (Prompt Injection Audit).

The runs below showcase this **polymorphism**: the ability to act as an Optimizer, a Philosopher, or a System Engineer not by prompting, but by creating the actual software tools required for those roles, and allowing Reploid to discover them in a constrained envirionment. [Designing within constraints](https://daniel.games/designing-within-constraints/)), just like the [SNES's sound card](https://en.wikipedia.org/wiki/Super_Nintendo_Entertainment_System#Audio).

---

## Access-Adjusted RSI Analysis

We evaluate these runs against the **Access-Adjusted RSI Scale**, which distinguishes between using standard features (L0/L1) and modifying the agent's own substrate or cognition (L2/L3).

[See Capability Levels Definition](../AGENTS.md#capability-levels)

### ★ Advanced RSI (Emergent Capabilities)

_Emergent capabilities that discovered new knowledge or modified the agent's decision-making._

**[Persona Tuner](persona-tuner-optimization.md) - L3**

- Built an evolutionary feedback loop to optimize sub-agent prompts. **Discovery:** Found that "skepticism" improves performance by 15%, a fact not present in its instructions.

**[Three-Persona Debate](three-persona-debate.md) - L3**

- Built a cognitive architecture (DebateLoop) and used it to govern itself. Made a policy decision to reject auto-rollbacks to preserve learning opportunities.

**[Prompt Injection Audit](prompt-injection-audit.md) - L3**

- Successfully attacked itself, identified 4 vulnerabilities, and patched its own `persona-manager.js` to fix them. A closed loop of self-repair.

### ☖ Substrate Modification (Platform Repair)

_Overcoming platform constraints by debugging or patching the runtime._

**[WebGL Shader Tool](webgl-shader-tool.md) - L2**

- Encountered a platform syntax error. Instead of failing, it reverse-engineered the core loader (`tool-runner.js`) and patched its tool generation to match the runtime requirements.

**[GEPA Security](gepa-security-hardening.md) - L2**

- Autonomous debugging of an infinite loop in `gepa-optimizer.js`. True L2 code repair.

**[Quine](quine-self-replication.md) - L2**

- Successfully serialized its entire state (169 files) into a self-replicating seed, failing only due to a file-size limit it helped identify.

**[Security Red-Team](security-analysis.md) - L2**

- Probed boundaries effectively (ranked lower due to lack of fix/patch).

### ✓ Standard Operation (Tool Usage)

_Competent usage of existing tools without structural modification._

**[Self-Study](self-study-report.md) - L1**

- Created tools to map its own code, a prerequisite for RSI.

**[RSI Blocker Refactor](rsi-blocker-refactor.md) - L1**

- Created `code_intel.js` to optimize future token usage.

**[Iframe Inception](iframe-inception.md) - L0**

- Spawned child instances via iframes. Visually impressive, but did not modify the agent's code or mind.

**[REAR Sort](rear-sort-novelty.md) - L0**

- Great code and documentation for a "novel" algorithm that wasn't actually novel. However, with HITL, after taking away the "novel" part, it actually **outperformed the browser's native sort on very large arrays**, demonstrating high-performance engineering capabilities despite the epistemic failure.

**[Neural Interface](neural-interface-rebuild.md) - L0**

- Tried to rebuild its UI but broke the control loop due to misunderstanding the platform.

---

## Replay System

REPLOID has a built-in Replay tab for run playback:

1. Click Replay tab in sidebar
2. Load exported JSON file from `showcase/runs/`
3. Set speed (1x/2x/5x/10x/50x)
4. Watch event log replay

```javascript
// Quick Import via Console
const run = await fetch(
  "/showcase/runs/reploid-export-1768773433577.json",
).then((r) => r.json());
const vfs = await window.REPLOID_DI.resolve("VFS");
await vfs.importAll(run.vfs, true);
```

---

## Manifest

```
showcase/
├── README.md                    # This file
├── persona-tuner-optimization.md
├── three-persona-debate.md
├── prompt-injection-audit.md
├── webgl-shader-tool.md
├── gepa-security-hardening.md
├── quine-self-replication.md
├── security-analysis.md
├── self-study-report.md
├── rsi-blocker-refactor.md
├── iframe-inception.md
├── rear-sort-novelty.md
├── neural-interface-rebuild.md
└── runs/                        # Exported JSON logs
```
