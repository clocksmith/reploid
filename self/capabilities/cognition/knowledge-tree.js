/**
 * @fileoverview Knowledge Tree
 * RAPTOR-style hierarchical knowledge organization with temporal indexing,
 * hybrid retrieval, anticipatory context prediction, and adaptive forgetting.
 *
 * @see Blueprint 0x000068: Hierarchical Memory Architecture
 * @see https://arxiv.org/abs/2401.18059 (RAPTOR paper)
 */

const KnowledgeTree = {
  metadata: {
    id: 'KnowledgeTree',
    version: '2.0.0',
    genesis: { introduced: 'cognition' },
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
      temporalIndexPath: '/memory/knowledge/temporal-index.json',
      minClusterSize: 2,
      maxClusterSize: 5,
      targetClusters: 3,       // Target number of clusters per level
      summaryTemperature: 0,   // Deterministic summaries
      maxTreeLevels: 5,        // Prevent infinite recursion
      minDocsForTree: 3,       // Minimum documents to build tree
      // Temporal indexing
      temporalBucketMs: 3600000,  // 1 hour buckets for temporal index
      contiguityWindowMs: 300000, // 5 min window for temporal contiguity boost
      contiguityBoost: 0.1,       // Similarity boost for temporally adjacent items
      // Adaptive forgetting (Ebbinghaus)
      decayHalfLifeMs: 86400000 * 7, // 7 days half-life for memory decay
      accessBoostFactor: 0.15,       // Boost per access to slow decay
      minRetentionScore: 0.1,        // Minimum score before item is eligible for pruning
      // Hybrid retrieval weights
      hybridWeights: {
        semantic: 0.5,
        summary: 0.3,
        temporal: 0.2
      },
      // Anticipatory retrieval patterns
      taskContextPatterns: {
        debug: ['error', 'exception', 'bug', 'failure', 'stack', 'crash'],
        implement: ['architecture', 'pattern', 'design', 'structure', 'interface'],
        refactor: ['code smell', 'coupling', 'complexity', 'duplicate'],
        test: ['test case', 'assertion', 'mock', 'coverage', 'fixture'],
        document: ['api', 'usage', 'example', 'guide', 'reference']
      }
    };

    // --- State ---
    let _tree = null;
    let _temporalIndex = null; // { buckets: { timestamp: [nodeIds] }, nodeTimestamps: { nodeId: timestamp } }
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

      // Load temporal index
      try {
        if (await VFS.exists(CONFIG.temporalIndexPath)) {
          const content = await VFS.read(CONFIG.temporalIndexPath);
          _temporalIndex = JSON.parse(content);
          logger.info('[KnowledgeTree] Loaded temporal index', {
            buckets: Object.keys(_temporalIndex?.buckets || {}).length
          });
        } else {
          _temporalIndex = { buckets: {}, nodeTimestamps: {}, accessCounts: {} };
        }
      } catch (err) {
        logger.warn('[KnowledgeTree] Could not load temporal index:', err.message);
        _temporalIndex = { buckets: {}, nodeTimestamps: {}, accessCounts: {} };
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
            metadata: node.metadata,
            timestamp: node.timestamp || Date.now()
          }))
        )
      };

      await VFS.write(CONFIG.treePath, JSON.stringify(serializable, null, 2));
    };

    const persistTemporalIndex = async () => {
      if (!_temporalIndex) return;
      await VFS.write(CONFIG.temporalIndexPath, JSON.stringify(_temporalIndex, null, 2));
    };

    // --- Temporal Indexing ---

    const getBucketKey = (timestamp) => {
      return Math.floor(timestamp / CONFIG.temporalBucketMs) * CONFIG.temporalBucketMs;
    };

    const addToTemporalIndex = (nodeId, timestamp) => {
      if (!_temporalIndex) {
        _temporalIndex = { buckets: {}, nodeTimestamps: {}, accessCounts: {} };
      }

      const bucketKey = getBucketKey(timestamp);
      if (!_temporalIndex.buckets[bucketKey]) {
        _temporalIndex.buckets[bucketKey] = [];
      }
      if (!_temporalIndex.buckets[bucketKey].includes(nodeId)) {
        _temporalIndex.buckets[bucketKey].push(nodeId);
      }
      _temporalIndex.nodeTimestamps[nodeId] = timestamp;
      _temporalIndex.accessCounts[nodeId] = _temporalIndex.accessCounts[nodeId] || 0;
    };

    const recordAccess = (nodeId) => {
      if (!_temporalIndex?.accessCounts) return;
      _temporalIndex.accessCounts[nodeId] = (_temporalIndex.accessCounts[nodeId] || 0) + 1;
    };

    const getNodesInTimeRange = (startTime, endTime) => {
      if (!_temporalIndex?.buckets) return [];

      const nodeIds = new Set();
      const startBucket = getBucketKey(startTime);
      const endBucket = getBucketKey(endTime);

      for (const bucketKey of Object.keys(_temporalIndex.buckets)) {
        const key = parseInt(bucketKey, 10);
        if (key >= startBucket && key <= endBucket) {
          for (const nodeId of _temporalIndex.buckets[bucketKey]) {
            const nodeTimestamp = _temporalIndex.nodeTimestamps[nodeId];
            if (nodeTimestamp >= startTime && nodeTimestamp <= endTime) {
              nodeIds.add(nodeId);
            }
          }
        }
      }

      return Array.from(nodeIds);
    };

    // --- Adaptive Forgetting (Ebbinghaus-style) ---

    const computeRetentionScore = (nodeId) => {
      if (!_temporalIndex?.nodeTimestamps) return 1;

      const timestamp = _temporalIndex.nodeTimestamps[nodeId];
      if (!timestamp) return 1;

      const age = Date.now() - timestamp;
      const accessCount = _temporalIndex.accessCounts?.[nodeId] || 0;

      // Ebbinghaus exponential decay: R = e^(-t/S)
      // where S is strength, modified by access frequency
      const strength = CONFIG.decayHalfLifeMs * (1 + accessCount * CONFIG.accessBoostFactor);
      const retention = Math.exp(-age / strength);

      return Math.max(CONFIG.minRetentionScore, retention);
    };

    const applyRetentionDecay = (nodes) => {
      return nodes.map(node => ({
        ...node,
        retention: computeRetentionScore(node.id),
        score: node.score * computeRetentionScore(node.id)
      }));
    };

    const pruneDecayedNodes = async () => {
      if (!_tree?.levels) return 0;

      let pruned = 0;
      const prunedIds = [];

      // Only prune leaf nodes (level 0)
      const originalCount = _tree.levels[0].length;
      _tree.levels[0] = _tree.levels[0].filter(node => {
        const retention = computeRetentionScore(node.id);
        if (retention <= CONFIG.minRetentionScore) {
          prunedIds.push(node.id);
          pruned++;
          return false;
        }
        return true;
      });

      // Clean up temporal index
      for (const nodeId of prunedIds) {
        const timestamp = _temporalIndex?.nodeTimestamps?.[nodeId];
        if (timestamp) {
          const bucketKey = getBucketKey(timestamp);
          if (_temporalIndex.buckets[bucketKey]) {
            _temporalIndex.buckets[bucketKey] = _temporalIndex.buckets[bucketKey].filter(id => id !== nodeId);
            if (_temporalIndex.buckets[bucketKey].length === 0) {
              delete _temporalIndex.buckets[bucketKey];
            }
          }
          delete _temporalIndex.nodeTimestamps[nodeId];
          delete _temporalIndex.accessCounts[nodeId];
        }
      }

      if (pruned > 0) {
        await persistTree();
        await persistTemporalIndex();

        logger.info('[KnowledgeTree] Pruned decayed nodes', { pruned, originalCount });
        EventBus.emit('knowledge:tree:pruned', { pruned, prunedIds });
      }

      return pruned;
    };

    // --- Retrieval (Collapsed Tree with Hybrid & Temporal) ---

    const query = async (queryText, options = {}) => {
      const { topK = 5, includeAllLevels = true, useHybrid = false, useRetention = true } = options;

      if (!_tree?.levels) {
        logger.warn('[KnowledgeTree] No tree available for query');
        return [];
      }

      const queryEmbedding = await SemanticMemory.embed(queryText);

      // Collapsed tree retrieval: search ALL levels
      const allNodes = includeAllLevels
        ? _tree.levels.flat()
        : _tree.levels[0]; // Only leaf nodes

      let scored = allNodes.map(node => ({
        ...node,
        score: cosineSimilarity(queryEmbedding, node.embedding)
      }));

      // Apply retention decay if enabled
      if (useRetention) {
        scored = applyRetentionDecay(scored);
      }

      // Record access for retrieved nodes
      const topNodes = scored
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

      for (const node of topNodes) {
        recordAccess(node.id);
      }

      const results = topNodes.map(node => ({
        id: node.id,
        content: node.content,
        level: node.level,
        score: node.score,
        retention: node.retention,
        metadata: node.metadata
      }));

      EventBus.emit('knowledge:tree:query', {
        query: queryText.slice(0, 50),
        resultCount: results.length,
        levels: [...new Set(results.map(r => r.level))]
      });

      return results;
    };

    // --- Hybrid Retrieval ---

    const hybridQuery = async (queryText, options = {}) => {
      const {
        topK = 10,
        timeRangeMs = null,
        weights = CONFIG.hybridWeights
      } = options;

      if (!_tree?.levels) {
        logger.warn('[KnowledgeTree] No tree available for hybrid query');
        return [];
      }

      const queryEmbedding = await SemanticMemory.embed(queryText);
      const now = Date.now();

      // Get all candidate nodes
      let allNodes = _tree.levels.flat();

      // Apply time range filter if specified
      if (timeRangeMs) {
        const nodeIdsInRange = new Set(getNodesInTimeRange(now - timeRangeMs, now));
        allNodes = allNodes.filter(n => nodeIdsInRange.has(n.id));
      }

      // Score each node with hybrid approach
      const scored = allNodes.map(node => {
        // Semantic similarity
        const semanticScore = cosineSimilarity(queryEmbedding, node.embedding);

        // Summary bonus (higher levels get boost for broad queries)
        const summaryBonus = node.level > 0 ? 0.1 * node.level : 0;

        // Temporal contiguity boost
        let temporalBoost = 0;
        const nodeTimestamp = _temporalIndex?.nodeTimestamps?.[node.id];
        if (nodeTimestamp) {
          // Check if other high-scoring nodes are temporally adjacent
          const hasTemporalNeighbor = allNodes.some(other => {
            if (other.id === node.id) return false;
            const otherTimestamp = _temporalIndex?.nodeTimestamps?.[other.id];
            if (!otherTimestamp) return false;
            const timeDiff = Math.abs(nodeTimestamp - otherTimestamp);
            const otherScore = cosineSimilarity(queryEmbedding, other.embedding);
            return timeDiff < CONFIG.contiguityWindowMs && otherScore > 0.5;
          });
          temporalBoost = hasTemporalNeighbor ? CONFIG.contiguityBoost : 0;
        }

        // Apply retention decay
        const retention = computeRetentionScore(node.id);

        // Weighted hybrid score
        const hybridScore = (
          semanticScore * weights.semantic +
          summaryBonus * weights.summary +
          temporalBoost * weights.temporal
        ) * retention;

        return {
          ...node,
          semanticScore,
          summaryBonus,
          temporalBoost,
          retention,
          score: hybridScore
        };
      });

      // Sort and return top-K
      const results = scored
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

      // Record access
      for (const node of results) {
        recordAccess(node.id);
      }

      EventBus.emit('knowledge:tree:hybrid-query', {
        query: queryText.slice(0, 50),
        resultCount: results.length,
        timeRange: timeRangeMs
      });

      return results.map(node => ({
        id: node.id,
        content: node.content,
        level: node.level,
        score: node.score,
        semanticScore: node.semanticScore,
        temporalBoost: node.temporalBoost,
        retention: node.retention,
        metadata: node.metadata
      }));
    };

    // --- Anticipatory Retrieval ---

    const detectTaskType = (query) => {
      const queryLower = query.toLowerCase();

      for (const [taskType, patterns] of Object.entries(CONFIG.taskContextPatterns)) {
        const matchCount = patterns.filter(p => queryLower.includes(p)).length;
        if (matchCount > 0) {
          return { taskType, confidence: matchCount / patterns.length };
        }
      }

      return { taskType: 'general', confidence: 0 };
    };

    const anticipatoryQuery = async (queryText, options = {}) => {
      const { topK = 10, boostFactor = 0.2 } = options;

      // Detect task type
      const { taskType, confidence } = detectTaskType(queryText);

      // Get base hybrid results
      const baseResults = await hybridQuery(queryText, { topK: topK * 2 });

      if (taskType === 'general' || confidence === 0) {
        return baseResults.slice(0, topK);
      }

      // Get anticipatory context based on task type
      const contextPatterns = CONFIG.taskContextPatterns[taskType] || [];
      const anticipatoryQueries = contextPatterns.slice(0, 3); // Use top 3 patterns

      // Gather additional context using the query function
      const anticipatedNodeIds = new Set();
      for (const contextQueryText of anticipatoryQueries) {
        const contextResults = await query(contextQueryText, { topK: 3 });
        for (const result of contextResults) {
          anticipatedNodeIds.add(result.id);
        }
      }

      // Boost scores for anticipated nodes in base results
      const boostedResults = baseResults.map(result => {
        const isAnticipated = anticipatedNodeIds.has(result.id);
        return {
          ...result,
          score: isAnticipated ? result.score * (1 + boostFactor * confidence) : result.score,
          anticipated: isAnticipated
        };
      });

      // Re-sort and return
      const finalResults = boostedResults
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

      EventBus.emit('knowledge:tree:anticipatory-query', {
        query: queryText.slice(0, 50),
        taskType,
        confidence,
        anticipatedCount: anticipatedNodeIds.size
      });

      return finalResults;
    };

    // --- Time Range Query ---

    const queryByTimeRange = async (startTime, endTime, options = {}) => {
      const { topK = 20 } = options;

      const nodeIds = getNodesInTimeRange(startTime, endTime);

      if (nodeIds.length === 0) {
        return [];
      }

      // Get node objects
      const allNodes = _tree?.levels?.flat() || [];
      const nodeMap = new Map(allNodes.map(n => [n.id, n]));

      const results = nodeIds
        .map(id => nodeMap.get(id))
        .filter(Boolean)
        .map(node => ({
          id: node.id,
          content: node.content,
          level: node.level,
          timestamp: _temporalIndex?.nodeTimestamps?.[node.id],
          metadata: node.metadata
        }))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, topK);

      return results;
    };

    // --- Incremental Updates ---

    const addDocument = async (document, options = {}) => {
      const timestamp = options.timestamp || Date.now();

      if (!_tree) {
        // No tree exists, build new one
        const result = await build([document]);
        // Add temporal index for the new node
        if (result?.levels?.[0]?.[0]) {
          addToTemporalIndex(result.levels[0][0].id, timestamp);
          await persistTemporalIndex();
        }
        return result?.levels?.[0]?.[0]?.id;
      }

      const content = typeof document === 'string' ? document : document.content;
      const embedding = await SemanticMemory.embed(content);

      const newNode = {
        id: generateId('node'),
        content,
        embedding,
        level: 0,
        children: [],
        timestamp,
        metadata: typeof document === 'object' ? document.metadata : {}
      };

      // Add to level 0
      _tree.levels[0].push(newNode);

      // Add to temporal index
      addToTemporalIndex(newNode.id, timestamp);

      // Find best cluster to update
      if (_tree.levels.length > 1) {
        await updateParentClusters(newNode);
      }

      await persistTree();
      await persistTemporalIndex();

      EventBus.emit('knowledge:tree:add', { nodeId: newNode.id, timestamp });

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

    const getTemporalIndex = () => _temporalIndex;

    const getStats = () => {
      if (!_tree) {
        return { hasTree: false, levels: 0, totalNodes: 0, temporalBuckets: 0 };
      }

      const temporalBuckets = Object.keys(_temporalIndex?.buckets || {}).length;
      const indexedNodes = Object.keys(_temporalIndex?.nodeTimestamps || {}).length;

      return {
        hasTree: true,
        id: _tree.id,
        createdAt: _tree.createdAt,
        documentCount: _tree.documentCount,
        levels: _tree.levels.length,
        totalNodes: countNodes(_tree),
        nodesPerLevel: _tree.levels.map(l => l.length),
        temporalBuckets,
        indexedNodes,
        config: {
          decayHalfLifeMs: CONFIG.decayHalfLifeMs,
          minRetentionScore: CONFIG.minRetentionScore
        }
      };
    };

    const clear = async () => {
      _tree = null;
      _temporalIndex = { buckets: {}, nodeTimestamps: {}, accessCounts: {} };

      if (await VFS.exists(CONFIG.treePath)) {
        await VFS.delete(CONFIG.treePath);
      }
      if (await VFS.exists(CONFIG.temporalIndexPath)) {
        await VFS.delete(CONFIG.temporalIndexPath);
      }

      EventBus.emit('knowledge:tree:cleared');
    };

    // --- Configuration ---

    const configure = (newConfig) => {
      Object.assign(CONFIG, newConfig);
      logger.info('[KnowledgeTree] Configuration updated');
    };

    const getConfig = () => ({ ...CONFIG });

    return {
      init,
      build,
      // Basic query
      query,
      // Hybrid retrieval
      hybridQuery,
      // Anticipatory retrieval
      anticipatoryQuery,
      detectTaskType,
      // Time-based queries
      queryByTimeRange,
      // Incremental updates
      addDocument,
      // Adaptive forgetting
      pruneDecayedNodes,
      computeRetentionScore,
      // Accessors
      getTree,
      getTemporalIndex,
      getStats,
      // Maintenance
      clear,
      configure,
      getConfig
    };
  }
};

export default KnowledgeTree;
