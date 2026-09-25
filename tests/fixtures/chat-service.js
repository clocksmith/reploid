/** Injected text execution for tests only; never claims model inference. */
export function createChatTestService() {
  const calls = [], closed = [];
  return {
    calls, closed,
    async open(options) {
      calls.push(options);
      options.options?.onProgress?.({ stage: 'manifest', progress: 0.05, message: 'Parsing manifest...' });
      options.options?.onProgress?.({ stage: 'weights', progress: 0.5, message: 'Loading weights...' });
      return { loaded: true, modelId: options.source,
        manifestHash: '502fbd6d4c9ed6a890931665995c8ebb42a30e5cda23aa2cfd8e680bee7fa5bc',
        resetGenerationState() {},
        async *stream(messages) {
        await new Promise(resolve => setTimeout(resolve, 10));
        yield { type: 'text-delta', text: 'Fixture: ' + messages.at(-1).content };
      } };
    },
    async close(scope) { closed.push(scope); }
  };
}
