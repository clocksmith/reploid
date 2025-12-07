/**
 * pipeline.js - Main Inference Pipeline
 *
 * Orchestrates the complete inference flow for MoE transformer models:
 * - Token processing with tokenizer
 * - KV cache management
 * - MoE routing and expert execution
 * - Optional speculative decoding
 * - GPU/CPU compute dispatch
 *
 * @module inference/pipeline
 */

import { MoERouter, createExpertExecutionPlan, combineExpertOutputs } from './moe-router.js';
import { SpeculativeDecoder } from './speculative.js';
import { KVCache, SlidingWindowKVCache } from './kv-cache.js';
import { Tokenizer } from './tokenizer.js';

// Memory interfaces (Agent-A)
import { getMemoryCapabilities } from '../memory/capability.js';

// Storage interfaces (Agent-B)
import { loadShard, getManifest } from '../storage/shard-manager.js';

// GPU interfaces (Agent-C)
import { getDevice, getKernelCapabilities } from '../gpu/device.js';
import {
  runMatmul,
  dequantize,
  runAttention,
  runRMSNorm,
  runSoftmax,
  runRoPE,
  runSiLU,
} from '../gpu/kernel-selector.js';
import { acquireBuffer, releaseBuffer, readBuffer } from '../gpu/buffer-pool.js';

/**
 * Generation Options
 * @typedef {Object} GenerateOptions
 * @property {number} maxTokens - Maximum tokens to generate (default: 512)
 * @property {number} temperature - Sampling temperature (default: 0.7)
 * @property {number} topP - Nucleus sampling threshold (default: 0.9)
 * @property {number} topK - Top-k sampling (default: 40)
 * @property {number} repetitionPenalty - Repetition penalty (default: 1.1)
 * @property {string[]} stopSequences - Stop generation on these sequences
 * @property {boolean} useSpeculative - Enable speculative decoding
 * @property {Function} onToken - Callback for each generated token
 */

/**
 * Model Layer Configuration
 * @typedef {Object} LayerConfig
 * @property {number} hiddenSize - Hidden dimension
 * @property {number} intermediateSize - FFN intermediate dimension
 * @property {number} numHeads - Number of attention heads
 * @property {number} numKVHeads - Number of KV heads (for GQA)
 * @property {number} headDim - Dimension per head
 * @property {number} numExperts - Number of MoE experts (if MoE layer)
 * @property {number} topK - Top-k experts to route to
 */

/**
 * Main Inference Pipeline
 */
export class InferencePipeline {
  constructor() {
    // Components
    this.tokenizer = null;
    this.kvCache = null;
    this.moeRouter = null;
    this.speculativeDecoder = null;

    // Model state
    this.manifest = null;
    this.modelConfig = null;
    this.weights = new Map(); // layerIdx -> weight buffers
    this.expertWeights = new Map(); // expertIdx -> weight buffers

    // Runtime state
    this.isLoaded = false;
    this.isGenerating = false;
    this.currentSeqLen = 0;

    // GPU context (from Agent-C)
    this.gpuContext = null;
    this.useGPU = false;

    // Memory context (from Agent-A)
    this.memoryContext = null;

    // Storage context (from Agent-B)
    this.storageContext = null;

    // Stats
    this.stats = {
      tokensGenerated: 0,
      totalTimeMs: 0,
      prefillTimeMs: 0,
      decodeTimeMs: 0
    };
  }

  /**
   * Initialize pipeline with external contexts
   * @param {Object} contexts - External module contexts
   */
  async initialize(contexts = {}) {
    if (contexts.gpu) {
      this.gpuContext = contexts.gpu;
      this.useGPU = true;
    }
    if (contexts.memory) {
      this.memoryContext = contexts.memory;
    }
    if (contexts.storage) {
      this.storageContext = contexts.storage;
    }
  }

