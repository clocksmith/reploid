/**
 * moe-router.js - Mixture of Experts Router
 *
 * Implements top-k expert selection for Mixtral-style MoE models.
 * Handles gating network computation and expert selection.
 *
 * @module inference/moe-router
 */

import { getDevice } from '../gpu/device.js';
import { runMatmul, runSoftmax } from '../gpu/kernel-selector.js';
import { acquireBuffer, releaseBuffer, readBuffer } from '../gpu/buffer-pool.js';

/**
 * MoE Router Configuration
 * @typedef {Object} MoEConfig
 * @property {number} numExperts - Total number of experts (e.g., 8 for Mixtral)
 * @property {number} topK - Number of experts to select per token (e.g., 2)
 * @property {number} hiddenSize - Hidden dimension size
 * @property {boolean} normalizeWeights - Whether to renormalize weights after top-k
 */

/**
 * Expert Selection Result
 * @typedef {Object} ExpertSelection
 * @property {number[]} indices - Selected expert indices
 * @property {Float32Array} weights - Corresponding weights for each selected expert
 * @property {Float32Array} routerLogits - Raw router logits (for auxiliary loss)
 */

export class MoERouter {
  /**
   * @param {MoEConfig} config
   */
  constructor(config) {
    this.numExperts = config.numExperts || 8;
    this.topK = config.topK || 2;
    this.hiddenSize = config.hiddenSize || 4096;
    this.normalizeWeights = config.normalizeWeights !== false;

    // Router gate weights (linear projection: hidden_size -> num_experts)
    // Will be loaded from model weights
    this.gateWeight = null;

    // Track active experts for the current batch
    this.activeExperts = new Set();

    // Auxiliary load balancing stats
    this.loadBalanceStats = {
      expertCounts: new Uint32Array(this.numExperts),
      totalTokens: 0
    };
  }

  /**
   * Load router gate weights from model
   * @param {Float32Array|GPUBuffer} weights - Gate weight matrix [hidden_size, num_experts]
   */
  loadWeights(weights) {
    this.gateWeight = weights;
  }

  /**
   * Compute router logits from hidden states (CPU fallback)
   * @param {Float32Array} hiddenStates - Input tensor [batchSize * seqLen, hiddenSize]
   * @param {number} numTokens - Number of tokens
   * @returns {Float32Array} Router logits [numTokens, numExperts]
   */
  computeRouterLogitsCPU(hiddenStates, numTokens) {
    if (!this.gateWeight) {
      throw new Error('Router gate weights not loaded');
    }

    const logits = new Float32Array(numTokens * this.numExperts);

    // Matrix multiply: hidden_states @ gate_weight
    for (let t = 0; t < numTokens; t++) {
      for (let e = 0; e < this.numExperts; e++) {
        let sum = 0;
        for (let h = 0; h < this.hiddenSize; h++) {
          sum += hiddenStates[t * this.hiddenSize + h] *
                 this.gateWeight[h * this.numExperts + e];
        }
        logits[t * this.numExperts + e] = sum;
      }
    }

    return logits;
  }

