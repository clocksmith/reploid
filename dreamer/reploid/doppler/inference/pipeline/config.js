/**
 * config.js - Model Configuration Parsing
 *
 * Parses and normalizes model configuration from various sources:
 * - HuggingFace config.json format
 * - GGUF metadata format
 * - llama.cpp conventions
 *
 * Handles model-specific features like:
 * - Gemma embedding scaling and RMSNorm offset
 * - GPT-OSS layer-specific attention patterns
 * - MoE routing parameters
 * - Activation function detection
 *
 * @module inference/pipeline/config
 */

/**
 * Check if model is Gemma family (includes Gemma 1, 2, 3)
 * @param {object} config - Raw model config
 * @param {object} manifest - Model manifest
 * @returns {boolean}
 */
export function isGemmaModel(config, manifest) {
  const arch = manifest?.architecture || '';
  const modelType = config?.model_type || config?.text_config?.model_type || '';
  return /gemma/i.test(arch) || /gemma/i.test(modelType);
}

/**
 * Check if model is Gemma 3+ (uses (1+weight) RMSNorm)
 * Gemma 3 uses: output = (x / rms) * (1 + weight)
 * Standard models use: output = (x / rms) * weight
 * @param {object} config - Raw model config
 * @param {object} manifest - Model manifest
 * @returns {boolean}
 */
export function isGemma3Model(config, manifest) {
  const arch = manifest?.architecture || config?.architectures?.[0] || '';
  const modelType = config?.model_type || config?.text_config?.model_type || '';

  const isGemma3 = /gemma.*3|gemma3/i.test(arch) ||
                   /gemma.*3|gemma3/i.test(modelType) ||
                   arch.includes('Gemma3');

  const result = isGemma3;
  console.log(`[DEBUG] _isGemma3Model: arch="${arch}", modelType="${modelType}", result=${result}`);
  return result;
}

/**
 * Check if model is GPT-OSS (special attention patterns)
 * @param {object} config - Raw model config
 * @param {object} manifest - Model manifest
 * @returns {boolean}
 */
export function isGptOssModel(config, manifest) {
  const arch = manifest?.architecture || '';
  const modelType = config?.model_type || '';
  return /gpt.*oss|gptoss/i.test(arch) || /gpt.*oss|gptoss/i.test(modelType);
}

/**
 * Normalize activation function name
 * Maps various naming conventions to standard names: 'silu' or 'gelu'
 * @param {string} activation - Raw activation name from config
 * @returns {string} Normalized activation: 'silu' or 'gelu'
 */
export function normalizeActivation(activation) {
  if (!activation) return 'silu';
  const lower = activation.toLowerCase();

  // Gemma 3 uses "gelu_pytorch_tanh", others might use "gelu", "gelu_new", etc.
  if (lower.includes('gelu')) return 'gelu';

  // LLaMA/Mistral use "silu" or "swish"
  if (lower.includes('silu') || lower.includes('swish')) return 'silu';

  // Default to silu (most common in modern LLMs)
  return 'silu';
}

/**
 * Get stop token IDs from config/manifest
 * @param {object} config - Raw model config
 * @param {object} manifest - Model manifest
 * @returns {number[]} Array of stop token IDs
 */
export function getStopTokenIds(config, manifest) {
  // Check manifest for eos_token_id (can be array for Gemma)
  const eosTokenId = manifest?.eos_token_id || config?.eos_token_id || config?.text_config?.eos_token_id;

  if (Array.isArray(eosTokenId)) {
    return eosTokenId; // Gemma uses [1, 106]
  }
  if (typeof eosTokenId === 'number') {
    return [eosTokenId];
  }

  // Gemma default: 1 (EOS), 106 (<end_of_turn>)
  if (isGemmaModel(config, manifest)) {
    return [1, 106];
  }

  return [];
}

/**
 * Infer attention parameters from tensor shapes
 * Used when config metadata is missing or incomplete
 * @param {object} manifest - Model manifest with tensor info
 * @param {number} hiddenSize - Known hidden size
 * @param {number} [knownNumHeads] - Known number of heads (if available)
 * @returns {object|null} {numHeads, numKVHeads, headDim} or null
 */
