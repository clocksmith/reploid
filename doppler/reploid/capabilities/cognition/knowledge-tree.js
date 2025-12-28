/**
 * @fileoverview Knowledge Tree
 * RAPTOR-style hierarchical knowledge organization.
 * Clusters documents, builds recursive summaries, enables multi-level retrieval.
 *
 * @see Blueprint 0x000068: Hierarchical Memory Architecture
 * @see https://arxiv.org/abs/2401.18059 (RAPTOR paper)
 */

const KnowledgeTree = {
  metadata: {
    id: 'KnowledgeTree',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'VFS', 'LLMClient', 'SemanticMemory', 'EventBus'],
    async: true,
    type: 'capability'
  },

  factory: (deps) => {
    const { Utils, VFS, LLMClient, SemanticMemory, EventBus } = deps;
    const { logger, generateId, Errors } = Utils;

    // --- Configuration ---
    const CONFIG = {
      treePath: '/memory/knowledge/tree.json',
      minClusterSize: 2,
      maxClusterSize: 5,
      targetClusters: 3,       // Target number of clusters per level
      summaryTemperature: 0,   // Deterministic summaries
      maxTreeLevels: 5,        // Prevent infinite recursion
      minDocsForTree: 3        // Minimum documents to build tree
    };

    // --- State ---
    let _tree = null;
    let _isBuilding = false;

    // --- Initialization ---

    const init = async () => {
      // Try to load existing tree
      try {
        if (await VFS.exists(CONFIG.treePath)) {
          const content = await VFS.read(CONFIG.treePath);
          _tree = JSON.parse(content);
          logger.info('[KnowledgeTree] Loaded existing tree', {
            levels: _tree?.levels?.length || 0,
            totalNodes: countNodes(_tree)
          });
        }
      } catch (err) {
        logger.warn('[KnowledgeTree] Could not load tree:', err.message);
        _tree = null;
      }
      return true;
    };

    const countNodes = (tree) => {
      if (!tree?.levels) return 0;
      return tree.levels.reduce((sum, level) => sum + level.length, 0);
    };

    // --- Clustering (Simple K-Means for Browser) ---

    const cosineSimilarity = (a, b) => {
      if (!a || !b || a.length !== b.length) return 0;
      let dot = 0, normA = 0, normB = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }
      const mag = Math.sqrt(normA) * Math.sqrt(normB);
      return mag === 0 ? 0 : dot / mag;
    };

    const centroid = (embeddings) => {
      if (embeddings.length === 0) return null;
      const dim = embeddings[0].length;
      const result = new Array(dim).fill(0);
      for (const emb of embeddings) {
        for (let i = 0; i < dim; i++) {
          result[i] += emb[i];
        }
      }
      for (let i = 0; i < dim; i++) {
        result[i] /= embeddings.length;
      }
      return result;
    };

    const kMeansClustering = (nodes, k, maxIterations = 10) => {
      if (nodes.length <= k) {
        // Each node is its own cluster
        return nodes.map(n => [n]);
      }

      // Initialize centroids randomly
      const shuffled = [...nodes].sort(() => Math.random() - 0.5);
      let centroids = shuffled.slice(0, k).map(n => [...n.embedding]);

      let clusters = [];

      for (let iter = 0; iter < maxIterations; iter++) {
        // Assign nodes to nearest centroid
        clusters = Array.from({ length: k }, () => []);

        for (const node of nodes) {
          let bestIdx = 0;
          let bestSim = -1;

          for (let i = 0; i < centroids.length; i++) {
            const sim = cosineSimilarity(node.embedding, centroids[i]);
            if (sim > bestSim) {
              bestSim = sim;
              bestIdx = i;
            }
          }

          clusters[bestIdx].push(node);
        }

        // Remove empty clusters
        clusters = clusters.filter(c => c.length > 0);

        // Recalculate centroids
        const newCentroids = clusters.map(cluster =>
          centroid(cluster.map(n => n.embedding))
        );

        // Check convergence
        let converged = true;
        for (let i = 0; i < Math.min(centroids.length, newCentroids.length); i++) {
          if (cosineSimilarity(centroids[i], newCentroids[i]) < 0.999) {
            converged = false;
            break;
          }
        }

        centroids = newCentroids;
        if (converged) break;
      }

      return clusters;
    };

    // --- Tree Building ---

    const build = async (documents, options = {}) => {
      if (_isBuilding) {
        throw new Errors.StateError('Tree build already in progress');
      }

      if (!documents || documents.length < CONFIG.minDocsForTree) {
        logger.warn('[KnowledgeTree] Not enough documents for tree', {
          count: documents?.length || 0,
          minimum: CONFIG.minDocsForTree
        });
        return null;
      }

      _isBuilding = true;
      const startTime = Date.now();

      EventBus.emit('knowledge:tree:build:start', { documentCount: documents.length });

      try {
        // Level 0: Embed all documents
        logger.info('[KnowledgeTree] Embedding documents...');
        const level0 = await Promise.all(documents.map(async (doc, idx) => {
          const content = typeof doc === 'string' ? doc : doc.content;
          const embedding = await SemanticMemory.embed(content);
          return {
            id: generateId('node'),
            content,
            embedding,
            level: 0,
            children: [],
            metadata: typeof doc === 'object' ? doc.metadata : { index: idx }
          };
        }));

        const levels = [level0];
        let currentLevel = level0;

        // Build higher levels until single root or max levels
        let levelIdx = 0;
        while (currentLevel.length > 1 && levelIdx < CONFIG.maxTreeLevels) {
          levelIdx++;
          logger.info(`[KnowledgeTree] Building level ${levelIdx}...`, {
            nodesAtLevel: currentLevel.length
          });

          // Calculate number of clusters
          const k = Math.max(1, Math.ceil(currentLevel.length / CONFIG.targetClusters));

          // Cluster current level
          const clusters = kMeansClustering(currentLevel, k);

          // Summarize each cluster
          const nextLevel = await Promise.all(clusters.map(async (cluster) => {
            const summary = await summarizeCluster(cluster);
            const embedding = await SemanticMemory.embed(summary);

            return {
              id: generateId('node'),
              content: summary,
              embedding,
              level: levelIdx,
              children: cluster.map(n => n.id),
              childNodes: cluster,
              metadata: { clusterSize: cluster.length }
            };
          }));

          levels.push(nextLevel);
          currentLevel = nextLevel;

          EventBus.emit('knowledge:tree:build:level', {
            level: levelIdx,
            nodeCount: nextLevel.length
          });
        }

        // Build tree structure
        _tree = {
          id: generateId('tree'),
          createdAt: Date.now(),
          documentCount: documents.length,
          levels,
          root: currentLevel.length === 1 ? currentLevel[0] : null
        };

        // Persist to VFS
        await persistTree();

        const duration = Date.now() - startTime;
        logger.info('[KnowledgeTree] Build complete', {
          levels: levels.length,
          totalNodes: countNodes(_tree),
          durationMs: duration
        });

        EventBus.emit('knowledge:tree:build:complete', {
          levels: levels.length,
          totalNodes: countNodes(_tree),
          durationMs: duration
        });

        return _tree;

      } catch (err) {
        logger.error('[KnowledgeTree] Build failed:', err.message);
        EventBus.emit('knowledge:tree:build:error', { error: err.message });
        throw err;

      } finally {
        _isBuilding = false;
      }
    };

    const summarizeCluster = async (cluster) => {
      const contents = cluster.map(n => n.content).join('\n\n---\n\n');

      const prompt = `Summarize these related items into a single coherent summary that captures their key themes and information:

${contents}

Summary:`;

      try {
        const response = await LLMClient.chat(
          [{ role: 'user', content: prompt }],
          { temperature: CONFIG.summaryTemperature, max_tokens: 500 }
        );

        return response.content || response;
      } catch (err) {
        logger.warn('[KnowledgeTree] Cluster summarization failed:', err.message);
        // Fallback: concatenate first sentences
        return cluster
          .map(n => n.content.split('.')[0])
          .join('. ') + '.';
      }
    };

    const persistTree = async () => {
      if (!_tree) return;

      // Create serializable version (remove childNodes to avoid circular refs)
      const serializable = {
        ..._tree,
        levels: _tree.levels.map(level =>
          level.map(node => ({
            id: node.id,
            content: node.content,
            embedding: node.embedding,
            level: node.level,
            children: node.children,
            metadata: node.metadata
          }))
        )
      };

      await VFS.write(CONFIG.treePath, JSON.stringify(serializable, null, 2));
    };

    // --- Retrieval (Collapsed Tree) ---

    const query = async (queryText, options = {}) => {
      const { topK = 5, includeAllLevels = true } = options;

      if (!_tree?.levels) {
        logger.warn('[KnowledgeTree] No tree available for query');
        return [];
      }

      const queryEmbedding = await SemanticMemory.embed(queryText);

      // Collapsed tree retrieval: search ALL levels
      const allNodes = includeAllLevels
        ? _tree.levels.flat()
        : _tree.levels[0]; // Only leaf nodes

      const scored = allNodes.map(node => ({
        ...node,
        score: cosineSimilarity(queryEmbedding, node.embedding)
      }));

      const results = scored
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map(node => ({
          id: node.id,
          content: node.content,
          level: node.level,
          score: node.score,
          metadata: node.metadata
        }));

      EventBus.emit('knowledge:tree:query', {
        query: queryText.slice(0, 50),
        resultCount: results.length,
        levels: [...new Set(results.map(r => r.level))]
      });

      return results;
    };

    // --- Incremental Updates ---

    const addDocument = async (document) => {
      if (!_tree) {
        // No tree exists, build new one
        return build([document]);
      }

      const content = typeof document === 'string' ? document : document.content;
      const embedding = await SemanticMemory.embed(content);

      const newNode = {
        id: generateId('node'),
        content,
        embedding,
        level: 0,
        children: [],
        metadata: typeof document === 'object' ? document.metadata : {}
      };

      // Add to level 0
      _tree.levels[0].push(newNode);

      // Find best cluster to update
      if (_tree.levels.length > 1) {
        await updateParentClusters(newNode);
      }

      await persistTree();

      EventBus.emit('knowledge:tree:add', { nodeId: newNode.id });

      return newNode.id;
    };

    const updateParentClusters = async (newNode) => {
      // Find most similar node at level 1
      if (!_tree.levels[1]) return;

      let bestParent = null;
      let bestSim = -1;

      for (const parent of _tree.levels[1]) {
        const sim = cosineSimilarity(newNode.embedding, parent.embedding);
        if (sim > bestSim) {
          bestSim = sim;
          bestParent = parent;
        }
      }

      if (bestParent) {
        bestParent.children.push(newNode.id);
        // Re-summarize the cluster
        const childNodes = _tree.levels[0].filter(n =>
          bestParent.children.includes(n.id)
        );
        bestParent.content = await summarizeCluster(childNodes);
        bestParent.embedding = await SemanticMemory.embed(bestParent.content);
      }
    };

    // --- Accessors ---

    const getTree = () => _tree;

    const getStats = () => {
      if (!_tree) {
        return { hasTree: false, levels: 0, totalNodes: 0 };
      }

      return {
        hasTree: true,
        id: _tree.id,
        createdAt: _tree.createdAt,
        documentCount: _tree.documentCount,
        levels: _tree.levels.length,
        totalNodes: countNodes(_tree),
        nodesPerLevel: _tree.levels.map(l => l.length)
      };
    };

    const clear = async () => {
      _tree = null;
      if (await VFS.exists(CONFIG.treePath)) {
        await VFS.delete(CONFIG.treePath);
      }
      EventBus.emit('knowledge:tree:cleared');
    };

    return {
      init,
      build,
      query,
      addDocument,
      getTree,
      getStats,
      clear
    };
  }
};

export default KnowledgeTree;
