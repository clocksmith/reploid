# Workflow Directory

**Purpose**: Task orchestration, state machines, and autonomous operation components.

## Contents

| File | Purpose |
|------|---------|
| `sentinel-fsm.js` | Finite state machine for agent lifecycle management |
| `sentinel-tools.js` | Tools for sentinel state transitions |
| `autonomous-orchestrator.js` | Curator Mode - overnight autonomous proposal generation |

---

## Components

### sentinel-fsm.js

Manages the agent's operational states and transitions.

**States:**
- IDLE - Waiting for input
- THINKING - Processing request
- EXECUTING - Running tools
- PAUSED - Temporarily halted
- ERROR - Error recovery

### sentinel-tools.js

Provides tools for controlling the sentinel state machine.

**Tools:**
- Pause/resume agent
- Reset state
- Get current state

### autonomous-orchestrator.js

Curator Mode for autonomous overnight operation.

**Features:**
- Proposal generation without user input
- Safety boundaries and limits
- Visual reports of activity
- Auto-approval options

---

## See Also

- **[Core Modules](../core/README.md)** - Agent loop and execution
- **[Capabilities](../capabilities/README.md)** - RSI capabilities
