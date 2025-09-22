#!/usr/bin/env node

/**
 * Project Hermes - Node.js Port of REPLOID
 * Server-side Guardian Agent with Git worktree session management
 */

const express = require('express');
const WebSocket = require('ws');
const { execSync } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const http = require('http');

// Configuration
const PORT = process.env.PORT || 3000;
const SESSIONS_DIR = path.join(__dirname, 'sessions');
const WORKTREES_DIR = path.join(__dirname, 'worktrees');

// Initialize directories
const initDirectories = async () => {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
  await fs.mkdir(WORKTREES_DIR, { recursive: true });
};

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Session manager
class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.activeSession = null;
  }

  async createSession(goal) {
    const sessionId = `session_${Date.now()}`;
    const sessionPath = path.join(SESSIONS_DIR, sessionId);
    const worktreePath = path.join(WORKTREES_DIR, sessionId);

    // Create session directory
    await fs.mkdir(sessionPath, { recursive: true });

    // Create Git worktree for isolated changes
    try {
      execSync(`git worktree add ${worktreePath} -b ${sessionId}`, {
        cwd: path.join(__dirname, '..')
      });
    } catch (err) {
      console.warn(`Failed to create worktree: ${err.message}`);
    }

    const session = {
      id: sessionId,
      goal,
      path: sessionPath,
      worktree: worktreePath,
      state: 'IDLE',
      created: new Date().toISOString(),
      turnCount: 0
    };

    this.sessions.set(sessionId, session);
    this.activeSession = sessionId;

    return session;
  }

  async getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  async listSessions() {
    return Array.from(this.sessions.values());
  }
}

// FSM States (simplified version)
const FSMStates = {
  IDLE: 'IDLE',
  CURATING_CONTEXT: 'CURATING_CONTEXT',
  AWAITING_CONTEXT_APPROVAL: 'AWAITING_CONTEXT_APPROVAL',
  PLANNING_WITH_CONTEXT: 'PLANNING_WITH_CONTEXT',
  GENERATING_PROPOSAL: 'GENERATING_PROPOSAL',
  AWAITING_PROPOSAL_APPROVAL: 'AWAITING_PROPOSAL_APPROVAL',
  APPLYING_CHANGES: 'APPLYING_CHANGES',
  REFLECTING: 'REFLECTING'
};

// Guardian Agent FSM
class GuardianAgent {
  constructor(sessionManager) {
    this.sessionManager = sessionManager;
    this.state = FSMStates.IDLE;
    this.currentSession = null;
  }

  async transition(newState) {
    console.log(`[FSM] ${this.state} -> ${newState}`);
    this.state = newState;

    if (this.currentSession) {
      this.currentSession.state = newState;
    }

    // Broadcast state change to WebSocket clients
    this.broadcastState();
  }

  async processGoal(goal) {
    // Create new session
    this.currentSession = await this.sessionManager.createSession(goal);

    // Start FSM flow
    await this.transition(FSMStates.CURATING_CONTEXT);
    await this.curateContext();
  }

  async curateContext() {
    // Simulate context curation
    const catsPath = path.join(this.currentSession.path, `turn-${this.currentSession.turnCount}.cats.md`);

    // Use the cats CLI to create context bundle
    const catsContent = `# Context for: ${this.currentSession.goal}
## Relevant Files
\`\`\`javascript
// Sample context
const modules = ['sentinel-tools.js', 'sentinel-fsm.js'];
\`\`\`
`;

    await fs.writeFile(catsPath, catsContent);
    await this.transition(FSMStates.AWAITING_CONTEXT_APPROVAL);
  }

  async generateProposal(context) {
    await this.transition(FSMStates.PLANNING_WITH_CONTEXT);

    // Simulate proposal generation
    await new Promise(resolve => setTimeout(resolve, 1000));

    await this.transition(FSMStates.GENERATING_PROPOSAL);

    const dogsPath = path.join(this.currentSession.path, `turn-${this.currentSession.turnCount}.dogs.md`);
    const dogsContent = `# Changes for: ${this.currentSession.goal}
\`\`\`paws-change
operation: MODIFY
file_path: test-file.js
\`\`\`
\`\`\`javascript
// Modified content
console.log('Guardian Agent changes applied');
\`\`\`
`;

    await fs.writeFile(dogsPath, dogsContent);
    await this.transition(FSMStates.AWAITING_PROPOSAL_APPROVAL);
  }

