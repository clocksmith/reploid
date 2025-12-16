/**
 * pipeline.ts - Main Inference Pipeline (Thin Orchestrator)
 *
 * This module orchestrates inference by delegating to specialized modules:
 * - init.ts: Initialization, weight loading, KV cache, RoPE
 * - embed.ts: Token embedding with optional Gemma scaling
 * - layer.ts: Transformer layer processing (attention + FFN)
 * - logits.ts: Final layer norm and LM head projection
 * - sampling.ts: Token sampling strategies
 * - config.ts: Model configuration parsing
 *
 * The pipeline maintains state (weights, caches, tokenizer) and coordinates
 * the flow from input tokens to generated output.
 *
 * @module inference/pipeline
 */

import { MoERouter } from './moe-router.js';
import { SpeculativeDecoder } from './speculative.js';
import { KVCache, SlidingWindowKVCache } from './kv-cache.js';
import { Tokenizer } from './tokenizer.js';
import { getDevice, setTrackSubmits } from '../gpu/device.js';
import { releaseBuffer, readBuffer } from '../gpu/buffer-pool.js';
import { runArgmax, runGPUSample, isGPUSamplingAvailable } from '../gpu/kernels/sample.js';
import { resetSubmitStats, logSubmitStats, getSubmitStats } from '../gpu/submit-tracker.js';
import { createCommandRecorder, type CommandRecorder } from '../gpu/command-recorder.js';
import { log, setGPUDevice } from '../debug/index.js';

// Pipeline sub-modules
import { sample, applyRepetitionPenalty, logitsSanity, getTopK, type SamplingOptions } from './pipeline/sampling.js';
import { parseModelConfig, type ParsedModelConfig, type Manifest } from './pipeline/config.js';
import {
  normalizeAttentionKernel,
  initRoPEFrequencies,
  createKVCache,
  initTokenizer,
  loadWeights,
  applyGemmaChatTemplate,
  isStopToken,
  initMoERouter,
  initSpeculativeDecoder,
  type PipelineContexts,
} from './pipeline/init.js';
import { embed } from './pipeline/embed.js';
import { processLayer, type LayerContext } from './pipeline/layer.js';
import { computeLogits, computeLogitsGPU, extractLastPositionLogits, type LogitsConfig, type LogitsWeights } from './pipeline/logits.js';
import { createWeightBufferHelpers, type WeightBufferConfig, type WeightDebugFlags } from './pipeline/weights.js';
import type { LayerWeights, ExpertWeights, RouterWeights } from './pipeline/types.js';
import type { LogitsDebugFlags } from './pipeline/logits.js';
import { getDopplerLoader } from '../loader/doppler-loader.js';

// Re-export types for external use
export type { LayerWeights, ExpertWeights, RouterWeights };
export { PipelineContexts };

// ============================================================================
// TypeScript Interfaces
// ============================================================================

export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  repetitionPenalty?: number;
  stopSequences?: string[];
  useSpeculative?: boolean;
  onToken?: ((tokenId: number, text: string) => void) | null;
  useChatTemplate?: boolean;
  decode?: (tokens: number[]) => string;
  debug?: boolean;
  signal?: AbortSignal;
}

export interface LayerConfig {
  hiddenSize: number;
  intermediateSize: number;
  numHeads: number;
  numKVHeads: number;
  headDim: number;
  numExperts?: number;
  topK?: number;
}

export interface PipelineStats {
  tokensGenerated: number;
  totalTimeMs: number;
  prefillTimeMs: number;
  decodeTimeMs: number;
}

export interface BatchingStats {
  batchedForwardCalls: number;
  unbatchedForwardCalls: number;
  totalBatchedTimeMs: number;
  totalUnbatchedTimeMs: number;
}

// ============================================================================
// Main Inference Pipeline Class
// ============================================================================

export class InferencePipeline {
  // Components
  tokenizer: Tokenizer | null = null;
  kvCache: KVCache | SlidingWindowKVCache | null = null;
  moeRouter: MoERouter | null = null;
  speculativeDecoder: SpeculativeDecoder | null = null;

  // Model state
  manifest: Manifest | null = null;
  modelConfig: ParsedModelConfig | null = null;
  weights: Map<string, any> = new Map();
  expertWeights: Map<string, ExpertWeights> = new Map();

