/**
 * Pipeline initialization - model loading, tokenizer setup, KV cache, RoPE.
 *
 * This module handles all initialization tasks for the inference pipeline:
 * - Loading model manifest and parsing configuration
 * - Initializing tokenizer
 * - Setting up KV cache (standard or sliding window)
 * - Computing RoPE frequency buffers (linear or YARN scaling)
 * - Loading model weights via DopplerLoader
 * - Setting up MoE router if applicable
 *
 * @module inference/pipeline/init
 */

import type { ParsedModelConfig, Manifest } from './config.js';
import { parseModelConfig } from './config.js';
import { getDevice, getKernelCapabilities } from '../../gpu/device.js';
import { acquireBuffer } from '../../gpu/buffer-pool.js';
import { KVCache, SlidingWindowKVCache } from '../kv-cache.js';
import { Tokenizer } from '../tokenizer.js';
import { MoERouter } from '../moe-router.js';
import { SpeculativeDecoder } from '../speculative.js';
import { getDopplerLoader } from '../../loader/doppler-loader.js';
import { log, setGPUDevice } from '../../debug/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * External contexts that can be injected into the pipeline.
 */
export interface PipelineContexts {
  /** GPU context (device, capabilities) */
  gpu?: { device?: GPUDevice; capabilities?: any };
  /** Memory context for allocation */
  memory?: Record<string, unknown>;
  /** Storage context for custom shard loading */
  storage?: {
    loadShard?: (index: number) => Promise<ArrayBuffer | Uint8Array>;
  };
  /** Base URL for loading model files */
  baseUrl?: string;
  /** Runtime configuration overrides */
  runtime?: {
    attentionKernel?: string;
    debug?: boolean;
  };
  /** Progress callback for weight loading */
  onProgress?: (progress: { percent: number; message?: string }) => void;
}

/**
 * RoPE configuration.
 */
export interface RoPEConfig {
  headDim: number;
  maxSeqLen: number;
  ropeTheta: number;
  ropeScale?: number;
  ropeScalingType?: string;
  ropeScaling?: {
    factor?: number;
    beta_fast?: number;
    beta_slow?: number;
    original_max_position_embeddings?: number;
  };
}

/**
 * RoPE frequency buffers.
 */
export interface RoPEBuffers {
  cos: GPUBuffer | Float32Array;
  sin: GPUBuffer | Float32Array;
}

/**
 * KV cache configuration.
 */
export interface KVCacheConfig {
  numLayers: number;
  numHeads: number;
  headDim: number;
  maxSeqLen: number;
  useGPU: boolean;
  layout: 'contiguous' | 'paged';
  kvDtype: 'f16' | 'f32';
  slidingWindow?: number;
}

// ============================================================================
// Attention Kernel Normalization
// ============================================================================

/**
 * Normalize attention kernel specifier to a valid kernel name.
 *
 * @param value - Raw kernel specifier (from manifest or runtime)
 * @returns Normalized kernel name or null for auto-selection
 */
export function normalizeAttentionKernel(
  value: string | null | undefined
): 'tiled_large' | 'tiled_small' | 'streaming' | null {
  if (!value || typeof value !== 'string') return null;

  const v = value.toLowerCase().trim();
  if (v === 'auto') return null;
  if (v === 'tiled_large' || v === 'large') return 'tiled_large';
  if (v === 'tiled_small' || v === 'small' || v === 'tiled_small_hd') return 'tiled_small';
  if (v === 'streaming' || v === 'stream') return 'streaming';

  log.warn('Pipeline', `Unknown attentionKernel "${value}", using auto`);
  return null;
}

// ============================================================================
// RoPE Initialization
// ============================================================================

/**
 * Initialize RoPE (Rotary Position Embedding) frequency buffers.
 *
 * Supports two scaling modes:
 * - Linear: Uniform scaling across all dimensions
 * - YARN (Yet Another RoPE eNhancement): Per-dimension scaling based on wavelength
 *
 * @param config - RoPE configuration
 * @param useGPU - Whether to upload to GPU
 * @returns RoPE frequency buffers (cos and sin)
 */
