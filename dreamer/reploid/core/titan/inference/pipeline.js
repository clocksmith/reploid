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

// TitanLoader for weight loading
import { getTitanLoader } from '../loader/titan-loader.js';
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

    // TitanLoader instance
    this.titanLoader = null;

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

    // RoPE frequency buffers (initialized in loadModel)
    this.ropeFreqsCos = null;
    this.ropeFreqsSin = null;
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

    // Initialize RoPE frequencies
    await this._initRoPEFrequencies();

    this.isLoaded = true;
  }

  /**
   * Initialize RoPE frequency buffers
   * @private
   */
  async _initRoPEFrequencies() {
    const { headDim, maxSeqLen, ropeTheta } = this.modelConfig;
    const halfDim = headDim / 2;

    // Compute frequencies: theta_i = 1 / (base^(2i/d))
    const freqs = new Float32Array(halfDim);
    for (let i = 0; i < halfDim; i++) {
      freqs[i] = 1.0 / Math.pow(ropeTheta, (2 * i) / headDim);
    }

    // Compute cos/sin for each position up to maxSeqLen
    const cosValues = new Float32Array(maxSeqLen * halfDim);
    const sinValues = new Float32Array(maxSeqLen * halfDim);

    for (let pos = 0; pos < maxSeqLen; pos++) {
      for (let i = 0; i < halfDim; i++) {
        const angle = pos * freqs[i];
        cosValues[pos * halfDim + i] = Math.cos(angle);
        sinValues[pos * halfDim + i] = Math.sin(angle);
      }
    }

    // Upload to GPU if available
    const device = getDevice();
    if (device && this.useGPU) {
      this.ropeFreqsCos = acquireBuffer(cosValues.byteLength, undefined, 'rope_cos');
      this.ropeFreqsSin = acquireBuffer(sinValues.byteLength, undefined, 'rope_sin');
      device.queue.writeBuffer(this.ropeFreqsCos, 0, cosValues);
      device.queue.writeBuffer(this.ropeFreqsSin, 0, sinValues);
    } else {
      // Keep as CPU arrays
      this.ropeFreqsCos = cosValues;
      this.ropeFreqsSin = sinValues;
    }

    console.log(`[Pipeline] RoPE frequencies initialized: ${maxSeqLen} positions, dim=${halfDim}`);
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
   * Load model weights from storage via TitanLoader
   * @private
   */
  async _loadWeights() {
    // Initialize TitanLoader if not already done
    if (!this.titanLoader) {
      this.titanLoader = getTitanLoader();
      await this.titanLoader.init();
    }

    // Load model via TitanLoader
    const modelId = this.manifest.modelId || this.manifest.model_id || 'default';
    await this.titanLoader.load(modelId, {
      verifyHashes: true,
      onProgress: (info) => {
        console.log(`[Pipeline] Loading: ${info.stage} - ${Math.round(info.progress * 100)}%`);
      },
    });

    // Map TitanLoader layers to pipeline weights
    for (let l = 0; l < this.modelConfig.numLayers; l++) {
      const layerWeights = this.titanLoader.getLayerWeights(l);
      if (layerWeights) {
        this.weights.set(`layer_${l}`, layerWeights);
      }
    }

    // Store embeddings reference
    if (this.titanLoader.embeddings) {
      this.weights.set('embed', this.titanLoader.embeddings);
    }

    // Store LM head reference
    if (this.titanLoader.lmHead) {
      this.weights.set('lm_head', this.titanLoader.lmHead);
    }

    // Store final norm reference
    if (this.titanLoader.finalNorm) {
      this.weights.set('final_norm', this.titanLoader.finalNorm);
    }

    // MoE router weights - loaded on demand via titanLoader.loadExpert()
    if (this.moeRouter && this.modelConfig.useMoE) {
      console.log('[Pipeline] MoE model - experts will be loaded on demand');
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
    const hiddenSize = this.modelConfig.hiddenSize;
    const numTokens = tokenIds.length;

    // Get embeddings buffer from TitanLoader
    const embedBuffer = this.weights.get('embed');
    if (!embedBuffer) {
      console.warn('[Pipeline] Embeddings not loaded, using placeholder');
      return new Float32Array(numTokens * hiddenSize);
    }

    const device = getDevice();
    if (!device || !this.useGPU) {
      // CPU fallback - read embeddings if possible
      if (embedBuffer instanceof Float32Array) {
        const result = new Float32Array(numTokens * hiddenSize);
        for (let i = 0; i < numTokens; i++) {
          const tokenId = tokenIds[i];
          const srcOffset = tokenId * hiddenSize;
          const dstOffset = i * hiddenSize;
          for (let j = 0; j < hiddenSize; j++) {
            result[dstOffset + j] = embedBuffer[srcOffset + j];
          }
        }
        return result;
      }
      return new Float32Array(numTokens * hiddenSize);
    }

    // GPU path: gather embeddings
    // Create token indices buffer
    const tokenIdBuffer = acquireBuffer(numTokens * 4, undefined, 'token_ids');
    device.queue.writeBuffer(tokenIdBuffer, 0, new Uint32Array(tokenIds));

    // Create output buffer for gathered embeddings
    const outputSize = numTokens * hiddenSize * 4;
    const outputBuffer = acquireBuffer(outputSize, undefined, 'embedded_tokens');

    // For now, read back from GPU embeddings and do gather on CPU
    // Full GPU gather would require a custom kernel
    const embeddingData = await readBuffer(embedBuffer, this.modelConfig.vocabSize * hiddenSize * 4);
    const embeddings = new Float32Array(embeddingData);
    const result = new Float32Array(numTokens * hiddenSize);

    for (let i = 0; i < numTokens; i++) {
      const tokenId = tokenIds[i];
      const srcOffset = tokenId * hiddenSize;
      const dstOffset = i * hiddenSize;
      for (let j = 0; j < hiddenSize; j++) {
        result[dstOffset + j] = embeddings[srcOffset + j];
      }
    }

    // Upload result to GPU
    device.queue.writeBuffer(outputBuffer, 0, result);

    releaseBuffer(tokenIdBuffer);

    return result;
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

    const qSize = numTokens * numHeads * headDim;
    const kvSize = numTokens * numKVHeads * headDim;

    // 1. Create input buffer from hidden states
    let inputBuffer = acquireBuffer(hiddenStates.byteLength, undefined, 'attn_input');
    device.queue.writeBuffer(inputBuffer, 0, hiddenStates);

    // 2. Apply RMSNorm (input normalization)
    let normedBuffer = inputBuffer;
    if (layerWeights.inputNorm) {
      const normWeightBuf = this._getWeightBuffer(layerWeights.inputNorm, 'attn_norm_w');
      normedBuffer = await runRMSNorm(inputBuffer, normWeightBuf, 1e-5, {
        batchSize: numTokens,
        hiddenSize,
      });
      if (inputBuffer !== normedBuffer) releaseBuffer(inputBuffer);
      if (!(layerWeights.inputNorm instanceof GPUBuffer)) releaseBuffer(normWeightBuf);
    }

    // 3. Project to Q, K, V using actual weights
    let Q, K, V;

    if (layerWeights.qProj) {
      const qProjBuf = this._getWeightBuffer(layerWeights.qProj, 'q_proj');
      Q = await runMatmul(normedBuffer, qProjBuf, numTokens, numHeads * headDim, hiddenSize);
      if (!(layerWeights.qProj instanceof GPUBuffer)) releaseBuffer(qProjBuf);
    } else {
      Q = acquireBuffer(qSize * 4, undefined, 'Q');
    }

    if (layerWeights.kProj) {
      const kProjBuf = this._getWeightBuffer(layerWeights.kProj, 'k_proj');
      K = await runMatmul(normedBuffer, kProjBuf, numTokens, numKVHeads * headDim, hiddenSize);
      if (!(layerWeights.kProj instanceof GPUBuffer)) releaseBuffer(kProjBuf);
    } else {
      K = acquireBuffer(kvSize * 4, undefined, 'K');
    }

    if (layerWeights.vProj) {
      const vProjBuf = this._getWeightBuffer(layerWeights.vProj, 'v_proj');
      V = await runMatmul(normedBuffer, vProjBuf, numTokens, numKVHeads * headDim, hiddenSize);
      if (!(layerWeights.vProj instanceof GPUBuffer)) releaseBuffer(vProjBuf);
    } else {
      V = acquireBuffer(kvSize * 4, undefined, 'V');
    }

    releaseBuffer(normedBuffer);

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
    const attnOutput = await runAttention(Q, K, V, null, numHeads, headDim, {
      seqLen: numTokens,
      kvLen: this.currentSeqLen + numTokens,
      numKVHeads,
      causal: true,
    });

    // 7. Apply output projection
    let output;
    if (layerWeights.oProj) {
      const oProjBuf = this._getWeightBuffer(layerWeights.oProj, 'o_proj');
      output = await runMatmul(attnOutput, oProjBuf, numTokens, hiddenSize, numHeads * headDim);
      if (!(layerWeights.oProj instanceof GPUBuffer)) releaseBuffer(oProjBuf);
    } else {
      output = attnOutput;
    }

    // 8. Read output back
    const outputData = await readBuffer(output, numTokens * hiddenSize * 4);

    // Cleanup
    releaseBuffer(Q);
    releaseBuffer(K);
    releaseBuffer(V);
    if (output !== attnOutput) releaseBuffer(attnOutput);
    releaseBuffer(output);

    return new Float32Array(outputData);
  }

  /**
   * Get or create GPU buffer for weight tensor
   * @private
   */
  _getWeightBuffer(weight, label) {
    if (weight instanceof GPUBuffer) {
      return weight;
    }
    const device = getDevice();
    const buf = acquireBuffer(weight.byteLength, undefined, label);
    device.queue.writeBuffer(buf, 0, weight);
    return buf;
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

    // Load expert weights via TitanLoader
    if (this.titanLoader) {
      const weights = await this.titanLoader.loadExpert(layerIdx, expertIdx);
      if (weights) {
        this.expertWeights.set(key, weights);
      }
    }
  }

  /**
   * Run a single expert FFN
   * @private
   */
  async _runExpert(layerIdx, expertIdx, input) {
    const key = `layer_${layerIdx}_expert_${expertIdx}`;
    const weights = this.expertWeights.get(key);

    if (!weights || !weights.gate || !weights.up || !weights.down) {
      console.warn(`[Pipeline] Expert ${expertIdx} weights not available for layer ${layerIdx}`);
      return new Float32Array(input.length);
    }

    const device = getDevice();
    const hiddenSize = this.modelConfig.hiddenSize;
    const intermediateSize = this.modelConfig.intermediateSize;
    const numTokens = input.length / hiddenSize;

    if (!device || !this.useGPU) {
      // CPU fallback
      return new Float32Array(input.length);
    }

    // 1. Create input buffer
    const inputBuffer = acquireBuffer(input.byteLength, undefined, 'expert_input');
    device.queue.writeBuffer(inputBuffer, 0, input);

    // 2. Gate projection: gate = W_gate @ x
    const gateOutput = await runMatmul(inputBuffer, weights.gate, numTokens, intermediateSize, hiddenSize);

    // 3. Up projection: up = W_up @ x
    const upOutput = await runMatmul(inputBuffer, weights.up, numTokens, intermediateSize, hiddenSize);

    // 4. SiLU activation: out = silu(gate) * up
    const activatedOutput = await runSiLU(gateOutput, {
      size: numTokens * intermediateSize,
      gate: upOutput,
    });

    // 5. Down projection: result = W_down @ activated
    const output = await runMatmul(activatedOutput, weights.down, numTokens, hiddenSize, intermediateSize);

    // 6. Read output back
    const outputData = await readBuffer(output, input.byteLength);

    // Cleanup
    releaseBuffer(inputBuffer);
    releaseBuffer(gateOutput);
    releaseBuffer(upOutput);
    releaseBuffer(activatedOutput);
    releaseBuffer(output);

    return new Float32Array(outputData);
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
   * Compute output logits from final hidden states
   * @private
   */
  async _computeLogits(hiddenStates) {
    const { hiddenSize, vocabSize } = this.modelConfig;
    const device = getDevice();

    // Get final norm and LM head weights
    const finalNorm = this.weights.get('final_norm');
    const lmHead = this.weights.get('lm_head');

    if (!finalNorm || !lmHead) {
      console.warn('[Pipeline] Final norm or LM head not loaded, returning zeros');
      return new Float32Array(vocabSize);
    }

    // For single token decode, hiddenStates is [hiddenSize]
    const numTokens = hiddenStates.length / hiddenSize;

    if (!device || !this.useGPU) {
      // CPU path: simple RMSNorm + matmul
      const normed = this._rmsNormCPU(hiddenStates, finalNorm);
      return this._matmulCPU(normed, lmHead, numTokens, vocabSize, hiddenSize);
    }

    // GPU path
    // 1. Upload hidden states
    const inputBuffer = acquireBuffer(hiddenStates.byteLength, undefined, 'logits_input');
    device.queue.writeBuffer(inputBuffer, 0, hiddenStates);

    // 2. Apply final RMSNorm
    const normWeightBuffer = finalNorm instanceof GPUBuffer ? finalNorm :
      (() => {
        const buf = acquireBuffer(finalNorm.byteLength, undefined, 'final_norm_w');
        device.queue.writeBuffer(buf, 0, finalNorm);
        return buf;
      })();

    const normedBuffer = await runRMSNorm(inputBuffer, normWeightBuffer, 1e-5, {
      batchSize: numTokens,
      hiddenSize,
    });

    // 3. Project to vocab via LM head: [numTokens, hiddenSize] x [hiddenSize, vocabSize]
    const lmHeadBuffer = lmHead instanceof GPUBuffer ? lmHead :
      (() => {
        const buf = acquireBuffer(lmHead.byteLength, undefined, 'lm_head_w');
        device.queue.writeBuffer(buf, 0, lmHead);
        return buf;
      })();

    const logitsBuffer = await runMatmul(normedBuffer, lmHeadBuffer, numTokens, vocabSize, hiddenSize);

    // 4. Read back logits
    const logitsData = await readBuffer(logitsBuffer, numTokens * vocabSize * 4);

    // Cleanup
    releaseBuffer(inputBuffer);
    releaseBuffer(normedBuffer);
    releaseBuffer(logitsBuffer);
    if (!(finalNorm instanceof GPUBuffer)) releaseBuffer(normWeightBuffer);
    if (!(lmHead instanceof GPUBuffer)) releaseBuffer(lmHeadBuffer);

    return new Float32Array(logitsData);
  }

  /**
   * CPU RMSNorm implementation
   * @private
   */
  _rmsNormCPU(x, weight, eps = 1e-5) {
    const n = x.length;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      sumSq += x[i] * x[i];
    }
    const rms = Math.sqrt(sumSq / n + eps);

    const result = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      result[i] = (x[i] / rms) * weight[i % weight.length];
    }
    return result;
  }

  /**
   * CPU matmul implementation (for fallback)
   * @private
   */
  _matmulCPU(input, weight, M, N, K) {
    // input: [M, K], weight: [K, N] (or [N, K] transposed)
    // For LM head, weight is typically [vocabSize, hiddenSize] stored row-major
    const result = new Float32Array(M * N);

    for (let m = 0; m < M; m++) {
      for (let n = 0; n < N; n++) {
        let sum = 0;
        for (let k = 0; k < K; k++) {
          // Assuming weight is [N, K] (vocab x hidden)
          sum += input[m * K + k] * weight[n * K + k];
        }
        result[m * N + n] = sum;
      }
    }
    return result;
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
