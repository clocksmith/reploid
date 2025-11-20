const CodePanel = {
  metadata: {
    id: 'CodePanel',
    version: '1.0.0',
    dependencies: ['Utils', 'CodeViewer?'],
    async: false,
    type: 'ui'
  },

  factory: (deps) => {
    const { Utils, CodeViewer } = deps;
    const { logger } = Utils;

    const init = (containerId) => {
      const container = document.getElementById(containerId);
      if (!container) return;

      if (CodeViewer?.init) {
        CodeViewer.init(containerId);
      }

      logger.info('[CodePanel] Initialized');
    };

    return { init };
  }
};

export default CodePanel;