  /**
   * Load model from manifest
   * @param {Object} manifest - Model manifest from .rpl format
   */
  async loadModel(manifest) {
    this.manifest = manifest;
    this.modelConfig = this._parseModelConfig(manifest);

    // Initialize tokenizer
    this.tokenizer = new Tokenizer();
    await this.tokenizer.initialize(manifest);

    // Initialize KV cache
    const cacheConfig = {
      numLayers: this.modelConfig.numLayers,
      numHeads: this.modelConfig.numKVHeads || this.modelConfig.numHeads,
      headDim: this.modelConfig.headDim,
      maxSeqLen: this.modelConfig.maxSeqLen || 4096,
      useGPU: this.useGPU,
      layout: this.modelConfig.maxSeqLen > 8192 ? 'paged' : 'contiguous'
    };

    if (this.modelConfig.slidingWindow) {
      this.kvCache = new SlidingWindowKVCache({
        ...cacheConfig,
        windowSize: this.modelConfig.slidingWindow
      });
    } else {
      this.kvCache = new KVCache(cacheConfig);
    }

    // Initialize MoE router if model uses MoE
    if (this.modelConfig.useMoE) {
      this.moeRouter = new MoERouter({
        numExperts: this.modelConfig.numExperts,
        topK: this.modelConfig.moeTopK || 2,
        hiddenSize: this.modelConfig.hiddenSize,
        normalizeWeights: true
      });
    }

    // Initialize speculative decoder if draft model available
    if (manifest.draftModel) {
      this.speculativeDecoder = new SpeculativeDecoder({
        numDraftTokens: manifest.draftModel.numTokens || 5
      });
    }

    // Load model weights
    await this._loadWeights();

    this.isLoaded = true;
  }

  /**
   * Parse model configuration from manifest
   * @private
   */
  _parseModelConfig(manifest) {
    const config = manifest.config || manifest.modelConfig || {};

    return {
      // Architecture
      numLayers: config.num_hidden_layers || config.n_layer || 32,
      hiddenSize: config.hidden_size || config.n_embd || 4096,
      intermediateSize: config.intermediate_size || config.n_inner || 14336,
      numHeads: config.num_attention_heads || config.n_head || 32,
      numKVHeads: config.num_key_value_heads || config.numHeads,
      headDim: config.head_dim || Math.floor(
        (config.hidden_size || 4096) / (config.num_attention_heads || 32)
      ),
      vocabSize: config.vocab_size || 32000,
      maxSeqLen: config.max_position_embeddings || 4096,

      // MoE config
      useMoE: config.num_local_experts > 1 || config.num_experts > 1,
      numExperts: config.num_local_experts || config.num_experts || 8,
      moeTopK: config.num_experts_per_tok || config.top_k || 2,

      // Optimizations
      slidingWindow: config.sliding_window || null,
      ropeTheta: config.rope_theta || 10000,

      // Quantization
      quantization: manifest.quantization || 'f16'
    };
  }

  /**
   * Load model weights from storage
   * @private
   */
  async _loadWeights() {
    // TODO: Implement actual weight loading from Agent-B's storage
    // For now, this is a placeholder

    if (!this.storageContext) {
      console.warn('Storage context not set - weights not loaded');
      return;
    }

    // Load embedding weights
    // const embedWeights = await this.storageContext.loadShard(0);
    // this.weights.set('embed', embedWeights);

    // Load layer weights
    // for (let l = 0; l < this.modelConfig.numLayers; l++) {
    //   const layerWeights = await this.storageContext.loadShard(l + 1);
    //   this.weights.set(`layer_${l}`, layerWeights);
    // }

    // MoE router weights
    if (this.moeRouter && this.modelConfig.useMoE) {
      // Load router gate weights for each MoE layer
      // this.moeRouter.loadWeights(routerWeights);
    }
  }

