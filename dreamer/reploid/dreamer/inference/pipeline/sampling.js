/**
 * sampling.js - Token Sampling Module
 *
 * Handles token sampling from logits with:
 * - Temperature scaling
 * - Top-k filtering
 * - Top-p (nucleus) filtering
 * - Repetition penalty
 * - Greedy (argmax) mode
 *
 * @module inference/pipeline/sampling
 */

/**
 * Apply repetition penalty to logits
 * @param {Float32Array} logits - Logits array (modified in place)
 * @param {number[]} previousTokens - Previously generated tokens
 * @param {number} penalty - Repetition penalty (1.0 = no penalty)
 */
export function applyRepetitionPenalty(logits, previousTokens, penalty) {
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
 * Softmax function
 * @param {Float32Array} logits - Input logits
 * @returns {Float32Array} Probability distribution
 */
export function softmax(logits) {
  const n = logits.length;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = logits[i];
    if (v > max) max = v;
  }

  const exps = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const e = Math.exp(logits[i] - max);
    exps[i] = e;
    sum += e;
  }

  // Normalize in place
  const invSum = sum > 0 ? 1 / sum : 0;
  for (let i = 0; i < n; i++) {
    exps[i] *= invSum;
  }
  return exps;
}

/**
 * Sample next token from logits
 * @param {Float32Array} logits - Input logits (may be modified)
 * @param {object} opts - Sampling options
 * @param {number} opts.temperature - Temperature (0 = greedy)
 * @param {number} opts.topP - Top-p (nucleus) threshold
 * @param {number} opts.topK - Top-k filtering (0 = disabled)
 * @param {function} [opts.decode] - Optional tokenizer decode function for debug
 * @param {boolean} [opts.debug] - Enable debug logging
 * @returns {number} Sampled token ID
 */
export function sample(logits, opts) {
  const { temperature, topP, topK, decode = null, debug = false } = opts;

  // Temperature = 0 means greedy (argmax) sampling
  if (temperature === 0) {
    let maxIdx = 0;
    let maxVal = logits[0];
    for (let i = 1; i < logits.length; i++) {
      if (logits[i] > maxVal) {
        maxVal = logits[i];
        maxIdx = i;
      }
    }
    if (debug) {
      const text = decode ? decode([maxIdx]) : '?';
      console.log(`[Sampling] Greedy selected: id=${maxIdx} "${text}" logit=${maxVal.toFixed(4)}`);
    }
    return maxIdx;
  }

  // Apply temperature (skip if 1.0 for efficiency)
  if (temperature !== 1.0) {
    for (let i = 0; i < logits.length; i++) {
      logits[i] /= temperature;
    }
  }

  // Convert to probabilities
  const probs = softmax(logits);

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

  // Debug logging
  if (debug) {
    const top5 = candidates.slice(0, 5).map(c => {
      const text = decode ? decode([c.token]) : '?';
      return `"${text}"(${(c.prob * 100).toFixed(1)}%)`;
    }).join(', ');
    console.log(`[Sampling] Top-5 after temp=${temperature}, topK=${topK}, topP=${topP}: ${top5}`);
  }

  // Sample from distribution
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
 * Get top-k tokens with probabilities (for debugging)
 * @param {Float32Array} logits - Input logits
 * @param {number} k - Number of top tokens
 * @param {function} [decode] - Optional tokenizer decode function
 * @returns {Array<{token: number, prob: number, text: string}>}
 */
export function getTopK(logits, k = 5, decode = null) {
  const probs = softmax(new Float32Array(logits)); // Copy to avoid modifying input

  const indexed = [];
  for (let i = 0; i < logits.length; i++) {
    indexed.push({ token: i, logit: logits[i], prob: probs[i] });
  }
  indexed.sort((a, b) => b.logit - a.logit);

  return indexed.slice(0, k).map(t => ({
    token: t.token,
    logit: t.logit,
    prob: t.prob,
    text: decode ? decode([t.token]) : `[${t.token}]`
  }));
}

/**
 * Log logits sanity check (debug utility)
 * @param {Float32Array} logits - Logits to analyze
 * @param {string} label - Label for logging
 * @param {function} [decode] - Optional tokenizer decode function
 * @returns {object} Statistics
 */
export function logitsSanity(logits, label, decode = null) {
  let min = Infinity, max = -Infinity;
  let nanCount = 0, infCount = 0;

  for (let i = 0; i < logits.length; i++) {
    const v = logits[i];
    if (Number.isNaN(v)) { nanCount++; continue; }
    if (!Number.isFinite(v)) { infCount++; continue; }
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const top5 = getTopK(logits, 5, decode);
  const top5Str = top5.map(t => `"${t.text}"(${(t.prob * 100).toFixed(1)}%)`).join(', ');

  console.log(`[Pipeline] ${label} logits: min=${min.toFixed(2)}, max=${max.toFixed(2)} | top-5: ${top5Str}`);

  if (nanCount > 0 || infCount > 0) {
    console.warn(`[Pipeline] ${label} logits have ${nanCount} NaN, ${infCount} Inf values`);
  }

  return { min, max, nanCount, infCount, top5 };
}
