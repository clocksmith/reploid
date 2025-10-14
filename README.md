# ☇ REPLOID - Recursive Self-Improvement Agent System

**Recursive Evolutionary Programming Language Operating Intelligently via DREAMER**

```
    ╭─────────────────────────────────────────────────────────╮
    │                                                         │
    │       ☇  R E P L O I D  - RSI AGENT SYSTEM  ☇        │
    │                                                         │
    │        ██▀█  ██▀▀  ██▀█  █     ██▀█  █  ██▀▄        │
    │        █▀▄   █▀▀   █▀▀   █     █  █  █  █  █        │
    │        ▀  ▀  ▀▀▀▀  ▀     ▀▀▀   ▀▀▀  ▀▀▀  ▀▀▀        │
    │                                                         │
    │     Dynamic Reasoning Engine for Autonomous            │
    │     Modification and Enhancement via REPLOID           │
    │                                                         │
    ╰─────────────────────────────────────────────────────────╯
```

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js 16+](https://img.shields.io/badge/node-16+-green.svg)](https://nodejs.org/)
[![Tests: 85 Passing](https://img.shields.io/badge/tests-85%20passing-brightgreen.svg)]()
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

**Try it now:** [replo.id](https://replo.id)
**Repository:** [github.com/clocksmith/reploid](https://github.com/clocksmith/reploid)

## Overview

REPLOID is a **browser-native agentic AI system** that can modify its own source code through a structured, human-supervised workflow. Built on the PAWS philosophy (Prepare Artifacts With SWAP), REPLOID demonstrates that the browser is the ideal environment for Recursive Self-Improvement (RSI) agents.

**Why the browser?** It provides rich Web APIs for visualization, built-in sandboxing for safe code execution, visual feedback loops that surpass CLI tools, and universal deployment with zero installation.

**The Difference:** Unlike AI coding assistants that require you to approve changes blindly, REPLOID shows you *beautiful interactive diffs*, lets you approve files individually, and maintains a complete audit trail in git. It's AI-assisted development with the transparency and control of a senior engineer.

## Table of Contents

- [Key Features](#key-features)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Core Concepts](#core-concepts)
- [Usage](#usage)
- [Architecture](#architecture)
- [Development](#development)
- [Testing](#testing)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Key Features

### ♲ Recursive Self-Improvement (100% Complete)
- **12 RSI modules** for self-introspection, meta-learning, and automated testing
- **Self-testing framework** validates changes before applying (80% pass threshold)
- **Performance monitoring** with automatic optimization (memoization, throttling)
- **Reflection storage** learns from past experiences for continuous improvement
- **Agent can modify its own source code** with human approval at every step

### ☥ Browser-Native Advantages
- **Visual diff viewer** - Interactive UI far superior to terminal diffs
- **Real-time status** - FSM state machine displayed with smooth animations
- **VFS Explorer** - File browser with search, preview, and tree navigation
- **Live previews** - Website Builder persona shows changes in real-time iframe
- **Rich interactions** - Click, drag, search, filter - impossible in terminals

### ⚘ Multi-Agent Competitive Verification (Paxos)
- **Multiple AI agents** compete to solve the same task in parallel
- **Automated verification** runs each solution in isolated git worktrees
- **Consensus selection** - only solutions passing tests are presented
- **Dramatically higher reliability** for complex or ambiguous tasks
- **Integrated with Hermes server** for full PAWS workflow automation

### ☿ Safety & Control
- **Human-in-the-loop** approval at context selection and change proposal stages
- **Selective file approval** - review and approve changes file-by-file
- **Git checkpoints** before every change with instant rollback
- **Web Worker sandboxing** for safe code execution and verification
- **Session isolation** - multiple concurrent workspaces prevent conflicts

### ⚛ PAWS Philosophy (100% Complete)
- **cats.js** - Curated context bundles with AI-powered file selection
- **dogs.js** - Change extraction and application with interactive review
- **paws-session.js** - Full git worktree session management with rewind/merge
- **Hermes server** - Node.js backend with WebSocket streaming
- **Full CLI tools** for automation and scripting workflows

### ⛮ Curator Mode - Autonomous Operation
- **Overnight proposal generation** - auto-approves context, generates 7+ proposals per goal
- **Stops at human approval** - never auto-applies changes to your code
- **Visual HTML reports** - beautiful dashboard to review all proposals in the morning
- **Cost efficient** - ~$0.10 per session (21 proposals) with Gemini Flash, or $0 with local Ollama

## Quick Start

### Browser Mode (Recommended)

```bash
# Option 1: Python HTTP server (simplest)
python -m http.server 8000
# Navigate to http://localhost:8000

# Option 2: Node.js with proxy support
npm install
npm start
# Navigate to http://localhost:3000
```

**First Launch:**

1. **Choose configuration** - Minimal RSI Core (8 modules) recommended for first time
2. **Enter API key** - Gemini, OpenAI, or Anthropic (or use local Ollama)
3. **Set a goal** - Try: "Create a simple to-do list component"
4. **Review context** - Approve the files REPLOID selected
5. **Review changes** - Beautiful diff viewer shows exactly what will change
6. **Apply** - Changes are applied with git checkpoint for easy rollback

### CLI Mode

```bash
# Create context bundle
node cats.js "src/**/*.js" -o context.md

# Apply changes with verification
node dogs.js changes.md --interactive --verify "npm test"

# Manage sessions
node paws-session.js start "feature-auth"
node paws-session.js list
node paws-session.js merge <session-id>
```

### Server Mode (Project Hermes)

```bash
cd hermes
npm install
npm start
# Server at http://localhost:3000 with WebSocket streaming
```

## Installation

### Browser-Only Setup (Zero Install)

```bash
# Serve with Python
python -m http.server 8080

# Serve with Node
npx serve .

# That's it! No npm install required for browser mode
```

### Full Development Setup

```bash
# Clone repository
git clone https://github.com/clocksmith/reploid.git
cd reploid

# Install dependencies (optional for browser mode)
npm install

# Run tests
npm test

# Start development server
npm start
```

### Requirements

- **Browser:** Chrome/Edge 90+ (for File System Access API)
- **Node.js:** 16+ (for CLI tools and Hermes server)
- **API Key:** Gemini, OpenAI, or Anthropic (or use local Ollama)
- **Git:** Required for session management features

## Core Concepts

### The DREAMER Engine

REPLOID's workflow is powered by DREAMER:

**D**ynamic **R**easoning **E**ngine for **A**utonomous **M**odification and **E**nhancement via **REPLOID**

It follows an 8-state FSM:

```
IDLE → CURATING_CONTEXT → AWAITING_CONTEXT_APPROVAL →
PLANNING_WITH_CONTEXT → GENERATING_PROPOSAL →
AWAITING_PROPOSAL_APPROVAL → APPLYING_CHANGES → REFLECTING
```

### Human-in-the-Loop Approval

You approve at two critical checkpoints:

1. **Context Approval** - Review which files the AI wants to see
2. **Proposal Approval** - Review actual code changes with visual diffs

This ensures you maintain full control while benefiting from AI assistance.

### Three Deployment Modes

| Mode | Use Case | Benefits |
|------|----------|----------|
| **Browser** | Interactive development | Visual diff viewer, live preview, no install |
| **CLI** | Automation & scripting | Chain commands, integrate with CI/CD |
| **Server** | Team collaboration | Git worktrees, WebSocket streaming, multi-user |

### Agent Personas

Pre-configured personas optimize REPLOID for different tasks:

**Lab Personas ⚗**
- **RSI Lab Sandbox** - Self-improvement experiments with guided lessons
- **Code Refactorer** - Quality analysis and bug fixes with best practices
- **RFC Author** - Formal architectural change proposals

**Factory Personas ⚛**
- **Website Builder** - Landing pages with live preview in iframe
- **Product Prototype** - Interactive UI prototypes with rapid iteration
- **Creative Writer** - Document generation and content creation

## Usage

### Basic Workflow

```javascript
// 1. Set a goal
const goal = "Add dark mode toggle to settings";

// 2. REPLOID curates context (auto-selects relevant files)
// You review and approve: ✓ settings.js ✓ theme.js ✓ styles.css

// 3. REPLOID generates proposal (creates change bundle)
// You review beautiful diffs and approve changes file-by-file

// 4. REPLOID applies changes (with git checkpoint)
// 5. REPLOID reflects (learns from outcome for next time)
```

### CLI Workflow

```bash
# Create context with AI curation
node cats.js . --ai-curate "Add user authentication" \
  --ai-provider gemini \
  --max-files 10

# Apply changes with interactive review
node dogs.js auth-changes.md --interactive

# With verification and rollback
node dogs.js auth-changes.md \
  --verify "npm test" \
  --revert-on-fail
```

### Session Management

```bash
# Start isolated session
node paws-session.js start "feature-payments"

# Work in session workspace
cd .paws/sessions/<id>/workspace

# View session with TUI
node paws-session.js show <id> --interactive

# Rewind to previous state
node paws-session.js rewind <id> --to-turn 3

# Merge or archive
node paws-session.js merge <id>
node paws-session.js archive <id>
```

### Curator Mode - Overnight Operation

Perfect for generating multiple solution proposals while you sleep:

1. **Enable Curator Mode** - Toggle checkbox in UI
2. **Configure** - Set max proposals (1-20, default 7) and delay
3. **Enter goals** - One per line or separate overnight runs
4. **Leave browser open** - Proposals generate automatically

**Morning Review:**
- Click "View Reports" for visual timeline
- Review 7+ proposals in beautiful dashboard
- Selectively approve best proposals
- Apply via standard REPLOID workflow

**Safety:** Proposals never auto-apply. You must explicitly approve every change.

### Paxos Multi-Agent Workflow

Run multiple AI agents in parallel with automatic verification:

**Via Browser:**
1. Use Hermes server endpoint `/api/paxos`
2. Provides real-time WebSocket logs
3. View consensus results in UI

**Via CLI:**
```bash
# Server must be running
cd hermes
npm start

# Trigger from client (or via curl)
curl -X POST http://localhost:3000/api/paxos \
  -H "Content-Type: application/json" \
  -d '{
    "objective": "Refactor auth module",
    "contextPath": "auth-context.md",
    "verifyCmd": "npm test"
  }'
```

## Architecture

### Project Structure

```
reploid/
├── index.html               # Main browser application
├── boot.js                  # Module loader & onboarding
├── config.json              # Personas & module configuration
├── cats.js                  # PAWS context bundler
├── dogs.js                  # PAWS change applier
├── paws-session.js          # Session management
├── paxos_tool.js            # Client-side Paxos integration
│
├── hermes/                  # Node.js server
│   ├── index.js            # Guardian Agent server
│   ├── paxos_orchestrator.js  # Multi-agent Paxos workflow
│   └── sessions/           # Server session storage
│
├── upgrades/                # 40+ core modules
│   ├── sentinel-fsm.js     # Guardian Agent state machine
│   ├── sentinel-tools.js   # PAWS tool implementations
│   ├── agent-cycle.js      # Agent cognitive loop
│   ├── diff-viewer-ui.js   # Interactive diff viewer
│   ├── git-vfs.js          # Git-based virtual filesystem
│   ├── introspector.js     # Self-analysis (RSI)
│   ├── reflection-store.js # Learning persistence (RSI)
│   ├── self-tester.js      # Automated validation (RSI)
│   ├── local-llm.js        # WebGPU inference
│   ├── pyodide-runtime.js  # Python execution
│   ├── swarm-orchestrator.js  # Multi-agent coordination
│   └── ...                 # 28 more modules
│
├── blueprints/              # 27 RFC specifications
├── personas/                # 6 agent personas
├── tests/                   # 85 passing tests
│   ├── unit/               # 67 unit tests
│   ├── integration/        # 18 integration tests
│   └── README.md           # Testing guide
├── docs/                    # Documentation
│   ├── QUICK-START.md      # Interactive tutorial
│   ├── API.md              # Complete API reference
│   ├── TROUBLESHOOTING.md  # Common issues & fixes
│   └── ROADMAP.md          # Development plan (100% complete)
└── README.md                # This file
```

### Technology Stack

- **Frontend:** Vanilla JavaScript (no framework lock-in)
- **Backend:** Node.js + Express + WebSocket
- **Storage:** IndexedDB (browser), Git worktrees (server)
- **Testing:** Vitest (85 tests), Playwright (E2E)
- **Build:** None required! ES modules work directly in browser

### Design Principles

1. **Transparency** - Every decision visible with visual feedback
2. **Safety First** - Multiple checkpoints, rollback, verification
3. **Progressive Enhancement** - Works without server, better with it
4. **No Lock-in** - Works with any LLM, any editor, exports to git
5. **Composability** - CLI tools can be scripted and chained

## Development

### Running Tests

```bash
# All tests
npm test

# Watch mode
npm run test:watch

# Interactive UI
npm run test:ui

# Coverage report
npm run test:coverage

# E2E tests
npm run test:e2e
```

**Test Coverage:**
- **85 passing tests** (67 unit + 18 integration)
- **60% code coverage** on core modules
- **100% event-bus coverage**

### Development Server

```bash
# Start with hot reload
npm run dev:all

# Or run components separately
npm run dev:proxy    # Proxy server
npm run dev:hermes   # Hermes server
npm run dev:browser  # Static file server
```

### Adding a New Module

```javascript
// 1. Create module in upgrades/
const MyModule = {
  name: 'MyModule',
  dependencies: ['EventBus', 'DIContainer'],

  init(eventBus, di) {
    // Your initialization code
  },

  // Your module methods
};

export default MyModule;

// 2. Add to module-manifest.json
{
  "moduleId": "MYMD",
  "filePath": "upgrades/my-module.js",
  "displayName": "My Module",
  "dependencies": ["EVBS", "DICR"]
}

// 3. Add tests in tests/unit/
```

### Creating a Persona

```markdown
<!-- personas/my-persona.md -->
# My Persona

## Role
You are an expert in [specific domain].

## Process
1. Analyze the context carefully
2. Plan your approach
3. Generate clean, tested code

## Output Format
Use DOGS format for file changes:
🐕 --- DOGS_START_FILE: path/to/file.js ---
// Your code here
🐕 --- DOGS_END_FILE: path/to/file.js ---
```

## Testing

### Automated Test Suite

```bash
# Quick test
npm test

# Full test suite with coverage
npm run test:coverage

# E2E tests (requires Playwright)
npm run test:e2e

# Interactive test UI
npm run test:ui
```

**Test Organization:**
- `tests/unit/` - Pure function tests (67 tests)
- `tests/integration/` - Component integration (18 tests)
- `tests/e2e/` - Full workflow tests (planned)

**Key Test Files:**
- `agent-logic-pure.test.js` - Agent cognitive functions
- `event-bus.test.js` - Event system (100% coverage)
- `utils.test.js` - Utilities (98% coverage)
- `sentinel-fsm-integration.test.js` - FSM validation

See [tests/README.md](tests/README.md) for detailed testing guide.

## Documentation

- **[Quick Start Guide](docs/QUICK-START.md)** - Interactive tutorial with sample goals
- **[API Reference](docs/API.md)** - Complete module API documentation
- **[Troubleshooting](docs/TROUBLESHOOTING.md)** - Common issues and solutions
- **[Testing Guide](tests/README.md)** - Test suite documentation
- **[Roadmap](docs/ROADMAP.md)** - Development priorities (100% complete)
- **[RFC Status](RFC-STATUS.md)** - Implementation tracking
- **[Personas Guide](docs/PERSONAS.md)** - Creating custom personas
- **[Module Mapping](UPGRADE-BLUEPRINT-MAPPING.md)** - Complete module reference

## Why REPLOID?

### vs. CLI-Only Tools (like PAWS)

REPLOID implements PAWS philosophy in the browser with major UX improvements:

| Feature | CLI Tools | REPLOID |
|---------|-----------|---------|
| Diff Viewing | Terminal text | Interactive visual diffs |
| File Navigation | `ls`, `grep` | Point-and-click VFS explorer |
| Status | Text output | Real-time animated FSM |
| Approval | Yes/no prompts | Selective file approval |
| Preview | Impossible | Live iframe preview |
| Installation | npm/pip | Zero install (static HTML) |

### vs. AI Coding Assistants (Cursor, GitHub Copilot)

| Feature | Assistants | REPLOID |
|---------|------------|---------|
| Context Control | Automatic (implicit) | Explicit (you choose files) |
| Change Review | Inline suggestions | Full diff viewer |
| Rollback | Undo/redo | Git checkpoints |
| Multi-agent | No | Yes (Paxos) |
| Self-improvement | No | Yes (RSI capabilities) |
| Cost visibility | Hidden | Transparent tracking |

### vs. Agentic IDEs (Windsurf, Replit Agent)

| Feature | Agentic IDEs | REPLOID |
|---------|--------------|---------|
| Autonomy | High (black box) | Balanced (transparent) |
| Deployment | Desktop/cloud | Browser + CLI + Server |
| Extensibility | Plugin API | Direct code modification |
| Session Management | Basic | Full git worktree isolation |
| Learning | Cloud-based | Local reflection storage |

## Real-World Workflows

### 1. Add a New Feature

```
Goal: "Add dark mode toggle"
→ REPLOID selects: settings.js, theme.js, styles.css
→ You approve context
→ REPLOID generates changes with toggle component
→ You review diffs, approve files one by one
→ Apply with git checkpoint
→ REPLOID reflects on outcome
```

### 2. Refactor Legacy Code

```
Persona: Code Refactorer
Goal: "Improve error handling in api.js"
→ REPLOID analyzes patterns and anti-patterns
→ Proposes refactoring with try-catch, custom errors
→ You review comprehensive diffs
→ Apply with --verify "npm test"
→ Tests pass, changes committed
```

### 3. Competitive Debugging

```
Mode: Paxos Multi-Agent
Goal: "Fix memory leak in event handlers"
→ 3 agents (Gemini, Claude, GPT-4) propose solutions
→ Each runs in isolated git worktree
→ Automated tests verify each solution
→ Only passing solutions presented
→ You select best implementation
```

### 4. Overnight Proposal Generation

```
Mode: Curator
Goals: [5 complex refactoring tasks]
→ Leave browser open overnight
→ 35 proposals generated (7 per goal)
→ Morning: Review visual report
→ Select best 5 proposals
→ Apply throughout the day
```

## Performance

### Startup Times

- **Minimal Setup:** 8 modules, ~500ms
- **Full Setup:** 40 modules, ~2s
- **Cold Start:** First time, ~3s (module caching)

### Browser Requirements

- **Chrome/Edge 90+** - File System Access API
- **2GB RAM minimum** - IndexedDB + VFS
- **Modern CPU** - ES modules, async/await

### API Cost (Example)

- **Single goal:** ~$0.02-0.05 (Gemini Flash)
- **Paxos (3 agents):** ~$0.06-0.15
- **Curator (7 proposals):** ~$0.10-0.30
- **Local Ollama:** $0 (runs on your GPU)

## Security

### Browser Sandboxing

- **Origin isolation** - REPLOID can only access its own files
- **No arbitrary code execution** - All code runs in Web Workers
- **CORS protection** - API calls must be explicitly allowed
- **File System API** - Requires explicit user permission

### Data Privacy

- **Local-first** - Everything stored in browser (IndexedDB)
- **No telemetry** - Zero tracking or analytics
- **API keys** - Stored in localStorage, never transmitted except to LLM APIs
- **Git history** - All changes tracked locally

### Best Practices

1. **Review all changes** - Never auto-approve proposals
2. **Use verification** - Always run tests before applying
3. **Git checkpoints** - Commit before major changes
4. **API key security** - Use environment variables in production
5. **Regular backups** - Export sessions periodically

## Contributing

We welcome contributions! Here's how to get involved:

### Reporting Issues

1. Check [existing issues](https://github.com/clocksmith/reploid/issues)
2. Use issue templates for bugs/features
3. Provide reproduction steps
4. Include browser/Node version

### Pull Requests

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Write tests for new functionality
4. Ensure all tests pass (`npm test`)
5. Commit with clear messages
6. Push to branch
7. Open Pull Request with description

### Development Guidelines

- **Code Style:** Follow existing patterns (vanilla JS, no frameworks)
- **Tests:** Add tests for all new features
- **Documentation:** Update README and relevant docs
- **Commits:** Use semantic commit messages

### Areas for Contribution

- 🐛 **Bug Fixes** - Always welcome!
- 📚 **Documentation** - Help improve our docs
- 🧪 **Tests** - Increase coverage
- 🎨 **UI/UX** - Improve visual design
- 🔧 **Tools** - New personas or modules
- 🌐 **i18n** - Translations

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Related Projects

**[PAWS](https://github.com/yourusername/paws)** - The command-line toolkit that inspired REPLOID. Perfect for automation, CI/CD integration, and developers who prefer terminal workflows.

## Acknowledgments

REPLOID builds on:
- **PAWS Philosophy** - Explicit context and structured workflows
- **Paxos Consensus** - Multi-agent competitive verification
- **Git Worktrees** - Isolated session management
- **Web Standards** - File System Access API, Web Workers, IndexedDB

## Community

- **Website:** [replo.id](https://replo.id)
- **Repository:** [github.com/clocksmith/reploid](https://github.com/clocksmith/reploid)
- **Issues:** [GitHub Issues](https://github.com/clocksmith/reploid/issues)
- **Discussions:** [GitHub Discussions](https://github.com/clocksmith/reploid/discussions)

---

**☇ Built by developers who believe AI should augment, not replace, human creativity.**

**Try it now:** [replo.id](https://replo.id)
