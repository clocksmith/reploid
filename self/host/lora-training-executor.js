/** One isolated Doppler training owner, shared by browser-worker and native hosts. */
export function createDopplerTrainingExecutor({ loadRuntime, modelUrl, policy, onProgress = () => {} }) {
  let loaded = null, trainer = null, busy = false, closed = false;
  return Object.freeze({
    async request(action, input, { signal } = {}) {
      if (busy || closed) throw new Error('Training executor closed or busy');
      busy = true;
      try {
        signal?.throwIfAborted();
        let result;
        if (action === 'prepare') {
          if (trainer) throw new Error('Training pipeline already prepared');
          const api = await loadRuntime(); signal?.throwIfAborted();
          loaded = await api.loadNativeQwenTrainingPipeline(modelUrl, {
            onProgress: (stage, progress, message) => onProgress(message || stage)
          }); signal?.throwIfAborted();
          trainer = api.createNativeQwenLoRATrainer({ ...policy.trainer, pipeline: loaded.pipeline,
            baseModelId: policy.modelId, layerIdx: policy.layerIdx, module: policy.module });
          const assignment = trainer.describeTrainingSample(input.participantId, input.sample);
          const probe = await trainer.createTrainingRound({ jobId: 'identity-check', roundId: '0', assignments: [assignment] });
          if (probe.baseManifestHash !== policy.baseManifestHash) throw new Error('Training base differs from the qualified model');
          result = { assignment, baseManifestHash: probe.baseManifestHash };
        } else {
          if (!trainer) throw new Error('Prepare the training pipeline first');
          switch (action) {
            case 'step': result = await trainer.trainStep(input.sample.inputIds, input.sample.targetIds, input.sample.supervisedTokenCount); break;
            case 'round': result = await trainer.createTrainingRound(input); break;
            case 'contribute': result = await trainer.computeGradientContribution(input.round, input.participantId, input.sample); break;
            case 'apply': result = await trainer.applyGradientContributions(input.round, input.contributions); break;
            case 'export': result = await trainer.exportAdapter(input); break;
            default: throw new Error('Unsupported training action');
          }
        }
        signal?.throwIfAborted(); return result;
      } finally { busy = false; }
    },
    async close() {
      if (busy) throw new Error('Training GPU work has not settled');
      closed = true;
      trainer?.dispose(); trainer = null; await loaded?.pipeline.unload(); loaded = null;
    }
  });
}
