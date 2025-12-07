/**
 * @fileoverview ListMemories - Query semantic memory store
 */

async function call(args = {}, deps = {}) {
  const { EmbeddingStore, SemanticMemory } = deps;

  if (!EmbeddingStore) {
    throw new Error('EmbeddingStore not available');
  }

  const { query, limit = 10, domain } = args;

  // If query provided, do semantic search
  if (query && SemanticMemory) {
    const results = await SemanticMemory.search(query, { topK: limit });
    return JSON.stringify(results.map(r => ({
      id: r.id,
      content: r.content.slice(0, 500),
      similarity: r.similarity.toFixed(3),
      domain: r.domain,
      timestamp: new Date(r.timestamp).toISOString()
    })), null, 2);
  }

  // Otherwise list all memories
  const memories = await EmbeddingStore.getAllMemories();

  // Filter by domain if specified
  let filtered = domain
    ? memories.filter(m => m.domain === domain)
    : memories;

  // Sort by timestamp descending
  filtered.sort((a, b) => b.timestamp - a.timestamp);

  // Limit results
  const limited = filtered.slice(0, limit);

  const stats = await EmbeddingStore.getStats();

  return JSON.stringify({
    total: memories.length,
    showing: limited.length,
    stats,
    memories: limited.map(m => ({
      id: m.id,
      content: m.content.slice(0, 200) + (m.content.length > 200 ? '...' : ''),
      domain: m.domain,
      source: m.source,
      accessCount: m.accessCount,
      timestamp: new Date(m.timestamp).toISOString()
    }))
  }, null, 2);
}

export const tool = {
  name: "ListMemories",
  description: "List or search semantic memories. Use 'query' for semantic search, or list all with optional 'domain' filter.",
  call
};

export default call;
