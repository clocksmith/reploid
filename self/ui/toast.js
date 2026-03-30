/**
 * @fileoverview Toast Notification System
 * Provides non-blocking notifications for transient info/success messages.
 * Errors and warnings are handled by ErrorStore and displayed in Status tab.
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
   * @param {string} options.type - 'info' | 'success'
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
      info: '☛',
      success: '✓'
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
      <span class="toast-icon">${icons[type] || '☛'}</span>
      <div class="toast-content">
        ${title ? `<div class="toast-title">${this._escapeHtml(title)}</div>` : ''}
        ${message ? `<div class="toast-message">${this._escapeHtml(message)}</div>` : ''}
        ${actionsHtml}
      </div>
      <button class="toast-close" aria-label="Dismiss">☈</button>
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
