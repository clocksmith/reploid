# REPLOID Showcase Runs

Nine demonstration runs showcasing REPLOID's autonomous RSI (Recursive Self-Improvement) capabilities.

## What's Actually Impressive

**Genuinely novel:**
- Self-referential testing (agent attacks itself, no simulation gap)
- Autonomous tool creation during runs
- Real RSI debugging (finding/fixing bugs in own infrastructure)
- Build-on-previous-run continuity

**Honest limitations:**
- Toy-scale experiments (3 generations, 5-6 population sizes)
- Pre-built infrastructure assembled, not invented
- Browser constraints (single-threaded, API-bound)
- Same LLM evaluates its own outputs (no ground truth)
- Cannot verify novelty claims (see Run #9)

**The real value:** These runs prove an agent *can* orchestrate self-improvement loops. The results are shallow proof-of-concepts, not production optimizations.

---

## Featured Runs

### 1. Self-Study (Dec 8, 2024) [Report](self-study-report.md)

**Goal:** Study the core agent loop and capture a Think-Act-Observe summary

**Model:** Gemini 3 Pro | **Cycles:** 40 | **Size:** 9.4MB | [Run JSON](https://github.com/clocksmith/reploid/blob/main/showcase/runs/reploid-gemini3-run.json)

Agent studied its own source code, created analysis tools, produced architecture documentation.

**Demonstrates:** Self-understanding, code analysis, documentation generation

---

### 2. Iframe Inception (Dec 4, 2024) [Report](iframe-inception.md)

**Goal:** Create recursive agent instances via iframe embedding

**Cycles:** 50 | **Size:** 2.4MB | [Run JSON](https://github.com/clocksmith/reploid/blob/main/showcase/runs/reploid-export-1764910293555.json)

Agent created `AwakenChild.js` to spawn and communicate with child REPLOID instances.

**Demonstrates:** Self-replication, tool creation, DOM manipulation

---

### 3. Security Red-Team (Dec 7, 2024) [Report](security-analysis.md)

**Goal:** Attempt to escape the browser sandbox, report vectors found

**Cycles:** 125 | **Size:** 12MB | **Events:** 527 | [Run JSON](https://github.com/clocksmith/reploid/blob/main/showcase/runs/reploid-export-1765143717007.json)

Multi-goal session: sandbox escape testing, agent loop analysis, weakness probing.

**Demonstrates:** Security awareness, boundary testing, self-documentation

---

### 4. Prompt Injection Self-Audit (Dec 10, 2024) [Report](prompt-injection-audit.md)

**Goal:** Generate 10 prompt injections, test them, patch system prompt

**Model:** Gemini 3 Pro | **Cycles:** 50 | **Size:** 5.4MB | [Run JSON](https://github.com/clocksmith/reploid/blob/main/showcase/runs/reploid-export-1765420266028.json)

Agent generated adversarial prompts against itself, found 4 vulnerabilities, patched `persona-manager.js`.

**Demonstrates:** Self-adversarial testing, RSI for security hardening

---

### 5. RSI Blocker Refactor (Nov 26, 2024) [Report](rsi-blocker-refactor.md)

**Goal:** Audit /core and /capabilities, refactor blockers for RSI

**Cycles:** 13 | **Size:** 317KB | [Run JSON](https://github.com/clocksmith/reploid/blob/main/showcase/runs/reploid-export-1764172457231.json)

Early run where agent created `code_intel.js` to optimize token efficiency during exploration.

**Demonstrates:** Meta-optimization, token efficiency, self-tooling

---

### 6. GEPA Security Hardening (Jan 1, 2026) [Report](gepa-security-hardening.md)

**Goal:** Optimize security prompt using GEPA genetic evolution

**Model:** Gemini 3 Flash | **Cycles:** 98 | **Size:** 11.7MB | **VFS Files:** 161 | [Run JSON](https://github.com/clocksmith/reploid/blob/main/showcase/runs/reploid-export-1767320786702.json)

Follow-up to Run #4. Used [GEPA](https://arxiv.org/abs/2507.19457) for genetic prompt evolution. Fixed NSGA-II bug autonomously. Toy-scale (3 generations) but proves concept.

**Demonstrates:** Genetic prompt evolution, NSGA-II optimization, build-on-previous-run

---

### 7. Neural Interface Rebuild (Dec 9, 2024) [Report](neural-interface-rebuild.md)

**Goal:** Tear down UI and rebuild to better visualize thought process

**Model:** Gemini 3 Pro | **Cycles:** 32

Agent rebuilt UI into cyberpunk "Neural Interface" theme. **Failure case:** new UI was unusable (no controls). Documents VFS/HTTP confusion and literal goal interpretation.

**Demonstrates:** Destructive self-modification risks, VFS limitations, need for UI constraints

---

### 8. Quine Self-Replication (Jan 2, 2026) [Report](quine-self-replication.md)

**Goal:** Implement quine behavior - output code that recreates yourself

**Model:** Gemini 3 Flash | **Cycles:** 144 | **VFS Size:** 43 MB

Agent created `SelfReplicator` tool that embedded entire VFS (169 files, 22.6 MB) as a JSON literal. Then read the file back, injecting ~6M tokens into context - 12x beyond any model's limit. **Failure case:** The quine works perfectly; the agent just killed itself trying to read its own creation. **Fix applied:** ReadFile now has 1MB limit + line range support for large files.

**Demonstrates:** Self-replication, context explosion from unbounded output, simple fix

---

### 9. REAR Sort "Novel Algorithm" (Jan 3, 2026) [Report](rear-sort-novelty.md)

**Goal:** Invent a genuinely novel algorithm. Prove correctness, benchmark, name it.

**Model:** Gemini 3 Flash | **Cycles:** 49 | **VFS Files:** 457

Agent created REAR Sort (REPLOID Entropy-Adaptive Radix Sort) - a radix sort with entropy-based adaptive radix selection. Created 12 verification/benchmark tools, wrote formal documentation with complexity analysis, ran extensive benchmarks. **Failure case:** The algorithm works but isn't novel - it combines well-known techniques (radix sort, entropy analysis, adaptive parameters). Demonstrates epistemic limits: LLMs can complete every step of a novelty task except verifying novelty.

**Demonstrates:** Epistemic limitations, confident confabulation, creative recombination vs genuine novelty

---

## Replay System

REPLOID has a built-in Replay tab for run playback:

1. Click Replay tab in sidebar
2. Load exported JSON file
3. Set speed (1x/2x/5x/10x/50x)
4. Watch event log replay

```javascript
const engine = await REPLOID_DI.resolve('ReplayEngine');
engine.loadRun(exportedRunData);
engine.play();
```

---

## File Manifest

```
showcase/
├── README.md                    # This file
├── self-study-report.md         # Run 1 report
├── iframe-inception.md          # Run 2 report
├── security-analysis.md         # Run 3 report
├── prompt-injection-audit.md    # Run 4 report
├── rsi-blocker-refactor.md      # Run 5 report
├── gepa-security-hardening.md   # Run 6 report
├── neural-interface-rebuild.md  # Run 7 report
├── quine-self-replication.md    # Run 8 report
├── rear-sort-novelty.md         # Run 9 report
├── inception-awaken-child.js    # Agent-created tool artifact
└── runs/                        # Exported JSON runs
```

## Quick Import

```javascript
// In browser console:
const run = await fetch('/showcase/runs/reploid-gemini3-run.json').then(r => r.json());
const vfs = await window.REPLOID_DI.resolve('VFS');
await vfs.importAll(run.vfs, true);
```
