/**
 * Pipeline Module Index
 *
 * Re-exports all pipeline sub-modules for easier importing.
 *
 * Usage:
 *   import { sample, softmax, parseModelConfig } from './pipeline/index.js';
 *
 * Or import specific modules:
 *   import { sample } from './pipeline/sampling.js';
 *
 * @module inference/pipeline
 */

// Configuration parsing
export {
  parseModelConfig,
  isGemmaModel,
  isGemma3Model,
  isGptOssModel,
  normalizeActivation,
  getStopTokenIds,
  inferAttentionParams,
  inferVocabSize,
} from './config.js';

// Sampling
export {
  sample,
  softmax,
  applyRepetitionPenalty,
  getTopK,
  logitsSanity,
} from './sampling.js';

// Embedding
export {
  embed,
  scaleGPUBuffer,
  validateEmbedding,
} from './embed.js';

// Future modules (to be implemented):
// - attention.js: Attention block operations
// - ffn.js: Feed-forward network operations
// - logits.js: Final logits computation
// - layer.js: Layer processing orchestration
// - generate.js: Token generation loop