  /**
   * Generate tokens from prompt
   * @param {string} prompt - Input prompt
   * @param {GenerateOptions} options - Generation options
   * @yields {string} Generated tokens
   */
  async *generate(prompt, options = {}) {
    if (!this.isLoaded) {
      throw new Error('Model not loaded');
    }

    if (this.isGenerating) {
      throw new Error('Generation already in progress');
    }

    this.isGenerating = true;
    const startTime = performance.now();

    try {
      // Parse options with defaults
      const opts = {
        maxTokens: options.maxTokens || 512,
        temperature: options.temperature ?? 0.7,
        topP: options.topP ?? 0.9,
        topK: options.topK ?? 40,
        repetitionPenalty: options.repetitionPenalty ?? 1.1,
        stopSequences: options.stopSequences || [],
        useSpeculative: options.useSpeculative ?? false,
        onToken: options.onToken || null
      };

      // Encode prompt
      const inputIds = this.tokenizer.encode(prompt);
      let generatedIds = [...inputIds];

      // Prefill phase
      const prefillStart = performance.now();
      await this._prefill(inputIds);
      this.stats.prefillTimeMs += performance.now() - prefillStart;

      // Decode phase
      const decodeStart = performance.now();
      let tokensGenerated = 0;
      let shouldStop = false;

      while (tokensGenerated < opts.maxTokens && !shouldStop) {
        let newTokens;

        if (opts.useSpeculative && this.speculativeDecoder) {
          // Speculative decoding path
          const result = await this._speculativeStep(generatedIds);
          newTokens = result.newTokens;
        } else {
          // Standard autoregressive decoding
          newTokens = [await this._decodeStep(generatedIds, opts)];
        }

        for (const token of newTokens) {
          generatedIds.push(token);
          tokensGenerated++;

          // Decode and yield token
          const tokenText = this.tokenizer.decode([token]);
          yield tokenText;

          if (opts.onToken) {
            opts.onToken(token, tokenText);
          }

          // Check stop conditions
          if (token === this.tokenizer.getSpecialTokens().eos) {
            shouldStop = true;
            break;
          }

          // Check stop sequences
          const currentText = this.tokenizer.decode(
            generatedIds.slice(inputIds.length)
          );
          for (const stopSeq of opts.stopSequences) {
            if (currentText.endsWith(stopSeq)) {
              shouldStop = true;
              break;
            }
          }

          if (tokensGenerated >= opts.maxTokens) break;
        }
      }

      this.stats.decodeTimeMs += performance.now() - decodeStart;
      this.stats.tokensGenerated += tokensGenerated;

    } finally {
      this.isGenerating = false;
      this.stats.totalTimeMs += performance.now() - startTime;
    }
  }

  /**
   * Prefill phase - process entire prompt at once
   * @private
   */
  async _prefill(inputIds) {
    const numTokens = inputIds.length;

    // Process all layers
    let hiddenStates = await this._embed(inputIds);

    for (let l = 0; l < this.modelConfig.numLayers; l++) {
      hiddenStates = await this._processLayer(l, hiddenStates, numTokens, true);
    }

    this.currentSeqLen = numTokens;
  }

  /**
   * Single decode step - generate one token
   * @private
   */
  async _decodeStep(currentIds, opts) {
    // Only process the last token (use cached KV for previous)
    const lastToken = currentIds[currentIds.length - 1];

    let hiddenStates = await this._embed([lastToken]);

    for (let l = 0; l < this.modelConfig.numLayers; l++) {
      hiddenStates = await this._processLayer(l, hiddenStates, 1, false);
    }

    // Apply final layer norm and LM head
    const logits = await this._computeLogits(hiddenStates);

    // Apply repetition penalty
    this._applyRepetitionPenalty(logits, currentIds, opts.repetitionPenalty);

    // Sample next token
    const nextToken = this._sample(logits, opts);

    this.currentSeqLen++;
    return nextToken;
  }

