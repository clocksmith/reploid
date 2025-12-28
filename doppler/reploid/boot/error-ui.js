/**
 * @fileoverview Safe Mode Error UI
 * Renders friendly recovery UI when boot fails.
 */

/**
 * Render safe mode error UI.
 * @param {Error} error - The error that caused boot failure
 */
export function renderErrorUI(error) {
  const html = `
    <div style="
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 600px;
      margin: 50px auto;
      padding: 30px;
      background: #1a1a2e;
      border: 1px solid #e94560;
      border-radius: 8px;
      color: #eee;
    ">
      <h1 style="color: #e94560; margin-top: 0; display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 1.5em;">&#x26A0;</span>
        REPLOID Boot Failure
      </h1>

      <p style="color: #aaa; line-height: 1.6;">
        The system encountered an error during startup. You can try the recovery options below.
      </p>

      <div style="
        background: #0f0f1a;
        padding: 15px;
        border-radius: 4px;
        margin: 20px 0;
        font-family: monospace;
        font-size: 13px;
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-all;
        color: #ff6b6b;
      ">${escapeHtml(error.message)}</div>

      <details style="margin: 20px 0;">
        <summary style="cursor: pointer; color: #aaa; padding: 10px 0;">
          Show Stack Trace
        </summary>
        <pre style="
          background: #0f0f1a;
          padding: 15px;
          border-radius: 4px;
          font-size: 11px;
          overflow-x: auto;
          color: #888;
        ">${escapeHtml(error.stack || 'No stack trace available')}</pre>
      </details>

      <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 20px;">
        <button onclick="location.reload()" style="
          background: #16213e;
          color: #eee;
          border: 1px solid #0f3460;
          padding: 12px 24px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
        ">
          &#x21BB; Reload Page
        </button>

        <button onclick="factoryReset()" style="
          background: #e94560;
          color: #fff;
          border: none;
          padding: 12px 24px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
        ">
          &#x1F5D1; Factory Reset
        </button>

        <button onclick="downloadLogs()" style="
          background: #16213e;
          color: #eee;
          border: 1px solid #0f3460;
          padding: 12px 24px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
        ">
          &#x1F4BE; Download Logs
        </button>
      </div>

      <p style="color: #666; font-size: 12px; margin-top: 30px;">
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
