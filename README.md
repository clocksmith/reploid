# REPLOID - Guardian Agent System

```
╔════════════════════════════════════════════════════════════════════════════════╗
║                                                                                  ║
║     ██████╗ ███████╗██████╗ ██╗      ██████╗ ██╗██████╗                        ║
║     ██╔══██╗██╔════╝██╔══██╗██║     ██╔═══██╗██║██╔══██╗                       ║
║     ██████╔╝█████╗  ██████╔╝██║     ██║   ██║██║██║  ██║                       ║
║     ██╔══██╗██╔══╝  ██╔═══╝ ██║     ██║   ██║██║██║  ██║                       ║
║     ██║  ██║███████╗██║     ███████╗╚██████╔╝██║██████╔╝                       ║
║     ╚═╝  ╚═╝╚══════╝╚═╝     ╚══════╝ ╚═════╝ ╚═╝╚═════╝                        ║
║                                                                                  ║
║          ⚡ Guardian Agent with Human-in-the-Loop Approvals ⚡                    ║
║                                                                                  ║
╚════════════════════════════════════════════════════════════════════════════════╝
```

## ★ What is REPLOID?

REPLOID is a **browser-native agentic AI system designed for Recursive Self-Improvement (RSI) via source code manipulation**. The core hypothesis: **the browser is the perfect ecosystem for an RSI agent** because it provides:

- 🎨 **Rich Web APIs** for visualization, interaction, and file system access
- 🔒 **Built-in sandboxing** for safe code execution (Web Workers, Service Workers, iframes)
- 🧠 **Visual feedback loops** that enable better human-AI collaboration than CLI tools
- ⚡ **Direct access to both machine and mind** through interactive UIs
- 🌐 **Universal deployment** with no installation required

REPLOID implements the **PAWS philosophy** (Prepare Artifacts With SWAP) for safe, controlled self-modification. It operates with human-in-the-loop approvals at critical decision points, ensuring you maintain full control over all changes **including changes to its own source code**.

The system runs in three environments:
- **Browser**: Full Guardian Agent with interactive diff viewer, approval flow, and RSI capabilities
- **CLI**: PAWS tools (`cats`/`dogs`) for command-line bundle operations
- **Server**: Node.js port (Project Hermes) with Git worktree isolation

## ⚡ Quick Start

**New to REPLOID?** 📚 Read the [**Quick Start Guide**](docs/QUICK-START.md) for an interactive tutorial!

**📋 Complete Documentation Index:** See [docs/INDEX.md](docs/INDEX.md) for all available documentation.

### Browser Mode

```bash
# Serve the project locally
python -m http.server 8000
# Navigate to http://localhost:8000
```

### CLI Mode

```bash
# Create context bundle
bin/cats "*.js" -o context.cats.md

# Apply change bundle
bin/dogs changes.dogs.md --verify "npm test"
```

### Server Mode (Project Hermes)

```bash
cd hermes
npm install
npm start
# Server runs at http://localhost:3000
```

**Having issues?** 🔧 Check the [Troubleshooting Guide](docs/TROUBLESHOOTING.md)

## ☰ Guardian Agent Flow

The Guardian Agent follows a structured FSM (Finite State Machine) with these states:

1. **IDLE** → Set a goal to begin
2. **CURATING_CONTEXT** → Agent selects relevant files
3. **AWAITING_CONTEXT_APPROVAL** → Review and approve context bundle
4. **PLANNING_WITH_CONTEXT** → Agent analyzes and plans changes
5. **GENERATING_PROPOSAL** → Creates dogs.md change bundle
6. **AWAITING_PROPOSAL_APPROVAL** → Interactive diff review with selective approval
7. **APPLYING_CHANGES** → Applies approved changes with checkpoint
8. **REFLECTING** → Learns from outcome for future improvements

## ♜ Project Structure

