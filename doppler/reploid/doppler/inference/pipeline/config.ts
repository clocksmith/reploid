/**
 * Model configuration parsing and normalization.
 * Handles HuggingFace, GGUF, and llama.cpp config formats.
 */

export type ActivationType = 'silu' | 'gelu';

export interface RawConfig {
  model_type?: string;
  text_config?: RawConfig;
  architectures?: string[];
  hidden_size?: number;
  n_embd?: number;
  embeddingLength?: number;
  num_hidden_layers?: number;
  n_layer?: number;
  blockCount?: number;
  num_attention_heads?: number;
  n_head?: number;
  attentionHeadCount?: number;
  num_key_value_heads?: number;
  attentionHeadCountKV?: number;
  head_dim?: number;
  intermediate_size?: number;
  n_inner?: number;
  feedForwardLength?: number;
  vocab_size?: number;
  max_position_embeddings?: number;
  contextLength?: number;
  rope_theta?: number;
  ropeFreqBase?: number;
  rms_norm_eps?: number;
  attentionLayerNormRMSEpsilon?: number;
  hidden_activation?: string;
  hidden_act?: string;
  eos_token_id?: number | number[];
  rope_scaling?: RopeScalingConfig;
  sliding_window?: number;
  num_local_experts?: number;
  num_experts?: number;
  experts_per_token?: number;
  num_experts_per_tok?: number;
  top_k?: number;
  layer_types?: string[];
  attention_bias?: boolean;
  quantization_config?: { quant_method?: string };
}

export interface RopeScalingConfig {
  type?: string;
  rope_type?: string;
  factor?: number;
  beta_fast?: number;
  beta_slow?: number;
  original_max_position_embeddings?: number;
}

export interface TensorInfo {
  shape?: number[];
  dtype?: string;
}

export interface Manifest {
  architecture?: string;
  config?: RawConfig;
  tensors?: Record<string, TensorInfo>;
  tokenizer?: { vocab_size?: number };
  quantization?: string;
  eos_token_id?: number | number[];
  modelId?: string;
  model_id?: string;
  name?: string;
}

export interface AttentionParams {
  numHeads: number;
  numKVHeads: number;
  headDim: number;
}

export interface ParsedModelConfig {
  numLayers: number;
  hiddenSize: number;
  intermediateSize: number;
  numHeads: number;
  numKVHeads: number;
  headDim: number;
  vocabSize: number;
  maxSeqLen: number;
  useMoE: boolean;
  numExperts: number;
  moeTopK: number;
  slidingWindow: number | null;
  ropeTheta: number;
  ropeScale: number;
  ropeScalingType: string | null;
  ropeScaling: RopeScalingConfig | null;
  quantization: string;
  quantMethod: string | null;
  rmsNormEps: number;
  rmsNormWeightOffset: boolean;
  scaleEmbeddings: boolean;
  hiddenActivation: ActivationType;
  isGemma: boolean;
  isGemma3: boolean;
  stopTokenIds: number[];
  isGptOss: boolean;
  layerTypes: string[] | null;
  attentionBias: boolean;
  embeddingScale?: number;
}

export function isGemmaModel(config: RawConfig, manifest: Manifest): boolean {
  const arch = manifest?.architecture ?? '';
  const modelType = config?.model_type ?? config?.text_config?.model_type ?? '';
  return /gemma/i.test(arch) || /gemma/i.test(modelType);
}

export function isGemma3Model(config: RawConfig, manifest: Manifest): boolean {
  const arch = manifest?.architecture ?? config?.architectures?.[0] ?? '';
  const modelType = config?.model_type ?? config?.text_config?.model_type ?? '';
  return /gemma.*3|gemma3/i.test(arch) || /gemma.*3|gemma3/i.test(modelType) || arch.includes('Gemma3');
}

export function isGptOssModel(config: RawConfig, manifest: Manifest): boolean {
  const arch = manifest?.architecture ?? '';
  const modelType = config?.model_type ?? '';
  return /gpt.*oss|gptoss/i.test(arch) || /gpt.*oss|gptoss/i.test(modelType);
}

