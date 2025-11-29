/**
 * @fileoverview HITL Widget - Approval queue UI component
 * Displays pending approvals and allows approve/reject actions.
 */

const HITLWidget = {
  metadata: {
    id: 'HITLWidget',
    version: '1.0.0',
    dependencies: ['Utils', 'EventBus', 'HITLController?'],
    async: false,
    type: 'ui'
  },

  factory: (deps) => {
    const { Utils, EventBus, HITLController } = deps;
    const { logger } = Utils;

    let _container = null;
    let _updateHandler = null;

    const init = (containerId) => {
      _container = typeof containerId === 'string'
        ? document.getElementById(containerId)
        : containerId;

      if (!_container) {
        logger.warn('[HITLWidget] Container not found');
        return false;
      }

      // Subscribe to HITL events for live updates
      _updateHandler = () => render();
      EventBus.on('hitl:approval-pending', _updateHandler, 'HITLWidget');
      EventBus.on('hitl:approval-granted', _updateHandler, 'HITLWidget');
      EventBus.on('hitl:approval-rejected', _updateHandler, 'HITLWidget');
      EventBus.on('hitl:master-mode-changed', _updateHandler, 'HITLWidget');
      EventBus.on('hitl:config-reset', _updateHandler, 'HITLWidget');

      render();
      logger.info('[HITLWidget] Initialized');
      return true;
    };

    const cleanup = () => {
      if (_updateHandler) {
        EventBus.off('hitl:approval-pending', _updateHandler);
        EventBus.off('hitl:approval-granted', _updateHandler);
        EventBus.off('hitl:approval-rejected', _updateHandler);
        EventBus.off('hitl:master-mode-changed', _updateHandler);
        EventBus.off('hitl:config-reset', _updateHandler);
        _updateHandler = null;
      }
    };

    const render = () => {
      if (!_container) return;

      if (!HITLController) {
        _container.innerHTML = '<div class="hitl-widget hitl-disabled">HITL not available</div>';
        return;
      }

      const state = HITLController.getState();
      const { config, approvalQueue, approvalStats } = state;
      const isHITL = config.masterMode === 'hitl';

      const html = `
        <div class="hitl-widget ${isHITL ? 'hitl-active' : 'hitl-auto'}">
          <div class="hitl-header">
            <span class="hitl-icon">${isHITL ? '⚇' : '⚙'}</span>
            <span class="hitl-title">${isHITL ? 'HITL Mode' : 'Autonomous'}</span>
            <button class="hitl-toggle" data-action="toggle-mode">
              ${isHITL ? 'Go Auto' : 'Enable HITL'}
            </button>
          </div>

          ${approvalQueue.length > 0 ? `
            <div class="hitl-queue">
              <div class="hitl-queue-header">
                <span>${approvalQueue.length} Pending Approval${approvalQueue.length > 1 ? 's' : ''}</span>
              </div>
              ${approvalQueue.slice(0, 5).map(item => `
                <div class="hitl-item" data-id="${item.id}">
                  <div class="hitl-item-info">
                    <span class="hitl-item-module">${item.moduleId}</span>
                    <span class="hitl-item-action">${item.action}</span>
                  </div>
                  <div class="hitl-item-actions">
                    <button class="hitl-approve" data-action="approve" data-id="${item.id}" title="Approve">✓</button>
                    <button class="hitl-reject" data-action="reject" data-id="${item.id}" title="Reject">✗</button>
                  </div>
                </div>
              `).join('')}
              ${approvalQueue.length > 5 ? `
                <div class="hitl-more">+${approvalQueue.length - 5} more</div>
              ` : ''}
            </div>
          ` : ''}

          <div class="hitl-stats">
            <span class="hitl-stat approved" title="Approved">${approvalStats.approved}</span>
            <span class="hitl-stat rejected" title="Rejected">${approvalStats.rejected}</span>
            <span class="hitl-stat auto" title="Auto-approved">${approvalStats.autoApproved}</span>
          </div>
        </div>
      `;

      _container.innerHTML = html;
      bindEvents();
    };

    const bindEvents = () => {
      if (!_container) return;

      _container.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;

        const action = btn.dataset.action;
        const id = btn.dataset.id;

        switch (action) {
          case 'toggle-mode':
            const current = HITLController.getState().config.masterMode;
            HITLController.setMasterMode(current === 'hitl' ? 'autonomous' : 'hitl');
            break;
          case 'approve':
            if (id) HITLController.approve(id);
            break;
          case 'reject':
            if (id) HITLController.reject(id, 'Rejected via widget');
            break;
        }
      });
    };

    // Get status for dashboard integration
    const getStatus = () => {
      if (!HITLController) {
        return { state: 'idle', primaryMetric: 'N/A', secondaryMetric: '', message: null };
      }

      const state = HITLController.getState();
      const queue = state.approvalQueue;
      const hasWarning = queue.length > 0;

      return {
        state: hasWarning ? 'warning' : 'idle',
        primaryMetric: state.config.masterMode === 'autonomous' ? 'Auto' : 'HITL',
        secondaryMetric: queue.length > 0 ? `${queue.length} pending` : 'No pending',
        lastActivity: queue.length > 0 ? queue[0].timestamp : null,
        message: hasWarning ? `${queue.length} approval${queue.length > 1 ? 's' : ''} needed` : null
      };
    };

    return {
      init,
      cleanup,
      render,
      getStatus
    };
  }
};

