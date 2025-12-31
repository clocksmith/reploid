// Toast Notification System - Non-blocking user feedback
// Replaces alert() calls with elegant toast notifications
// Uses rd.css classes: toast-container, toast, toast-success/error/warning/info

const ToastNotifications = {
  metadata: {
    id: 'ToastNotifications',
    version: '1.0.0',
    description: 'Non-blocking toast notification system for user feedback',
    dependencies: ['Utils'],
    async: false,
    type: 'ui'
  },

  factory: (deps) => {
    const { Utils } = deps;
    const { logger } = Utils;

    let container = null;
    let toastQueue = [];
    let activeToasts = [];

    // Toast types - icons only, styling comes from rd.css
    const TOAST_ICONS = {
      success: '\u2605',  // ★
      error: '\u2612',    // ☒
      warning: '\u2621',  // ☡
      info: '\u261B'      // ☛
    };

    // Initialize toast container
    const init = () => {
      if (container) return;

      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
      logger.info('[ToastNotifications] Initialized');
    };

    // Show toast notification
    const show = (message, type = 'info', duration = 4000) => {
      init(); // Ensure container exists

      const icon = TOAST_ICONS[type] || TOAST_ICONS.info;

      // Create toast element using rd.css classes
      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;

      toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <span class="toast-message">${message}</span>
        <span class="toast-close">\u2A2F</span>
      `;

      // Add to container
      container.appendChild(toast);
      activeToasts.push(toast);

      // Animate in using rd.css .visible class
      setTimeout(() => {
        toast.classList.add('visible');
      }, 10);

      // Auto-remove after duration
      const removeToast = () => {
        toast.classList.remove('visible');
        setTimeout(() => {
          if (container && container.contains(toast)) {
            container.removeChild(toast);
          }
          activeToasts = activeToasts.filter(t => t !== toast);
        }, 300);
      };

      // Click to dismiss
      toast.addEventListener('click', removeToast);

      // Auto-dismiss
      if (duration > 0) {
        setTimeout(removeToast, duration);
      }

      return toast;
    };

    // Convenience methods
    const success = (message, duration) => show(message, 'success', duration);
    const error = (message, duration) => show(message, 'error', duration);
    const warning = (message, duration) => show(message, 'warning', duration);
    const info = (message, duration) => show(message, 'info', duration);

    // Clear all toasts
    const clearAll = () => {
      activeToasts.forEach(toast => {
        if (container && container.contains(toast)) {
          container.removeChild(toast);
        }
      });
      activeToasts = [];
    };

    return {
      init,
      show,
      success,
      error,
      warning,
      info,
      clearAll
    };
  }
};

// Register module if running in REPLOID environment
if (typeof window !== 'undefined' && window.ModuleRegistry) {
  window.ModuleRegistry.register(ToastNotifications);
}

export default ToastNotifications;
