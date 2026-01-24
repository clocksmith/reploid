/**
 * @fileoverview Intent Bundle LoRA workflow shim.
 */

const IntentBundleLoRA = {
  metadata: {
    id: 'IntentBundleLoRA',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'NeuralCompiler', 'EventBus?'],
    async: true,
    type: 'capability'
  },

  factory: (deps) => {
    const { Utils, NeuralCompiler, EventBus } = deps;
    const { logger } = Utils;

    const DEFAULT_BUNDLE_PATH = '/.system/intent-bundle.json';

    const emit = (event, payload) => {
      if (EventBus) {
        EventBus.emit(event, payload);
      }
    };

    const applyIntentBundle = async (bundleOrPath = DEFAULT_BUNDLE_PATH, options = {}) => {
      if (!NeuralCompiler?.applyIntentBundle) {
        const reason = 'NeuralCompiler not available';
        logger.warn('[IntentBundleLoRA] ' + reason);
        emit('intent-bundle:lora:missing', { reason });
        return {
          status: 'unavailable',
          approved: false,
          stub: true,
          reason
        };
      }

      return NeuralCompiler.applyIntentBundle(bundleOrPath, options);
    };

    return {
      applyIntentBundle
    };
  }
};

export default IntentBundleLoRA;
