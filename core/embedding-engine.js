// Embedding Engine - Local vector embeddings via transformers.js
// Uses all-MiniLM-L6-v2 (~23MB quantized) for semantic similarity

const EmbeddingEngine = {
  metadata: {
    id: 'EmbeddingEngine',
    version: '1.0.0',
    description: 'Local vector embeddings for semantic reflection search',
    dependencies: ['Utils'],
    externalDeps: ['@xenova/transformers'],
    type: 'intelligence'
  },

  factory: (deps) => {
    const { Utils } = deps;
    const { logger } = Utils;

    let extractor = null;
    let isReady = false;
    let loadPromise = null;
    let loadError = null;

    const init = async () => {
      if (isReady) return true;
      if (loadPromise) return loadPromise;

      logger.info('[EmbeddingEngine] Background loading all-MiniLM-L6-v2...');

      loadPromise = (async () => {
        try {
          // Dynamic import to avoid blocking boot
          const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.14.0');

          // Quantized model is ~23MB
          extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
            quantized: true
          });

          isReady = true;
          loadError = null;
          logger.info('[EmbeddingEngine] Model loaded and ready.');
          return true;
        } catch (e) {
          logger.error('[EmbeddingEngine] Load failed:', e);
          loadError = e;
          isReady = false;
          return false;
        }
      })();

      return loadPromise;
    };

    // Trigger background load immediately if browser is idle
    if (typeof window !== 'undefined') {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => init(), { timeout: 5000 });
      } else {
        // Fallback for browsers without requestIdleCallback
        setTimeout(init, 2000);
      }
    }

    const vectorize = async (text) => {
      if (!isReady) {
        const success = await init();
        if (!success) {
          throw new Error(`EmbeddingEngine not available: ${loadError?.message || 'Unknown error'}`);
        }
      }

      // Pooling: mean, Normalize: true (for cosine similarity)
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      return Array.from(output.data);
    };

    const vectorizeBatch = async (texts) => {
      if (!isReady) await init();

      const results = [];
      for (const text of texts) {
        const vec = await vectorize(text);
        results.push(vec);
      }
      return results;
    };

    const cosineSimilarity = (vecA, vecB) => {
      if (vecA.length !== vecB.length) {
        throw new Error('Vectors must have same dimension');
      }

      let dot = 0;
      // Assuming normalized vectors, cosine sim is just dot product
      for (let i = 0; i < vecA.length; i++) {
        dot += vecA[i] * vecB[i];
      }
      return dot;
    };

    const findMostSimilar = (queryVec, candidates, topK = 5) => {
      const scored = candidates.map((candidate, index) => ({
        index,
        score: cosineSimilarity(queryVec, candidate.vector),
        ...candidate
      }));

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, topK);
    };

    return {
      init,
      vectorize,
      vectorizeBatch,
      cosineSimilarity,
      findMostSimilar,
      isReady: () => isReady,
      getError: () => loadError
    };
  }
};

export default EmbeddingEngine;
