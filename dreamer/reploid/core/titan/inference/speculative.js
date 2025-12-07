/**
 * speculative.js - Speculative Decoding
 *
 * Implements speculative decoding for faster inference.
 * Uses a draft model to generate candidate tokens, then verifies
 * them in parallel with the main model.
 *
 * Based on: "Fast Inference from Transformers via Speculative Decoding"
 * (Leviathan et al., 2022)
 *
 * @module inference/speculative
 */

/**
 * Speculative Decoding Configuration
 * @typedef {Object} SpeculativeConfig
 * @property {number} numDraftTokens - Number of tokens to draft (default: 5)
 * @property {number} maxRejectionRetries - Max retries after rejection (default: 3)
 * @property {boolean} enableTreeDraft - Use tree-based drafting (experimental)
 */

/**
 * Verification Result
 * @typedef {Object} VerificationResult
 * @property {number} acceptedCount - Number of accepted draft tokens
 * @property {number[]} acceptedTokens - The accepted token IDs
 * @property {number} sampledToken - Token sampled from corrected distribution
 * @property {boolean} allAccepted - Whether all draft tokens were accepted
 */

export class SpeculativeDecoder {
  /**
   * @param {SpeculativeConfig} config
   */
  constructor(config = {}) {
    this.numDraftTokens = config.numDraftTokens || 5;
    this.maxRejectionRetries = config.maxRejectionRetries || 3;
    this.enableTreeDraft = config.enableTreeDraft || false;

    // Draft model reference (smaller/faster model)
    this.draftModel = null;
    // Main model reference (for verification)
    this.mainModel = null;

    // Statistics
    this.stats = {
      totalDrafted: 0,
      totalAccepted: 0,
      totalRejected: 0,
      averageAcceptRate: 0
    };
  }

  /**
   * Set the draft model for speculation
   * @param {Object} model - Draft model with generate() method
   */
  setDraftModel(model) {
    this.draftModel = model;
  }

  /**
   * Set the main model for verification
   * @param {Object} model - Main model with forwardBatch() method
   */
  setMainModel(model) {
    this.mainModel = model;
  }

  /**
   * Generate draft tokens using the smaller model
   * @param {number[]} inputIds - Current token sequence
   * @param {Object} kvCache - KV cache state
   * @param {number} numTokens - Number of tokens to draft
   * @returns {Promise<{tokens: number[], logprobs: Float32Array[]}>}
   */
  async generateDraftTokens(inputIds, kvCache, numTokens = this.numDraftTokens) {
    if (!this.draftModel) {
      throw new Error('Draft model not set');
    }

    const draftTokens = [];
    const draftLogprobs = [];

    // Clone KV cache for draft generation (don't pollute main cache)
    const draftKVCache = kvCache?.clone?.() || kvCache;
    let currentIds = [...inputIds];

    for (let i = 0; i < numTokens; i++) {
      // Forward pass through draft model
      const { logits, newKVCache } = await this.draftModel.forward(
        currentIds,
        draftKVCache
      );

      // Sample next token
      const { token, logprob } = this.sampleToken(logits);
      draftTokens.push(token);
      draftLogprobs.push(logprob);

      // Append for next iteration
      currentIds = [...currentIds, token];
    }

    return {
      tokens: draftTokens,
      logprobs: draftLogprobs
    };
  }

  /**
   * Sample a token from logits using temperature sampling
   * @param {Float32Array} logits - Logits for vocabulary
   * @param {number} temperature - Sampling temperature (default: 1.0)
   * @returns {{token: number, logprob: Float32Array}}
   */
  sampleToken(logits, temperature = 1.0) {
    const vocabSize = logits.length;

    // Apply temperature
    const scaledLogits = new Float32Array(vocabSize);
    for (let i = 0; i < vocabSize; i++) {
      scaledLogits[i] = logits[i] / temperature;
    }

    // Compute softmax (log probabilities)
    const logprobs = this.logSoftmax(scaledLogits);
    const probs = new Float32Array(vocabSize);
    for (let i = 0; i < vocabSize; i++) {
      probs[i] = Math.exp(logprobs[i]);
    }

    // Sample from distribution
    const r = Math.random();
    let cumSum = 0;
    for (let i = 0; i < vocabSize; i++) {
      cumSum += probs[i];
      if (r < cumSum) {
        return { token: i, logprob: logprobs };
      }
    }

    // Fallback to last token
    return { token: vocabSize - 1, logprob: logprobs };
  }