```
/
├── index.html              # Main browser application
├── boot.js                 # Persona-based onboarding
├── config.json             # Personas and module configuration
├── ui-dashboard.html       # Guardian Agent dashboard
├── RFC-STATUS.md           # RFC implementation tracking
│
├── bin/                    # CLI tools
│   ├── cats                # Context bundle creator
│   └── dogs                # Change bundle applier
│
├── hermes/                 # Node.js server port
│   ├── index.js            # Guardian Agent server
│   ├── sessions/           # Isolated session data
│   └── worktrees/          # Git worktree isolation
│
├── upgrades/               # Core modules (40+ modules)
│   ├── sentinel-fsm.js     # Guardian Agent FSM
│   ├── sentinel-tools.js   # PAWS tool implementations
│   ├── diff-viewer-ui.js   # Interactive diff viewer
│   ├── git-vfs.js          # Git-based virtual filesystem
│   ├── verification-manager.js  # Web Worker coordinator
│   ├── verification-worker.js   # Sandboxed verification
│   ├── di-container.js     # Dependency injection
│   ├── event-bus.js        # Event system
│   ├── introspector.js     # Self-analysis (RSI)
│   ├── reflection-store.js # Learning persistence (RSI)
│   ├── reflection-analyzer.js  # Pattern recognition (RSI)
│   ├── reflection-search.js    # Semantic search (RSI)
│   ├── self-tester.js      # Automated validation (RSI)
│   ├── performance-optimizer.js  # Auto-optimization (RSI)
│   ├── browser-apis.js     # Web API integration (RSI)
│   ├── local-llm.js        # WebGPU LLM inference (AR)
│   ├── hybrid-llm-provider.js  # Local/cloud switching (AR)
│   ├── swarm-orchestrator.js   # Multi-agent coordination (AR)
│   ├── pyodide-runtime.js  # Python execution (AR)
│   ├── python-tool.js      # Python tool interface (AR)
│   ├── cost-tracker.js     # Cost tracking & rate limiting
│   ├── tool-analytics.js   # Tool usage analytics
│   ├── tab-coordinator.js  # Inter-tab coordination
│   └── tool-doc-generator.js   # Auto-generated tool docs
│
├── tests/                  # Test suite (85 passing tests)
│   ├── unit/               # Unit tests (67 tests)
│   ├── integration/        # Integration tests (18 tests)
│   └── e2e/                # E2E tests (planned)
│
├── blueprints/             # RFC documents (26 specs)
├── personas/               # Agent personas (6 personas)
├── sessions/               # Session workspaces
├── docs/                   # Documentation
└── templates/              # Document templates
```

## ⚙ Key Features

### 🔄 Recursive Self-Improvement (RSI) - ✅ 100% Complete (12 Modules)
- **Self-Introspection**: Analyzes own architecture, dependencies, and complexity metrics (`introspector.js`)
- **Meta-Learning**: Learns from experience with reflection persistence and pattern recognition (`reflection-store.js`, `reflection-analyzer.js`)
- **Self-Testing**: Automated validation framework with 80% pass threshold before applying changes (`self-tester.js`)
- **Performance Monitoring**: Tracks metrics with auto-optimization (memoization, throttling, retry) (`performance-optimizer.js`)
- **Browser-Native Advantages**: File System Access API, Web Notifications, real filesystem persistence (`browser-apis.js`)
- **Multi-Agent Swarm**: Distributed task delegation and knowledge sharing across tabs (`swarm-orchestrator.js`)
- **Local GPU Inference**: WebGPU-accelerated LLM with vision model support (`local-llm.js`, `hybrid-llm-provider.js`)
- **Python Execution**: In-browser NumPy/SciPy via Pyodide for scientific computing (`pyodide-runtime.js`, `python-tool.js`)
- **Cost Tracking**: API usage monitoring and rate limiting (`cost-tracker.js`)
- **Semantic Search**: TF-IDF search over reflections (`reflection-search.js`)
- **Tool Documentation**: Auto-generated markdown docs (`tool-doc-generator.js`)
- **Unit Testing**: Comprehensive test suite for pure functions (`tests/agent-logic-pure.test.js`)
- **Self-modification capabilities**: Agent can propose and apply changes to its own source code
- **RFC-based evolution**: 26 architectural blueprints in `blueprints/` directory
- **Safe experimentation**: RSI Lab Sandbox persona for self-improvement experiments