  /**
   * Speculative decoding step
   * @private
   */
  async _speculativeStep(currentIds) {
    if (!this.speculativeDecoder) {
      throw new Error('Speculative decoder not initialized');
    }

    return await this.speculativeDecoder.step(
      currentIds,
      this.kvCache,
      this.kvCache.clone() // Draft uses cloned cache
    );
  }

  /**
   * Embed token IDs to hidden states
   * @private
   */
  async _embed(tokenIds) {
    // TODO: Implement actual embedding lookup
    // For now, return placeholder
    const hiddenSize = this.modelConfig.hiddenSize;
    return new Float32Array(tokenIds.length * hiddenSize);
  }

  /**
   * Process a single transformer layer
   * @private
   */
  async _processLayer(layerIdx, hiddenStates, numTokens, isPrefill) {
    const hiddenSize = this.modelConfig.hiddenSize;

    // 1. Self-attention
    let attnOutput = await this._attention(
      layerIdx, hiddenStates, numTokens, isPrefill
    );

    // 2. Add residual
    for (let i = 0; i < hiddenStates.length; i++) {
      attnOutput[i] += hiddenStates[i];
    }

    // 3. Layer norm
    const normed = this._layerNorm(attnOutput);

    // 4. FFN (or MoE FFN)
    let ffnOutput;
    if (this.modelConfig.useMoE && this._isMoELayer(layerIdx)) {
      ffnOutput = await this._moeFeedForward(layerIdx, normed, numTokens);
    } else {
      ffnOutput = await this._feedForward(layerIdx, normed);
    }

    // 5. Add residual
    for (let i = 0; i < normed.length; i++) {
      ffnOutput[i] += normed[i];
    }

    return ffnOutput;
  }

  /**
   * Self-attention computation
   * @private
   */
  async _attention(layerIdx, hiddenStates, numTokens, isPrefill) {
    const { numHeads, numKVHeads, headDim, hiddenSize } = this.modelConfig;
    const device = getDevice();

    if (!this.useGPU || !device) {
      // CPU fallback - simplified attention
      return this._attentionCPU(layerIdx, hiddenStates, numTokens, isPrefill);
    }

    // Get layer weights
    const layerWeights = this.weights.get(`layer_${layerIdx}`);
    if (!layerWeights) {
      console.warn(`[Pipeline] Layer ${layerIdx} weights not loaded, using placeholder`);
      return new Float32Array(hiddenStates.length);
    }

    // 1. Create input buffer from hidden states
    const inputBuffer = acquireBuffer(hiddenStates.byteLength, undefined, 'attn_input');
    device.queue.writeBuffer(inputBuffer, 0, hiddenStates);

    // 2. Apply RMSNorm (input normalization)
    const normWeight = layerWeights.inputNorm;
    if (normWeight) {
      const normBuffer = acquireBuffer(normWeight.byteLength, undefined, 'attn_norm_weight');
      device.queue.writeBuffer(normBuffer, 0, normWeight);
      const normedBuffer = await runRMSNorm(inputBuffer, normBuffer, 1e-5, {
        batchSize: numTokens,
        hiddenSize,
      });
      releaseBuffer(inputBuffer);
      releaseBuffer(normBuffer);
      // Use normed output as new input
    }

    // 3. Project to Q, K, V (using matmul)
    // Q: [numTokens, hiddenSize] x [hiddenSize, numHeads * headDim]
    // K: [numTokens, hiddenSize] x [hiddenSize, numKVHeads * headDim]
    // V: same as K

    // For now, placeholder until weight layout is fully defined
    const qSize = numTokens * numHeads * headDim;
    const kvSize = numTokens * numKVHeads * headDim;

    const Q = acquireBuffer(qSize * 4, undefined, 'Q');
    const K = acquireBuffer(kvSize * 4, undefined, 'K');
    const V = acquireBuffer(kvSize * 4, undefined, 'V');

    // 4. Apply RoPE to Q and K
    if (this.ropeFreqsCos && this.ropeFreqsSin) {
      await runRoPE(Q, this.ropeFreqsCos, this.ropeFreqsSin, numTokens, {
        numHeads,
        headDim,
        startPos: this.currentSeqLen,
      });
      await runRoPE(K, this.ropeFreqsCos, this.ropeFreqsSin, numTokens, {
        numHeads: numKVHeads,
        headDim,
        startPos: this.currentSeqLen,
      });
    }

    // 5. Update KV cache
    const kData = await readBuffer(K, kvSize * 4);
    const vData = await readBuffer(V, kvSize * 4);
    this.kvCache.update(layerIdx, new Float32Array(kData), new Float32Array(vData), this.currentSeqLen);

    // 6. Run attention
    const output = await runAttention(Q, K, V, null, numHeads, headDim, {
      seqLen: numTokens,
      kvLen: this.currentSeqLen + numTokens,
      numKVHeads,
      causal: true,
    });

    // 7. Read output back
    const outputData = await readBuffer(output, numTokens * numHeads * headDim * 4);

    // Cleanup
    releaseBuffer(Q);
    releaseBuffer(K);
    releaseBuffer(V);
    releaseBuffer(output);

    return new Float32Array(outputData);
  }