  // Runtime state
  isLoaded = false;
  isGenerating = false;
  currentSeqLen = 0;

  // DopplerLoader instance
  dopplerLoader: any = null;

  // GPU context
  gpuContext: { device?: GPUDevice } | null = null;
  useGPU = false;

  // Memory and storage contexts
  memoryContext: Record<string, unknown> | null = null;
  storageContext: { loadShard?: (index: number | string) => Promise<ArrayBuffer> } | null = null;

  // Stats
  stats: PipelineStats = { tokensGenerated: 0, totalTimeMs: 0, prefillTimeMs: 0, decodeTimeMs: 0 };
  batchingStats: BatchingStats = { batchedForwardCalls: 0, unbatchedForwardCalls: 0, totalBatchedTimeMs: 0, totalUnbatchedTimeMs: 0 };

  // Base URL for loading assets
  baseUrl: string | null = null;

  // RoPE frequency buffers
  ropeFreqsCos: Float32Array | GPUBuffer | null = null;
  ropeFreqsSin: Float32Array | GPUBuffer | null = null;

  // Attention kernel override
  attentionKernelOverride: 'tiled_large' | 'tiled_small' | 'streaming' | null = null;
  manifestAttentionKernelDefault: 'tiled_large' | 'tiled_small' | 'streaming' | null = null;

  // Debug
  debug = false;

  // Tied embeddings
  useTiedEmbeddings = false;
  embeddingVocabSize: number | null = null;

  // MoE router weights per layer
  layerRouterWeights: Map<number, RouterWeights> | null = null;

  // Debug flags (combined for both layer and logits)
  private _debugFlags: Record<string, boolean> = {};
  private _decodeStepCount = 0;

  constructor() {}

  // ==========================================================================
  // Initialization
  // ==========================================================================

  async initialize(contexts: PipelineContexts = {}): Promise<void> {
    if (contexts.gpu?.device) {
      this.gpuContext = { device: contexts.gpu.device };
      this.useGPU = true;
    }
    if (contexts.memory) this.memoryContext = contexts.memory;
    if (contexts.storage) this.storageContext = contexts.storage as any;
    if (contexts.baseUrl) this.baseUrl = contexts.baseUrl;

    if (contexts.runtime?.attentionKernel) {
      this.attentionKernelOverride = normalizeAttentionKernel(contexts.runtime.attentionKernel);
    }
    if (contexts.runtime?.debug) this.debug = true;

    const device = getDevice();
    if (device) setGPUDevice(device);

    log.debug('Pipeline', 'Initialized', { useGPU: this.useGPU, debug: this.debug });
  }

  async loadModel(manifest: any): Promise<void> {
    this.manifest = manifest;
    this.modelConfig = parseModelConfig(manifest);

    if (manifest.optimizations?.debug || manifest.runtime?.debug) this.debug = true;

    const manifestKernel = manifest.optimizations?.attentionKernel || manifest.attentionKernel || manifest.runtime?.attentionKernel;
    this.manifestAttentionKernelDefault = normalizeAttentionKernel(manifestKernel);
    if (!this.attentionKernelOverride && this.manifestAttentionKernelDefault) {
      this.attentionKernelOverride = this.manifestAttentionKernelDefault;
    }

    console.log('[Pipeline] Model config:', {
      numLayers: this.modelConfig.numLayers,
      hiddenSize: this.modelConfig.hiddenSize,
      vocabSize: this.modelConfig.vocabSize,
      numHeads: this.modelConfig.numHeads,
      numKVHeads: this.modelConfig.numKVHeads,
      headDim: this.modelConfig.headDim,
      useMoE: this.modelConfig.useMoE,
    });

    // Initialize tokenizer
    this.tokenizer = await initTokenizer(manifest, this.baseUrl ?? undefined);
    const tokenizerVocabSize = this.tokenizer.getVocabSize();
    if (Number.isFinite(tokenizerVocabSize) && tokenizerVocabSize > 0) {
      if (tokenizerVocabSize !== this.modelConfig.vocabSize) {
        // Don't override - use model's vocab size for embedding compatibility
        console.log(`[Pipeline] Tokenizer vocabSize=${tokenizerVocabSize} differs from model=${this.modelConfig.vocabSize}, using model size`);
      }
    }

    // Initialize KV cache
    this.kvCache = createKVCache(this.modelConfig, this.useGPU, this.debug);

    // Initialize MoE router if needed
    if (this.modelConfig.useMoE) {
      this.moeRouter = new MoERouter({
        numExperts: this.modelConfig.numExperts,
        topK: this.modelConfig.moeTopK || 2,
        hiddenSize: this.modelConfig.hiddenSize,
        normalizeWeights: true,
      });
    }

    // Initialize speculative decoder if draft model
    if ((manifest as any).draftModel) {
      this.speculativeDecoder = initSpeculativeDecoder(manifest);
    }

    // Load weights
    await this._loadWeights();

    // Initialize RoPE frequencies
    await this._initRoPE();

    this.isLoaded = true;
    console.log('[Pipeline] Model loaded successfully');
  }

