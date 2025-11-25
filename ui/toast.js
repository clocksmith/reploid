/**
 * @fileoverview Toast Notification System
 * Provides non-blocking notifications with optional actions.
 */

const Toast = {
  _container: null,
  _toasts: new Map(),
  _idCounter: 0,

  init() {
    if (this._container) return;

    this._container = document.createElement('div');
    this._container.className = 'toast-container';
    this._container.setAttribute('role', 'alert');
    this._container.setAttribute('aria-live', 'polite');
    document.body.appendChild(this._container);
  },

  /**
   * Show a toast notification
   * @param {Object} options
   * @param {string} options.type - 'info' | 'success' | 'warning' | 'error'
   * @param {string} options.title - Toast title
   * @param {string} options.message - Toast message
   * @param {number} options.duration - Auto-dismiss duration in ms (0 = no auto-dismiss)
   * @param {Array} options.actions - Array of {label, onClick, primary} objects
   * @returns {string} Toast ID for programmatic dismissal
   */
  show(options = {}) {
    this.init();

    const {
      type = 'info',
      title = '',
      message = '',
      duration = 5000,
      actions = []
    } = options;

    const id = `toast-${++this._idCounter}`;
    const icons = {
      info: '○',
      success: '✓',
      warning: '⚠',
      error: '✗'
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.id = id;

    let actionsHtml = '';
    if (actions.length > 0) {
      actionsHtml = `
        <div class="toast-actions">
          ${actions.map((a, i) => `
            <button class="toast-btn ${a.primary ? 'primary' : ''}" data-action="${i}">
              ${a.label}
            </button>
          `).join('')}
        </div>
      `;
    }

    toast.innerHTML = `
      <span class="toast-icon">${icons[type]}</span>
      <div class="toast-content">
        ${title ? `<div class="toast-title">${title}</div>` : ''}
        ${message ? `<div class="toast-message">${message}</div>` : ''}
        ${actionsHtml}
      </div>
      <button class="toast-close" aria-label="Dismiss">&times;</button>
    `;

    // Bind close button
    toast.querySelector('.toast-close').addEventListener('click', () => {
      this.dismiss(id);
    });

    // Bind action buttons
    actions.forEach((action, index) => {
      const btn = toast.querySelector(`[data-action="${index}"]`);
      if (btn && action.onClick) {
        btn.addEventListener('click', () => {
          action.onClick();
          this.dismiss(id);
        });
      }
    });

    this._container.appendChild(toast);
    this._toasts.set(id, toast);

    // Auto-dismiss
    if (duration > 0) {
      setTimeout(() => this.dismiss(id), duration);
    }

    return id;
  },

  dismiss(id) {
    const toast = this._toasts.get(id);
    if (!toast) return;

    toast.style.animation = 'fadeOut 0.2s ease forwards';
    setTimeout(() => {
      toast.remove();
      this._toasts.delete(id);
    }, 200);
  },

  dismissAll() {
    this._toasts.forEach((_, id) => this.dismiss(id));
  },

  // Convenience methods
  info(title, message, options = {}) {
    return this.show({ type: 'info', title, message, ...options });
  },

  success(title, message, options = {}) {
    return this.show({ type: 'success', title, message, ...options });
  },

  warning(title, message, options = {}) {
    return this.show({ type: 'warning', title, message, ...options });
  },

  error(title, message, options = {}) {
    return this.show({ type: 'error', title, message, duration: 0, ...options });
  },

  // Error history for debugging
  _errorHistory: [],
  MAX_ERROR_HISTORY: 20,

  logError(error) {
    this._errorHistory.unshift({
      timestamp: Date.now(),
      ...error
    });
    if (this._errorHistory.length > this.MAX_ERROR_HISTORY) {
      this._errorHistory.pop();
    }
  },

  getErrorHistory() {
    return [...this._errorHistory];
  },

  clearErrorHistory() {
    this._errorHistory = [];
  },

  /**
   * Show error modal with full details
   * @param {string} title - Error title
   * @param {string} fullError - Full error message
   * @param {Object} context - Optional context (tool name, cycle, etc.)
   */
  showErrorModal(title, fullError, context = {}) {
    // Remove existing modal if any
    const existing = document.getElementById('error-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'error-modal';
    modal.className = 'error-modal-overlay';

    const timestamp = new Date().toLocaleString();
    const contextInfo = Object.entries(context)
      .filter(([_, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' | ');

    modal.innerHTML = `
      <div class="error-modal">
        <div class="error-modal-header">
          <span class="error-modal-title">${title}</span>
          <button class="error-modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="error-modal-meta">
          <span>${timestamp}</span>
          ${contextInfo ? `<span class="error-modal-context">${contextInfo}</span>` : ''}
        </div>
        <div class="error-modal-content">
          <pre>${this._escapeHtml(fullError)}</pre>
        </div>
        <div class="error-modal-actions">
          <button class="toast-btn" id="error-copy-btn">Copy to Clipboard</button>
          <button class="toast-btn primary" id="error-close-btn">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Log this error
    this.logError({ title, message: fullError, ...context });

    // Bind events
    const closeModal = () => modal.remove();

    modal.querySelector('.error-modal-close').onclick = closeModal;
    modal.querySelector('#error-close-btn').onclick = closeModal;
    modal.querySelector('.error-modal-overlay').addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    modal.querySelector('#error-copy-btn').onclick = async () => {
      const copyBtn = modal.querySelector('#error-copy-btn');
      try {
        const copyText = `${title}\n${timestamp}\n${contextInfo ? contextInfo + '\n' : ''}\n${fullError}`;
        await navigator.clipboard.writeText(copyText);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy to Clipboard'; }, 2000);
      } catch (e) {
        copyBtn.textContent = 'Copy failed';
        setTimeout(() => { copyBtn.textContent = 'Copy to Clipboard'; }, 2000);
      }
    };

    // ESC to close
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  },

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

// Add fadeOut animation
const style = document.createElement('style');
style.textContent = `
  @keyframes fadeOut {
    from { opacity: 1; transform: translateX(0); }
    to { opacity: 0; transform: translateX(20px); }
  }
`;
document.head.appendChild(style);

export default Toast;
