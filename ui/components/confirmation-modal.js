// Confirmation Modal Component for REPLOID

const ConfirmationModal = {
  metadata: {
    id: 'ConfirmationModal',
    version: '1.1.0',
    dependencies: ['Utils'],
    async: false,
    type: 'ui'
  },

  factory: (deps) => {
    const { Utils } = deps;
    const { logger, escapeHtml } = Utils;

    let activeModal = null;

    const attachHandlers = (overlay, handlers) => {
      overlay.querySelector('.modal-btn-confirm').addEventListener('click', handlers.confirm);
      overlay.querySelector('.modal-btn-cancel').addEventListener('click', handlers.cancel);
      overlay.querySelector('.modal-close').addEventListener('click', handlers.cancel);
      document.addEventListener('keydown', handlers.escape);
      overlay.addEventListener('click', handlers.overlayClick);
    };

    const confirm = (options = {}) => {
      const {
        title = 'Confirm Action',
        message = 'Are you sure you want to proceed?',
        confirmText = 'Confirm',
        cancelText = 'Cancel',
        danger = false,
        details = null
      } = options;

      return new Promise((resolve) => {
        closeModal();

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
          <div class="modal-content ${danger ? 'modal-danger' : ''}">
            <div class="modal-header">
              <h3 class="modal-title">${escapeHtml(title)}</h3>
              <button class="modal-close" aria-label="Close">&times;</button>
            </div>
            <div class="modal-body">
              <p class="modal-message">${escapeHtml(message)}</p>
              ${details ? `<div class="modal-details">${escapeHtml(details)}</div>` : ''}
            </div>
            <div class="modal-actions">
              <button class="btn btn-secondary modal-btn-cancel">${escapeHtml(cancelText)}</button>
              <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} modal-btn-confirm">${escapeHtml(confirmText)}</button>
            </div>
          </div>
        `;

        const handlers = {
          confirm: () => {
            closeModal();
            resolve(true);
          },
          cancel: () => {
            closeModal();
            resolve(false);
          },
          escape: (event) => {
            if (event.key === 'Escape') handlers.cancel();
          },
          overlayClick: (event) => {
            if (event.target === overlay) handlers.cancel();
          }
        };

        document.body.appendChild(overlay);
        attachHandlers(overlay, handlers);

        activeModal = { overlay, handlers };
        logger.info('[ConfirmationModal] Modal shown:', title);
      });
    };

    const closeModal = () => {
      if (!activeModal) return;
      const { overlay, handlers } = activeModal;

      document.removeEventListener('keydown', handlers.escape);
      overlay.removeEventListener('click', handlers.overlayClick);

      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }

      activeModal = null;
      logger.info('[ConfirmationModal] Modal closed');
    };

    return { confirm, closeModal };
  }
};

export default ConfirmationModal;