  /**
   * Compute router logits using GPU (when available)
   * @param {GPUBuffer} hiddenStates - Input tensor on GPU [numTokens, hiddenSize]
   * @param {number} numTokens - Number of tokens
   * @param {Object} gpuContext - GPU context (optional, uses global device if not provided)
   * @returns {Promise<GPUBuffer>} Router logits on GPU [numTokens, numExperts]
   */
  async computeRouterLogitsGPU(hiddenStates, numTokens, gpuContext = null) {
    const device = gpuContext?.device || getDevice();
    if (!device) {
      throw new Error('GPU device not available');
    }

    if (!this.gateWeight) {
      throw new Error('Router gate weights not loaded');
    }

    // Ensure gate weight is on GPU
    let gateWeightBuffer = this.gateWeight;
    let createdGateBuffer = false;

    if (!(this.gateWeight instanceof GPUBuffer)) {
      // Upload gate weights to GPU
      gateWeightBuffer = device.createBuffer({
        label: 'moe_gate_weight',
        size: this.gateWeight.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(gateWeightBuffer, 0, this.gateWeight);
      createdGateBuffer = true;

      // Cache the GPU buffer for reuse
      this.gateWeightGPU = gateWeightBuffer;
    }

    // Matrix multiply: hidden_states [numTokens, hiddenSize] @ gate_weight [hiddenSize, numExperts]
    // Result: [numTokens, numExperts]
    const logitsBuffer = await runMatmul(
      hiddenStates,
      gateWeightBuffer,
      numTokens,           // M
      this.numExperts,     // N
      this.hiddenSize,     // K
      { preferF16: false } // Use F32 for routing precision
    );

    return logitsBuffer;
  }

  /**
   * Route tokens using GPU and read back results
   * @param {GPUBuffer} hiddenStates - Hidden states on GPU
   * @param {number} numTokens - Number of tokens
   * @returns {Promise<ExpertSelection[]>} Expert selections for each token
   */
  async routeGPU(hiddenStates, numTokens) {
    // Compute router logits on GPU
    const logitsBuffer = await this.computeRouterLogitsGPU(hiddenStates, numTokens);

    // Read back logits to CPU for top-k selection
    // (GPU top-k is complex and not always faster for small numExperts)
    const logits = await readBuffer(logitsBuffer, Float32Array);

    const selections = [];
    this.activeExperts.clear();

    for (let t = 0; t < numTokens; t++) {
      const tokenLogits = logits.subarray(
        t * this.numExperts,
        (t + 1) * this.numExperts
      );

      const selection = this.selectExpertsForToken(tokenLogits);
      selections.push(selection);

      for (const idx of selection.indices) {
        this.activeExperts.add(idx);
        this.loadBalanceStats.expertCounts[idx]++;
      }
      this.loadBalanceStats.totalTokens++;
    }

    // Clean up logits buffer
    logitsBuffer.destroy();

    return selections;
  }

  /**
   * Apply softmax to logits
   * @param {Float32Array} logits - Input logits
   * @param {number} size - Size of softmax dimension
   * @returns {Float32Array} Softmax probabilities
   */
  softmax(logits, size) {
    const result = new Float32Array(size);

    // Find max for numerical stability
    let max = -Infinity;
    for (let i = 0; i < size; i++) {
      if (logits[i] > max) max = logits[i];
    }

    // Compute exp and sum
    let sum = 0;
    for (let i = 0; i < size; i++) {
      result[i] = Math.exp(logits[i] - max);
      sum += result[i];
    }

    // Normalize
    for (let i = 0; i < size; i++) {
      result[i] /= sum;
    }

    return result;
  }

  /**
   * Select top-k experts for a single token
   * @param {Float32Array} logits - Router logits for one token [numExperts]
   * @returns {ExpertSelection} Selected experts with weights
   */
  selectExpertsForToken(logits) {
    // Apply softmax to get probabilities
    const probs = this.softmax(logits, this.numExperts);

    // Find top-k experts
    const indexed = [];
    for (let i = 0; i < this.numExperts; i++) {
      indexed.push({ index: i, prob: probs[i] });
    }
    indexed.sort((a, b) => b.prob - a.prob);

    const topKExperts = indexed.slice(0, this.topK);
    const indices = topKExperts.map(e => e.index);
    const weights = new Float32Array(topKExperts.map(e => e.prob));

    // Renormalize weights if configured
    if (this.normalizeWeights) {
      let weightSum = 0;
      for (let i = 0; i < this.topK; i++) {
        weightSum += weights[i];
      }
      for (let i = 0; i < this.topK; i++) {
        weights[i] /= weightSum;
      }
    }

    return {
      indices,
      weights,
      routerLogits: new Float32Array(logits)
    };
  }

  /**
   * Route a batch of tokens to experts
   * @param {Float32Array} hiddenStates - Input hidden states [numTokens, hiddenSize]
   * @param {number} numTokens - Number of tokens
   * @returns {ExpertSelection[]} Expert selections for each token
   */
  route(hiddenStates, numTokens) {
    // Compute router logits
    const allLogits = this.computeRouterLogitsCPU(hiddenStates, numTokens);

    const selections = [];
    this.activeExperts.clear();

    for (let t = 0; t < numTokens; t++) {
      // Extract logits for this token
      const tokenLogits = allLogits.subarray(
        t * this.numExperts,
        (t + 1) * this.numExperts
      );

      const selection = this.selectExpertsForToken(tokenLogits);
      selections.push(selection);

      // Track active experts
      for (const idx of selection.indices) {
        this.activeExperts.add(idx);
      }

      // Update load balance stats
      for (const idx of selection.indices) {
        this.loadBalanceStats.expertCounts[idx]++;
      }
      this.loadBalanceStats.totalTokens++;
    }

    return selections;
  }

  /**
   * Get currently active expert indices
   * @returns {number[]} Array of active expert indices
   */
  getActiveExperts() {
    return Array.from(this.activeExperts).sort((a, b) => a - b);
  }

  /**
   * Compute auxiliary load balancing loss
   * Used during training to encourage balanced expert utilization.
   * @returns {number} Load balancing loss value
   */
  computeLoadBalanceLoss() {
    if (this.loadBalanceStats.totalTokens === 0) return 0;

    const numTokens = this.loadBalanceStats.totalTokens;
    const expertProbs = new Float32Array(this.numExperts);

    // Compute fraction of tokens routed to each expert
    for (let i = 0; i < this.numExperts; i++) {
      expertProbs[i] = this.loadBalanceStats.expertCounts[i] / numTokens;
    }

    // Load balance loss: sum of (expert_prob * expert_fraction)
    // Ideally each expert gets 1/numExperts of tokens
    let loss = 0;
    const idealFraction = 1 / this.numExperts;
    for (let i = 0; i < this.numExperts; i++) {
      // Squared deviation from ideal
      const deviation = expertProbs[i] - idealFraction;
      loss += deviation * deviation;
    }

    return loss * this.numExperts;
  }

  /**
   * Reset load balancing statistics
   */
  resetStats() {
    this.loadBalanceStats.expertCounts.fill(0);
    this.loadBalanceStats.totalTokens = 0;
    this.activeExperts.clear();
  }

  /**
   * Get expert utilization statistics
   * @returns {Object} Utilization stats per expert
   */
  getUtilizationStats() {
    const total = this.loadBalanceStats.totalTokens;
    if (total === 0) {
      return { experts: [], totalTokens: 0 };
    }

    const experts = [];
    for (let i = 0; i < this.numExperts; i++) {
      experts.push({
        index: i,
        count: this.loadBalanceStats.expertCounts[i],
        percentage: (this.loadBalanceStats.expertCounts[i] / total) * 100
      });
    }

    return {
      experts,
      totalTokens: total,
      loadBalanceLoss: this.computeLoadBalanceLoss()
    };
  }
}

/**
 * Create a grouped expert execution plan
 * Groups tokens by their selected experts for efficient batched computation
 *
 * @param {ExpertSelection[]} selections - Expert selections for all tokens
 * @param {number} numExperts - Total number of experts
 * @returns {Map<number, {tokenIndices: number[], weights: Float32Array}>}
 */
export function createExpertExecutionPlan(selections, numExperts) {
  const plan = new Map();

  // Initialize empty plans for each expert
  for (let e = 0; e < numExperts; e++) {
    plan.set(e, { tokenIndices: [], weights: [] });
  }

  // Group tokens by expert
  for (let t = 0; t < selections.length; t++) {
    const sel = selections[t];
    for (let k = 0; k < sel.indices.length; k++) {
      const expertIdx = sel.indices[k];
      const weight = sel.weights[k];
      plan.get(expertIdx).tokenIndices.push(t);
      plan.get(expertIdx).weights.push(weight);
    }
  }

  // Convert weight arrays to Float32Array
  for (const [expertIdx, data] of plan) {
    plan.set(expertIdx, {
      tokenIndices: data.tokenIndices,
      weights: new Float32Array(data.weights)
    });
  }

  return plan;
}

/**
 * Combine expert outputs with routing weights
 *
 * @param {Map<number, Float32Array>} expertOutputs - Output from each expert [numTokens, hiddenSize]
 * @param {ExpertSelection[]} selections - Original routing decisions
 * @param {number} numTokens - Number of tokens
 * @param {number} hiddenSize - Hidden dimension
 * @returns {Float32Array} Combined output [numTokens, hiddenSize]
 */
export function combineExpertOutputs(expertOutputs, selections, numTokens, hiddenSize) {
  const output = new Float32Array(numTokens * hiddenSize);

  for (let t = 0; t < numTokens; t++) {
    const sel = selections[t];

    for (let k = 0; k < sel.indices.length; k++) {
      const expertIdx = sel.indices[k];
      const weight = sel.weights[k];
      const expertOut = expertOutputs.get(expertIdx);

      if (!expertOut) continue;

      // Weighted sum: output += weight * expert_output
      for (let h = 0; h < hiddenSize; h++) {
        output[t * hiddenSize + h] += weight * expertOut[t * hiddenSize + h];
      }
    }
  }

  return output;
}

export default MoERouter;