// CSS styles (can be injected or included separately)
const HITL_WIDGET_STYLES = `
.hitl-widget {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  padding: 12px;
  font-size: 12px;
}
.hitl-widget.hitl-active {
  border-left: 3px solid #ffa500;
}
.hitl-widget.hitl-auto {
  border-left: 3px solid #66bb6a;
}
.hitl-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.hitl-icon {
  font-size: 16px;
}
.hitl-title {
  flex: 1;
  font-weight: 500;
}
.hitl-toggle {
  background: rgba(255, 255, 255, 0.1);
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
}
.hitl-toggle:hover {
  background: rgba(255, 255, 255, 0.2);
}
.hitl-queue {
  margin: 8px 0;
  background: rgba(255, 165, 0, 0.1);
  border-radius: 4px;
  padding: 8px;
}
.hitl-queue-header {
  font-weight: 500;
  margin-bottom: 8px;
  color: #ffa500;
}
.hitl-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.hitl-item:last-child {
  border-bottom: none;
}
.hitl-item-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.hitl-item-module {
  font-weight: 500;
  font-size: 11px;
}
.hitl-item-action {
  color: rgba(255, 255, 255, 0.6);
  font-size: 10px;
}
.hitl-item-actions {
  display: flex;
  gap: 4px;
}
.hitl-approve, .hitl-reject {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.hitl-approve {
  background: rgba(102, 187, 106, 0.2);
  color: #66bb6a;
}
.hitl-approve:hover {
  background: rgba(102, 187, 106, 0.4);
}
.hitl-reject {
  background: rgba(244, 135, 113, 0.2);
  color: #f48771;
}
.hitl-reject:hover {
  background: rgba(244, 135, 113, 0.4);
}
.hitl-more {
  text-align: center;
  color: rgba(255, 255, 255, 0.5);
  font-size: 10px;
  padding-top: 4px;
}
.hitl-stats {
  display: flex;
  gap: 12px;
  justify-content: center;
}
.hitl-stat {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
}
.hitl-stat.approved {
  background: rgba(102, 187, 106, 0.2);
  color: #66bb6a;
}
.hitl-stat.rejected {
  background: rgba(244, 135, 113, 0.2);
  color: #f48771;
}
.hitl-stat.auto {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.6);
}
.hitl-disabled {
  color: rgba(255, 255, 255, 0.4);
  text-align: center;
  padding: 20px;
}
`;

export default HITLWidget;
export { HITL_WIDGET_STYLES };