export async function initRoPEFrequencies(
  config: RoPEConfig,
  useGPU: boolean
): Promise<RoPEBuffers> {
  const {
    headDim,
    maxSeqLen,
    ropeTheta,
    ropeScale = 1.0,
    ropeScalingType,
    ropeScaling,
  } = config;

  const halfDim = headDim / 2;

  // YARN scaling parameters
  const isYarn = ropeScalingType === 'yarn';
  const yarnFactor = ropeScaling?.factor || ropeScale;
  const yarnBetaFast = ropeScaling?.beta_fast || 32;
  const yarnBetaSlow = ropeScaling?.beta_slow || 1;
  const originalMaxPos = ropeScaling?.original_max_position_embeddings || 4096;

  // Compute base frequencies: theta_i = 1 / (base^(2i/d))
  const freqs = new Float32Array(halfDim);
  for (let i = 0; i < halfDim; i++) {
    freqs[i] = 1.0 / Math.pow(ropeTheta, (2 * i) / headDim);
  }

  // Compute per-dimension scaling factors
  const scales = new Float32Array(halfDim);
  if (isYarn) {
    // YARN: wavelength-based interpolation
    for (let i = 0; i < halfDim; i++) {
      const wavelength = (2 * Math.PI) / freqs[i];
      const lowThresh = originalMaxPos / yarnBetaSlow;
      const highThresh = originalMaxPos / yarnBetaFast;

      if (wavelength < highThresh) {
        // High frequency -> extrapolation (no scaling)
        scales[i] = 1.0;
      } else if (wavelength > lowThresh) {
        // Low frequency -> full interpolation
        scales[i] = yarnFactor;
      } else {
        // Smooth transition region
        const t = (wavelength - highThresh) / (lowThresh - highThresh);
        scales[i] = 1.0 + (yarnFactor - 1.0) * t;
      }
    }
    console.log(
      `[Pipeline] YARN RoPE: factor=${yarnFactor}, beta_fast=${yarnBetaFast}, beta_slow=${yarnBetaSlow}`
    );
  } else {
    // Linear scaling: uniform across all dimensions
    for (let i = 0; i < halfDim; i++) {
      scales[i] = ropeScale;
    }
  }

  // Compute cos/sin for each position
  const cosValues = new Float32Array(maxSeqLen * halfDim);
  const sinValues = new Float32Array(maxSeqLen * halfDim);

  for (let pos = 0; pos < maxSeqLen; pos++) {
    for (let i = 0; i < halfDim; i++) {
      const scaledPos = pos / scales[i];
      const angle = scaledPos * freqs[i];
      cosValues[pos * halfDim + i] = Math.cos(angle);
      sinValues[pos * halfDim + i] = Math.sin(angle);
    }
  }

  // Upload to GPU if available
  const device = getDevice();
  if (device && useGPU) {
    const cosBuffer = acquireBuffer(cosValues.byteLength, undefined, 'rope_cos');
    const sinBuffer = acquireBuffer(sinValues.byteLength, undefined, 'rope_sin');
    device.queue.writeBuffer(cosBuffer, 0, cosValues);
    device.queue.writeBuffer(sinBuffer, 0, sinValues);

    console.log(
      `[Pipeline] RoPE frequencies initialized (GPU): ${maxSeqLen} positions, dim=${halfDim}, ` +
      `headDim=${headDim}, theta=${ropeTheta}, scaling=${isYarn ? 'yarn' : 'linear'}`
    );

    return { cos: cosBuffer, sin: sinBuffer };
  }

  console.log(
    `[Pipeline] RoPE frequencies initialized (CPU): ${maxSeqLen} positions, dim=${halfDim}, ` +
    `headDim=${headDim}, theta=${ropeTheta}, scaling=${isYarn ? 'yarn' : 'linear'}`
  );

  return { cos: cosValues, sin: sinValues };
}

// ============================================================================
// KV Cache Setup
// ============================================================================

/**
 * Create and configure KV cache based on model configuration.
 *
 * @param modelConfig - Parsed model configuration
 * @param useGPU - Whether GPU is available
 * @param debug - Debug mode flag
 * @returns Configured KV cache instance
 */
