/** Pure Pareto ranking and crowding-distance selection. Ranking grants no execution or adoption authority. */
export function createGepaSelection({ policy }) {
  return {
  /**
   * Check if candidate A dominates candidate B (weighted comparison)
   * @param {Object} a - First candidate
   * @param {Object} b - Second candidate
   * @param {Array} objectives - Objective names
   * @param {Object} weights - Objective weights
   * @returns {number} 1 if A dominates, -1 if B dominates, 0 if neither
   */
  checkDominance(a, b, objectives, weights = {}) {
    let aBetter = 0;
    let bBetter = 0;

    for (const obj of objectives) {
      const weight = weights[obj] || 1.0;
      const aScore = (a.scores[obj] || 0) * weight;
      const bScore = (b.scores[obj] || 0) * weight;

      if (aScore > bScore) aBetter++;
      if (bScore > aScore) bBetter++;
    }

    if (aBetter > 0 && bBetter === 0) return 1;
    if (bBetter > 0 && aBetter === 0) return -1;
    return 0;
  },

  /**
   * Calculate crowding distance for diversity preservation
   * @param {Array} front - Non-dominated front
   * @param {Array} objectives - Objective names
   * @returns {Array} Front with crowdingDistance set
   */
  calculateCrowdingDistance(front, objectives) {
    if (front.length <= 2) {
      for (const c of front) c.crowdingDistance = Infinity;
      return front;
    }

    for (const c of front) c.crowdingDistance = 0;

    for (const obj of objectives) {
      front.sort((a, b) => (a.scores[obj] || 0) - (b.scores[obj] || 0));
      front[0].crowdingDistance = Infinity;
      front[front.length - 1].crowdingDistance = Infinity;

      const range = (front[front.length - 1].scores[obj] || 0) - (front[0].scores[obj] || 0);
      if (range === 0) continue;

      for (let i = 1; i < front.length - 1; i++) {
        front[i].crowdingDistance +=
          ((front[i + 1].scores[obj] || 0) - (front[i - 1].scores[obj] || 0)) / range;
      }
    }

    return front;
  },

  /**
   * Perform NSGA-II selection
   * @param {Array} candidates - All candidates
   * @param {Array} objectives - Objective names
   * @param {number} targetSize - Target population size
   * @param {Object} config - Configuration including weights
   * @returns {Array} Selected candidates
   */
  select(candidates, objectives, targetSize, config = {}) {
    const weights = config.objectiveWeights || policy.objectiveWeights;

    // Reset dominance counters
    for (const c of candidates) {
      c.dominatedBy = 0;
      c.dominates = [];
      c.rank = -1;
    }

    // Calculate dominance relationships
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const dominated = this.checkDominance(candidates[i], candidates[j], objectives, weights);
        if (dominated === 1) {
          candidates[j].dominatedBy++;
          candidates[i].dominates.push(j);
        } else if (dominated === -1) {
          candidates[i].dominatedBy++;
          candidates[j].dominates.push(i);
        }
      }
    }

    // Build Pareto fronts
    const fronts = [];
    let remaining = [...candidates];
    let rank = 0;

    while (remaining.length > 0) {
      const front = remaining.filter(c => c.dominatedBy === 0);
      if (front.length === 0) break; // safety: prevent infinite loop
      for (const c of front) c.rank = rank;
      fronts.push(front);

      for (const c of front) {
        for (const dominatedIdx of c.dominates) {
          candidates[dominatedIdx].dominatedBy--;
        }
      }

      remaining = remaining.filter(c => c.rank === -1);
      rank++;
    }

    // Select candidates from fronts
    const selected = [];
    for (const front of fronts) {
      if (selected.length + front.length <= targetSize) {
        selected.push(...front);
      } else {
        // Use crowding distance for tie-breaking
        const withCrowding = this.calculateCrowdingDistance(front, objectives);
        withCrowding.sort((a, b) => b.crowdingDistance - a.crowdingDistance);
        selected.push(...withCrowding.slice(0, targetSize - selected.length));
        break;
      }
    }

    return selected;
  },

  /**
   * Compute composite fitness score for a candidate
   * @param {Object} candidate - Candidate with scores
   * @param {Array} objectives - Objective names
   * @param {Object} weights - Objective weights
   * @returns {number} Composite fitness
   */
  computeCompositeFitness(candidate, objectives, weights = {}) {
    let totalWeight = 0;
    let weightedSum = 0;

    for (const obj of objectives) {
      const weight = weights[obj] || 1.0;
      const score = candidate.scores[obj] || 0;
      weightedSum += score * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  },

  /**
   * Check if evolution has converged (stagnation detection)
   * @param {Object} currentBest - Current best scores
   * @param {Object} previousBest - Previous best scores
   * @param {Array} objectives - Objective names
   * @param {number} threshold - Convergence threshold
   * @returns {boolean} True if converged
   */
  checkConvergence(currentBest, previousBest, objectives, threshold) {
    if (!previousBest) return false;

    for (const obj of objectives) {
      const current = currentBest[obj] || 0;
      const previous = previousBest[obj] || 0;
      const improvement = current - previous;

      if (improvement > threshold) {
        return false; // Still improving
      }
    }

    return true;
  },

  /**
   * Get hypervolume indicator (quality metric for Pareto fronts)
   * Uses a reference point of [0, 0, ..., 0]
   * @param {Array} front - Non-dominated front
   * @param {Array} objectives - Objective names
   * @returns {number} Hypervolume approximation
   */
  computeHypervolume(front, objectives) {
    if (front.length === 0) return 0;

    // Simple hypervolume approximation using dominated area
    let volume = 0;

    for (const candidate of front) {
      let contribution = 1;
      for (const obj of objectives) {
        contribution *= (candidate.scores[obj] || 0);
      }
      volume += contribution;
    }

    return volume;
  }
};
}