  /**
   * CPU fallback for attention
   * @private
   */
  _attentionCPU(layerIdx, hiddenStates, numTokens, isPrefill) {
    const { numHeads, numKVHeads, headDim } = this.modelConfig;
    // Placeholder: update KV cache with zeros
    const kvSize = numKVHeads * headDim;
    const dummyKV = new Float32Array(numTokens * kvSize);
    this.kvCache.update(layerIdx, dummyKV, dummyKV, this.currentSeqLen);
    return new Float32Array(hiddenStates.length);
  }

  /**
   * Feed-forward network
   * @private
   */
  async _feedForward(layerIdx, hiddenStates) {
    const { hiddenSize, intermediateSize } = this.modelConfig;
    const device = getDevice();
    const numTokens = hiddenStates.length / hiddenSize;

    if (!this.useGPU || !device) {
      // CPU fallback
      return new Float32Array(hiddenStates.length);
    }

    const layerWeights = this.weights.get(`layer_${layerIdx}`);
    if (!layerWeights || !layerWeights.ffnGate || !layerWeights.ffnUp || !layerWeights.ffnDown) {
      console.warn(`[Pipeline] Layer ${layerIdx} FFN weights not loaded`);
      return new Float32Array(hiddenStates.length);
    }

    // 1. Create input buffer
    const inputBuffer = acquireBuffer(hiddenStates.byteLength, undefined, 'ffn_input');
    device.queue.writeBuffer(inputBuffer, 0, hiddenStates);

    // 2. Gate projection: gate = W_gate @ x
    const gateWeightBuffer = acquireBuffer(layerWeights.ffnGate.byteLength, undefined, 'ffn_gate_w');
    device.queue.writeBuffer(gateWeightBuffer, 0, layerWeights.ffnGate);
    const gateOutput = await runMatmul(inputBuffer, gateWeightBuffer, numTokens, intermediateSize, hiddenSize);

    // 3. Up projection: up = W_up @ x
    const upWeightBuffer = acquireBuffer(layerWeights.ffnUp.byteLength, undefined, 'ffn_up_w');
    device.queue.writeBuffer(upWeightBuffer, 0, layerWeights.ffnUp);
    const upOutput = await runMatmul(inputBuffer, upWeightBuffer, numTokens, intermediateSize, hiddenSize);

    // 4. SiLU activation on gate, multiply with up: out = silu(gate) * up
    const activatedOutput = await runSiLU(gateOutput, {
      size: numTokens * intermediateSize,
      gate: upOutput,
    });

    // 5. Down projection: result = W_down @ activated
    const downWeightBuffer = acquireBuffer(layerWeights.ffnDown.byteLength, undefined, 'ffn_down_w');
    device.queue.writeBuffer(downWeightBuffer, 0, layerWeights.ffnDown);
    const output = await runMatmul(activatedOutput, downWeightBuffer, numTokens, hiddenSize, intermediateSize);

    // 6. Read output back
    const outputData = await readBuffer(output, hiddenStates.byteLength);

    // Cleanup
    releaseBuffer(inputBuffer);
    releaseBuffer(gateWeightBuffer);
    releaseBuffer(upWeightBuffer);
    releaseBuffer(downWeightBuffer);
    releaseBuffer(gateOutput);
    releaseBuffer(upOutput);
    releaseBuffer(activatedOutput);
    releaseBuffer(output);

    return new Float32Array(outputData);
  }