export function inferAttentionParams(manifest, hiddenSize, knownNumHeads = null) {
  const tensors = manifest?.tensors || {};

  // Find Q/K projection shapes to infer head dimensions
  let qShape = null, kShape = null;
  for (const [name, tensor] of Object.entries(tensors)) {
    const lower = name.toLowerCase();
    if (lower.includes('q_proj') || lower.includes('self_attn.q')) {
      qShape = tensor?.shape;
    }
    if (lower.includes('k_proj') || lower.includes('self_attn.k')) {
      kShape = tensor?.shape;
    }
    if (qShape && kShape) break;
  }

  if (!qShape || !kShape) return null;

  // Weight shapes vary by framework:
  // - PyTorch (HuggingFace): [out_features, in_features] = [numHeads * headDim, hiddenSize]
  // - GGUF: [in_features, out_features] = [hiddenSize, numHeads * headDim]
  let qOutDim, kOutDim;
  if (qShape[0] === hiddenSize) {
    // GGUF format: [in, out]
    qOutDim = qShape[1];
    kOutDim = kShape[1];
  } else {
    // PyTorch format: [out, in]
    qOutDim = qShape[0];
    kOutDim = kShape[0];
  }

  // If numHeads is known from config, compute headDim directly
  if (knownNumHeads && qOutDim % knownNumHeads === 0) {
    const headDim = qOutDim / knownNumHeads;
    if (kOutDim % headDim === 0) {
      const numKVHeads = kOutDim / headDim;
      if (numKVHeads > 0 && knownNumHeads >= numKVHeads) {
        return { numHeads: knownNumHeads, numKVHeads, headDim };
      }
    }
  }

  // Try to get headDim from q_norm weight (most reliable for Gemma-style models)
  for (const [name, tensor] of Object.entries(tensors)) {
    if ((name.includes('q_norm') || name.includes('attn_q_norm')) &&
        tensor?.shape?.length === 1) {
      const normHeadDim = tensor.shape[0];
      if (qOutDim % normHeadDim === 0 && kOutDim % normHeadDim === 0) {
        const numHeads = qOutDim / normHeadDim;
        const numKVHeads = kOutDim / normHeadDim;
        if (numHeads >= numKVHeads && numHeads > 0 && numKVHeads > 0) {
          console.log(`[Config] Inferred headDim=${normHeadDim} from q_norm.weight shape`);
          return { numHeads, numKVHeads, headDim: normHeadDim };
        }
      }
    }
  }

  // Common headDim values to try (256 first for Gemma, then LLaMA/Mistral values)
  const commonHeadDims = [256, 128, 64, 96, 80, 160];
  for (const testHeadDim of commonHeadDims) {
    if (qOutDim % testHeadDim === 0 && kOutDim % testHeadDim === 0) {
      const numHeads = qOutDim / testHeadDim;
      const numKVHeads = kOutDim / testHeadDim;
      if (numHeads >= numKVHeads && numHeads > 0 && numKVHeads > 0) {
        return { numHeads, numKVHeads, headDim: testHeadDim };
      }
    }
  }

  // Fallback: assume headDim = hiddenSize / 32 (common default)
  const fallbackHeadDim = Math.floor(hiddenSize / 32);
  if (qOutDim % fallbackHeadDim === 0 && kOutDim % fallbackHeadDim === 0) {
    return {
      numHeads: qOutDim / fallbackHeadDim,
      numKVHeads: kOutDim / fallbackHeadDim,
      headDim: fallbackHeadDim
    };
  }

  return null;
}

/**
 * Infer vocab size from embedding tensor shapes
 * @param {object} manifest - Model manifest
 * @returns {number|null} Vocab size or null
 */
export function inferVocabSize(manifest) {
  const tensors = manifest?.tensors || {};

  for (const [name, tensor] of Object.entries(tensors)) {
    const lower = name.toLowerCase();
    const isEmbedding =
      lower.includes('embed_tokens.weight') ||
      lower.endsWith('wte.weight') ||
      lower.endsWith('tok_embeddings.weight') ||
      lower.endsWith('word_embeddings.weight');
    const isLmHead =
      lower.includes('lm_head.weight') ||
      lower.endsWith('output.weight');

    if (!isEmbedding && !isLmHead) continue;

    const shape = tensor?.shape;
    if (!Array.isArray(shape) || shape.length === 0) continue;

    // Embedding shape is [vocab_size, hidden_size]
    // LM head shape is [vocab_size, hidden_size] or [hidden_size, vocab_size]
    // Take the larger dimension as vocab_size
    const vocabSize = Math.max(...shape);
    if (vocabSize > 1000) { // Sanity check
      return vocabSize;
    }
  }

  return null;
}

/**
 * Parse full model configuration from manifest
 * @param {object} manifest - Model manifest
 * @returns {object} Normalized model configuration
 */
