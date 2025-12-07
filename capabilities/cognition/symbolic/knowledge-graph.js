/**
 * @fileoverview Knowledge Graph
 * Entity-relationship store for symbolic reasoning.
 * Provides RDF-like triple storage with confidence tracking.
 */

const KnowledgeGraph = {
  metadata: {
    id: 'KnowledgeGraph',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'VFS', 'EventBus'],
    async: true,
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, VFS, EventBus } = deps;
    const { logger, generateId } = Utils;

    const STORE_PATH = '/.memory/knowledge-graph.json';
    const MAX_ENTITIES = 10000;
    const MAX_TRIPLES = 50000;
    const CONFIDENCE_DECAY_RATE = 0.999; // Per hour

    // In-memory graph structure
    let _entities = new Map();
    let _triples = [];
    let _predicateIndex = new Map(); // predicate -> triple indices
    let _subjectIndex = new Map();   // subject -> triple indices
    let _objectIndex = new Map();    // object -> triple indices

    // --- Persistence ---

    const init = async () => {
      if (await VFS.exists(STORE_PATH)) {
        try {
          const content = await VFS.read(STORE_PATH);
          const data = JSON.parse(content);
          deserialize(data);
          logger.info(`[KnowledgeGraph] Loaded ${_entities.size} entities, ${_triples.length} triples`);
        } catch (e) {
          logger.error('[KnowledgeGraph] Corrupt store, starting fresh', e);
          _entities = new Map();
          _triples = [];
        }
      }
      rebuildIndices();
      return true;
    };

    const save = async () => {
      if (!await VFS.exists('/.memory')) {
        await VFS.mkdir('/.memory');
      }
      const data = serialize();
      await VFS.write(STORE_PATH, JSON.stringify(data, null, 2));
    };

    const serialize = () => ({
      entities: Array.from(_entities.entries()),
      triples: _triples,
      version: 1
    });

    const deserialize = (data) => {
      _entities = new Map(data.entities || []);
      _triples = data.triples || [];
    };

    const rebuildIndices = () => {
      _predicateIndex = new Map();
      _subjectIndex = new Map();
      _objectIndex = new Map();

      _triples.forEach((triple, idx) => {
        addToIndex(_predicateIndex, triple.predicate, idx);
        addToIndex(_subjectIndex, triple.subject, idx);
        if (typeof triple.object === 'string') {
          addToIndex(_objectIndex, triple.object, idx);
        }
      });
    };

    const addToIndex = (index, key, value) => {
      if (!index.has(key)) {
        index.set(key, []);
      }
      index.get(key).push(value);
    };

    // --- Entity Operations ---

    const addEntity = async (entity) => {
      const id = entity.id || generateId('ent');

      const entry = {
        id,
        types: entity.types || ['Entity'],
        labels: entity.labels || { en: id },
        properties: entity.properties || {},
        metadata: {
          confidence: entity.confidence ?? 1.0,
          source: entity.source || 'system',
          timestamp: Date.now(),
          ...entity.metadata
        }
      };

      _entities.set(id, entry);
      await save();

      EventBus.emit('cognition:symbolic:add', { type: 'entity', id });
      logger.debug(`[KnowledgeGraph] Added entity: ${id}`);

      return id;
    };

    const getEntity = (id) => {
      return _entities.get(id) || null;
    };

    const updateEntity = async (id, updates) => {
      const entity = _entities.get(id);
      if (!entity) return null;

      Object.assign(entity, updates);
      entity.metadata.timestamp = Date.now();
      _entities.set(id, entity);
      await save();

      return entity;
    };

    const deleteEntity = async (id) => {
      if (!_entities.has(id)) return false;

      _entities.delete(id);

      // Remove all triples involving this entity
      _triples = _triples.filter(t => t.subject !== id && t.object !== id);
      rebuildIndices();
      await save();

      logger.debug(`[KnowledgeGraph] Deleted entity: ${id}`);
      return true;
    };

    const getAllEntities = () => {
      return Array.from(_entities.values());
    };

    // --- Triple Operations ---

    const addTriple = async (subject, predicate, object, metadata = {}) => {
      // Validate subject exists or is a literal
      if (!_entities.has(subject) && typeof subject === 'string') {
        // Auto-create entity for unknown subjects
        await addEntity({ id: subject, labels: { en: subject } });
      }

      const triple = {
        id: generateId('trp'),
        subject,
        predicate,
        object,
        metadata: {
          confidence: metadata.confidence ?? 0.8,
          source: metadata.source || 'llm',
          timestamp: Date.now(),
          provenance: metadata.provenance || []
        }
      };

      // Check for duplicate
      const existing = _triples.find(t =>
        t.subject === subject &&
        t.predicate === predicate &&
        t.object === object
      );

      if (existing) {
        // Update confidence if higher
        if (triple.metadata.confidence > existing.metadata.confidence) {
          existing.metadata.confidence = triple.metadata.confidence;
          existing.metadata.timestamp = Date.now();
        }
        await save();
        return existing.id;
      }

      const idx = _triples.length;
      _triples.push(triple);

      // Update indices
      addToIndex(_predicateIndex, predicate, idx);
      addToIndex(_subjectIndex, subject, idx);
      if (typeof object === 'string') {
        addToIndex(_objectIndex, object, idx);
      }

      await save();

      EventBus.emit('cognition:symbolic:add', { type: 'triple', id: triple.id });
      logger.debug(`[KnowledgeGraph] Added triple: ${subject} -[${predicate}]-> ${object}`);

      return triple.id;
    };

    const getTriple = (id) => {
      return _triples.find(t => t.id === id) || null;
    };

    const deleteTriple = async (id) => {
      const idx = _triples.findIndex(t => t.id === id);
      if (idx === -1) return false;

      _triples.splice(idx, 1);
      rebuildIndices();
      await save();

      return true;
    };

    // --- Query Operations ---

    const query = (pattern) => {
      let results = [..._triples];

      if (pattern.subject) {
        const indices = _subjectIndex.get(pattern.subject) || [];
        results = indices.map(i => _triples[i]).filter(Boolean);
      }

      if (pattern.predicate) {
        if (pattern.subject) {
          results = results.filter(t => t.predicate === pattern.predicate);
        } else {
          const indices = _predicateIndex.get(pattern.predicate) || [];
          results = indices.map(i => _triples[i]).filter(Boolean);
        }
      }

      if (pattern.object) {
        results = results.filter(t => t.object === pattern.object);
      }

      if (pattern.minConfidence) {
        results = results.filter(t => t.metadata.confidence >= pattern.minConfidence);
      }

      return results;
    };

    const queryEntities = (pattern) => {
      let results = getAllEntities();

      if (pattern.type) {
        results = results.filter(e => e.types.includes(pattern.type));
      }

      if (pattern.hasProperty) {
        results = results.filter(e => pattern.hasProperty in e.properties);
      }

      if (pattern.label) {
        const labelLower = pattern.label.toLowerCase();
        results = results.filter(e =>
          Object.values(e.labels).some(l => l.toLowerCase().includes(labelLower))
        );
      }

      return results;
    };

    const getRelatedEntities = (entityId, predicate = null) => {
      const outgoing = query({ subject: entityId, predicate });
      const incoming = query({ object: entityId, predicate });

      const related = new Set();

      outgoing.forEach(t => {
        if (typeof t.object === 'string' && _entities.has(t.object)) {
          related.add(t.object);
        }
      });

      incoming.forEach(t => {
        if (_entities.has(t.subject)) {
          related.add(t.subject);
        }
      });

      return Array.from(related).map(id => _entities.get(id));
    };

    // --- Confidence Management ---

    const decayConfidence = async () => {
      const now = Date.now();
      const hourMs = 3600000;
      let updated = 0;

      for (const triple of _triples) {
        if (triple.metadata.source === 'llm') {
          const hoursOld = (now - triple.metadata.timestamp) / hourMs;
          const decayedConfidence = triple.metadata.confidence * Math.pow(CONFIDENCE_DECAY_RATE, hoursOld);

          if (decayedConfidence < 0.3) {
            // Mark for deletion
            triple.metadata.confidence = 0;
            updated++;
          } else if (Math.abs(triple.metadata.confidence - decayedConfidence) > 0.01) {
            triple.metadata.confidence = decayedConfidence;
            updated++;
          }
        }
      }

      // Remove low-confidence triples
      const before = _triples.length;
      _triples = _triples.filter(t => t.metadata.confidence > 0);
      const removed = before - _triples.length;

      if (removed > 0) {
        rebuildIndices();
        await save();
        logger.info(`[KnowledgeGraph] Decayed ${updated} triples, removed ${removed}`);
      }

      return { updated, removed };
    };

    // --- Maintenance ---

    const prune = async () => {
      // Remove entities with no triples
      const usedEntities = new Set();
      for (const triple of _triples) {
        usedEntities.add(triple.subject);
        if (typeof triple.object === 'string') {
          usedEntities.add(triple.object);
        }
      }

      let removed = 0;
      for (const [id, entity] of _entities) {
        if (!usedEntities.has(id) && entity.metadata.source !== 'system') {
          _entities.delete(id);
          removed++;
        }
      }

      if (removed > 0) {
        await save();
        logger.info(`[KnowledgeGraph] Pruned ${removed} orphan entities`);
      }

      return removed;
    };

    const getStats = () => ({
      entityCount: _entities.size,
      tripleCount: _triples.length,
      predicates: Array.from(_predicateIndex.keys()),
      maxEntities: MAX_ENTITIES,
      maxTriples: MAX_TRIPLES
    });

    const clear = async () => {
      _entities = new Map();
      _triples = [];
      _predicateIndex = new Map();
      _subjectIndex = new Map();
      _objectIndex = new Map();
      await save();
      logger.info('[KnowledgeGraph] Cleared all data');
    };

    const exportGraph = () => serialize();

    const importGraph = async (data) => {
      deserialize(data);
      rebuildIndices();
      await save();
      logger.info(`[KnowledgeGraph] Imported ${_entities.size} entities, ${_triples.length} triples`);
    };

    return {
      init,
      addEntity,
      getEntity,
      updateEntity,
      deleteEntity,
      getAllEntities,
      addTriple,
      getTriple,
      deleteTriple,
      query,
      queryEntities,
      getRelatedEntities,
      decayConfidence,
      prune,
      getStats,
      clear,
      exportGraph,
      importGraph
    };
  }
};

export default KnowledgeGraph;
