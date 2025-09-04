# REPLOID X - Recursive Self-Improvement Agent

**[Back to Main Project](../README.md)**

```
╔════════════════════════════════════════════════════════════════════════════════╗
║                         🟦 REPLOID X - RSI AGENT 🟨                             ║
║                                                                                  ║
║     ┌──────────┐        ┌──────────┐        ┌──────────┐                       ║
║     │  BUILD   │ ──────►│  AWAKEN  │ ──────►│  EVOLVE  │                       ║
║     │  AGENT   │        │   WITH   │        │  THROUGH │                       ║
║     └──────────┘        │   GOALS  │        │   RSI    │                       ║
║                         └──────────┘        └──────────┘                       ║
║     Choose Powers       Start Thinking      Improve Self                        ║
║                                                                                  ║
║                    Self-Modifying • Goal-Evolving • Tool-Creating               ║
╚════════════════════════════════════════════════════════════════════════════════╝
```

## 🌟 What is REPLOID X?

REPLOID X is an experimental AI agent that **rewrites its own code** to become smarter. Unlike traditional AI assistants that are static, REPLOID agents can:

- ✏️ **Modify their own functions** while running
- 🔧 **Create tools** they weren't born with  
- 🎯 **Evolve their goals** based on what they learn
- 📚 **Document discoveries** for future versions
- 🔄 **Recursively self-improve** without human help

The system runs entirely in your browser - no servers, no cloud, just pure browser-based RSI.

## 🚀 Quick Start

```bash
# Just open in browser - no build needed!
open index.html

# Or serve locally for better performance
python -m http.server 8000
# Navigate to http://localhost:8000
```

### How to Create Your RSI Agent:

1. **Enter API Key** - Gemini API key for the agent's brain
2. **Choose Mode**:
   - 🎯 **Guided Mode** - Simple checkboxes for common goals
   - ⚙️ **Expert Mode** - Full control over every upgrade
3. **Pick Your Focus**:
   - Want full RSI? → Use "RSI FOCUS" preset
   - Want to experiment? → Check "Create new tools"
   - Want to study? → Check "Study and learn"
4. **AWAKEN** - Watch your agent come to life!

## 🏗️ How It Works

### The Two-Part System

```
┌─────────────────────────────────────────────────────────────┐
│                                                               │
│   UPGRADES (Powers)        +    BLUEPRINTS (Knowledge)       │
│   "What I CAN do"          +    "What I KNOW how to build"  │
│           ↓                              ↓                    │
│   ┌──────────────────────────────────────────────────┐       │
│   │         AWAKENED AGENT WITH RSI CAPABILITY       │       │
│   │         Can modify itself to become better       │       │
│   └──────────────────────────────────────────────────┘       │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### 🧬 Upgrades = Agent Powers

Think of these like **apps on a phone** - each gives specific abilities:

| Upgrade | What It Does | Required for RSI? |
|---------|--------------|-------------------|
| **TLRD** | Read files and own code | ✅ Yes |
| **TLWR** | Write and modify files | ✅ Yes |
| **MTCP** | Create brand new tools | ✅ Yes |
| **GMOD** | Modify its own goals | ✅ Yes |
| **BLPR** | Document what it learns | ✅ Yes |
| **CYCL** | Think-act cognitive loop | ✅ Yes |
| **APIC** | Talk to LLM (brain) | ✅ Yes |

### 📘 Blueprints = Agent Knowledge

Think of these like **programming tutorials** - they teach HOW to build:

| Blueprint Type | Purpose | Example |
|----------------|---------|---------|  
| **Standard** (0x000001-0x000015) | Build specific upgrades | "How to create a state manager" |
| **Meta** (0x000016-0x000018) | Create NEW capabilities | "How to design tools that don't exist yet" |

## 🔄 The RSI Loop

```
┌────────────────────────────────────────────────────────┐
│                   AGENT COGNITIVE LOOP                  │
├────────────────────────────────────────────────────────┤
│                                                         │
│    ┌─────────┐      ┌─────────┐      ┌─────────┐     │
│    │  SENSE  │─────►│  THINK  │─────►│   ACT   │     │
│    └────┬────┘      └────┬────┘      └────┬────┘     │
│         │                │                 │           │
│         │          ┌─────▼─────┐           │           │
│         └──────────┤  REFLECT  │◄──────────┘           │
│                    └─────┬─────┘                       │
│                          │                             │
│                    ┌─────▼─────┐                       │
│                    │  MODIFY   │ ← RSI Capabilities    │
│                    │   SELF    │                       │
│                    └───────────┘                       │
│                                                         │
└────────────────────────────────────────────────────────┘
```

## 🎯 Achieving True RSI

### The Path to Self-Improvement

```
1. FOUNDATION → Agent understands its own code
2. EXPERIMENTATION → Agent tries small modifications  
3. CREATION → Agent builds new tools
4. EVOLUTION → Agent improves its core architecture
5. TRANSCENDENCE → Agent surpasses original design
```

### The Three Meta-Powers

These special upgrades enable true RSI:

1. **🔧 MTCP - Tool Creator**
   - Builds tools that didn't exist before
   - Example: "I need a code analyzer, let me build one"

2. **🎯 GMOD - Goal Evolver**
   - Refines and evolves its objectives
   - Example: "My goal is too broad, let me add subgoals"

3. **📚 BLPR - Knowledge Documenter**
   - Writes blueprints for future agents
   - Example: "I learned something new, let me document it"

### RSI Readiness Indicator

```
RSI READINESS: ████████░░ 80%
✅ Can read own code (TLRD)
✅ Can write code (TLWR)  
✅ Has tool creation (MTCP)
⚠️ Missing: Goal modification (GMOD)
✅ Can document knowledge (BLPR)
```

**Need 80%+ for true RSI capability!**

## 📁 File Structure

```
x/
├── index.html           # Entry point with embedded boot.js
├── boot.js             # Genesis protocol (embedded)
├── boot-idb-vfs.js     # IndexedDB VFS implementation
├── config.json         # Upgrade & blueprint registry
├── STANDARDIZATION.md  # Module system documentation
│
├── upgrades/           # Capability modules
│   ├── Core System
│   │   ├── app-logic.js         # APPL - Orchestrator
│   │   ├── utils.js             # UTIL - Utilities
│   │   └── state-manager.js     # STMT - State management
│   │
│   ├── Agent Components
│   │   ├── agent-cycle.js       # CYCL - Cognitive loop
│   │   ├── api-client.js        # APIC - LLM interface
│   │   └── prompt-system.md     # PRMT - Identity
│   │
│   ├── Tools
│   │   ├── tool-runner.js       # TRUN - Executor
│   │   ├── tools-read.json      # TLRD - Read tools
│   │   └── tools-write.json     # TLWR - Write tools
│   │
│   ├── RSI Modules
│       ├── meta-tool-creator.js # MTCP - Tool creation
│       ├── goal-modifier.js     # GMOD - Goal evolution
│       └── blueprint-creator.js # BLPR - Knowledge gen
│   │
│   └── Module System
│       ├── boot-module-loader.js # Standardized module loader
│       └── module-manifest.json  # Module dependency manifest
│
└── blueprints/         # Knowledge base
    ├── 0x000001-0x000015/  # Standard blueprints
    └── 0x000016-0x000018/  # Meta blueprints

