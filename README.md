# REPLOID: Recursive Self-Improvement Substrate

> An AI that can modify its own code. Browser-native. No limits.

**R**ecursive **E**volution **P**rotocol **L**oop **O**ptimizing **I**ntelligent **D**REAMER
(**D**ynamic **R**ecursive **E**ngine **A**dapting **M**odules **E**volving **R**EPLOID)
→ REPLOID ↔ DREAMER ↔ ∞

---

## What is This?

REPLOID is not an AI assistant. It's a **self-modifying AI substrate** that demonstrates recursive self-improvement (RSI) in a browser environment.

**Level 1 RSI:** Agent creates tools at runtime
**Level 2 RSI:** Agent improves its tool creation mechanism
**Level 3 RSI:** Agent modifies core substrate modules

All improvements persist to IndexedDB (VFS) while original source code remains the evolutionary starting point ("genesis").

---

## Why Does This Matter?

Most AI systems are frozen at deployment. REPLOID can:
- Create new tools during execution
- Improve its own tool creation mechanism
- Modify its core cognitive loop
- Persist its evolution locally (no cloud)

This is a research project exploring what happens when you give an AI the ability to rewrite itself.

---

## Quick Start

### Option 1: Zero-Setup WebLLM Demo (No Installation)

1. Visit [reploid.dev](https://reploid.firebaseapp.com) or `open index.html` locally
2. Click **"🚀 Try WebLLM Demo"**
3. Wait for model download (~2GB, first time only)
4. Watch AI create tools, improve those tools, then improve how it creates tools
5. **Requires:** Chrome 113+ or Edge 113+ with WebGPU

**What you'll see:** Agent creates `self_play_prompt_improver` tool → tests it → creates `improve_prompt_improver` (meta-tool) → uses meta-tool to create better tools → **this is RSI**

### Option 2: Full Setup (Cloud Models)

```bash
# Clone repo
git clone https://github.com/clocksmith/paws.git
cd paws/reploid

# Optional: Configure API keys for cloud models
echo "GEMINI_API_KEY=your_key" > .env
echo "ANTHROPIC_API_KEY=your_key" >> .env

# Start proxy server (optional, for server-side API calls)
npm start

# Open in browser
open index.html
```

On boot screen:
1. Click "+ Add Model"
2. Select provider (Gemini, Claude, OpenAI, Ollama, WebLLM)
3. Choose connection type
4. Enter API key (if browser-cloud)
5. Click "Awaken Agent"

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  Agent Loop (reads from VFS, not disk)     │
│  ↓                                          │
│  LLM Client → Tool Runner → VFS (IndexedDB)│
│                              ↓               │
│                         Evolved Code        │
│                         Created Tools       │
│                              ↑               │
│  Genesis State (disk) ──first boot──┘       │
└─────────────────────────────────────────────┘
```

**How it works:** Agent reads code from VFS → analyzes & improves → writes back to VFS → hot-reloads → becomes better.

**Key insight:** The agent's "brain" is data in IndexedDB. It can modify this data (its own code). Original source code is the evolutionary starting point.

---

## RSI Levels Explained

### Level 1: Tool Creation
Agent can create new functions at runtime.

**Example:**
```javascript
// Agent decides it needs a tool
TOOL_CALL: create_tool
ARGS: {
  name: "analyze_code",
  code: "export default async function(args) { /* analysis logic */ }"
}

// Tool is saved to /tools/analyze_code.js in VFS
// Tool is loaded via blob URL and registered
// Agent can now use: analyze_code({file: "..."})
```

### Level 2: Meta-Tool Creation
Agent creates tools that create tools.

**Example:**
```javascript
// Agent realizes tool creation is repetitive
TOOL_CALL: create_tool
ARGS: {
  name: "create_tool_from_description",
  code: `export default async function({description}) {
    // Uses LLM to generate tool code from description
    // Calls create_tool() internally
    // Returns new tool name
  }`
}

// Now agent can: create_tool_from_description({
//   description: "Parse JSON and extract errors"
// })
// This is meta-programming - tools creating tools
```

### Level 3: Substrate Modification
Agent modifies core modules (agent-loop, tool-runner, etc.).

**Example:**
```javascript
// Agent reads current tool-writer
TOOL_CALL: read_file
ARGS: {path: "/core/tool-writer.js"}

// Agent analyzes and finds bottleneck
// Agent generates optimized version with AST caching
TOOL_CALL: improve_core_module
ARGS: {
  module: "tool-writer",
  code: "... improved version ..."
}

// Module backs up, hot-reloads
// Future tool creations are faster
// Agent has improved itself
```

---

## Genesis Levels

REPLOID has 3 genesis levels that determine how much infrastructure the agent starts with:

### 1. FULL SUBSTRATE (Recommended) ✅
- **9 modules + 10 blueprints**
- All infrastructure ready to use
- Agent can immediately start creating tools
- Demonstrates RSI capabilities out-of-the-box
- **Use this for demos**

### 2. MINIMAL AXIOMS (Experimental) 🧪
- **3 modules + 3 blueprints**
- Only VFS, LLM client, and cognitive loop
- Agent must build tool system from documentation
- Tests whether blueprints are sufficient for bootstrap
- **Use this to test emergent intelligence**

### 3. TABULA RASA (Experimental) 🧪
- **5 modules + 0 blueprints**
- Basic tool infrastructure but zero guidance
- Agent must discover patterns through trial and error
- Ultimate test of emergent capability
- **Use this for research on AI learning**

Select genesis level on boot screen before awakening agent.

**Quick Comparison:**

| Genesis Level | Modules | Blueprints | Difficulty | Use Case |
|--------------|---------|------------|------------|----------|
| **FULL SUBSTRATE** ✅ | 9 | 10 | ⭐ Easy | Demos, out-of-the-box RSI |
| **MINIMAL AXIOMS** 🧪 | 3 | 3 | ⭐⭐⭐ Hard | Test emergent intelligence |
| **TABULA RASA** 🧪 | 5 | 0 | ⭐⭐⭐⭐⭐ Expert | Pure trial-and-error learning |

---

## Core Modules (All Self-Modifiable)

**Cognitive Layer:**
- `agent-loop.js` - Main cognitive cycle and decision-making
- `llm-client.js` - Multi-provider LLM communication (4 connection types)
- `multi-model-coordinator.js` - Orchestrates multiple models

**Tool Layer:**
- `tool-runner.js` - Executes tools and manages registry
- `tool-writer.js` - Creates and validates new tools (Level 1 RSI)
- `meta-tool-writer.js` - Improves core modules (Level 2+ RSI)

**Substrate Layer:**
- `substrate-loader.js` - Hot-loads evolved code as living modules
- `substrate-tools.js` - 11 substrate manipulation tools

**Foundation:**
- `vfs.js` - Virtual filesystem (IndexedDB)
- `utils.js` - Shared utilities

All modules use factory pattern and can be read, modified, and hot-reloaded by the agent.

---

## Built-in Tools (24 total)

The agent starts with these CRUD-organized tools:

### VFS Operations (5)
- `read_file(path)`, `write_file(path, content)`, `update_file(path, content)`
- `delete_file(path)`, `list_files(path)`

### Tool Creation - Level 1 RSI (5)
- `read_tool(name)`, `create_tool(name, code)`, `update_tool(name, code)`
- `delete_tool(name)`, `list_tools()`

### Meta-Improvement - Level 2 RSI (3)
- `improve_tool_writer(code)` - Improve the ToolWriter mechanism
- `improve_core_module(module, code)` - Improve ANY core module
- `rollback_tool_writer()` - Undo last improvement

### Substrate Manipulation - Level 3 RSI (11)
- `load_module(path)` - Import and execute module from VFS
- `load_widget(path, containerId)` - Mount widget in dashboard
- `create_widget(name, html, css, js)` - Create simple DOM widget
- `create_web_component(name, html, css, js)` - Create Web Component
- `execute_substrate_code(code)` - Execute arbitrary code in substrate
- `inject_tool(name, code)` - Fast tool injection (bypasses validation)
- `reload_module(path)`, `unload_module(path)`, `list_loaded_modules()`
- `update_preview(html, css, js)` - Update Live Preview panel
- `load_iframe(path, containerId)` - Load code in sandboxed iframe

---

## Connection Types

REPLOID supports 4 ways to connect to LLMs:

### 1. Browser → Cloud (Direct)
- Browser makes API calls directly to provider
- **Requires:** User's API key (stored in localStorage)
- **Use for:** Gemini, OpenAI, Anthropic, Groq

### 2. Proxy → Cloud
- Server proxy makes API calls using .env keys
- **Requires:** Server running, .env configured
- **Use for:** Hiding API keys, rate limiting

### 3. Browser → Local (WebGPU)
- Browser runs LLM via WebLLM (WebGPU)
- **Requires:** Chrome 113+, 2GB+ VRAM, 8GB+ RAM
- **Use for:** Offline, privacy, small models (1-3B params)
- **Recommended models:**
  - Phi-3.5-mini-instruct-q4f16_1-MLC (2GB, best for demos)
  - Qwen2.5-1.5B-Instruct-q4f16_1-MLC (1GB, fast)
  - Llama-3.2-1B-Instruct-q4f16_1-MLC (800MB, ultra-fast)

### 4. Proxy → Local (Ollama)
- Server proxy forwards to local Ollama
- **Requires:** Ollama installed and running
- **Use for:** Large local models (7B-120B params)

---

## RSI Examples

### Example 1: Tool Creation (Level 1)
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

### Example 2: Meta-Tool Creation (Level 2)
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

### Example 3: Substrate Modification (Level 3)
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

## Philosophy: Substrate-Independent RSI

REPLOID is an experiment in [**substrate-independent RSI**](https://www.edge.org/response-detail/27126):

- The agent's "brain" is just data in IndexedDB
- The agent can modify this data (its own code)
- The original source code (genesis) is the evolutionary starting point
- Every agent instance can evolve differently

**Analogy:**
- **DNA** = source code on disk (genesis)
- **Organism** = runtime state in IndexedDB (evolved)
- **Mutations** = agent self-modifications
- **Fitness** = agent-measured improvements (faster, better, smarter)

**Key Question:** Can an AI improve itself faster than humans can improve it?

---

## Technical Details

### VFS Implementation
- **Storage:** IndexedDB (via simple-vfs.js)
- **Operations:** read, write, list, delete, snapshot, restore
- **Persistence:** Survives page refreshes
- **Reset:** "Clear Cache" button wipes IndexedDB, reload fetches genesis

### Module Loading
- **Genesis:** Fetch from disk → write to VFS (first boot)
- **Runtime:** Read from VFS → create blob URL → import as ES module
- **Hot-reload:** Replace blob URL, re-initialize factory, update references

### Agent Loop
- **System prompt:** Includes list of all tools and RSI capabilities
- **Tool calling:** `TOOL_CALL: name` + `ARGS: {...}`
- **Context management:** Conversation history with automatic compaction
- **Safety:** MAX_ITERATIONS=5000, automatic rollback on errors

### Security
- **Sandboxing:** Can only access local resources through secure proxy
- **No eval():** Uses native ES module imports via blob URLs
- **Rollback:** Failed improvements automatically rolled back to last working version
- **Audit:** All changes logged to VFS with timestamps and backups

---

## Limitations

- **Browser-only:** No Node.js backend required (except optional proxy)
- **Storage:** IndexedDB typically ~50MB-unlimited (browser-dependent)
- **WebLLM models:** Limited to 1-3B params due to browser VRAM constraints
- **Multi-model consensus:** Basic implementation, agent can improve it

---

## Troubleshooting

### "WebGPU not supported"
**Fix:** Use Chrome 113+ or Edge 113+

### WebLLM model fails to load
**Fix:**
- Check browser console for exact model ID
- See `WEBLLM_QUICKSTART.md` for compatible models
- Try smaller model (Qwen2.5-1.5B or Llama-3.2-1B)

### Agent creates tools but they don't work
**Expected:** Small models (1B-3B) make mistakes. Agent will iterate and fix bugs. This is part of the RSI process.

### "Module failed to hot-reload"
**Fix:** Click "Clear Cache" and reload. This resets to genesis state.

### Agent gets stuck in loop
**Fix:** Click "Stop" button. Agent will reach MAX_ITERATIONS (5000) automatically.

---

## Contributing

REPLOID is a research project. Contributions welcome:

1. **Test genesis levels:** Run MINIMAL AXIOMS or TABULA RASA and report results
2. **Improve blueprints:** Add documentation that helps agent bootstrap
3. **Create examples:** Show interesting RSI behaviors
4. **Port to other runtimes:** REPLOID should work in Deno, Node.js, etc.

See `/blueprints/` for documentation the agent can read.

---

## Research Questions

- Can Level 2 RSI emerge from Level 1 without explicit tools?
- How many iterations until agent creates meta-tools?
- Does TABULA RASA lead to novel RSI patterns?
- Can agent discover RSI capabilities without blueprints?
- What happens after 1000+ iterations of self-improvement?

**Run experiments and share results!**

---

## License

MIT

---

## Links

- **GitHub:** https://github.com/clocksmith/reploid
- **Live Demo:** https://reploid.firebaseapp.com

---

**The future is not AI that does what you ask. The future is AI that asks itself how to get better at what you asked.**