  /**
   * MoE feed-forward network
   * @private
   */
  async _moeFeedForward(layerIdx, hiddenStates, numTokens) {
    if (!this.moeRouter) {
      throw new Error('MoE router not initialized');
    }

    // 1. Route tokens to experts
    const selections = this.moeRouter.route(hiddenStates, numTokens);

    // 2. Create execution plan (group tokens by expert)
    const plan = createExpertExecutionPlan(selections, this.modelConfig.numExperts);

    // 3. Execute each active expert
    const expertOutputs = new Map();

    for (const [expertIdx, data] of plan) {
      if (data.tokenIndices.length === 0) continue;

      // Load expert weights on demand
      await this._ensureExpertLoaded(layerIdx, expertIdx);

      // Gather tokens for this expert
      const expertInput = this._gatherTokens(
        hiddenStates, data.tokenIndices, this.modelConfig.hiddenSize
      );

      // Run expert FFN
      const expertOutput = await this._runExpert(layerIdx, expertIdx, expertInput);
      expertOutputs.set(expertIdx, expertOutput);
    }

    // 4. Combine expert outputs with routing weights
    const combined = combineExpertOutputs(
      expertOutputs,
      selections,
      numTokens,
      this.modelConfig.hiddenSize
    );

    return combined;
  }

  /**
   * Check if layer is MoE layer (some models have dense layers too)
   * @private
   */
  _isMoELayer(layerIdx) {
    // For Mixtral, all layers are MoE
    // Some models alternate between dense and MoE
    return true;
  }

  /**
   * Ensure expert weights are loaded
   * @private
   */
  async _ensureExpertLoaded(layerIdx, expertIdx) {
    const key = `layer_${layerIdx}_expert_${expertIdx}`;
    if (this.expertWeights.has(key)) return;

    // TODO: Load expert weights from storage on demand
    // const weights = await this.storageContext.loadExpert(layerIdx, expertIdx);
    // this.expertWeights.set(key, weights);
  }

  /**
   * Run a single expert FFN
   * @private
   */
  async _runExpert(layerIdx, expertIdx, input) {
    // TODO: Implement with Agent-C's GPU kernels
    return new Float32Array(input.length);
  }

  /**
   * Gather tokens by indices
   * @private
   */
  _gatherTokens(hiddenStates, indices, hiddenSize) {
    const gathered = new Float32Array(indices.length * hiddenSize);
    for (let i = 0; i < indices.length; i++) {
      const srcOffset = indices[i] * hiddenSize;
      gathered.set(
        hiddenStates.subarray(srcOffset, srcOffset + hiddenSize),
        i * hiddenSize
      );
    }
    return gathered;
  }