### 🧠 Browser-Native Advantages
- **Visual diff viewer**: Interactive UI for reviewing changes (far superior to CLI diffs)
- **Real-time status visualization**: FSM state machine displayed with animations
- **VFS Explorer**: File browser with search, preview, and tree navigation
- **Live previews**: Website Builder persona shows changes in real-time iframe
- **Rich interactions**: Click, drag, search, filter - not possible in terminal
- **Web Worker sandboxing**: Safe code execution without process spawning
- **IndexedDB persistence**: Client-side storage for sessions and checkpoints

### Guardian Agent (Project Sentinel - 100% Complete)
- Human-in-the-loop approval at context and proposal stages
- Interactive diff viewer with selective file approval
- Checkpoint/rollback system for safe changes
- Session-based workspaces for isolation
- REFLECTING state for continuous learning and RSI

### PAWS Philosophy (100% Complete)
- **cats.md**: Curated context bundles
- **dogs.md**: Explicit change proposals
- Full CLI tools for bundle creation/application
- AI-powered context curation
- Verification command support

### Architecture (Project Phoenix)
- Dependency Injection Container
- Event Bus for loose coupling
- Standardized module format
- Web Worker sandboxing for verification

### Security & Safety
- Browser sandbox isolation
- Virtual filesystem with Git backend
- Checkpoint system before changes
- Verification execution in Web Workers
- Session-based workspace isolation

## ☗ Personas

Personas provide pre-configured agent capabilities:

### Lab Personas ⚗
- **RSI Lab Sandbox**: Self-improvement experiments
- **Code Refactorer**: Code quality analysis
- **RFC Author**: Formal change proposals

### Factory Personas ⚛
- **Website Builder**: Landing pages with preview
- **Product Prototype Factory**: Interactive UI prototypes
- **Creative Writer**: Document generation

## ⚿ Security Options

### Browser-Only (Default)
Runs entirely in browser sandbox with virtual filesystem.

### Secure Proxy (Optional)
```bash
npm install
cp .env.example .env  # Add your API key
npm start
```

## ✎ RFC Status

| Project | Status | Description |
|---------|--------|-------------|
| **Sentinel** | ☑ 100% | Guardian Agent with approvals |
| **PAWS CLI** | ☑ 100% | cats/dogs tools and Hermes server |
| **Phoenix** | ⚬ 40% | Architecture improvements |
| **AR-1** | ☑ 100% | Python execution with Pyodide |
| **AR-2** | ☑ 100% | Local LLM inference with WebGPU |
| **Enhancements** | ☑ 100% | All 18 enhancements complete |

## ⚑ Testing

### Automated Test Suite
REPLOID includes a comprehensive testing infrastructure with 85 passing tests:

```bash
# Run all tests
npm test

# Watch mode (run tests on file changes)
npm run test:watch

# Interactive UI
npm run test:ui

# Coverage report (60% thresholds)
npm run test:coverage
```

**Test Coverage:**
- **Unit Tests:** 67 tests (utils, event-bus, state-manager)
  - `utils.js`: 98.85% coverage
  - `event-bus.js`: 100% coverage
- **Integration Tests:** 18 tests (FSM validation)
- **CI/CD:** GitHub Actions runs tests on Node 18.x & 20.x

See `tests/README.md` for detailed testing guide and best practices.

### Manual Testing
See `test-guardian-flow.md` for step-by-step Guardian Agent testing instructions.

## ♲ Contributing

The system supports self-modification through RFCs. Use the RFC Author persona to draft proposals, which the Guardian Agent can then implement with human approval.

See documentation:
- **Quick Start:** `docs/QUICK-START.md` - Interactive tutorial with sample goals
- **API Reference:** `docs/API.md` - Complete module API documentation
- **Troubleshooting:** `docs/TROUBLESHOOTING.md` - Common issues and solutions
- **Testing Guide:** `tests/README.md` - Test suite documentation and best practices
- **Roadmap:** `docs/ROADMAP.md` - Development priorities (53/53 complete, 100% ✅)
- **Enhancements:** `docs/TODO-ENHANCEMENTS.md` - Post-roadmap improvements (8/18 complete, 44%)
- **Personas:** `docs/PERSONAS.md` - Persona development guide
- **RFC Status:** `RFC-STATUS.md` - Implementation tracking
- **Guardian Flow:** `test-guardian-flow.md` - Manual testing guide

---

*Guardian Agent with PAWS philosophy - Safe, controlled, and transparent AI assistance.* ⚡