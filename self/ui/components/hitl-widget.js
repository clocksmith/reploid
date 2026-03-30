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
      EventBus.on('hitl:approval-mode-changed', _updateHandler, 'HITLWidget');
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
        EventBus.off('hitl:approval-mode-changed', _updateHandler);
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
      const mode = config.masterMode;
      const isHITL = mode === 'hitl';
      const isEveryN = mode === 'every_n';
      const isAuto = mode === 'autonomous';

      const modeIcon = isHITL ? '⚑' : (isEveryN ? '♺' : '☇');
      const modeTitle = isHITL ? 'HITL Mode' : (isEveryN ? `Every ${config.everyNSteps}` : 'Autonomous');
      const widgetClass = isHITL ? 'hitl-active' : (isEveryN ? 'hitl-every-n' : 'hitl-auto');

      const html = `
        <div class="hitl-widget ${widgetClass}">
          <div class="hitl-header">
            <span class="hitl-icon">${modeIcon}</span>
            <select class="hitl-mode-select" data-action="change-mode">
              <option value="autonomous" ${isAuto ? 'selected' : ''}>Autonomous</option>
              <option value="every_n" ${isEveryN ? 'selected' : ''}>Every N Steps</option>
              <option value="hitl" ${isHITL ? 'selected' : ''}>Full HITL</option>
            </select>
          </div>

          ${isEveryN ? `
            <div class="hitl-config">
              <label class="hitl-config-label">
                Steps:
                <input type="number" class="hitl-steps-input" value="${config.everyNSteps}" min="1" max="100" data-action="set-steps" />
                <span class="hitl-step-counter">(${config.stepCounter}/${config.everyNSteps})</span>
              </label>
            </div>
          ` : ''}

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
                    <button class="hitl-reject" data-action="reject" data-id="${item.id}" title="Reject">✄</button>
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
          case 'approve':
            if (id) HITLController.approve(id);
            break;
          case 'reject':
            if (id) HITLController.reject(id, 'Rejected via widget');
            break;
        }
      });

      // Handle mode change dropdown
      _container.addEventListener('change', (e) => {
        const el = e.target.closest('[data-action]');
        if (!el) return;

        const action = el.dataset.action;

        switch (action) {
          case 'change-mode':
            HITLController.setMasterMode(el.value);
            break;
          case 'set-steps':
            const steps = parseInt(el.value, 10);
            if (steps >= 1 && steps <= 100) {
              HITLController.setEveryNSteps(steps);
            }
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
      const mode = state.config.masterMode;

      let primaryMetric = 'Auto';
      if (mode === 'hitl') primaryMetric = 'HITL';
      else if (mode === 'every_n') primaryMetric = `N=${state.config.everyNSteps}`;

      return {
        state: hasWarning ? 'warning' : 'idle',
        primaryMetric,
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

export default HITLWidget;