  private async _loadWeights(): Promise<void> {
    const result = await loadWeights(
      this.manifest!,
      this.modelConfig!,
      this.storageContext ?? undefined,
      (info) => console.log(`[Pipeline] Loading: ${info.stage} - ${Math.round(info.progress * 100)}%`)
    );

    // Store weights in map
    result.layerWeights.forEach((w, k) => this.weights.set(k, w));
    this.weights.set('embed', result.embeddings);
    this.weights.set('lm_head', result.lmHead);
    this.weights.set('final_norm', result.finalNorm);

    this.useTiedEmbeddings = result.useTiedEmbeddings;
    this.embeddingVocabSize = result.embeddingVocabSize;
    this.layerRouterWeights = result.layerRouterWeights;

    // Store DopplerLoader reference for expert loading
    this.dopplerLoader = getDopplerLoader();

    // Initialize MoE router with weights
    if (this.modelConfig!.useMoE && this.moeRouter) {
      this.moeRouter = initMoERouter(this.modelConfig!, result.layerWeights);
    }
  }

  private async _initRoPE(): Promise<void> {
    const config = this.modelConfig!;
    const ropeBuffers = await initRoPEFrequencies({
      headDim: config.headDim,
      maxSeqLen: config.maxSeqLen || 4096,
      ropeTheta: config.ropeTheta,
      ropeScale: config.ropeScale,
      ropeScalingType: config.ropeScalingType,
      ropeScaling: config.ropeScaling,
    }, this.useGPU);
    this.ropeFreqsCos = ropeBuffers.cos;
    this.ropeFreqsSin = ropeBuffers.sin;
  }

  // ==========================================================================
  // Generation
  // ==========================================================================

