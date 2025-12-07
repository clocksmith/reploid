const LLMConfigPanel = {
  metadata: {
    id: 'LLMConfigPanel',
    version: '1.0.0', // Updated to use LLMClient
    dependencies: ['Utils', 'EventBus', 'LLMClient', 'ToastNotifications?'],
    async: false,
    type: 'ui'
  },

  factory: (deps) => {
    const { Utils, EventBus, LLMClient, ToastNotifications } = deps;
    const { logger } = Utils;

    const init = async (containerId) => {
      const container = document.getElementById(containerId);
      if (!container) return;

      const statusIcon = document.getElementById('llm-status-icon');
      const statusText = document.getElementById('llm-status-text');
      const modelLabel = document.getElementById('llm-current-model');
      const loadBtn = document.getElementById('llm-load-btn');
      const modelSelect = document.getElementById('llm-model-select');

      // Update status using LLMClient
      const updateStatus = () => {
        if (!LLMClient) return;

        // Check WebLLM status via the new API
        const status = LLMClient.getWebLLMStatus ? LLMClient.getWebLLMStatus() : { loaded: false };

        if (status.loaded) {
          if (statusIcon) statusIcon.textContent = '\u{1F7E2}'; // green circle
          if (statusText) statusText.textContent = 'Ready (WebGPU)';
          if (modelLabel) modelLabel.textContent = status.model || 'Loaded';
        } else {
          if (statusIcon) statusIcon.textContent = '\u26AA'; // white circle
          if (statusText) statusText.textContent = 'Not loaded';
        }
      };

      // Check WebGPU support
      const gpuStatusEl = document.getElementById('llm-webgpu-status');
      if (gpuStatusEl && navigator.gpu) {
         gpuStatusEl.innerHTML = '\u2705 WebGPU available';
         gpuStatusEl.style.color = '#0f0';
      } else if (gpuStatusEl) {
         gpuStatusEl.textContent = '\u26A0\uFE0F WebGPU not supported in this browser';
         gpuStatusEl.style.color = '#f90';
      }

      // Load Model Handler
      if (loadBtn) {
        loadBtn.onclick = async () => {
          const modelId = modelSelect?.value;
          if (!modelId) return;

          loadBtn.disabled = true;
          loadBtn.textContent = 'Initializing...';

          try {
            // Trigger initialization via a dummy chat request or explicit init if added later
            // For now, we rely on the lazy-init in LLMClient.chat, but we can force a check
            // by sending a system prompt.
            if (ToastNotifications) ToastNotifications.info('Model will initialize on first message.');

            // Visual feedback only since LLMClient is lazy-loaded
            if (modelLabel) modelLabel.textContent = `${modelId} (Selected)`;

          } catch (error) {
            logger.error('[LLMConfigPanel] Setup failed:', error);
            if (ToastNotifications) ToastNotifications.error(error.message);
          } finally {
            loadBtn.disabled = false;
            loadBtn.textContent = 'Set Model';
          }
        };
      }

      updateStatus();
      logger.info('[LLMConfigPanel] Initialized');
    };

    return { init };
  }
};

export default LLMConfigPanel;
