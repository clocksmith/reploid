/**
 * @fileoverview PromptScoreMap
 * Simple in-memory prompt scoring for RSI proof.
 * Tracks prompt → { score, uses } for selection.
 */

const PromptScoreMap = {
  metadata: {
    id: 'PromptScoreMap',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'EventBus'],
    type: 'capability'
  },

  factory: (deps) => {
    const { Utils, EventBus } = deps;
    const { logger, generateId } = Utils;

    // In-memory storage: Map<promptHash, { prompt, score, uses, passRates }>
    const _prompts = new Map();
    const MAX_PROMPTS = 100;

    // Simple hash for prompt deduplication
    const hashPrompt = (prompt) => {
      if (!prompt || typeof prompt !== 'string') return 'empty';
      let hash = 0;
      for (let i = 0; i < prompt.length; i++) {
        const char = prompt.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
      }
      return `p_${Math.abs(hash).toString(36)}`;
    };

    /**
     * Record a prompt's arena performance
     * @param {string} prompt - The prompt text
     * @param {number} passRate - Arena pass rate (0-100)
     * @param {string} [taskType] - Optional task type for categorization
     */
    const record = (prompt, passRate, taskType = 'default') => {
      const hash = hashPrompt(prompt);
      const existing = _prompts.get(hash);

      if (existing) {
        existing.uses += 1;
        existing.passRates.push(passRate);
        if (existing.passRates.length > 20) existing.passRates.shift(); // Keep last 20
        existing.score = existing.passRates.reduce((a, b) => a + b, 0) / existing.passRates.length;
        existing.lastUsed = Date.now();
      } else {
        _prompts.set(hash, {
          id: generateId('prm'),
          hash,
          prompt,
          taskType,
          uses: 1,
          passRates: [passRate],
          score: passRate,
          created: Date.now(),
          lastUsed: Date.now()
        });
      }

      // Evict low-performers if over limit
      if (_prompts.size > MAX_PROMPTS) {
        _evictLowest();
      }

      EventBus.emit('promptscore:recorded', { hash, passRate, taskType });
      logger.debug(`[PromptScoreMap] Recorded: hash=${hash} passRate=${passRate} score=${_prompts.get(hash)?.score}`);
    };

    /**
     * Select best prompt for a task type
     * Uses score/uses ratio (exploitation) with exploration bonus for low-use prompts
     * @param {string} [taskType] - Task type filter
     * @param {number} [explorationWeight=1.5] - UCB1 exploration weight
     * @returns {{ prompt: string, score: number, uses: number } | null}
     */
    const select = (taskType = 'default', explorationWeight = 1.5) => {
      const candidates = [..._prompts.values()]
        .filter(p => !taskType || p.taskType === taskType || p.taskType === 'default');

      if (candidates.length === 0) return null;

      const totalUses = candidates.reduce((sum, p) => sum + p.uses, 0);

      // UCB1 selection: score + exploration bonus
      let best = null;
      let bestValue = -Infinity;

      for (const p of candidates) {
        const exploitation = p.score / 100; // Normalize to 0-1
        const exploration = explorationWeight * Math.sqrt(Math.log(totalUses + 1) / (p.uses + 1));
        const ucb = exploitation + exploration;

        if (ucb > bestValue) {
          bestValue = ucb;
          best = p;
        }
      }

      if (best) {
        logger.debug(`[PromptScoreMap] Selected: ${best.hash} (score=${best.score}, uses=${best.uses})`);
      }

      return best ? { prompt: best.prompt, score: best.score, uses: best.uses, hash: best.hash } : null;
    };

    /**
     * Get top K prompts by score
     * @param {number} [k=5] - Number of prompts to return
     * @param {string} [taskType] - Optional task type filter
     */
    const topK = (k = 5, taskType = null) => {
      return [..._prompts.values()]
        .filter(p => !taskType || p.taskType === taskType)
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map(p => ({ prompt: p.prompt, score: p.score, uses: p.uses, hash: p.hash }));
    };

    /**
     * Get success rate across all tracked prompts
     */
    const getAggregateStats = () => {
      const all = [..._prompts.values()];
      if (all.length === 0) return { count: 0, avgScore: 0, totalUses: 0 };

      const totalUses = all.reduce((sum, p) => sum + p.uses, 0);
      const weightedScore = all.reduce((sum, p) => sum + p.score * p.uses, 0) / totalUses;

      return {
        count: all.length,
        avgScore: Math.round(weightedScore * 100) / 100,
        totalUses,
        best: all.sort((a, b) => b.score - a.score)[0]?.score || 0
      };
    };

    const _evictLowest = () => {
      const sorted = [..._prompts.entries()]
        .sort((a, b) => a[1].score - b[1].score);

      // Remove bottom 10%
      const toRemove = Math.max(1, Math.floor(sorted.length * 0.1));
      for (let i = 0; i < toRemove; i++) {
        _prompts.delete(sorted[i][0]);
      }
    };

    /**
     * Clear all stored prompts
     */
    const clear = () => {
      _prompts.clear();
      logger.info('[PromptScoreMap] Cleared all prompts');
    };

    /**
     * Get all prompts (for debugging/export)
     */
    const getAll = () => [..._prompts.values()];

    return {
      record,
      select,
      topK,
      getAggregateStats,
      clear,
      getAll,
      hashPrompt,
      // Expose size for testing
      get size() { return _prompts.size; }
    };
  }
};

export default PromptScoreMap;
