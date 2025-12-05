// UIManager - Thin orchestrator for UI panels
// Version 4.1.0: Removed legacy visualizer dependencies

const UIManager = {
  metadata: {
    id: 'UIManager',
    version: '1.0.0',
    description: 'Orchestrates UI panels via DI Container',
    dependencies: [
      'Utils', 'EventBus', 'StateManager',
      'PythonReplPanel', 'LLMConfigPanel', 'VFSPanel',
      'MetricsPanel', 'ChatPanel', 'CodePanel'
    ],
    async: true,
    type: 'ui'
  },

  factory: (deps) => {
    const { Utils, EventBus } = deps;
    const { logger } = Utils;

    const panels = {};
    let logToggleBtn = null;
    let activePanelId = 'thought-panel';
    const PANEL_STORAGE_KEY = 'reploid_active_panel';

    const init = async () => {
      logger.info('[UIManager] Initializing UI Orchestrator...');

      logToggleBtn = document.getElementById('log-toggle-btn');

      // Simplified panel map (removed broken visualizers)
      const panelMap = [
        { id: 'python-repl-panel', module: deps.PythonReplPanel },
        { id: 'local-llm-panel', module: deps.LLMConfigPanel },
        { id: 'vfs-tree', module: deps.VFSPanel },
        { id: 'performance-panel', module: deps.MetricsPanel },
        { id: 'agent-container', module: deps.ChatPanel },
        { id: 'code-panel', module: deps.CodePanel }
      ];

      for (const item of panelMap) {
        if (!item.module?.init) continue;
        try {
          await item.module.init(item.id);
          panels[item.id] = item.module;
        } catch (error) {
          logger.error(`[UIManager] Failed to initialize panel ${item.id}:`, error);
        }
      }

      setupNavigation();
      if (!restoreState()) {
        showPanel(activePanelId);
      }

      logger.info('[UIManager] UI Ready');
    };

    const setupNavigation = () => {
      if (logToggleBtn) {
        logToggleBtn.addEventListener('click', cyclePanels);
      }

      EventBus.on('panel:switch', ({ panel }) => {
        if (panel) showPanel(panel);
      });
    };

    const cyclePanels = () => {
      // Removed visualizers from cycle
      const sequence = [
        'thought-panel',
        'performance-panel',
        'introspection-panel',
        'python-repl-panel',
        'local-llm-panel'
      ];

      const currentIndex = sequence.indexOf(activePanelId);
      const nextIndex = (currentIndex + 1) % sequence.length;
      showPanel(sequence[nextIndex]);
    };

    const showPanel = (panelId) => {
      const advancedPanels = document.querySelectorAll('.advanced-panel');
      advancedPanels.forEach(panel => panel.classList.add('hidden'));

      const target = document.getElementById(panelId);
      if (target) {
        target.classList.remove('hidden');
        activePanelId = panelId;
        if (logToggleBtn) {
          logToggleBtn.textContent = `Show: ${formatPanelName(panelId)}`;
        }
        saveState();
      }
    };

    const formatPanelName = (id) => {
      return id.replace('-panel', '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    };

    const saveState = () => {
      try {
        localStorage.setItem(PANEL_STORAGE_KEY, activePanelId);
      } catch (error) {
        logger.warn('[UIManager] Failed to save panel state:', error);
      }
    };

    const restoreState = () => {
      try {
        const saved = localStorage.getItem(PANEL_STORAGE_KEY);
        if (saved) {
          showPanel(saved);
          return true;
        }
      } catch (error) {
        logger.warn('[UIManager] Failed to restore panel state:', error);
      }
      return false;
    };

    return { init };
  }
};

export default UIManager;