export function parseModelConfig(manifest) {
  // Get raw config from manifest (handles nested text_config for VLMs)
  const rawConfig = manifest.config || {};
  const config = rawConfig.text_config || rawConfig;

  // Handle GGUF metadata format (camelCase fields)
  if (!config.hidden_size && config.embeddingLength) {
    config.hidden_size = config.embeddingLength;
  }
  if (!config.num_hidden_layers && config.blockCount) {
    config.num_hidden_layers = config.blockCount;
  }
  if (!config.num_attention_heads && config.attentionHeadCount) {
    config.num_attention_heads = config.attentionHeadCount;
  }
  if (!config.num_key_value_heads && config.attentionHeadCountKV) {
    config.num_key_value_heads = config.attentionHeadCountKV;
  }
  if (!config.intermediate_size && config.feedForwardLength) {
    config.intermediate_size = config.feedForwardLength;
  }
  if (!config.max_position_embeddings && config.contextLength) {
    config.max_position_embeddings = config.contextLength;
  }
  if (!config.rope_theta && config.ropeFreqBase) {
    config.rope_theta = config.ropeFreqBase;
  }
  if (!config.rms_norm_eps && config.attentionLayerNormRMSEpsilon) {
    config.rms_norm_eps = config.attentionLayerNormRMSEpsilon;
  }

  // Extract and validate main parameters
  const hiddenSize = config.hidden_size || config.n_embd || 4096;
  const intermediateSize = config.intermediate_size || config.n_inner || hiddenSize * 4;
  const numLayers = config.num_hidden_layers || config.n_layer || 32;
  let numHeads = config.num_attention_heads || config.n_head;
  let numKVHeads = config.num_key_value_heads;
  let headDim = config.head_dim;

  // Get vocab size from multiple sources
  let vocabSize = config.vocab_size;
  const configVocab = config.vocab_size;
  const tokenizerVocab = manifest.tokenizer?.vocab_size;
  const inferredVocab = inferVocabSize(manifest);

  const vocabCandidates = [];
  if (Number.isFinite(configVocab) && configVocab > 0) vocabCandidates.push(configVocab);
  if (Number.isFinite(tokenizerVocab) && tokenizerVocab > 0) vocabCandidates.push(tokenizerVocab);
  if (Number.isFinite(inferredVocab) && inferredVocab > 0) vocabCandidates.push(inferredVocab);

  vocabSize = vocabCandidates.length > 0 ? Math.max(...vocabCandidates) : 32000;

  // Infer attention params if missing
  if (!numHeads || !headDim) {
    const inferred = inferAttentionParams(manifest, hiddenSize, numHeads);
    if (inferred) {
      numHeads = numHeads || inferred.numHeads;
      numKVHeads = numKVHeads || inferred.numKVHeads;
      headDim = headDim || inferred.headDim;
      console.log(`[Config] Inferred attention params: numHeads=${numHeads}, numKVHeads=${numKVHeads}, headDim=${headDim}`);
    }
  }

  // Defaults
  numHeads = numHeads || 32;
  numKVHeads = numKVHeads || numHeads;
  headDim = headDim || Math.floor(hiddenSize / numHeads);

  // RoPE scaling
  const ropeScaling = config.rope_scaling;
  let ropeScale = 1.0;
  let ropeScalingType = null;
  if (ropeScaling && typeof ropeScaling === 'object') {
    ropeScalingType = ropeScaling.type || ropeScaling.rope_type || 'linear';
    const factor = ropeScaling.factor;
    if (Number.isFinite(factor) && factor > 0) {
      if (ropeScalingType !== 'linear') {
        console.warn(`[Config] Unsupported RoPE scaling type "${ropeScalingType}", treating as linear with factor ${factor}`);
      }
      ropeScale = factor;
    }
  }

  // MoE config
  const slidingWindow = config.sliding_window || null;
  const moeTopK = config.experts_per_token || config.num_experts_per_tok || config.top_k || 2;

  // Model type detection
  const isGemma = isGemmaModel(rawConfig, manifest);
  const isGemma3 = isGemma3Model(rawConfig, manifest);
  const isGptOss = isGptOssModel(rawConfig, manifest);

  // RMS norm epsilon (Gemma uses 1e-6, most others use 1e-5)
  const rmsNormEps = config.rms_norm_eps || (isGemma ? 1e-6 : 1e-5);

  // Activation function
  const hiddenActivation = normalizeActivation(config.hidden_activation || config.hidden_act || 'silu');

  // Layer types for GPT-OSS
  const layerTypes = Array.isArray(config.layer_types) ? config.layer_types : null;

  // Log config summary
  console.log('[Config] Parsed model config:', {
    numLayers, hiddenSize, intermediateSize, numHeads, numKVHeads, headDim, vocabSize,
    hiddenActivation, rmsNormEps, isGemma, isGemma3
  });

  return {
    // Architecture
    numLayers,
    hiddenSize,
    intermediateSize,
    numHeads,
    numKVHeads,
    headDim,
    vocabSize,
    maxSeqLen: config.max_position_embeddings || 4096,

    // MoE config
    useMoE: config.num_local_experts > 1 || config.num_experts > 1,
    numExperts: config.num_local_experts || config.num_experts || 8,
    moeTopK,

    // Optimizations
    slidingWindow,
    ropeTheta: config.rope_theta || (isGemma ? 1000000 : 10000),
    ropeScale,
    ropeScalingType,
    ropeScaling: ropeScaling && typeof ropeScaling === 'object'
      ? { ...ropeScaling, factor: ropeScale, rope_type: ropeScalingType || 'linear' }
      : null,

    // Quantization
    quantization: manifest.quantization || 'f16',
    quantMethod: config.quantization_config?.quant_method || null,

    // Normalization
    rmsNormEps,
    rmsNormWeightOffset: isGemma3,

    // Model-specific features
    scaleEmbeddings: isGemma,
    hiddenActivation,
    isGemma,
    isGemma3,
    stopTokenIds: getStopTokenIds(rawConfig, manifest),

    // GPT-OSS specific
    isGptOss,
    layerTypes,
    attentionBias: config.attention_bias || false,
  };
}