  /**
   * Layer normalization
   * @private
   */
  _layerNorm(x, eps = 1e-5) {
    const n = x.length;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += x[i];
    mean /= n;

    let variance = 0;
    for (let i = 0; i < n; i++) {
      const diff = x[i] - mean;
      variance += diff * diff;
    }
    variance /= n;

    const std = Math.sqrt(variance + eps);
    const result = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      result[i] = (x[i] - mean) / std;
    }
    return result;
  }

  /**
   * Compute output logits
   * @private
   */
  async _computeLogits(hiddenStates) {
    // TODO: Apply final layer norm + LM head projection
    return new Float32Array(this.modelConfig.vocabSize);
  }

  /**
   * Apply repetition penalty to logits
   * @private
   */
  _applyRepetitionPenalty(logits, previousTokens, penalty) {
    if (penalty === 1.0) return;

    const seen = new Set(previousTokens.slice(-100)); // Last 100 tokens
    for (const token of seen) {
      if (token < logits.length) {
        if (logits[token] > 0) {
          logits[token] /= penalty;
        } else {
          logits[token] *= penalty;
        }
      }
    }
  }

  /**
   * Sample next token from logits
   * @private
   */
  _sample(logits, opts) {
    const { temperature, topP, topK } = opts;

    // Apply temperature
    if (temperature !== 1.0) {
      for (let i = 0; i < logits.length; i++) {
        logits[i] /= temperature;
      }
    }

    // Convert to probabilities
    const probs = this._softmax(logits);

    // Apply top-k filtering
    let candidates = [];
    for (let i = 0; i < probs.length; i++) {
      candidates.push({ token: i, prob: probs[i] });
    }
    candidates.sort((a, b) => b.prob - a.prob);

    if (topK > 0) {
      candidates = candidates.slice(0, topK);
    }

    // Apply top-p (nucleus) filtering
    if (topP < 1.0) {
      let cumProb = 0;
      const filtered = [];
      for (const c of candidates) {
        filtered.push(c);
        cumProb += c.prob;
        if (cumProb >= topP) break;
      }
      candidates = filtered;
    }

    // Renormalize
    const probSum = candidates.reduce((s, c) => s + c.prob, 0);
    for (const c of candidates) {
      c.prob /= probSum;
    }

    // Sample
    const r = Math.random();
    let cumProb = 0;
    for (const c of candidates) {
      cumProb += c.prob;
      if (r < cumProb) {
        return c.token;
      }
    }

    return candidates[candidates.length - 1].token;
  }

  /**
   * Softmax
   * @private
   */
  _softmax(logits) {
    const max = Math.max(...logits);
    const exps = logits.map(l => Math.exp(l - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map(e => e / sum);
  }

  /**
   * Get currently active experts
   * @returns {number[]}
   */
  getActiveExperts() {
    if (!this.moeRouter) return [];
    return this.moeRouter.getActiveExperts();
  }

  /**
   * Clear KV cache
   */
  clearKVCache() {
    if (this.kvCache) {
      this.kvCache.clear();
    }
    this.currentSeqLen = 0;
  }

  /**
   * Get pipeline statistics
   * @returns {Object}
   */
  getStats() {
    const tokensPerSec = this.stats.decodeTimeMs > 0
      ? (this.stats.tokensGenerated / (this.stats.decodeTimeMs / 1000))
      : 0;

    return {
      ...this.stats,
      tokensPerSecond: tokensPerSec.toFixed(2),
      kvCacheMemory: this.kvCache?.getMemoryStats() || null,
      moeStats: this.moeRouter?.getUtilizationStats() || null,
      speculativeStats: this.speculativeDecoder?.getStats() || null
    };
  }

  /**
   * Unload model and free resources
   */
  async unload() {
    this.weights.clear();
    this.expertWeights.clear();
    this.kvCache = null;
    this.moeRouter = null;
    this.speculativeDecoder = null;
    this.tokenizer = null;
    this.manifest = null;
    this.isLoaded = false;
  }
}

/**
 * Create and initialize inference pipeline
 * @param {Object} manifest - Model manifest
 * @param {Object} contexts - External contexts (gpu, memory, storage)
 * @returns {Promise<InferencePipeline>}
 */
export async function createPipeline(manifest, contexts = {}) {
  const pipeline = new InferencePipeline();
  await pipeline.initialize(contexts);
  await pipeline.loadModel(manifest);
  return pipeline;
}

export default InferencePipeline;
