/** Worker isolation keeps training separate from the chat pipeline and adapter state. */
import { createDopplerTrainingExecutor } from './lora-training-executor.js';
import policy from '../config/lora-training.json' with { type: 'json' };
import { DOPPLER_TRAINING_URL } from '../../../shared/config/doppler-local-models.js';
const controller = new AbortController();
const executor = createDopplerTrainingExecutor({ policy,
  modelUrl: new URL(policy.modelPath, self.location.origin).href,
  loadRuntime: () => import(DOPPLER_TRAINING_URL),
  onProgress: progress => self.postMessage({ progress }) });
self.addEventListener('message', async ({ data }) => {
  if (data.action === 'cancel') { controller.abort(new Error('Training stopped')); return; }
  try {
    const result = data.action === 'close' ? await executor.close()
      : await executor.request(data.action, data.input, { signal: controller.signal });
    self.postMessage({ id: data.id, result });
  } catch (error) { self.postMessage({ id: data.id, error: error.message }); }
});