  /**
   * Compute log softmax for numerical stability
   * @param {Float32Array} logits
   * @returns {Float32Array}
   */
  logSoftmax(logits) {
    const n = logits.length;
    const result = new Float32Array(n);

    // Find max for stability
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
      if (logits[i] > max) max = logits[i];
    }

    // Compute log-sum-exp
    let sumExp = 0;
    for (let i = 0; i < n; i++) {
      sumExp += Math.exp(logits[i] - max);
    }
    const logSumExp = max + Math.log(sumExp);

    // Compute log probabilities
    for (let i = 0; i < n; i++) {
      result[i] = logits[i] - logSumExp;
    }

    return result;
  }

  /**
   * Verify draft tokens against the main model
   * Uses parallel forward pass for efficiency
   *
   * @param {number[]} inputIds - Original input sequence
   * @param {number[]} draftTokens - Drafted token candidates
   * @param {Float32Array[]} draftLogprobs - Log probs from draft model
   * @param {Object} kvCache - Main model KV cache
   * @returns {Promise<VerificationResult>}
   */
  async verifyDraftTokens(inputIds, draftTokens, draftLogprobs, kvCache) {
    if (!this.mainModel) {
      throw new Error('Main model not set');
    }

    // Concatenate input + draft tokens for parallel verification
    const fullSequence = [...inputIds, ...draftTokens];

    // Forward pass through main model (processes all positions at once)
    const { logits: mainLogits } = await this.mainModel.forward(
      fullSequence,
      kvCache
    );

    const numDraft = draftTokens.length;
    const acceptedTokens = [];
    let acceptedCount = 0;

    // Verify each draft token using rejection sampling
    for (let i = 0; i < numDraft; i++) {
      const draftToken = draftTokens[i];
      const draftLogprob = draftLogprobs[i][draftToken];

      // Get main model's logprob for this position
      const mainLogprob = this.logSoftmax(
        mainLogits.subarray(i * mainLogits.length / numDraft,
                           (i + 1) * mainLogits.length / numDraft)
      );
      const mainTokenLogprob = mainLogprob[draftToken];

      // Acceptance probability: min(1, p_main / p_draft)
      const acceptProb = Math.min(1, Math.exp(mainTokenLogprob - draftLogprob));

      if (Math.random() < acceptProb) {
        // Accept this token
        acceptedTokens.push(draftToken);
        acceptedCount++;
      } else {
        // Reject - stop here and sample from adjusted distribution
        break;
      }
    }

    // Sample final token from the residual distribution
    const sampledToken = this.sampleFromResidual(
      mainLogits,
      draftLogprobs[acceptedCount] || new Float32Array(mainLogits.length),
      acceptedCount < numDraft
    );

    // Update statistics
    this.stats.totalDrafted += numDraft;
    this.stats.totalAccepted += acceptedCount;
    this.stats.totalRejected += (numDraft - acceptedCount);
    this.stats.averageAcceptRate =
      this.stats.totalAccepted / this.stats.totalDrafted;

    return {
      acceptedCount,
      acceptedTokens,
      sampledToken,
      allAccepted: acceptedCount === numDraft
    };
  }

  /**
   * Sample from residual distribution after rejection
   * @param {Float32Array} mainLogits - Main model logits
   * @param {Float32Array} draftLogprobs - Draft model log probs
   * @param {boolean} wasRejected - Whether a token was rejected
   * @returns {number} Sampled token ID
   */
  sampleFromResidual(mainLogits, draftLogprobs, wasRejected) {
    if (!wasRejected) {
      // All accepted - sample normally from main model
      return this.sampleToken(mainLogits).token;
    }

    const vocabSize = mainLogits.length;
    const mainProbs = new Float32Array(vocabSize);
    const draftProbs = new Float32Array(vocabSize);

    // Convert to probabilities
    const mainLogprobs = this.logSoftmax(mainLogits);
    for (let i = 0; i < vocabSize; i++) {
      mainProbs[i] = Math.exp(mainLogprobs[i]);
      draftProbs[i] = Math.exp(draftLogprobs[i] || -Infinity);
    }

    // Compute residual: max(0, p_main - p_draft)
    const residual = new Float32Array(vocabSize);
    let residualSum = 0;
    for (let i = 0; i < vocabSize; i++) {
      residual[i] = Math.max(0, mainProbs[i] - draftProbs[i]);
      residualSum += residual[i];
    }

    // Normalize and sample
    if (residualSum > 0) {
      const r = Math.random() * residualSum;
      let cumSum = 0;
      for (let i = 0; i < vocabSize; i++) {
        cumSum += residual[i];
        if (r < cumSum) {
          return i;
        }
      }
    }

    // Fallback: sample from main distribution
    return this.sampleToken(mainLogits).token;
  }

  /**
   * Run one step of speculative decoding
   * @param {number[]} inputIds - Current sequence
   * @param {Object} mainKVCache - Main model KV cache
   * @param {Object} draftKVCache - Draft model KV cache
   * @returns {Promise<{newTokens: number[], mainKVCache: Object}>}
   */
  async step(inputIds, mainKVCache, draftKVCache) {
    // Generate draft tokens
    const { tokens: draftTokens, logprobs: draftLogprobs } =
      await this.generateDraftTokens(inputIds, draftKVCache);

    // Verify against main model
    const result = await this.verifyDraftTokens(
      inputIds,
      draftTokens,
      draftLogprobs,
      mainKVCache
    );

    // Combine accepted tokens + sampled token
    const newTokens = [...result.acceptedTokens, result.sampledToken];

    return {
      newTokens,
      mainKVCache,
      acceptRate: result.acceptedCount / draftTokens.length
    };
  }

  /**
   * Get speculative decoding statistics
   * @returns {Object} Decoding stats
   */
  getStats() {
    return {
      ...this.stats,
      speedup: this.estimateSpeedup()
    };
  }

  /**
   * Estimate speedup from speculative decoding
   * Theoretical: (1 + α*k) where α is accept rate, k is num draft tokens
   * @returns {number} Estimated speedup factor
   */
  estimateSpeedup() {
    if (this.stats.totalDrafted === 0) return 1.0;

    const α = this.stats.averageAcceptRate;
    const k = this.numDraftTokens;

    // Account for draft model overhead (assume ~0.1x main model cost)
    const draftOverhead = 0.1 * k;

    // Effective tokens per main model call
    const tokensPerCall = 1 + α * k;

    return tokensPerCall / (1 + draftOverhead);
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalDrafted: 0,
      totalAccepted: 0,
      totalRejected: 0,
      averageAcceptRate: 0
    };
  }
}

