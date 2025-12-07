const VFSPanel = {
  metadata: {
    id: 'VFSPanel',
    version: '1.0.0',
    dependencies: ['Utils', 'VFSExplorer'],
    async: false,
    type: 'ui'
  },

  factory: (deps) => {
    const { Utils, VFSExplorer } = deps;
    const { logger } = Utils;

    const init = async (containerId) => {
      const container = document.getElementById(containerId);
      if (!container) return;

      if (!VFSExplorer?.init) {
        container.innerHTML = '<div class="error">VFS Explorer unavailable</div>';
        return;
      }

      try {
        await VFSExplorer.init(containerId);
        logger.info('[VFSPanel] Explorer initialized');
      } catch (error) {
        logger.error('[VFSPanel] Initialization failed:', error);
        container.innerHTML = '<div class="error">Failed to load VFS Explorer</div>';
      }
    };

    return { init };
  }
};

export default VFSPanel;
