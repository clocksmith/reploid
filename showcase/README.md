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

## The Evolution of Autonomy

We have organized the most insightful runs into a narrative arc that demonstrates the agent's growth from a naive intern to a self-improving scientist.

[See Capability Levels Definition](../docs/vision.md#rsi-levels)

### 1. The Intern: [REAR Sort](rear-sort-novelty.md) (L0)

_Technically competent, but lacks wisdom._
The agent tried to invent a "novel" algorithm but got lost in unnecessary complexity. It took a human mentor (HITL) to guide it back to first principles.

> **Insight:** Novelty is a trap. With guidance, the agent stripped away the complexity to build "The Steamroller," a simple engineering solution that **outperformed the browser's native sort** on large arrays.

### 2. The Student: [WebGL Shader Tool](webgl-shader-tool.md) (L1)

_Learning the rules of the system._
When the agent's code failed with a platform syntax error, it didn't guess blindly. It read the source code of its own runtime (`tool-runner.js`) to learn the correct way to build tools, then unblocked itself.

> **Insight:** Adaptability beats memorization. The agent used introspection to solve a problem its training data couldn't answer.

### 3. The Mechanic: [Prompt Injection Audit](prompt-injection-audit.md) (L2)

_Fixing the engine while it runs._
The agent successfully attacked itself, identified 4 security vulnerabilities, and then patched its own system prompt (`persona-manager.js`) to close the holes.

> **Insight:** Use the agent to secure the agent. A closed loop of Red Team (Attack) -> Blue Team (Patch) -> Verification.

### 4. The Manager: [Three-Persona Debate](three-persona-debate.md) (L3)

_Setting policy and governance._
The agent built a "committee" (DebateLoop) to resolve a difficult policy decision: "Should we auto-rollback on failure?" It decided **NO**, prioritizing learning opportunities over stability.

> **Insight:** Governance as Code. The agent can build structures to make better decisions than it could make alone.

### 5. The Scientist: [Persona Tuner](persona-tuner-optimization.md) (L3)

_Discovering new knowledge._
The agent built an evolutionary feedback loop to empirically optimize sub-agent prompts. It found that "skepticism" improved performance by 15%—a counter-intuitive discovery found through data, not intuition.

> **Insight:** Moving from "vibes" to Science. The agent automated the job of a prompt engineer.

---

## Other Experiments

<details>
<summary>Click to see 7 additional demonstration runs</summary>

### ☖ Substrate & Security

- **[GEPA Security](gepa-security-hardening.md) - L2:** Autonomous debugging of an infinite loop in `gepa-optimizer.js`.
- **[Quine](quine-self-replication.md) - L2:** Serialized its entire state into a self-replicating seed.
- **[Security Red-Team](security-analysis.md) - L2:** Probed boundaries effectively (no fix applied).

### ✓ Standard Tools (L0/L1)

- **[Self-Study](self-study-report.md) - L1:** Created tools to map its own code.
- **[RSI Blocker Refactor](rsi-blocker-refactor.md) - L1:** Created `code_intel.js` to optimize token usage.
- **[Iframe Inception](iframe-inception.md) - L0:** Spawned child instances via iframes.
- **[Neural Interface](neural-interface-rebuild.md) - L0:** A cautionary failure case where it broke its own UI.

</details>

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
├── README.md                    # This file (Curated)
├── persona-tuner-optimization.md
├── three-persona-debate.md
├── webgl-shader-tool.md
├── prompt-injection-audit.md
├── rear-sort-novelty.md
├── gepa-security-hardening.md
├── quine-self-replication.md
├── security-analysis.md
├── self-study-report.md
├── rsi-blocker-refactor.md
├── iframe-inception.md
├── neural-interface-rebuild.md
└── runs/                        # Exported JSON logs
```