/**
 * Tree-based speculative decoding (experimental)
 * Generates multiple candidate paths and verifies in parallel
 */
export class TreeSpeculativeDecoder extends SpeculativeDecoder {
  constructor(config = {}) {
    super(config);
    this.branchFactor = config.branchFactor || 2;
    this.maxDepth = config.maxDepth || 3;
  }

  /**
   * Generate tree of draft tokens
   * @param {number[]} inputIds - Current sequence
   * @param {Object} kvCache - KV cache
   * @returns {Promise<Object>} Tree of draft candidates
   */
  async generateDraftTree(inputIds, kvCache) {
    // Build tree structure with multiple branches
    const root = { token: null, children: [], logprob: 0, depth: 0 };

    const buildTree = async (node, ids, depth) => {
      if (depth >= this.maxDepth) return;

      const { logits } = await this.draftModel.forward(ids, kvCache);
      const logprobs = this.logSoftmax(logits);

      // Get top-k tokens as branches
      const topK = this.getTopK(logprobs, this.branchFactor);

      for (const { token, logprob } of topK) {
        const child = {
          token,
          logprob: node.logprob + logprob,
          children: [],
          depth: depth + 1
        };
        node.children.push(child);

        // Recursively build subtree
        await buildTree(child, [...ids, token], depth + 1);
      }
    };

    await buildTree(root, inputIds, 0);
    return root;
  }

  /**
   * Get top-k tokens from log probabilities
   * @param {Float32Array} logprobs
   * @param {number} k
   * @returns {{token: number, logprob: number}[]}
   */
  getTopK(logprobs, k) {
    const indexed = [];
    for (let i = 0; i < logprobs.length; i++) {
      indexed.push({ token: i, logprob: logprobs[i] });
    }
    indexed.sort((a, b) => b.logprob - a.logprob);
    return indexed.slice(0, k);
  }
}

export default SpeculativeDecoder;