  async *generate(prompt: string, options: GenerateOptions = {}): AsyncGenerator<string, void, void> {
    if (!this.isLoaded) throw new Error('Model not loaded');
    if (this.isGenerating) throw new Error('Generation already in progress');

    this.isGenerating = true;
    this._decodeStepCount = 0;
    const startTime = performance.now();

    const opts = {
      maxTokens: options.maxTokens ?? 512,
      temperature: options.temperature ?? 0.7,
      topP: options.topP ?? 0.9,
      topK: options.topK ?? 40,
      repetitionPenalty: options.repetitionPenalty ?? 1.1,
      stopSequences: options.stopSequences ?? [],
      useSpeculative: options.useSpeculative ?? false,
      useChatTemplate: options.useChatTemplate ?? false,
      debug: options.debug ?? this.debug,
    };

    try {
      // Apply chat template if requested
      let processedPrompt = prompt;
      if (opts.useChatTemplate && this.modelConfig!.isGemma) {
        processedPrompt = applyGemmaChatTemplate(prompt);
        if (opts.debug) console.log('[Pipeline] Applied Gemma chat template');
      }

      // Tokenize
      const inputIds = this.tokenizer!.encode(processedPrompt);
      const generatedIds = [...inputIds];

      if (opts.debug) {
        console.log(`[Pipeline] Input: ${inputIds.length} tokens`);
      }

      // Prefill
      const prefillStart = performance.now();
      const prefillLogits = await this._prefill(inputIds, opts);
      this.stats.prefillTimeMs = performance.now() - prefillStart;

      // Debug: show input tokens
      const inputTokenTexts = inputIds.map(id => `${id}="${this.tokenizer?.decode?.([id]) || '?'}"`).join(', ');
      console.log(`[Pipeline] Input tokens (${inputIds.length}): ${inputTokenTexts}`);

      // Apply repetition penalty and sample first token
      applyRepetitionPenalty(prefillLogits, generatedIds, opts.repetitionPenalty);

      // Debug: check logits after repetition penalty
      const topAfterPenalty = getTopK(prefillLogits, 5, (tokens) => this.tokenizer?.decode?.(tokens) || '?');
      console.log(`[Pipeline] After rep penalty top-5: ${topAfterPenalty.map(t => `"${t.text}"(${(t.prob * 100).toFixed(1)}%)`).join(', ')}`);

      const firstToken = sample(prefillLogits, {
        temperature: opts.temperature,
        topP: opts.topP,
        topK: opts.topK,
      });

      console.log(`[Pipeline] First token sampled: id=${firstToken} text="${this.tokenizer?.decode?.([firstToken]) || '?'}"`);

      generatedIds.push(firstToken);

      // Yield first token
      const firstText = this.tokenizer!.decode([firstToken], true, false);
      yield firstText;
      if (options.onToken) options.onToken(firstToken, firstText);

      // Check stop conditions
      const stopTokenIds = this.modelConfig!.stopTokenIds || [];
      const eosToken = this.tokenizer!.getSpecialTokens?.()?.eos;
      let tokensGenerated = 1;

      // Decode loop
      const decodeStart = performance.now();
      while (tokensGenerated < opts.maxTokens) {
        if (options.signal?.aborted) break;

        const nextToken = await this._decodeStep(generatedIds, opts);
        generatedIds.push(nextToken);
        tokensGenerated++;

        const tokenText = this.tokenizer!.decode([nextToken], true, false);
        yield tokenText;
        if (options.onToken) options.onToken(nextToken, tokenText);

        // Check stop
        if (isStopToken(nextToken, stopTokenIds, eosToken)) break;

        // Check stop sequences
        if (opts.stopSequences.length > 0) {
          const fullText = this.tokenizer!.decode(generatedIds.slice(inputIds.length), false);
          if (opts.stopSequences.some(seq => fullText.endsWith(seq))) break;
        }
      }

      this.stats.decodeTimeMs = performance.now() - decodeStart;
      this.stats.tokensGenerated = tokensGenerated;
      this.stats.totalTimeMs = performance.now() - startTime;

      if (opts.debug) {
        console.log(`[Pipeline] Generated ${tokensGenerated} tokens in ${this.stats.totalTimeMs.toFixed(0)}ms`);
      }

      // Always log benchmark stats
      const ttft = this.stats.prefillTimeMs;
      const decodeTokens = tokensGenerated - 1; // First token comes from prefill
      const decodeSpeed = decodeTokens > 0 ? (decodeTokens / this.stats.decodeTimeMs * 1000) : 0;
      console.log(`[Benchmark] TTFT: ${ttft.toFixed(0)}ms | Prefill: ${this.stats.prefillTimeMs.toFixed(0)}ms | Decode: ${this.stats.decodeTimeMs.toFixed(0)}ms (${decodeTokens} tokens @ ${decodeSpeed.toFixed(1)} tok/s)`);
    } finally {
      this.isGenerating = false;
    }
  }

  // ==========================================================================
  // Prefill and Decode
  // ==========================================================================

