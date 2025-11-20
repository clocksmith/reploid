const PythonReplPanel = {
  metadata: {
    id: 'PythonReplPanel',
    version: '1.0.0',
    dependencies: ['Utils', 'EventBus', 'PyodideRuntime?', 'ToastNotifications?'],
    async: false,
    type: 'ui'
  },

  factory: (deps) => {
    const { Utils, EventBus, PyodideRuntime, ToastNotifications } = deps;
    const { logger } = Utils;

    let container = null;
    let outputContainer = null;
    let codeInput = null;

    const init = (containerId) => {
      container = document.getElementById(containerId);
      if (!container) return;

      outputContainer = document.getElementById('python-output');
      codeInput = document.getElementById('python-code-input');
      const statusIcon = document.getElementById('pyodide-status-icon');
      const statusText = document.getElementById('pyodide-status-text');

      const updateStatus = () => {
        if (!PyodideRuntime) return;
        const isReady = PyodideRuntime.isReady?.();
        const error = PyodideRuntime.getError?.();

        if (error) {
          if (statusIcon) statusIcon.textContent = '🔴';
          if (statusText) statusText.textContent = `Error: ${error.message}`;
        } else if (isReady) {
          if (statusIcon) statusIcon.textContent = '🟢';
          if (statusText) statusText.textContent = 'Ready';
        } else {
          if (statusIcon) statusIcon.textContent = '🟡';
          if (statusText) statusText.textContent = 'Initializing...';
        }
      };

      EventBus.on('pyodide:ready', updateStatus);
      EventBus.on('pyodide:error', updateStatus);
      EventBus.on('pyodide:initialized', updateStatus);

      setupButtons();
      updateStatus();
      logger.info('[PythonReplPanel] Initialized');
    };

    const setupButtons = () => {
      const executeBtn = document.getElementById('python-execute-btn');
      const clearBtn = document.getElementById('repl-clear-btn');
      const packagesBtn = document.getElementById('repl-packages-btn');
      const syncBtn = document.getElementById('repl-sync-btn');
      const syncCheck = document.getElementById('python-sync-workspace-check');

      if (executeBtn) {
        executeBtn.onclick = async () => {
          const code = codeInput?.value;
          if (!code?.trim()) return;

          executeBtn.disabled = true;
          executeBtn.textContent = '⏳ Running...';

          try {
            if (syncCheck?.checked && PyodideRuntime?.syncWorkspace) {
              await PyodideRuntime.syncWorkspace();
            }
            const result = await PyodideRuntime.execute(code, { async: false });
            appendOutput(result);
          } catch (error) {
            appendOutput({ success: false, error: error.message });
            if (ToastNotifications) {
              ToastNotifications.error(`Python error: ${error.message}`);
            }
          } finally {
            executeBtn.disabled = false;
            executeBtn.textContent = '▶️ Run';
          }
        };
      }

      if (clearBtn) {
        clearBtn.onclick = () => {
          if (outputContainer) outputContainer.innerHTML = '';
        };
      }

      if (packagesBtn && PyodideRuntime?.openPackageManager) {
        packagesBtn.onclick = () => PyodideRuntime.openPackageManager();
      }

      if (syncBtn && PyodideRuntime?.syncWorkspace) {
        syncBtn.onclick = async () => {
          syncBtn.disabled = true;
          syncBtn.textContent = 'Syncing...';
          try {
            await PyodideRuntime.syncWorkspace();
            if (ToastNotifications) ToastNotifications.success('Workspace synced');
          } catch (err) {
            logger.error('[PythonReplPanel] Sync failed:', err);
          } finally {
            syncBtn.disabled = false;
            syncBtn.textContent = '🔁 Sync FS';
          }
        };
      }
    };

    const appendOutput = (result) => {
      if (!outputContainer) return;

      const div = document.createElement('div');
      div.className = `repl-result ${result.success ? 'repl-result-success' : 'repl-result-error'}`;

      let content = `<div class="repl-result-header">--- ${new Date().toLocaleTimeString()} ---</div>`;
      if (result.stdout) content += `<div class="repl-stdout">${Utils.escapeHtml(result.stdout)}</div>`;
      if (result.stderr) content += `<div class="repl-stderr">${Utils.escapeHtml(result.stderr)}</div>`;
      if (result.success && result.result !== undefined) {
        content += `<div class="repl-return-value">=> ${Utils.escapeHtml(JSON.stringify(result.result))}</div>`;
      }
      if (!result.success) {
        content += `<div class="repl-error">Error: ${Utils.escapeHtml(result.error)}</div>`;
      }

      div.innerHTML = content;
      outputContainer.appendChild(div);
      outputContainer.scrollTop = outputContainer.scrollHeight;
    };

    return { init };
  }
};

export default PythonReplPanel;
