// The scoped Doppler options used for native qualification and every reverse-prompt attempt.
export const REVERSE_PROMPT_GENERATION = Object.freeze({
  maxTokens: 16, temperature: 0, topK: 1, topP: 1,
  repetitionPenalty: 1.1, repetitionPenaltyWindow: 0, presencePenalty: 0,
  stopSequences: Object.freeze([]), useSpeculative: false, useChatTemplate: true
});

// Doppler's resolved sampler evidence from the pinned model, including suppression settings.
export const REVERSE_PROMPT_GENERATION_HASH = 'sha256:3e4d8e8edde6ca0f22a88af0da37d18b7372633ae032dd3c7b64e4811d23b2d3';

export function hasReversePromptTemplate(manifest) {
  const { chatTemplate, output } = manifest?.inference ?? {};
  return chatTemplate?.enabled === true && chatTemplate.type === 'qwen' && chatTemplate.thinking === false
    && output?.reasoningOutput == null;
}
