/** Injected text execution for tests only; never claims model inference. */
import { LOCAL_DOPPLER_MODELS } from '../../self/config/doppler-local-models.js';

export function createChatTestService() {
  const calls = [], closed = [];
  return {
    calls, closed,
    async open(options) {
      calls.push(options);
      options.options?.onProgress?.({ stage: 'manifest', progress: 0.05, message: 'Parsing manifest...' });
      options.options?.onProgress?.({ stage: 'weights', progress: 0.5, message: 'Loading weights...' });
      const model = LOCAL_DOPPLER_MODELS.find(model => model.id === options.source);
      if (!model) throw new Error('Injected chat fixture requires a catalog model');
      return { loaded: true, modelId: options.source,
        manifestHash: model.identity.slice(7),
        resetGenerationState() {},
        async *stream(messages) {
        await new Promise(resolve => setTimeout(resolve, 10));
        yield { type: 'text-delta', text: 'Fixture: ' + messages.at(-1).content };
      } };
    },
    async close(scope) { closed.push(scope); }
  };
}
