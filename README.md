# REPLOID

**Reflective Embodiment Providing Logical Overseeing Intelligent DREAMER**
**(Deep Recursive Exploration Around Multimodal Embodying REPLOID)**

```
    ╭─────────────────────────────────────────────────────────╮
    │                                                         │
    │       ☇  R E P L O I D  - RSI AGENT SYSTEM  ☇        │
    │                                                         │
    │        ██▀█  ██▀▀  ██▀█  █     ██▀█  █  ██▀▄        │
    │        █▀▄   █▀▀   █▀▀   █     █  █  █  █  █        │
    │        ▀  ▀  ▀▀▀▀  ▀     ▀▀▀   ▀▀▀  ▀▀▀  ▀▀▀        │
    │                                                         │
    ╰─────────────────────────────────────────────────────────╯
```

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js 16+](https://img.shields.io/badge/node-16+-green.svg)](https://nodejs.org/)
[![Tests: 85 Passing](https://img.shields.io/badge/tests-85%20passing-brightgreen.svg)]()

**Try it:** [replo.id](https://replo.id) | **Code:** [github.com/clocksmith/reploid](https://github.com/clocksmith/reploid)

---

## What is REPLOID?

REPLOID is a **browser-native AI agent** that can modify its own code through structured, human-supervised workflows. Built on the PAWS philosophy (Prepare Artifacts With SWAP), it demonstrates recursive self-improvement in a secure, visual environment.

**Key Innovation:** Interactive visual diffs + git-backed approval workflow + 12 RSI modules = transparent, controllable AI-assisted development.

---

## Goals

1. **Recursive Self-Improvement** - Agent analyzes and modifies its own source code
2. **Human-in-the-Loop** - Every change requires explicit human approval
3. **Visual Transparency** - Beautiful diffs, file trees, and live previews
4. **Zero Installation** - Runs entirely in your browser
5. **Multi-Agent Competition** - Multiple solutions compete via Paxos consensus
6. **Local-First** - Your code never leaves your machine (except to your chosen LLM API)

---

## How It Works

```
┌─────────────┐
│  Set Goal   │ ──→ "Add dark mode toggle"
└─────────────┘
       ↓
┌─────────────────┐
│ Curate Context  │ ──→ AI selects relevant files
└─────────────────┘
       ↓
┌─────────────────┐
│ 👤 Approve Files │ ──→ You review & approve
└─────────────────┘
       ↓
┌─────────────────┐
│ Generate Changes│ ──→ AI creates DOGS bundle
└─────────────────┘
       ↓
┌─────────────────┐
│ 👤 Review Diffs  │ ──→ Visual diff viewer
└─────────────────┘
       ↓
┌─────────────────┐
│ Apply & Reflect │ ──→ Git checkpoint + learn
└─────────────────┘
```

**Two approval gates:** Context selection + Change review. Nothing happens without your explicit confirmation.

---

## Quick Start

### 1. Client-Only Mode (Simplest)

Open `index.html` in your browser:

```bash
# Serve with Python
python -m http.server 8000

# Or Node.js
npx serve
```

Navigate to `http://localhost:8000`, paste your API key (Gemini/OpenAI/Anthropic), and start!

**Modes Available:**
- **Client-only**: Paste API key directly in browser
- **Client + Server**: Node.js backend handles API calls
- **Local LLM**: WebGPU-accelerated local models (no API key needed)

### 2. With Node.js Server

```bash
# Install
npm install

# Add API key
echo "GEMINI_API_KEY=your_key_here" > .env

# Start server
npm start

# Open browser
open http://localhost:8000
```

### 3. CLI Mode

```bash
# Create context
node cats.js . --ai-curate "Add auth system" --max-files 10

# Apply changes
node dogs.js changes.md --interactive

# Session management
node paws-session.js start "feature-payments"
```

---

## Configuration

### Operational Modes

| Mode | Setup | Use Case |
|------|-------|----------|
| **Client-Only** | Paste API key in UI | Quick start, no server needed |
| **Client + API Keys** | Configure multiple providers | Fallback between providers |
| **Node.js Server** | `.env` file + `npm start` | Team collaboration, WebSocket streaming |
| **Local WebGPU** | Load model in UI (2-4GB download) | $0 cost, privacy, offline |

### API Providers

- **Google Gemini** - Recommended (fast, cheap: $0.02/goal)
- **OpenAI** - GPT-4 Turbo support
- **Anthropic** - Claude 3.5 Sonnet
- **Local Ollama** - Free, runs on your GPU
- **WebGPU Models** - Browser-native (Qwen, Phi, Llama)

---

## Features

### ♲ Recursive Self-Improvement
- 12 RSI modules (introspection, meta-learning, self-testing)
- Agent can modify its own source code
- Reflection storage learns from every interaction

### ☥ Visual & Interactive
- Side-by-side diff viewer with syntax highlighting
- File tree explorer with search
- Live HTML preview for web projects
- Real-time FSM state visualization

### ⚘ Multi-Agent Paxos
- 3+ agents compete on same task
- Automated testing in git worktrees
- Consensus-based selection
- Dramatically higher success rate

### ⛮ Curator Mode
- Generate 7+ proposals overnight
- Auto-approves context, stops at human review
- Visual HTML reports for morning review
- Perfect for exploring solution space

### ☿ Safety First
- Two approval gates (context + changes)
- Git checkpoint before every change
- Instant rollback with one click
- Web Worker sandboxing for code execution

---

## Documentation

- **[Quick Start Guide](docs/QUICK-START.md)** - Interactive tutorial
- **[Operational Modes](docs/OPERATIONAL_MODES.md)** - Client-only, Server, Local WebGPU
- **[API Reference](docs/API.md)** - Module documentation
- **[Personas Guide](docs/PERSONAS.md)** - Create custom agent personalities
- **[Troubleshooting](docs/TROUBLESHOOTING.md)** - Common issues
- **[Local Models](docs/LOCAL_MODELS.md)** - WebGPU/WebGL setup
- **[Testing](tests/README.md)** - Run the test suite
- **[Roadmap](docs/ROADMAP.md)** - Development status
- **[RFC Status](docs/RFC-STATUS.md)** - Implementation tracking

---

## PAWS CLI Toolkit

REPLOID is built on **PAWS** ([github.com/clocksmith/paws](https://github.com/clocksmith/paws)) - the command-line toolkit for AI-assisted development:

- **cats.js** - Context curation with AI file selection
- **dogs.js** - Change extraction and application
- **paws-session.js** - Git worktree session management
- **Hermes server** - WebSocket streaming + multi-agent orchestration

PAWS is perfect for automation, CI/CD integration, and terminal workflows.

---

## Examples

### Basic Goal
```javascript
"Add dark mode toggle to settings"
```

### Multi-Agent Competition
Enable Paxos mode → 3 agents compete → Best solution wins

### Curator Mode
1. Enable Curator checkbox
2. Set max proposals: 7
3. Enter goal: "Refactor authentication system"
4. Leave browser open overnight
5. Review proposals in morning

### Local WebGPU
1. Click "Local LLM" tab
2. Select model: Qwen2.5-Coder-1.5B
3. Wait for download (~900MB)
4. Use agent with $0 cost!

---

## Contributing

Contributions welcome! Areas for help:

- ☇ Bug fixes
- ☐ Documentation
- ⚗ Tests (current: 85 passing)
- ⚛ UI/UX improvements
- ⚙ New personas or modules
- ⛶ Internationalization

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for guidelines.

---

## License

MIT License - see [LICENSE](LICENSE) file.

---

## Related Projects

- **[PAWS](https://github.com/clocksmith/paws)** - CLI toolkit for AI-assisted development
- **[Hermes](hermes/README.md)** - Multi-agent orchestration server
- **[Blueprints](blueprints/README.md)** - RSI module specifications

---

**Built by developers who believe AI should augment, not replace, human creativity.**

⚛ [replo.id](https://replo.id) | ☐ [Documentation](docs/INDEX.md) | ⚙ [GitHub](https://github.com/clocksmith/reploid)
