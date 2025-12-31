/**
 * @fileoverview Safe Mode Error UI
 * Renders friendly recovery UI when boot fails.
 * Uses rd.css classes: error-ui-*, btn, border-error
 */

/**
 * Render safe mode error UI.
 * @param {Error} error - The error that caused boot failure
 */
export function renderErrorUI(error) {
  const html = `
    <div class="error-ui panel border-error">
      <h1 class="error-ui-header">REPLOID Boot Failure</h1>

      <p class="error-ui-description">
        The system encountered an error during startup. You can try the recovery options below.
      </p>

      <div class="error-ui-message">${escapeHtml(error.message)}</div>

      <details class="error-ui-details">
        <summary>Show Stack Trace</summary>
        <pre class="error-ui-stack">${escapeHtml(error.stack || 'No stack trace available')}</pre>
      </details>

      <div class="error-ui-actions">
        <button onclick="location.reload()" class="btn">
          \u21BB Reload Page
        </button>

        <button onclick="factoryReset()" class="btn btn-primary">
          \u2421 Factory Reset
        </button>

        <button onclick="downloadLogs()" class="btn">
          \u2193 Download Logs
        </button>
      </div>

      <p class="error-ui-hint">
        If the problem persists, try opening DevTools (F12) for more details.
      </p>
    </div>

    <script>
      async function factoryReset() {
        if (!confirm('This will delete all data. Continue?')) return;

        try {
          // Clear localStorage
          localStorage.clear();

          // Delete IndexedDB databases
          const dbs = await indexedDB.databases();
          for (const db of dbs) {
            if (db.name) indexedDB.deleteDatabase(db.name);
          }

          alert('Reset complete. Reloading...');
          location.reload();
        } catch (e) {
          alert('Reset failed: ' + e.message);
        }
      }

      function downloadLogs() {
        const logs = {
          error: ${JSON.stringify({ message: error.message, stack: error.stack })},
          timestamp: new Date().toISOString(),
          userAgent: navigator.userAgent,
          url: location.href,
          localStorage: Object.fromEntries(
            Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])
          )
        };

        const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'reploid-error-' + Date.now() + '.json';
        a.click();
        URL.revokeObjectURL(url);
      }
    </script>
  `;

  document.body.innerHTML = html;
}

/**
 * Escape HTML special characters.
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