export function normalizeActivation(activation: string | undefined): ActivationType {
  if (!activation) return 'silu';
  const lower = activation.toLowerCase();
  if (lower.includes('gelu')) return 'gelu';
  if (lower.includes('silu') || lower.includes('swish')) return 'silu';
  return 'silu';
}

export function getStopTokenIds(config: RawConfig, manifest: Manifest): number[] {
  const eosTokenId = manifest?.eos_token_id ?? config?.eos_token_id ?? config?.text_config?.eos_token_id;

  if (Array.isArray(eosTokenId)) return eosTokenId;
  if (typeof eosTokenId === 'number') return [eosTokenId];
  if (isGemmaModel(config, manifest)) return [1, 106];
  return [];
}

export function inferAttentionParams(
  manifest: Manifest,
  hiddenSize: number,
  knownNumHeads: number | null = null
): AttentionParams | null {
  const tensors = manifest?.tensors ?? {};

  let qShape: number[] | undefined;
  let kShape: number[] | undefined;

  for (const [name, tensor] of Object.entries(tensors)) {
    const lower = name.toLowerCase();
    if (lower.includes('q_proj') || lower.includes('self_attn.q')) qShape = tensor?.shape;
    if (lower.includes('k_proj') || lower.includes('self_attn.k')) kShape = tensor?.shape;
    if (qShape && kShape) break;
  }

  if (!qShape || !kShape) return null;

  const qOutDim = qShape[0] === hiddenSize ? qShape[1] : qShape[0];
  const kOutDim = kShape[0] === hiddenSize ? kShape[1] : kShape[0];

  if (knownNumHeads && qOutDim % knownNumHeads === 0) {
    const headDim = qOutDim / knownNumHeads;
    if (kOutDim % headDim === 0) {
      const numKVHeads = kOutDim / headDim;
      if (numKVHeads > 0 && knownNumHeads >= numKVHeads) {
        return { numHeads: knownNumHeads, numKVHeads, headDim };
      }
    }
  }

  // Try q_norm weight for headDim
  for (const [name, tensor] of Object.entries(tensors)) {
    if ((name.includes('q_norm') || name.includes('attn_q_norm')) && tensor?.shape?.length === 1) {
      const normHeadDim = tensor.shape[0];
      if (qOutDim % normHeadDim === 0 && kOutDim % normHeadDim === 0) {
        const numHeads = qOutDim / normHeadDim;
        const numKVHeads = kOutDim / normHeadDim;
        if (numHeads >= numKVHeads && numHeads > 0 && numKVHeads > 0) {
          return { numHeads, numKVHeads, headDim: normHeadDim };
        }
      }
    }
  }

  // Try common headDim values
  for (const testHeadDim of [256, 128, 64, 96, 80, 160]) {
    if (qOutDim % testHeadDim === 0 && kOutDim % testHeadDim === 0) {
      const numHeads = qOutDim / testHeadDim;
      const numKVHeads = kOutDim / testHeadDim;
      if (numHeads >= numKVHeads && numHeads > 0 && numKVHeads > 0) {
        return { numHeads, numKVHeads, headDim: testHeadDim };
      }
    }
  }

  // Fallback
  const fallbackHeadDim = Math.floor(hiddenSize / 32);
  if (qOutDim % fallbackHeadDim === 0 && kOutDim % fallbackHeadDim === 0) {
    return {
      numHeads: qOutDim / fallbackHeadDim,
      numKVHeads: kOutDim / fallbackHeadDim,
      headDim: fallbackHeadDim,
    };
  }

  return null;
}

export function inferVocabSize(manifest: Manifest): number | null {
  const tensors = manifest?.tensors ?? {};

  for (const [name, tensor] of Object.entries(tensors)) {
    const lower = name.toLowerCase();
    const isEmbedding =
      lower.includes('embed_tokens.weight') ||
      lower.endsWith('wte.weight') ||
      lower.endsWith('tok_embeddings.weight') ||
      lower.endsWith('word_embeddings.weight');
    const isLmHead = lower.includes('lm_head.weight') || lower.endsWith('output.weight');

    if (!isEmbedding && !isLmHead) continue;

    const shape = tensor?.shape;
    if (!Array.isArray(shape) || shape.length === 0) continue;

    const vocabSize = Math.max(...shape);
    if (vocabSize > 1000) return vocabSize;
  }

  return null;
}