  private async _prefill(inputIds: number[], opts: any): Promise<Float32Array> {
    const numTokens = inputIds.length;
    const config = this.modelConfig!;

    // Embed tokens
    const embedBuffer = this.weights.get('embed');
    console.log(`[Pipeline] Embed buffer: type=${embedBuffer?.constructor?.name}, size=${embedBuffer?.size ?? 'N/A'}`);

    let hiddenStates = await embed(inputIds, embedBuffer, {
      hiddenSize: config.hiddenSize,
      vocabSize: config.vocabSize,
      scaleEmbeddings: config.isGemma ?? false,
      debug: opts.debug,
    });

    // Debug: check hidden states after embedding
    if (hiddenStates instanceof GPUBuffer) {
      const sample = await readBuffer(hiddenStates, Math.min(512, hiddenStates.size));
      const f32 = new Float32Array(sample);
      const nanCount = f32.filter(x => !Number.isFinite(x)).length;
      const nonZero = Array.from(f32).filter(x => x !== 0).slice(0, 5);
      const sampleStr = nonZero.map(x => x.toFixed(4)).join(', ');
      console.log(`[Pipeline] After embed: buffer.size=${hiddenStates.size}, nan=${nanCount}/${f32.length}, sample=[${sampleStr}]`);
    }

    // Create CommandRecorder for batched GPU operations
    // This reduces GPU submits from 260+ per forward pass to 1
    const device = getDevice();
    // DEBUG: Disable batching to get accurate per-layer debug
    const recorder = undefined; // device ? createCommandRecorder('prefill') : undefined;
    const context = this._buildLayerContext(recorder);

    // Enable submit tracking for benchmarking
    const benchmarkSubmits = opts.debug;
    if (benchmarkSubmits) {
      setTrackSubmits(true);
      resetSubmitStats();
    }

    // Process all layers
    console.log(`[Pipeline] LAYER_LOOP_START: numLayers=${config.numLayers}, useGPU=${context.useGPU}`);
    for (let l = 0; l < config.numLayers; l++) {
      const prevStates = hiddenStates;
      hiddenStates = await processLayer(l, hiddenStates, numTokens, true, context) as GPUBuffer;

      // Debug: trace hidden state growth through layers (first 3 layers only to limit spam)
      if (l < 3 && hiddenStates instanceof GPUBuffer) {
        const device = getDevice();
        if (device) {
          try {
            const sampleSize = Math.min(256, hiddenStates.size);
            const staging = device.createBuffer({
              size: sampleSize,
              usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            });
            const enc = device.createCommandEncoder();
            enc.copyBufferToBuffer(hiddenStates, 0, staging, 0, sampleSize);
            device.queue.submit([enc.finish()]);
            await staging.mapAsync(GPUMapMode.READ);
            const data = new Float32Array(staging.getMappedRange().slice(0));
            staging.unmap();
            staging.destroy();
            const maxAbs = Math.max(...Array.from(data).map(x => Math.abs(x)));
            const sample = Array.from(data).slice(0, 3).map(x => x.toFixed(3)).join(', ');
            console.log(`[Pipeline] LAYER_${l}_OUT: maxAbs=${maxAbs.toFixed(2)}, sample=[${sample}]`);
          } catch (e) {
            console.log(`[Pipeline] LAYER_${l}_OUT: error reading buffer: ${e}`);
          }
        }
      } else if (l < 3) {
        console.log(`[Pipeline] LAYER_${l}_OUT: hiddenStates is ${hiddenStates?.constructor?.name}`);
      }

      if (prevStates instanceof GPUBuffer && prevStates !== hiddenStates) {
        releaseBuffer(prevStates);
      }
    }

    // Submit batched commands (cleanup happens automatically in submit)
    if (recorder) {
      await recorder.submitAndWait();
    }

    // Log submit stats after layer loop
    if (benchmarkSubmits) {
      logSubmitStats(`Prefill (${numTokens} tokens, ${config.numLayers} layers)`);
      setTrackSubmits(false);
    }

    // Debug: check final hidden states before logits
    console.log(`[Pipeline] LAYER_LOOP_DONE, hiddenStates type=${hiddenStates?.constructor?.name}`);
    if (hiddenStates instanceof GPUBuffer) {
      const device = getDevice();
      const sampleSize = Math.min(512, hiddenStates.size);
      const staging = device.createBuffer({
        size: sampleSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(hiddenStates, 0, staging, 0, sampleSize);
      device.queue.submit([enc.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const data = new Float32Array(staging.getMappedRange().slice(0));
      staging.unmap();
      staging.destroy();
      const nanCount = Array.from(data).filter(x => !Number.isFinite(x)).length;
      const nonZero = Array.from(data).filter(x => Number.isFinite(x) && x !== 0).slice(0, 5);
      console.log(`[Pipeline] FINAL_HIDDEN: nan=${nanCount}/${data.length}, sample=[${nonZero.map(x => x.toFixed(4)).join(', ')}]`);
    }

    // Compute logits
    const logits = await computeLogits(
      hiddenStates,
      numTokens,
      this._getLogitsWeights(),
      this._getLogitsConfig(),
      this.useGPU,
      this._debugFlags as any
    );

    if (hiddenStates instanceof GPUBuffer) releaseBuffer(hiddenStates);

    this.currentSeqLen = numTokens;

    // Extract last position logits
    const lastLogits = extractLastPositionLogits(logits, numTokens, config.vocabSize);

    // Log prefill logits for debug
    logitsSanity(lastLogits, 'Prefill', (tokens) => this.tokenizer?.decode?.(tokens) || '?');

    // Debug: check KV cache state after prefill
    if (this.kvCache?.hasGPUCache?.()) {
      console.log(`[Pipeline] KV cache active after prefill: seqLen=${this.kvCache.layers?.[0]?.seqLen ?? '?'}`);
    } else {
      console.log(`[Pipeline] WARNING: KV cache NOT active after prefill! hasGPUCache=${this.kvCache?.hasGPUCache?.()}`);
    }

    return lastLogits;
  }

  private async _decodeStep(currentIds: number[], opts: any): Promise<number> {
    const lastToken = currentIds[currentIds.length - 1];
    const numTokens = 1;
    const config = this.modelConfig!;

    this._decodeStepCount++;
    const isDebugStep = this._decodeStepCount <= 5;
    if (isDebugStep) {
      const tokenText = this.tokenizer?.decode?.([lastToken]) || '?';
      console.log(`[Decode][${this._decodeStepCount}] token="${tokenText}" pos=${this.currentSeqLen}`);
    }

    // Embed single token
    const embedBuffer = this.weights.get('embed');
    let hiddenStates = await embed([lastToken], embedBuffer, {
      hiddenSize: config.hiddenSize,
      vocabSize: config.vocabSize,
      scaleEmbeddings: config.isGemma ?? false,
    });

    // Debug: check embedding output for decode step 1
    if (this._decodeStepCount === 1 && hiddenStates instanceof GPUBuffer) {
      const embedData = await readBuffer(hiddenStates);
      const embedArr = new Float32Array(embedData);
      const sample = embedArr.slice(0, 5);
      const maxAbs = Math.max(...embedArr.map(Math.abs));
      const nonZero = embedArr.filter(x => Math.abs(x) > 1e-10).length;
      console.log(`[Decode][1] Embed check: maxAbs=${maxAbs.toFixed(2)}, nonZero=${nonZero}/${embedArr.length}, sample=[${Array.from(sample).map(v => v.toFixed(3)).join(', ')}]`);
    }

    // Create CommandRecorder for batched GPU operations
    const device = getDevice();
    const recorder = device ? createCommandRecorder('decode') : undefined;
    const context = this._buildLayerContext(recorder);

    // Enable submit tracking for first decode step benchmarking
    const benchmarkSubmits = this._decodeStepCount <= 3 && opts.debug;
    if (benchmarkSubmits) {
      setTrackSubmits(true);
      resetSubmitStats();
    }

    // Debug: check KV cache status for decode
    const hasGPUCache = context.kvCache?.hasGPUCache?.() ?? false;
    if (this._decodeStepCount === 1) {
      console.log(`[Decode] KV cache check: hasGPUCache=${hasGPUCache}, currentSeqLen=${context.currentSeqLen}`);
    }

    // Process all layers
    for (let l = 0; l < config.numLayers; l++) {
      const prevStates = hiddenStates;
      hiddenStates = await processLayer(l, hiddenStates, numTokens, false, context) as GPUBuffer;
      if (prevStates instanceof GPUBuffer && prevStates !== hiddenStates) {
        releaseBuffer(prevStates);
      }
    }

    // Submit batched commands (cleanup happens automatically in submit)
    if (recorder) {
      await recorder.submitAndWait();
    }

    // Log submit stats after decode layer loop
    if (benchmarkSubmits) {
      logSubmitStats(`Decode step ${this._decodeStepCount} (${config.numLayers} layers)`);
      setTrackSubmits(false);
    }

    // Try GPU-side sampling for deferred readback (avoids ~1MB logits readback)
    const useGPUSampling = this.useGPU && isGPUSamplingAvailable() && !isDebugStep;

    if (useGPUSampling) {
      // GPU path: compute logits on GPU, sample on GPU, read back only 4 bytes
      const logitsResult = await computeLogitsGPU(
        hiddenStates,
        numTokens,
        this._getLogitsWeights(),
        this._getLogitsConfig(),
        this._debugFlags as any
      );

      if (hiddenStates instanceof GPUBuffer) releaseBuffer(hiddenStates);

      if (logitsResult) {
        const { logitsBuffer, vocabSize } = logitsResult;

        // GPU-side sampling (greedy for now, temperature sampling later)
        // TODO: Add GPU-side repetition penalty and temperature sampling
        const nextToken = opts.temperature < 0.01
          ? await runArgmax(logitsBuffer, vocabSize)
          : await runGPUSample(logitsBuffer, vocabSize, {
              temperature: opts.temperature,
              topK: opts.topK,
            });

        releaseBuffer(logitsBuffer);
        this.currentSeqLen++;
        return nextToken;
      }
      // Fall through to CPU path if GPU sampling failed
    }

    // CPU path: read back logits, sample on CPU
    const logits = await computeLogits(
      hiddenStates,
      numTokens,
      this._getLogitsWeights(),
      this._getLogitsConfig(),
      this.useGPU,
      this._debugFlags as any
    );

    if (hiddenStates instanceof GPUBuffer) releaseBuffer(hiddenStates);

    // Log top-5 for debug
    if (isDebugStep) {
      logitsSanity(logits, `Decode[${this._decodeStepCount}]`, opts.decode);
    }

    // Apply penalty and sample
    applyRepetitionPenalty(logits, currentIds, opts.repetitionPenalty);
    const nextToken = sample(logits, {
      temperature: opts.temperature,
      topP: opts.topP,
      topK: opts.topK,
    });

    this.currentSeqLen++;
    return nextToken;
  }

  // ==========================================================================
  // Context and Config Builders
  // ==========================================================================

  private _buildLayerContext(recorder?: CommandRecorder): LayerContext {
    const config = this.modelConfig!;
    const { getWeightBuffer, getNormWeightBuffer } = createWeightBufferHelpers(
      this._getWeightBufferConfig(),
      this._debugFlags
    );

    return {
      config,
      weights: this.weights,
      kvCache: this.kvCache,
      currentSeqLen: this.currentSeqLen,
      useGPU: this.useGPU,
      debug: this.debug,
      ropeFreqsCos: this.ropeFreqsCos,
      ropeFreqsSin: this.ropeFreqsSin,
      attentionKernelOverride: this.attentionKernelOverride,
      weightConfig: this._getWeightBufferConfig(),
      debugFlags: this._debugFlags as any,
      expertWeights: this.expertWeights,
      expertLoader: this.dopplerLoader,
      moeRouter: this.moeRouter,
      layerRouterWeights: this.layerRouterWeights ?? undefined,
      recorder,
    };
  }

  private _getWeightBufferConfig(): WeightBufferConfig {
    return {
      rmsNormWeightOffset: this.modelConfig!.isGemma ?? false,
    };
  }

  private _getLogitsWeights(): LogitsWeights {
    return {
      finalNorm: this.weights.get('final_norm'),
      lmHead: this.weights.get('lm_head'),
    };
  }

  private _getLogitsConfig(): LogitsConfig {
    const config = this.modelConfig!;
    return {
      hiddenSize: config.hiddenSize,
      vocabSize: config.vocabSize,
      rmsNormEps: config.rmsNormEps,
      useTiedEmbeddings: this.useTiedEmbeddings,
      embeddingVocabSize: this.embeddingVocabSize,
    };
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  getStats(): PipelineStats {
    return { ...this.stats };
  }

  getBatchingStats(): BatchingStats {
    return { ...this.batchingStats };
  }

  async unload(): Promise<void> {
    (this.kvCache as any)?.clear?.();
    this.weights.clear();
    this.expertWeights.clear();
    this.isLoaded = false;
    this.currentSeqLen = 0;
    console.log('[Pipeline] Unloaded');
  }

  reset(): void {
    (this.kvCache as any)?.clear?.();
    this.currentSeqLen = 0;
    this._decodeStepCount = 0;
    this._debugFlags = {};
    this.stats = { tokensGenerated: 0, totalTimeMs: 0, prefillTimeMs: 0, decodeTimeMs: 0 };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export async function createPipeline(manifest: any, contexts: PipelineContexts = {}): Promise<InferencePipeline> {
  const pipeline = new InferencePipeline();
  await pipeline.initialize(contexts);
  await pipeline.loadModel(manifest);
  return pipeline;
}

// Backwards compatibility alias
export { InferencePipeline as Pipeline };