export function createKVCache(
  modelConfig: ParsedModelConfig,
  useGPU: boolean,
  debug: boolean = false
): KVCache | SlidingWindowKVCache {
  const modelMaxSeqLen = modelConfig.maxSeqLen || 4096;
  const slidingWindow = Number(modelConfig.slidingWindow || 0) || null;

  let cacheMaxSeqLen = modelMaxSeqLen;
  let cacheLayout: 'contiguous' | 'paged' = cacheMaxSeqLen > 8192 ? 'paged' : 'contiguous';

  // Sliding-window attention only needs a bounded KV cache
  if (slidingWindow && Number.isFinite(slidingWindow) && slidingWindow > 0) {
    cacheMaxSeqLen = Math.min(modelMaxSeqLen, slidingWindow);
    cacheLayout = 'contiguous';
  }

  // GPU paged KV cache is not implemented yet
  if (useGPU && cacheLayout === 'paged') {
    const FALLBACK_MAX_SEQ = 4096;
    cacheMaxSeqLen = Math.min(modelMaxSeqLen, FALLBACK_MAX_SEQ);
    cacheLayout = 'contiguous';
    console.warn(
      `[Pipeline] Paged GPU KV cache not supported. Capping KV cache to ${cacheMaxSeqLen} tokens.`
    );
  }

  // Use f16 KV cache when supported to reduce VRAM
  const gpuCaps = getKernelCapabilities();
  const kvDtype: 'f16' | 'f32' = useGPU && gpuCaps.hasF16 ? 'f16' : 'f32';

  const cacheConfig: KVCacheConfig = {
    numLayers: modelConfig.numLayers,
    numHeads: modelConfig.numKVHeads || modelConfig.numHeads,
    headDim: modelConfig.headDim,
    maxSeqLen: cacheMaxSeqLen,
    useGPU,
    layout: cacheLayout,
    kvDtype,
  };

  let kvCache: KVCache | SlidingWindowKVCache;

  if (modelConfig.slidingWindow) {
    kvCache = new SlidingWindowKVCache({
      ...cacheConfig,
      windowSize: modelConfig.slidingWindow,
    });
  } else {
    kvCache = new KVCache(cacheConfig);
  }

  if (debug) {
    console.log('[Pipeline] KV cache:', {
      type: kvCache?.constructor?.name || 'unknown',
      kvDtype: (kvCache as any)?.kvDtype,
      layout: (kvCache as any)?.layout,
      maxSeqLen: (kvCache as any)?.maxSeqLen,
      windowSize: (kvCache as any)?.windowSize || null,
    });
  }

  return kvCache;
}

// ============================================================================
// Tokenizer Setup
// ============================================================================

/**
 * Initialize tokenizer from manifest.
 *
 * @param manifest - Model manifest
 * @param baseUrl - Base URL for loading tokenizer.json
 * @returns Initialized tokenizer
 */
export async function initTokenizer(
  manifest: Manifest,
  baseUrl?: string
): Promise<Tokenizer> {
  const tokenizer = new Tokenizer();
  await tokenizer.initialize(manifest as any, { baseUrl });
  return tokenizer;
}

// ============================================================================
// Weight Loading
// ============================================================================

/**
 * Weight loading result.
 */
export interface WeightLoadResult {
  /** Layer weights map (layer_0, layer_1, etc.) */
  layerWeights: Map<string, any>;
  /** Embedding buffer */
  embeddings: GPUBuffer | Float32Array | null;
  /** LM head buffer */
  lmHead: GPUBuffer | Float32Array | null;
  /** Final norm buffer */
  finalNorm: GPUBuffer | Float32Array | null;
  /** Whether embeddings are tied to LM head */
  useTiedEmbeddings: boolean;
  /** Vocab size from embedding tensor (may differ from tokenizer) */
  embeddingVocabSize: number | null;
  /** Per-layer router weights for MoE */
  layerRouterWeights: Map<number, { weight: any; bias: any }>;
}

/** Options for loadWeights */
export interface LoadWeightsOptions {
  /** Custom storage context for shard loading */
  storageContext?: { loadShard?: (shardIdx: number) => Promise<ArrayBuffer> };
  /** Progress callback */
  onProgress?: (info: { stage: string; progress: number }) => void;
  /**
   * Verify shard hashes before loading. Defaults to false since verification
   * happens during download. Enable for extra safety when loading from untrusted sources.
   */
  verifyHashes?: boolean;
}

/**
 * Load model weights via DopplerLoader.
 *
 * @param manifest - Model manifest
 * @param modelConfig - Parsed model configuration
 * @param options - Load options
 * @returns Loaded weights
 */
