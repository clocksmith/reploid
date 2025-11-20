/**
 * @fileoverview Dashboard UI
 * Main user interface for the agent.
 */

const Dashboard = {
  factory: (deps) => {
    const { Utils, EventBus, AgentLoop, StateManager } = deps;
    const { logger } = Utils;

    // --- DOM Elements ---
    let _root = null;
    let _logContainer = null;
    let _statusIndicator = null;

    // --- Event Handlers ---

    const onLog = (entry) => {
      if (!_logContainer) return;
      const div = document.createElement('div');
      div.className = `log-entry log-${entry.level.toLowerCase()}`;
      div.textContent = `[${entry.ts.split('T')[1].split('.')[0]}] ${entry.msg}`;
      _logContainer.appendChild(div);
      _logContainer.scrollTop = _logContainer.scrollHeight;
    };

    const onStateChange = (state) => {
      if (!_statusIndicator) return;
      _statusIndicator.textContent = `Cycle: ${state.totalCycles} | Goal: ${state.currentGoal?.text || 'None'}`;
    };

    // --- Render Logic ---

    const render = () => {
      const container = document.createElement('div');
      container.className = 'dashboard-container';

      container.innerHTML = `
        <header class="dashboard-header">
          <h1>REPLOID v2.0</h1>
          <div id="status-bar" class="status-bar">Initializing...</div>
          <div class="controls">
            <input type="text" id="goal-input" placeholder="Enter agent goal..." />
            <button id="btn-start">Start Agent</button>
            <button id="btn-stop" disabled>Stop</button>
          </div>
        </header>

        <main class="dashboard-main">
          <section class="panel left-panel">
            <h3>Live Logs</h3>
            <div id="log-container" class="log-container"></div>
          </section>

          <section class="panel right-panel">
            <h3>VFS State</h3>
            <div id="vfs-container"></div>
          </section>
        </main>
      `;

      // Bind Events
      const btnStart = container.querySelector('#btn-start');
      const btnStop = container.querySelector('#btn-stop');
      const goalInput = container.querySelector('#goal-input');

      btnStart.onclick = async () => {
        const goal = goalInput.value.trim();
        if (!goal) return alert('Please enter a goal');

        // Configure model (Mock config for now - normally from settings UI)
        AgentLoop.setModel({ id: 'gemini-2.0-flash', provider: 'gemini' });

        btnStart.disabled = true;
        btnStop.disabled = false;

        try {
          await AgentLoop.run(goal);
        } catch (e) {
          alert(`Agent Error: ${e.message}`);
          btnStart.disabled = false;
          btnStop.disabled = true;
        }
      };

      btnStop.onclick = () => {
        AgentLoop.stop();
        btnStart.disabled = false;
        btnStop.disabled = true;
      };

      _logContainer = container.querySelector('#log-container');
      _statusIndicator = container.querySelector('#status-bar');

      return container;
    };

    const mount = (target) => {
      _root = target;
      _root.innerHTML = '';
      _root.appendChild(render());

      // Subscribe to events
      // We monkey-patch the logger for UI display since logger doesn't emit events by default
      // In a real implementation, we'd use a specific LogSink in Utils.
      // For now, we poll history or rely on EventBus events.

      // Hack: Proxy logger for demo
      const originalInfo = logger.info;
      logger.info = (msg, data) => {
        originalInfo(msg, data);
        onLog({ level: 'INFO', ts: new Date().toISOString(), msg });
      };

      // Load initial state
      try {
        const state = StateManager.getState();
        onStateChange(state);
      } catch (e) { /* State not ready */ }
    };

    return { mount };
  }
};

export default Dashboard;
