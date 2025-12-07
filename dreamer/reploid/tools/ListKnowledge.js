/**
 * @fileoverview ListKnowledge - Query the knowledge graph
 */

async function call(args = {}, deps = {}) {
  const { KnowledgeGraph } = deps;

  if (!KnowledgeGraph) {
    throw new Error('KnowledgeGraph not available');
  }

  const { entity, predicate, subject, object, limit = 50 } = args;

  // Query by entity
  if (entity) {
    const result = KnowledgeGraph.getEntity(entity);
    if (!result) {
      return `Entity "${entity}" not found`;
    }
    return JSON.stringify(result, null, 2);
  }

  // Query triples
  if (predicate || subject || object) {
    const triples = KnowledgeGraph.query({ predicate, subject, object });
    const limited = triples.slice(0, limit);
    return JSON.stringify({
      total: triples.length,
      showing: limited.length,
      triples: limited
    }, null, 2);
  }

  // Default: return stats and recent entities
  const entities = KnowledgeGraph.getAllEntities();
  const graph = KnowledgeGraph.exportGraph();

  // Get most recent entities (by ID timestamp)
  const recentEntities = entities
    .slice(-limit)
    .map(e => ({
      id: e.id,
      type: e.type,
      label: e.label || e.id,
      confidence: e.confidence?.toFixed(2)
    }));

  // Get sample triples
  const sampleTriples = graph.triples
    .slice(-20)
    .map(t => `${t.subject} -[${t.predicate}]-> ${t.object}`);

  return JSON.stringify({
    stats: {
      entities: entities.length,
      triples: graph.triples.length
    },
    recentEntities,
    recentTriples: sampleTriples
  }, null, 2);
}

export const tool = {
  name: "ListKnowledge",
  description: "Query the knowledge graph. Use 'entity' to get details, 'predicate'/'subject'/'object' to query triples, or no args for overview.",
  call
};

export default call;
