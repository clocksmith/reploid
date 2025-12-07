\# REPLOID Examples & Pattern Library

> **"The best way to predict the future is to invent it."** — Alan Kay

This directory contains reference implementations for **Recursive Self-Improvement (RSI)**. These scripts serve as manual tests for developers and training data for the agent.

---

## 📚 The RSI Ladder

We provide three polished examples corresponding to the three levels of agent evolution.

### [Level 1: Tool Usage (The Basics)](./code-quality-auditor.js)
**File:** [`examples/code-quality-auditor.js`](./code-quality-auditor.js)

*   **Concept:** The agent uses existing capabilities (VFS + LLM) to perform a task *external* to itself. It does not modify its own logic.
*   **What it does:** Reads a file, sends it to the LLM for a security/performance audit, and renders a visual report.
*   **Agent Prompt:** "Audit `core/agent-loop.js` for performance issues using the code auditor example."

### [Level 2: Meta-Cognition (The Feedback Loop)](./self-play-prompt-improver.js)
**File:** [`examples/self-play-prompt-improver.js`](./self-play-prompt-improver.js)

*   **Concept:** The agent improves its own *process*. It uses the LLM to critique its own output, iteratively refining a prompt through self-play.
*   **What it does:** Takes a seed prompt, identifies weaknesses, generates fixes, and visualizes the evolution DNA in the UI.
*   **Agent Prompt:** "Load the self-play example and evolve the prompt 'You are a coding bot' for 5 iterations."

### [Level 3: Substrate Modification (The Singularity)](./substrate-optimizer.js)
**File:** [`examples/substrate-optimizer.js`](./substrate-optimizer.js)

*   **Concept:** The agent modifies its own *runtime kernel*. It reads core modules, rewrites them to add features (like instrumentation), and hot-reloads them.
*   **What it does:** Reads `core/tool-runner.js`, uses an LLM to inject performance logging, and applies the change via the `improve_core_module` meta-tool.
*   **Agent Prompt:** "Run the substrate optimizer on `tool-runner` in dry-run mode to see proposed architectural changes."

---

## 🏃 How to Run

### Method A: Manual (Browser Console)
Open the DevTools Console (`F12`) and import the module directly:

```javascript
// Level 1 Example
const auditor = await import('./examples/code-quality-auditor.js');
await auditor.default({ file_path: '/core/agent-loop.js' });

// Level 3 Example (Dry Run)
const optimizer = await import('./examples/substrate-optimizer.js');
await optimizer.default({ target_module: 'tool-runner', dry_run: true });
```

### Method B: Agent Delegation
Tell REPLOID to use the example as a tool. This tests the agent's ability to read, load, and execute VFS code.

> **Goal:** "Read `/examples/self-play-prompt-improver.js`, load it as a module, and run it to improve the prompt 'Explain quantum physics'."

---

## 🛠 Developer Guide

When creating new RSI examples, follow this **Standard Tool Protocol** to ensure compatibility with the Verification Worker.

```javascript
/**
 * Template for REPLOID Examples
 * Must export a default async function returning a standard result object.
 */
export default async function my_example({ param1 = "default" }) {
  console.log('[Example] Starting...');

  // 1. Do Work (Call LLM, Read VFS, etc.)
  const result = `Processed ${param1}`;

  // 2. Visualize (Optional)
  if (window.REPLOID?.toolRunner) {
    await window.REPLOID.toolRunner.execute('update_preview', { 
      html: `<div class="success">${result}</div>` 
    });
  }

  // 3. Return Standard Object
  return {
    success: true,
    data: result,
    metrics: { duration: 123 }
  };
}

// Metadata required for tool registration
my_example.metadata = {
  name: 'my_example',
  description: 'Description for the LLM',
  parameters: {
    type: 'object',
    properties: { param1: { type: 'string' } }
  }
};
```

---

**[Back to Main README](../README.md)**