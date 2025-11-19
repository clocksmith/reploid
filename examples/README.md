# REPLOID Examples

This directory contains polished examples demonstrating different levels of recursive self-improvement.

---

## 📚 Available Examples

### 1. Self-Play Prompt Improver (Level 2 RSI)

**File:** `self-play-prompt-improver.js`

**What it demonstrates:**
- Agent using LLM to critique its own prompts
- Iterative improvement through self-play
- Level 2 RSI (improving the improvement process)
- Live Preview visualization of evolution

**How to use:**

```javascript
// Option 1: Agent creates it at runtime
// Goal: "Build a tool that uses the LLM to iteratively improve prompts"
// Agent will create similar tool using create_tool()

// Option 2: Manually load example
// In browser console or agent context:
const tool = await import('./examples/self-play-prompt-improver.js');
const result = await tool.default({
  initial_prompt: "You are a helpful AI assistant.",
  iterations: 5
});

console.log('Final prompt:', result.final_prompt);
console.log('Evolution:', result.evolution);
```

**Expected output:**
- Iteration 0: "You are a helpful AI assistant."
- Iteration 1: "You are an AI assistant that provides clear, accurate, and contextual responses to user questions."
  - Weakness: "Too generic, doesn't specify what makes responses helpful"
- Iteration 2: "You are an AI assistant specialized in providing clear, accurate responses with concrete examples and step-by-step explanations when needed."
  - Weakness: "Doesn't mention error handling or clarification"
- ...and so on

**Why it's better than naive implementation:**
- Each iteration addresses a SPECIFIC weakness
- Weaknesses are different each time (not repetitive)
- Prompt actually gets better (not just longer)
- Demonstrates actual intelligence, not string manipulation

---

## 🎯 Example Goals for Agent

Use these goals to have the agent create similar tools:

### Level 1 RSI Goals

**Simple Tool Creation:**
```
"Create a tool that analyzes JavaScript code for potential errors"
"Build a tool that generates test cases for a given function"
"Make a tool that converts JSON to TypeScript interfaces"
```

### Level 2 RSI Goals

**Meta-Tool Creation:**
```
"Build a tool that uses the LLM to iteratively improve prompts by identifying weaknesses and fixing them"
"Create a meta-tool that analyzes existing tools and generates improved versions"
"Build a tool-creation-assistant that helps you write better tools"
```

### Level 3 RSI Goals

**Substrate Modification:**
```
"Analyze your tool creation process and optimize the slowest parts"
"Read your agent-loop code and add parallel tool execution"
"Improve your cognitive cycle to be more efficient"
```

---

## 📝 Creating Your Own Examples

### Example Template

```javascript
// Example: [Name]
// Demonstrates [what RSI level and concept]

export default async function example_name({
  param1 = "default",
  param2 = 10
}) {
  console.log('[ExampleName] Starting...');

  // Your logic here
  // ...

  // Generate visualization if applicable
  const html = `<div>Your HTML visualization</div>`;

  // Update Live Preview
  if (window.REPLOID?.toolRunner) {
    await window.REPLOID.toolRunner.execute('update_preview', { html });
  }

  return {
    success: true,
    result: "...",
    message: "Example completed"
  };
}

// Metadata
example_name.metadata = {
  name: 'example_name',
  description: 'What this example does',
  parameters: {
    param1: 'Description of param1',
    param2: 'Description of param2'
  },
  returns: {
    success: 'boolean',
    result: 'any'
  }
};
```

### Guidelines

1. **Keep it focused:** Each example should demonstrate ONE clear concept
2. **Show, don't tell:** Use Live Preview to visualize what's happening
3. **Document extensively:** Code comments should explain WHY, not just WHAT
4. **Handle errors:** Gracefully handle failures (LLM errors, missing dependencies)
5. **Make it reproducible:** Same inputs should give similar outputs

---

## 🧪 Testing Examples

### Manual Testing

```javascript
// In browser console after REPLOID boots:

// 1. Import example
const tool = await import('./examples/self-play-prompt-improver.js');

// 2. Run with default params
const result = await tool.default({});

// 3. Check Live Preview for visualization
// 4. Inspect result object
console.log(result);
```

### Agent Testing

Give agent this goal:
```
"Load and test the self-play prompt improver example from /examples/.
Run it with iterations=3 and display results."
```

Agent should:
1. Read example file: `read_file('/examples/self-play-prompt-improver.js')`
2. Load as module: `load_module('/examples/self-play-prompt-improver.js')`
3. Execute: `execute_substrate_code('await self_play_prompt_improver({iterations: 3})')`
4. Results appear in Live Preview

---

## 🎨 Example Categories

### Cognitive Patterns
- Self-play prompt improvement
- Meta-cognitive evaluation
- Goal decomposition recursion
- Self-debugging loops

### Tool Patterns
- Tool-creating tools
- Tool analysis and optimization
- Tool composition (tools using tools)
- Tool validation frameworks

### Substrate Patterns
- Module hot-reloading
- Performance profiling and optimization
- Widget creation and management
- Code generation and validation

---

## 🚀 Future Examples (TODO)

### Meta-Cognitive Evaluator (Level 2)
Tool that scores its own reasoning quality and adjusts strategies.

### Recursive Goal Decomposition (Level 2)
Breaks goals into subgoals, then improves the decomposition algorithm itself.

### Self-Debugging Loop (Level 2)
When tool fails, agent analyzes failure, generates fix, tests fix, repeats.

### Code Optimizer (Level 3)
Profiles tool execution, identifies bottlenecks, generates optimized versions.

### Multi-Model Debate (Level 2)
Two models debate a question, third model judges, system improves debate format.

---

## 📚 Learning Path

**If you're new to REPLOID:**

1. Start with FULL SUBSTRATE genesis level
2. Try the Self-Play Prompt Improver example manually
3. Give agent goal: "Build a tool that improves prompts"
4. Watch agent create similar tool from scratch
5. Compare agent's version with the example

**If you want to push RSI limits:**

1. Try MINIMAL AXIOMS or TABULA RASA
2. See if agent can discover self-play patterns without examples
3. Give open-ended goal: "Improve yourself"
4. Observe emergent RSI behaviors

---

## 🔬 Research Opportunities

- **Can Level 2 RSI emerge without examples?** Test with TABULA RASA
- **How many iterations until diminishing returns?** Run self-play with iterations=100
- **Do smaller models discover different patterns?** Compare WebLLM (3B) vs cloud (175B)
- **Can agent improve the self-play algorithm itself?** Meta-meta-programming

---

## 📖 Additional Resources

- **Main README:** `../README.md` - Complete REPLOID documentation
- **WebLLM Guide:** `../WEBLLM_QUICKSTART.md` - Zero-setup demo instructions
- **Genesis Levels:** `../GENESIS_LEVELS_COMPARISON.md` - Boot mode comparison
- **Simple Goal:** `../SIMPLE_GOAL.md` - Original self-play spec

---

**Remember:** The best examples come from experimentation. Run the agent, see what it creates, refine it, save it here for others to learn from.
