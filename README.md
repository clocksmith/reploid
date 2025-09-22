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

REPLOID is a Guardian Agent system implementing the PAWS philosophy (Prepare Artifacts With SWAP) for safe, controlled AI-assisted development. It operates with human-in-the-loop approvals at critical decision points, ensuring you maintain full control over all changes.

The system runs in three environments:
- **Browser**: Full Guardian Agent with interactive diff viewer and approval flow
- **CLI**: PAWS tools (`cats`/`dogs`) for command-line bundle operations
- **Server**: Node.js port (Project Hermes) with Git worktree isolation

## ⚡ Quick Start

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
├── upgrades/               # Core modules
│   ├── sentinel-fsm.js     # Guardian Agent FSM
│   ├── sentinel-tools.js   # PAWS tool implementations
│   ├── diff-viewer-ui.js   # Interactive diff viewer
│   ├── git-vfs.js          # Git-based virtual filesystem
│   ├── verification-manager.js  # Web Worker coordinator
│   ├── verification-worker.js   # Sandboxed verification
│   ├── di-container.js     # Dependency injection
│   └── event-bus.js        # Event system
│
├── blueprints/             # RFC documents
├── personas/               # Agent personas
├── sessions/               # Session workspaces
└── templates/              # Document templates
```

## ⚙ Key Features

### Guardian Agent (Project Sentinel - 100% Complete)
- Human-in-the-loop approval at context and proposal stages
- Interactive diff viewer with selective file approval
- Checkpoint/rollback system for safe changes
- Session-based workspaces for isolation
- REFLECTING state for continuous learning

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
| **Local LLM** | ☐ 0% | Browser-based LLM (research) |

## ⚑ Testing the Guardian Flow

See `test-guardian-flow.md` for step-by-step testing instructions.

## ♲ Contributing

The system supports self-modification through RFCs. Use the RFC Author persona to draft proposals, which the Guardian Agent can then implement with human approval.

See documentation:
- `docs/PERSONAS.md` - Persona development guide
- `RFC-STATUS.md` - Implementation tracking
- `test-guardian-flow.md` - Testing guide

---

*Guardian Agent with PAWS philosophy - Safe, controlled, and transparent AI assistance.* ⚡