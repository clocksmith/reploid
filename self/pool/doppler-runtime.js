/**
 * @fileoverview Browser-only Doppler runtime adapter for pool providers.
 */

export function createDopplerRuntime({ modelSession = null, model = null, runtime = null } = {}) {
  let session = modelSession;
  let modelInfo = model;
  let runtimeInfo = runtime || {
    runtime: 'doppler',
    backend: 'browser-webgpu'
  };

  return {
    async loadModel(nextModel, nextSession) {
      modelInfo = nextModel;
      session = nextSession || session;
      if (!session) {
        return {
          ok: false,
          reason: 'Doppler model session not connected'
        };
      }
      return { ok: true, model: modelInfo };
    },
    getModelInfo() {
      return modelInfo;
    },
    getRuntimeInfo() {
      return runtimeInfo;
    },
    async generate({ prompt, generationConfig, assignment }) {
      if (!session || typeof session.generate !== 'function') {
        throw new Error('Doppler browser model session is not connected');
      }
      const startedAt = new Date().toISOString();
      const result = await session.generate({ prompt, generationConfig, assignment });
      const completedAt = new Date().toISOString();
      const outputText = String(result?.outputText ?? result?.text ?? result?.content ?? '');
      const tokenIds = Array.isArray(result?.tokenIds) ? result.tokenIds : [];
      return {
        outputText,
        tokenIds,
        transcript: result?.transcript || { outputText, tokenIds },
        tokenCounts: result?.tokenCounts || { input: 0, output: tokenIds.length },
        timing: { startedAt, completedAt },
        dopplerProviderReceipt: result?.receipt || null,
        status: 'completed'
      };
    }
  };
}

export default {
  createDopplerRuntime
};
