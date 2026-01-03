/**
 * @fileoverview Symbol Grounder
 * Maps LLM text output to symbolic entities in the knowledge graph.
 * Performs entity recognition, linking, and fact extraction.
 */

const SymbolGrounder = {
  metadata: {
    id: 'SymbolGrounder',
    version: '1.0.0',
    genesis: { introduced: 'cognition' },
    dependencies: ['Utils', 'EventBus', 'KnowledgeGraph', 'SemanticMemory'],
    async: true,
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, EventBus, KnowledgeGraph, SemanticMemory } = deps;
    const { logger, generateId } = Utils;

    // Patterns for extracting structured information
    const PATTERNS = {
      toolCall: /TOOL_CALL:\s*(\w+)/g,
      filePath: /(?:\/[\w\-./]+\.\w+)/g,
      codeRef: /`([^`]+)`/g,
      error: /(?:Error|Exception|Failed):\s*([^\n.]+)/gi,
      url: /https?:\/\/[^\s<>"{}|\\^`[\]]+/g,
      number: /\b\d+(?:\.\d+)?\b/g
    };

    // Type mapping for extracted mentions
    const TYPE_MAP = {
      toolCall: 'Tool',
      filePath: 'File',
      codeRef: 'CodeElement',
      error: 'Error',
      url: 'URL'
    };

    // --- Grounding Pipeline ---

    const ground = async (text, context = {}) => {
      if (!text || typeof text !== 'string') {
        return { entities: [], newEntities: [], relations: [], facts: [] };
      }

      // Step 1: Extract mentions using patterns
      const mentions = extractMentions(text);

      // Step 2: Link mentions to existing entities or create new ones
      const groundedEntities = [];
      const newEntities = [];

      for (const mention of mentions) {
        const linked = await linkMention(mention, context);

        if (linked.isNew) {
          newEntities.push(linked);
        }
        groundedEntities.push(linked);
      }

      // Step 3: Extract relations from text
      const relations = extractRelations(text, groundedEntities);

      // Step 4: Create facts from structured data
      const facts = extractFacts(text, context);

      logger.debug(`[SymbolGrounder] Grounded ${groundedEntities.length} entities, ${relations.length} relations`);

      return {
        entities: groundedEntities,
        newEntities,
        relations,
        facts
      };
    };

    // --- Mention Extraction ---

    const extractMentions = (text) => {
      const mentions = [];
      const seen = new Set();

      for (const [patternName, regex] of Object.entries(PATTERNS)) {
        // Reset regex state
        regex.lastIndex = 0;
        let match;

        while ((match = regex.exec(text)) !== null) {
          const value = match[1] || match[0];
          const key = `${patternName}:${value}`;

          if (!seen.has(key)) {
            seen.add(key);
            mentions.push({
              text: value,
              type: TYPE_MAP[patternName] || 'Entity',
              patternType: patternName,
              start: match.index,
              end: match.index + match[0].length,
              confidence: 0.9
            });
          }
        }
      }

      // Extract noun phrases (simple heuristic)
      const nounPhrases = extractNounPhrases(text);
      for (const np of nounPhrases) {
        const key = `np:${np.text}`;
        if (!seen.has(key) && np.text.length > 3) {
          seen.add(key);
          mentions.push({
            ...np,
            type: 'Entity',
            patternType: 'nounPhrase',
            confidence: 0.6
          });
        }
      }

      return mentions;
    };

    const extractNounPhrases = (text) => {
      // Simple noun phrase extraction using capitalization
      const phrases = [];
      const capitalizedPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
      let match;

      while ((match = capitalizedPattern.exec(text)) !== null) {
        // Filter out common sentence starters
        const skipWords = ['The', 'This', 'That', 'These', 'Those', 'It', 'I', 'You', 'We', 'They'];
        if (!skipWords.includes(match[1])) {
          phrases.push({
            text: match[1],
            start: match.index,
            end: match.index + match[0].length
          });
        }
      }

      return phrases;
    };

    // --- Entity Linking ---

    const linkMention = async (mention, context) => {
      const entities = KnowledgeGraph.getAllEntities();

      // Try exact match first
      let bestMatch = null;
      let bestScore = 0;

      for (const entity of entities) {
        const score = computeMatchScore(mention, entity);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = entity;
        }
      }

      // If good match found, return linked entity
      if (bestMatch && bestScore > 0.8) {
        return {
          mention,
          entity: bestMatch,
          entityId: bestMatch.id,
          score: bestScore,
          isNew: false
        };
      }

      // Try semantic similarity if available
      if (SemanticMemory && bestScore < 0.6) {
        try {
          const similar = await SemanticMemory.search(mention.text, { topK: 1 });
          if (similar.length > 0 && similar[0].similarity > 0.7) {
            // Found semantically similar memory, check for linked entity
            const memoryEntity = findEntityByLabel(similar[0].content, entities);
            if (memoryEntity) {
              return {
                mention,
                entity: memoryEntity,
                entityId: memoryEntity.id,
                score: similar[0].similarity,
                isNew: false,
                matchType: 'semantic'
              };
            }
          }
        } catch (e) {
          // SemanticMemory not ready, continue without it
        }
      }

      // Create new entity if high-confidence novel mention
      if (mention.confidence > 0.7) {
        const newId = await KnowledgeGraph.addEntity({
          types: [mention.type],
          labels: { en: mention.text },
          properties: {
            extractedFrom: 'llm-output',
            patternType: mention.patternType
          },
          source: 'grounding',
          confidence: mention.confidence
        });

        const newEntity = KnowledgeGraph.getEntity(newId);

        return {
          mention,
          entity: newEntity,
          entityId: newId,
          score: mention.confidence,
          isNew: true
        };
      }

      // Low confidence, return unlinked
      return {
        mention,
        entity: null,
        entityId: null,
        score: 0,
        isNew: false,
        unlinked: true
      };
    };

    const computeMatchScore = (mention, entity) => {
      const mentionLower = mention.text.toLowerCase();
      let maxScore = 0;

      // Check labels
      for (const label of Object.values(entity.labels || {})) {
        const labelLower = label.toLowerCase();

        // Exact match
        if (labelLower === mentionLower) {
          return 1.0;
        }

        // Partial match
        if (labelLower.includes(mentionLower) || mentionLower.includes(labelLower)) {
          const score = Math.min(mentionLower.length, labelLower.length) /
                       Math.max(mentionLower.length, labelLower.length);
          maxScore = Math.max(maxScore, score * 0.8);
        }
      }

      // Check entity ID
      if (entity.id.toLowerCase() === mentionLower) {
        maxScore = Math.max(maxScore, 0.9);
      }

      // Type match bonus
      if (entity.types.includes(mention.type)) {
        maxScore = Math.min(1.0, maxScore + 0.1);
      }

      return maxScore;
    };

    const findEntityByLabel = (label, entities) => {
      const labelLower = label.toLowerCase();
      return entities.find(e =>
        Object.values(e.labels || {}).some(l => l.toLowerCase() === labelLower)
      );
    };

    // --- Relation Extraction ---

    const extractRelations = (text, groundedEntities) => {
      const relations = [];
      const entityMap = new Map(groundedEntities.map(g => [g.mention.text, g]));

      // Pattern-based relation extraction
      const relationPatterns = [
        {
          pattern: /(\w+)\s+(?:is|are)\s+(?:a|an)\s+(\w+)/gi,
          predicate: 'isA'
        },
        {
          pattern: /(\w+)\s+(?:uses?|using)\s+(\w+)/gi,
          predicate: 'uses'
        },
        {
          pattern: /(\w+)\s+(?:depends?\s+on|requires?)\s+(\w+)/gi,
          predicate: 'dependsOn'
        },
        {
          pattern: /(\w+)\s+(?:created?|generates?|produces?)\s+(\w+)/gi,
          predicate: 'produces'
        },
        {
          pattern: /(\w+)\s+(?:failed?|errored?)\s+(?:with|due\s+to)\s+(.+?)(?:\.|$)/gi,
          predicate: 'failedWith'
        }
      ];

      for (const { pattern, predicate } of relationPatterns) {
        pattern.lastIndex = 0;
        let match;

        while ((match = pattern.exec(text)) !== null) {
          const subjectText = match[1];
          const objectText = match[2];

          const subject = entityMap.get(subjectText);
          const object = entityMap.get(objectText);

          if (subject?.entityId && object?.entityId) {
            relations.push({
              subject: subject.entityId,
              predicate,
              object: object.entityId,
              confidence: 0.7,
              source: 'pattern-extraction'
            });
          }
        }
      }

      return relations;
    };

    // --- Fact Extraction ---

    const extractFacts = (text, context) => {
      const facts = [];

      // Extract tool execution facts
      const toolCalls = text.match(/TOOL_CALL:\s*(\w+)/g) || [];
      for (const call of toolCalls) {
        const toolName = call.replace('TOOL_CALL:', '').trim();
        facts.push({
          predicate: 'toolExecuted',
          args: [toolName, context.cycle || 'unknown'],
          confidence: 1.0,
          source: 'structured'
        });
      }

      // Extract success/failure facts
      if (text.includes('Error:') || text.includes('Failed')) {
        const toolMatch = text.match(/TOOL_CALL:\s*(\w+)/);
        if (toolMatch) {
          facts.push({
            predicate: 'failedExecution',
            args: [toolMatch[1], context.cycle || 'unknown'],
            confidence: 0.9,
            source: 'structured'
          });
        }
      }

      // Extract file modification facts
      const fileWrites = text.match(/(?:wrote|created|modified)\s+(\/[\w\-./]+\.\w+)/gi) || [];
      for (const write of fileWrites) {
        const path = write.match(/(\/[\w\-./]+\.\w+)/)?.[1];
        if (path) {
          facts.push({
            predicate: 'fileModified',
            args: [path, context.cycle || 'unknown'],
            confidence: 0.8,
            source: 'pattern'
          });
        }
      }

      return facts;
    };

    // --- Batch Processing ---

    const groundBatch = async (texts, context = {}) => {
      const results = [];
      for (const text of texts) {
        const result = await ground(text, context);
        results.push(result);
      }
      return results;
    };

    // --- Integration ---

    const integrateGrounding = async (grounding) => {
      // Add extracted relations to knowledge graph
      for (const relation of grounding.relations) {
        await KnowledgeGraph.addTriple(
          relation.subject,
          relation.predicate,
          relation.object,
          {
            confidence: relation.confidence,
            source: relation.source
          }
        );
      }

      // Add extracted facts to knowledge graph
      for (const fact of grounding.facts) {
        if (fact.args.length === 2) {
          await KnowledgeGraph.addTriple(
            fact.args[0],
            fact.predicate,
            fact.args[1],
            {
              confidence: fact.confidence,
              source: fact.source
            }
          );
        }
      }

      logger.debug(`[SymbolGrounder] Integrated ${grounding.relations.length} relations, ${grounding.facts.length} facts`);
    };

    return {
      ground,
      groundBatch,
      extractMentions,
      extractRelations,
      extractFacts,
      integrateGrounding
    };
  }
};

export default SymbolGrounder;