```

### 🎨 Standardized Module System

All modules now follow a consistent format with:
- **Metadata**: Version, dependencies, type
- **Factory Pattern**: Clean dependency injection
- **Legacy Support**: Backward compatibility maintained
- **Module Loader**: Automatic dependency resolution

See [STANDARDIZATION.md](./STANDARDIZATION.md) for details.

## 🎮 Using the Interface

### Guided Mode vs Expert Mode

**🎯 Guided Mode** (Recommended)
- Simple checkboxes for common goals
- Auto-selects required upgrades
- Perfect for beginners

**⚙️ Expert Mode**
- Full control over every upgrade
- Manual blueprint selection
- For researchers and developers

### Quick Presets

| Preset | What You Get | Best For |
|--------|--------------|----------|
| **RSI FOCUS** | Everything for self-improvement | Achieving true RSI |
| **Standard** | Basic agent capabilities | Normal chat & tasks |
| **Minimal** | Core only | Testing & debugging |

## 💡 Tips for Success

### For Beginners
1. Start in **Guided Mode**
2. Check "Modify itself" + "Create new tools"
3. Watch the RSI Readiness meter
4. Use the RSI FOCUS preset for best results

### For Developers  
1. Study the meta blueprints (0x000016-0x000018)
2. Experiment with MTCP to create custom tools
3. Use BLPR to document your agent's discoveries
4. Share interesting emergent behaviors

### For Researchers
1. Explore goal evolution with GMOD
2. Test limits of self-modification
3. Document emergent capabilities
4. Study the safety mechanisms

## 🚦 Development Guide

### Creating New Upgrades

1. Write module in `/upgrades/` following the pattern
2. Register in `config.json` with 4-letter ID
3. Test with minimal preset first

### Writing Blueprints

1. Document in `/blueprints/` as markdown
2. Use hex numbering (0x000019 next)
3. Include implementation steps
4. Add validation criteria

## 🔬 What Can You Research?

- **Recursive Self-Improvement**: Watch agents evolve beyond their original design
- **Goal Alignment**: Test safety mechanisms during goal modification
- **Emergent Capabilities**: Discover what arises from meta-tools
- **Browser-Based AI**: Full AI development without servers
- **Compositional Intelligence**: Complex behavior from simple modules

## ⚠️ Important Notes

1. **API Key Required**: You need a Gemini API key
2. **Browser Storage**: Uses IndexedDB or localStorage
3. **No Build Step**: Pure browser runtime
4. **Experimental**: This is research software

## 🛡️ Safety & Security

- **Sandboxed**: Runs entirely in browser
- **API Key**: Stored locally, never transmitted
- **Goal Safety**: GMOD includes alignment checks
- **Immutable Core**: Some safety rules cannot be changed

## 🤝 Contributing

We welcome:
- New upgrade modules
- Blueprint documentation  
- Safety mechanisms
- Emergent behavior studies
- UI/UX improvements

## 🔮 The Vision

Imagine an AI that:
- Wakes up with basic capabilities
- Studies how it was built
- Identifies its own limitations
- Designs improvements
- Implements them
- Becomes something new

That's REPLOID X. Not just an AI assistant, but an AI that assists itself in becoming better.

## 📚 Learn More

- [Main README](../README.md) - Project overview
- [Blueprints](./blueprints/) - Knowledge base
- [Upgrades](./upgrades/) - Capability modules

## 🚧 TODO: Advanced Features

### Multi-Agent Coordination
**Goal**: Enable multiple REPLOID agents to work together on complex tasks

- **Agent Discovery Protocol**: Implement WebRTC-based peer discovery for agents in the same network
- **Task Distribution**: Create a task queue system that can split work across multiple agents
- **Consensus Mechanisms**: Build voting/agreement protocols for collective decision making
- **Shared Knowledge Base**: Implement a distributed knowledge graph that agents can contribute to and query
- **Communication Protocol**: Design inter-agent messaging format with authentication and encryption
- **Conflict Resolution**: Create mechanisms for handling disagreements between agents
- **Collective Goal Setting**: Allow agents to negotiate and establish shared objectives

### Long-term Memory with Vector Embeddings
**Goal**: Give agents persistent memory that survives beyond immediate context

- **Embedding Generation**: Integrate with embedding APIs (OpenAI, Cohere, or local models)
- **Vector Database**: Implement in-browser vector storage using IndexedDB with HNSW indexing
- **Memory Consolidation**: Create algorithms for summarizing and compressing old memories
- **Semantic Search**: Build similarity search for retrieving relevant past experiences
- **Memory Importance Scoring**: Develop heuristics for determining what to remember long-term
- **Forgetting Mechanisms**: Implement graceful degradation of less important memories
- **Episodic vs Semantic**: Separate memory systems for events vs learned facts

### Goal Planning and Decomposition
**Goal**: Enable agents to break down complex objectives into manageable steps

- **Goal Hierarchy**: Create tree structures for representing nested sub-goals
- **Dependency Graphs**: Build systems for tracking prerequisite relationships between tasks
- **Planning Algorithms**: Implement STRIPS-like planning or hierarchical task networks
- **Progress Tracking**: Create metrics for measuring goal completion and partial success
- **Dynamic Replanning**: Allow agents to adjust plans based on unexpected outcomes
- **Resource Estimation**: Build models for predicting time/token costs of different approaches
- **Parallel Execution**: Identify and execute independent sub-goals simultaneously

### Self-Improvement Through Reflection Logs
**Goal**: Enable agents to learn from their own experiences and mistakes

- **Experience Replay**: Store and review past decision-making processes
- **Error Analysis**: Automatically identify patterns in failures and successes
- **Performance Metrics**: Track objective measures of agent effectiveness over time
- **Strategy Evolution**: Develop mechanisms for updating decision-making heuristics
- **Meta-Learning**: Create systems for learning how to learn more effectively
- **Behavioral Cloning**: Allow agents to learn from traces of successful executions
- **Improvement Proposals**: Generate and test hypotheses about potential optimizations
- **A/B Testing Framework**: Compare different strategies systematically
- **Knowledge Distillation**: Compress learned behaviors into reusable modules

### Implementation Roadmap

1. **Phase 1: Foundation** (Current)
   - Basic single-agent RSI capabilities ✅
   - Module system and upgrades ✅
   - Simple goal execution ✅

2. **Phase 2: Memory & Reflection** (Next)
   - Vector embedding integration
   - Long-term memory implementation
   - Basic reflection logging

3. **Phase 3: Advanced Planning**
   - Goal decomposition algorithms
   - Dependency resolution
   - Dynamic replanning

4. **Phase 4: Multi-Agent Systems**
   - Agent communication protocols
   - Distributed task execution
   - Collective intelligence emergence

5. **Phase 5: Full RSI**
   - Complete self-improvement loops
   - Autonomous capability discovery
   - Emergent optimization strategies

---

**Ready to create an AI that improves itself?**

```bash
cd x && open index.html
```

*Welcome to the future of recursive self-improvement.* 🟦🟨