export async function loadWeights(
  manifest: Manifest,
  modelConfig: ParsedModelConfig,
  options: LoadWeightsOptions = {}
): Promise<WeightLoadResult> {
  const { storageContext, onProgress, verifyHashes = false } = options;

  const dopplerLoader = getDopplerLoader();
  await dopplerLoader.init();

  // Configure custom shard loader if provided (Native Bridge)
  if (storageContext?.loadShard) {
    console.log('[Pipeline] Using custom shard loader (Native Bridge or external)');
    dopplerLoader.setCustomShardLoader(storageContext.loadShard as any, {
      verify: true,
    });
    dopplerLoader.setManifest(manifest as any);
  }

  // Load model via DopplerLoader
  // Skip hash verification by default - verification happens during download
  const modelId = manifest.modelId || (manifest as any).model_id || 'default';
  await dopplerLoader.load(modelId, {
    verifyHashes: storageContext?.loadShard ? false : verifyHashes,
    onProgress: onProgress || ((info) => {
      console.log(`[Pipeline] Loading: ${info.stage} - ${Math.round(info.progress * 100)}%`);
    }),
  });

  // Map layer weights
  const layerWeights = new Map<string, any>();
  for (let l = 0; l < modelConfig.numLayers; l++) {
    const weights = dopplerLoader.getLayerWeights(l);
    if (weights) {
      layerWeights.set(`layer_${l}`, weights);
    }
  }

  // Check for tied embeddings
  let useTiedEmbeddings = false;
  let embeddingVocabSize: number | null = null;

  if (dopplerLoader.lmHead && dopplerLoader.lmHead === dopplerLoader.embeddings) {
    useTiedEmbeddings = true;
    console.log('[Pipeline] Using tied embeddings for LM head (will use transposeB)');

    // Get actual vocab size from embedding tensor shape
    const embeddingTensorNames = [
      'language_model.model.embed_tokens.weight',
      'model.embed_tokens.weight',
      'embed_tokens.weight',
      'token_embd.weight',
      'wte.weight',
    ];
    for (const name of embeddingTensorNames) {
      const loc = dopplerLoader.tensorLocations.get(name);
      if (loc?.shape?.[0]) {
        embeddingVocabSize = loc.shape[0];
        console.log(
          `[Pipeline] Embedding matrix vocab size: ${embeddingVocabSize} (tokenizer: ${modelConfig.vocabSize})`
        );
        break;
      }
    }
  }

  // Collect per-layer router weights for MoE
  const layerRouterWeights = new Map<number, { weight: any; bias: any }>();
  if (modelConfig.useMoE) {
    for (let l = 0; l < modelConfig.numLayers; l++) {
      const weights = layerWeights.get(`layer_${l}`);
      if (weights?.routerWeight) {
        layerRouterWeights.set(l, {
          weight: weights.routerWeight,
          bias: weights.routerBias || null,
        });
      }
    }
    console.log('[Pipeline] MoE model - experts will be loaded on demand');
  }

  return {
    layerWeights,
    embeddings: dopplerLoader.embeddings,
    lmHead: dopplerLoader.lmHead,
    finalNorm: dopplerLoader.finalNorm,
    useTiedEmbeddings,
    embeddingVocabSize,
    layerRouterWeights,
  };
}

// ============================================================================
// Chat Templates
// ============================================================================

/**
 * Apply Gemma chat template to a prompt.
 *
 * Format: <start_of_turn>user\n{prompt}<end_of_turn>\n<start_of_turn>model\n
 * Note: BOS token (2) is added by tokenizer.
 *
 * @param prompt - Raw user prompt
 * @returns Formatted prompt with chat template
 */
export function applyGemmaChatTemplate(prompt: string): string {
  const userTurn = `<start_of_turn>user\n${prompt}<end_of_turn>\n`;
  const modelTurn = `<start_of_turn>model\n`;
  return userTurn + modelTurn;
}

/**
 * Check if a token is a stop token.
 *
 * @param token - Token ID to check
 * @param stopTokenIds - Configured stop token IDs
 * @param eosTokenId - EOS token from tokenizer
 * @returns True if token should stop generation
 */
export function isStopToken(
  token: number,
  stopTokenIds: number[],
  eosTokenId?: number
): boolean {
  if (stopTokenIds.includes(token)) return true;
  if (typeof eosTokenId === 'number' && token === eosTokenId) return true;
  return false;
}

// ============================================================================
// MoE Router Setup
// ============================================================================

/**
 * Initialize MoE router if model uses Mixture of Experts.
 *
 * @param modelConfig - Parsed model configuration
 * @param layerWeights - Layer weights map
 * @returns MoE router or null if not MoE model
 */
export function initMoERouter(
  modelConfig: ParsedModelConfig,
  layerWeights: Map<string, any>
): MoERouter | null {
  if (!modelConfig.useMoE) return null;

  const router = new MoERouter({
    numExperts: modelConfig.numExperts,
    topK: modelConfig.moeTopK || 2,
    hiddenSize: modelConfig.hiddenSize,
    normalizeWeights: true,
  });

  // Find first layer with router weights
  for (let l = 0; l < modelConfig.numLayers; l++) {
    const weights = layerWeights.get(`layer_${l}`);
    if (weights?.routerWeight) {
      router.loadWeights(weights.routerWeight, weights.routerBias || null);
      console.log(
        `[Pipeline] Loaded MoE router from layer ${l}` +
        (weights.routerBias ? ' (with bias)' : '')
      );
      break;
    }
  }

  return router;
}

// ============================================================================
// Speculative Decoder Setup
// ============================================================================

/**
 * Initialize speculative decoder if draft model is available.
 *
 * @param manifest - Model manifest
 * @returns Speculative decoder or null if no draft model
 */
export function initSpeculativeDecoder(manifest: Manifest): SpeculativeDecoder | null {
  if (!(manifest as any).draftModel) return null;

  return new SpeculativeDecoder({
    numDraftTokens: (manifest as any).draftModel.numTokens || 5,
  });
}
