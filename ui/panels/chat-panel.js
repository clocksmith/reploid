const ChatPanel = {
  metadata: {
    id: 'ChatPanel',
    version: '1.0.0',
    dependencies: ['Utils', 'ChatUI?'],
    async: false,
    type: 'ui'
  },

  factory: (deps) => {
    const { Utils } = deps;
    const { logger } = Utils;

    const init = (containerId) => {
      const container = document.getElementById(containerId);
      if (!container) return;
      logger.info('[ChatPanel] Ready (layout only)');
    };

    return { init };
  }
};

export default ChatPanel;
