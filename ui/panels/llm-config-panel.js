const LLMConfigPanel = {
  metadata: {
    id: 'LLMConfigPanel',
    version: '1.0.0',
    dependencies: ['Utils', 'EventBus', 'LocalLLM', 'ToastNotifications?'],
    async: false,
    type: 'ui'
  },

  factory: (deps) => {
    const { Utils, EventBus, LocalLLM, ToastNotifications } = deps;
    const { logger } = Utils;

    const init = async (containerId) => {
      const container = document.getElementById(containerId);
      if (!container) return;

      const statusIcon = document.getElementById('llm-status-icon');
      const statusText = document.getElementById('llm-status-text');
      const modelLabel = document.getElementById('llm-current-model');

      const updateStatus = () => {
        if (!LocalLLM) return;
        const status = LocalLLM.getStatus?.() || {};

        if (status.error) {
          if (statusIcon) statusIcon.textContent = '🔴';
          if (statusText) statusText.textContent = `Error: ${status.error}`;
        } else if (status.ready) {
          if (statusIcon) statusIcon.textContent = '🟢';
          if (statusText) statusText.textContent = 'Ready';
          if (modelLabel) modelLabel.textContent = status.model || 'Unknown';
        } else if (status.loading) {
          if (statusIcon) statusIcon.textContent = '🟡';
          if (statusText) statusText.textContent = 'Loading...';
        } else {
          if (statusIcon) statusIcon.textContent = '⚪';
          if (statusText) statusText.textContent = 'Not loaded';
        }
      };

      if (LocalLLM?.checkWebGPU) {
        const gpuStatusEl = document.getElementById('llm-webgpu-status');
        try {
          const gpuCheck = await LocalLLM.checkWebGPU();
          if (gpuStatusEl) {
            gpuStatusEl.innerHTML = gpuCheck.available
              ? `✅ WebGPU available (${gpuCheck.info?.vendor || 'Unknown'})`
              : `❌ WebGPU not available: ${gpuCheck.error}`;
            gpuStatusEl.style.color = gpuCheck.available ? '#0f0' : '#f00';
          }
        } catch (err) {
          if (gpuStatusEl) {
            gpuStatusEl.textContent = `⚠️ WebGPU check failed: ${err.message}`;
            gpuStatusEl.style.color = '#f90';
          }
        }
      }

      EventBus.on('local-llm:ready', updateStatus);
      EventBus.on('local-llm:error', updateStatus);
      EventBus.on('local-llm:progress', (data) => {
        const fill = document.getElementById('llm-progress-fill');
        const text = document.getElementById('llm-progress-text');
        if (fill) fill.style.width = `${(data.progress * 100).toFixed(1)}%`;
        if (text) text.textContent = data.text || `${(data.progress * 100).toFixed(1)}%`;
      });

      const loadBtn = document.getElementById('llm-load-btn');
      const modelSelect = document.getElementById('llm-model-select');

      if (loadBtn) {
        loadBtn.onclick = async () => {
          const modelId = modelSelect?.value;
          if (!modelId) return;

          loadBtn.disabled = true;
          loadBtn.textContent = 'Loading...';
          try {
            await LocalLLM.init(modelId);
            if (ToastNotifications) ToastNotifications.success('Model loaded successfully');
          } catch (error) {
            logger.error('[LLMConfigPanel] Model load failed:', error);
            if (ToastNotifications) ToastNotifications.error(error.message || 'Model load failed');
          } finally {
            loadBtn.disabled = false;
            loadBtn.textContent = 'Load Model';
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