  async applyChanges(proposal) {
    await this.transition(FSMStates.APPLYING_CHANGES);

    // Apply changes in worktree
    const worktree = this.currentSession.worktree;

    // Use the dogs CLI to apply changes
    // For now, simulate
    await new Promise(resolve => setTimeout(resolve, 500));

    await this.transition(FSMStates.REFLECTING);
    await this.reflect();
  }

  async reflect() {
    // Analyze outcome and learn
    const reflectionPath = path.join(this.currentSession.path, `turn-${this.currentSession.turnCount}.reflection.md`);

    const reflection = `# Reflection
## Outcome
Successfully completed: ${this.currentSession.goal}

## Insights
- Context curation was effective
- Changes applied cleanly

## Improvements
- Could optimize context selection
`;

    await fs.writeFile(reflectionPath, reflection);

    this.currentSession.turnCount++;
    await this.transition(FSMStates.IDLE);
  }

  broadcastState() {
    const message = JSON.stringify({
      type: 'STATE_CHANGE',
      state: this.state,
      session: this.currentSession ? {
        id: this.currentSession.id,
        goal: this.currentSession.goal,
        turnCount: this.currentSession.turnCount
      } : null
    });

    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
}

// Initialize components
const sessionManager = new SessionManager();
const agent = new GuardianAgent(sessionManager);

// API Routes
app.get('/api/status', (req, res) => {
  res.json({
    state: agent.state,
    session: agent.currentSession,
    sessions: Array.from(sessionManager.sessions.values())
  });
});

app.post('/api/goal', async (req, res) => {
  const { goal } = req.body;

  if (!goal) {
    return res.status(400).json({ error: 'Goal is required' });
  }

  await agent.processGoal(goal);
  res.json({
    session: agent.currentSession,
    state: agent.state
  });
});

app.post('/api/approve-context', async (req, res) => {
  if (agent.state !== FSMStates.AWAITING_CONTEXT_APPROVAL) {
    return res.status(400).json({ error: 'Not awaiting context approval' });
  }

  await agent.generateProposal(req.body.context);
  res.json({ state: agent.state });
});

app.post('/api/approve-proposal', async (req, res) => {
  if (agent.state !== FSMStates.AWAITING_PROPOSAL_APPROVAL) {
    return res.status(400).json({ error: 'Not awaiting proposal approval' });
  }

  await agent.applyChanges(req.body.proposal);
  res.json({ state: agent.state });
});

app.get('/api/sessions', async (req, res) => {
  const sessions = await sessionManager.listSessions();
  res.json(sessions);
});

// WebSocket handling
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');

  // Send current state
  ws.send(JSON.stringify({
    type: 'STATE_SYNC',
    state: agent.state,
    session: agent.currentSession
  }));

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'SET_GOAL':
          await agent.processGoal(data.goal);
          break;

        case 'APPROVE_CONTEXT':
          await agent.generateProposal(data.context);
          break;

        case 'APPROVE_PROPOSAL':
          await agent.applyChanges(data.proposal);
          break;

        default:
          ws.send(JSON.stringify({ error: 'Unknown message type' }));
      }
    } catch (err) {
      ws.send(JSON.stringify({ error: err.message }));
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });
});

// Start server
const main = async () => {
  await initDirectories();

  server.listen(PORT, () => {
    console.log(`
🚀 Project Hermes - REPLOID Node.js Port
   Server: http://localhost:${PORT}
   WebSocket: ws://localhost:${PORT}

   Guardian Agent ready for goals...
`);
  });
};

// Handle shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');

  // Clean up worktrees
  sessionManager.sessions.forEach(session => {
    try {
      execSync(`git worktree remove ${session.worktree} --force`, {
        cwd: path.join(__dirname, '..')
      });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  process.exit(0);
});

// Start if main module
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  SessionManager,
  GuardianAgent,
  app
};