export function parseModelConfig(manifest: Manifest): ParsedModelConfig {
  const rawConfig = manifest.config ?? {};
  const config: RawConfig = rawConfig.text_config ?? rawConfig;

  // Normalize GGUF camelCase to snake_case
  const hiddenSize = config.hidden_size ?? config.n_embd ?? config.embeddingLength ?? 4096;
  const numLayers = config.num_hidden_layers ?? config.n_layer ?? config.blockCount ?? 32;
  const intermediateSize = config.intermediate_size ?? config.n_inner ?? config.feedForwardLength ?? hiddenSize * 4;

  let numHeads = config.num_attention_heads ?? config.n_head ?? config.attentionHeadCount;
  let numKVHeads = config.num_key_value_heads ?? config.attentionHeadCountKV;
  let headDim = config.head_dim;

  // Vocab size from multiple sources
  const vocabCandidates: number[] = [];
  if (config.vocab_size && config.vocab_size > 0) vocabCandidates.push(config.vocab_size);
  if (manifest.tokenizer?.vocab_size) vocabCandidates.push(manifest.tokenizer.vocab_size);
  const inferredVocab = inferVocabSize(manifest);
  if (inferredVocab) vocabCandidates.push(inferredVocab);
  const vocabSize = vocabCandidates.length > 0 ? Math.max(...vocabCandidates) : 32000;

  // Infer attention params if missing
  if (!numHeads || !headDim) {
    const inferred = inferAttentionParams(manifest, hiddenSize, numHeads ?? null);
    if (inferred) {
      numHeads = numHeads ?? inferred.numHeads;
      numKVHeads = numKVHeads ?? inferred.numKVHeads;
      headDim = headDim ?? inferred.headDim;
    }
  }

  numHeads = numHeads ?? 32;
  numKVHeads = numKVHeads ?? numHeads;
  headDim = headDim ?? Math.floor(hiddenSize / numHeads);

  // RoPE scaling
  const ropeScaling = config.rope_scaling;
  let ropeScale = 1.0;
  let ropeScalingType: string | null = null;
  if (ropeScaling && typeof ropeScaling === 'object') {
    ropeScalingType = ropeScaling.type ?? ropeScaling.rope_type ?? 'linear';
    const factor = ropeScaling.factor;
    if (factor && factor > 0) ropeScale = factor;
  }

  const isGemma = isGemmaModel(rawConfig, manifest);
  const isGemma3 = isGemma3Model(rawConfig, manifest);
  const isGptOss = isGptOssModel(rawConfig, manifest);

  const rmsNormEps = config.rms_norm_eps ?? config.attentionLayerNormRMSEpsilon ?? (isGemma ? 1e-6 : 1e-5);
  const hiddenActivation = normalizeActivation(config.hidden_activation ?? config.hidden_act);
  const moeTopK = config.experts_per_token ?? config.num_experts_per_tok ?? config.top_k ?? 2;

  return {
    numLayers,
    hiddenSize,
    intermediateSize,
    numHeads,
    numKVHeads,
    headDim,
    vocabSize,
    maxSeqLen: config.max_position_embeddings ?? config.contextLength ?? 4096,
    useMoE: (config.num_local_experts ?? 0) > 1 || (config.num_experts ?? 0) > 1,
    numExperts: config.num_local_experts ?? config.num_experts ?? 8,
    moeTopK,
    slidingWindow: config.sliding_window ?? null,
    ropeTheta: config.rope_theta ?? config.ropeFreqBase ?? (isGemma ? 1000000 : 10000),
    ropeScale,
    ropeScalingType,
    ropeScaling: ropeScaling ? { ...ropeScaling, factor: ropeScale } : null,
    quantization: (manifest.quantization as string) ?? 'f16',
    quantMethod: config.quantization_config?.quant_method ?? null,
    rmsNormEps,
    rmsNormWeightOffset: isGemma3,
    scaleEmbeddings: isGemma,
    hiddenActivation,
    isGemma,
    isGemma3,
    stopTokenIds: getStopTokenIds(rawConfig, manifest),
    isGptOss,
    layerTypes: Array.isArray(config.layer_types) ? config.layer_types : null,
    attentionBias: config.attention_bias ?? false,
  };
}
