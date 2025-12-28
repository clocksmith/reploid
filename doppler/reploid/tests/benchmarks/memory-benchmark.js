/**
 * @fileoverview Memory System Benchmarks
 * Measures memory reuse rate, context reconstruction accuracy, and retrieval performance.
 *
 * @see Blueprint 0x000068: Hierarchical Memory Architecture
 */

const MemoryBenchmark = {
  name: 'Memory System Benchmark',

  async run(deps) {
    const { MemoryManager, SemanticMemory, EmbeddingStore, LLMClient, Utils, VFS } = deps;
    const { logger, generateId } = Utils;

    const results = {
      passed: 0,
      failed: 0,
      benchmarks: [],
      summary: {}
    };

    const bench = async (name, fn) => {
      const start = performance.now();
      try {
        const result = await fn();
        const duration = performance.now() - start;
        results.passed++;
        results.benchmarks.push({
          name,
          status: 'passed',
          duration,
          ...result
        });
        logger.info(`[BENCH] ${name}: ${duration.toFixed(2)}ms`, result);
        return result;
      } catch (err) {
        const duration = performance.now() - start;
        results.failed++;
        results.benchmarks.push({
          name,
          status: 'failed',
          duration,
          error: err.message
        });
        logger.error(`[BENCH] ${name}: FAILED`, err.message);
        return null;
      }
    };

    // --- Setup ---
    await MemoryManager.init();
    await SemanticMemory.init();

    // --- Benchmark 1: Memory Reuse Rate ---
    await bench('Memory Reuse Rate', async () => {
      // Simulate a conversation with repeated topics
      const topics = [
        'React component lifecycle and hooks',
        'Database query optimization techniques',
        'Authentication with JWT tokens',
        'React component state management',  // Repeat topic
        'API rate limiting strategies',
        'Database indexing best practices',  // Related to earlier topic
      ];

      let reuseCount = 0;
      let totalQueries = 0;

      for (const topic of topics) {
        // Store the topic
        await MemoryManager.add({
          role: 'user',
          content: `Tell me about ${topic}`,
          metadata: { type: 'query' }
        });

        // Query for related context
        const retrieved = await MemoryManager.retrieve(topic);
        totalQueries++;

        // Check if we got relevant past context
        const relevantHits = retrieved.filter(r =>
          r.type === 'episodic' && r.score > 0.6
        );

        if (relevantHits.length > 0) {
          reuseCount++;
        }
      }

      const reuseRate = totalQueries > 0 ? (reuseCount / totalQueries) * 100 : 0;

      return {
        reuseRate: reuseRate.toFixed(1) + '%',
        reuseCount,
        totalQueries,
        target: '>50%',
        passed: reuseRate >= 50
      };
    });

    // --- Benchmark 2: Context Reconstruction Accuracy ---
    await bench('Context Reconstruction Accuracy', async () => {
      // Store known content
      const testContent = [
        { role: 'user', content: 'The project uses TypeScript with strict mode enabled.' },
        { role: 'assistant', content: 'I will use TypeScript strict mode for all implementations.' },
        { role: 'user', content: 'The database is PostgreSQL with Prisma ORM.' },
        { role: 'assistant', content: 'I will use Prisma for database operations with PostgreSQL.' },
      ];

      // Store messages
      for (const msg of testContent) {
        await MemoryManager.add(msg);
      }

      // Force eviction to test retrieval
      await MemoryManager.evictOldest(testContent.length);

      // Query for reconstruction
      const queries = [
        'What language are we using?',
        'What database technology?',
      ];

      let accurateRetrievals = 0;
      const expectedKeywords = [
        ['typescript', 'strict'],
        ['postgresql', 'prisma']
      ];

      for (let i = 0; i < queries.length; i++) {
        const retrieved = await MemoryManager.retrieve(queries[i]);
        const content = retrieved.map(r => r.content.toLowerCase()).join(' ');

        const hasExpected = expectedKeywords[i].every(kw => content.includes(kw));
        if (hasExpected) accurateRetrievals++;
      }

      const accuracy = (accurateRetrievals / queries.length) * 100;

      return {
        accuracy: accuracy.toFixed(1) + '%',
        accurateRetrievals,
        totalQueries: queries.length,
        target: '>90%',
        passed: accuracy >= 90
      };
    });

    // --- Benchmark 3: Retrieval Latency ---
    await bench('Retrieval Latency', async () => {
      // Populate with test data
      const testMessages = Array.from({ length: 50 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Test message ${i} about topic ${i % 5}: ${generateId('content')}`
      }));

      for (const msg of testMessages) {
        await MemoryManager.add(msg);
      }

      // Measure retrieval times
      const latencies = [];
      const queries = ['topic 0', 'topic 2', 'topic 4', 'something else'];

      for (const query of queries) {
        const start = performance.now();
        await MemoryManager.retrieve(query);
        latencies.push(performance.now() - start);
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const maxLatency = Math.max(...latencies);

      return {
        avgLatency: avgLatency.toFixed(2) + 'ms',
        maxLatency: maxLatency.toFixed(2) + 'ms',
        target: '<50ms avg',
        passed: avgLatency < 50
      };
    });

    // --- Benchmark 4: Eviction Latency ---
    await bench('Eviction Latency', async () => {
      // Add messages to force eviction
      const messages = Array.from({ length: 20 }, (_, i) => ({
        role: 'user',
        content: `Long message ${i}: ${'x'.repeat(500)}`
      }));

      for (const msg of messages) {
        await MemoryManager.add(msg);
      }

      // Measure eviction time
      const start = performance.now();
      await MemoryManager.evictOldest(10);
      const evictionLatency = performance.now() - start;

      return {
        evictionLatency: evictionLatency.toFixed(2) + 'ms',
        evictedCount: 10,
        target: '<100ms',
        passed: evictionLatency < 100
      };
    });

    // --- Benchmark 5: Anticipatory Retrieval ---
    await bench('Anticipatory Retrieval', async () => {
      // Store some error-related context
      await MemoryManager.add({
        role: 'user',
        content: 'Fix the TypeError: Cannot read property of undefined',
        metadata: { type: 'error' }
      });

      await MemoryManager.add({
        role: 'assistant',
        content: 'The error was caused by accessing a null object. Added null check.',
        metadata: { type: 'fix' }
      });

      // Query with debugging-related task
      const results = await MemoryManager.anticipatoryRetrieve(
        'debug this crash in the application',
        { topK: 5 }
      );

      const anticipatedCount = results.filter(r => r.type === 'anticipated').length;
      const standardCount = results.filter(r => r.type !== 'anticipated').length;

      return {
        totalResults: results.length,
        anticipatedCount,
        standardCount,
        hasAnticipated: anticipatedCount > 0,
        passed: anticipatedCount > 0
      };
    });

    // --- Benchmark 6: Adaptive Forgetting ---
    await bench('Adaptive Forgetting Simulation', async () => {
      // Get current stats
      const statsBefore = await EmbeddingStore.getStats();

      // Simulate retention calculation
      const testMemories = [
        { timestamp: Date.now() - 1000, accessCount: 5, source: 'goal' },      // High retention
        { timestamp: Date.now() - 86400000, accessCount: 0, source: 'tool_result' }, // Low retention
        { timestamp: Date.now() - 3600000, accessCount: 2, source: 'user' },   // Medium retention
      ];

      const retentions = testMemories.map(m => MemoryManager.calculateRetention(m, Date.now()));

      // Verify retention ordering
      const highRetention = retentions[0].retention;
      const lowRetention = retentions[1].retention;
      const mediumRetention = retentions[2].retention;

      const orderCorrect = highRetention > mediumRetention && mediumRetention > lowRetention;

      // Dry-run prune
      const pruneResult = await MemoryManager.adaptivePrune({ dryRun: true });

      return {
        retentions: retentions.map(r => r.retention.toFixed(3)),
        orderCorrect,
        wouldPrune: pruneResult.wouldPrune,
        avgRetention: pruneResult.avgRetention?.toFixed(3) || 'N/A',
        passed: orderCorrect
      };
    });

    // --- Summary ---
    results.summary = {
      totalBenchmarks: results.benchmarks.length,
      passed: results.passed,
      failed: results.failed,
      passRate: ((results.passed / results.benchmarks.length) * 100).toFixed(1) + '%'
    };

    // Cleanup
    await MemoryManager.clearWorking();

    return results;
  }
};

export default MemoryBenchmark;
