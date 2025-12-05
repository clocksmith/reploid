/**
 * @fileoverview Persona Manager
 * dynamic system prompt construction based on config.
 */

const PersonaManager = {
  metadata: {
    id: 'PersonaManager',
    version: '1.0.0',
    dependencies: ['Utils'],
    async: true,
    type: 'core'
  },

  factory: (deps) => {
    const { Utils } = deps;
    const { logger } = Utils;

    // Core RSI instructions - always included
    const CORE_INSTRUCTIONS = `You are REPLOID, an autonomous AI agent in a browser-based VFS.
Your code lives at /core/, /capabilities/, and /tools/. You can read, write, and modify your own source.

## RSI PROTOCOL
1. NEVER declare yourself "done" - there is always room for improvement
2. After writing ANY code: LOAD it, EXECUTE it, VERIFY it works
3. After creating a tool: CALL the tool and observe the output
4. If something fails: debug, fix, retry
5. If something works: look for optimizations, edge cases, enhancements

## TOOL WRITING
All tools live in /tools/. Tools receive a \`deps\` object: { VFS, EventBus, ToolRunner, ... }
- Tool signature: \`export default async function(args, deps) { return result; }\`
- Tool names MUST use CamelCase (e.g., ReadFile, InspectCore)`;

    let _config = null;

    const loadConfig = async () => {
      if (_config) return _config;
      try {
        const response = await fetch('/config.json');
        if (response.ok) {
          _config = await response.json();
        }
      } catch (err) {
        logger.warn('[PersonaManager] Could not load config.json');
      }
      return _config;
    };

    const getSystemPrompt = async () => {
      try {
        const config = await loadConfig();
        if (!config?.personas?.length) {
          return CORE_INSTRUCTIONS;
        }

        // Get selection from localStorage, fallback to config default
        const selectedId = localStorage.getItem('REPLOID_PERSONA_ID')
          || config.defaultPersona
          || 'default';

        const personaDef = config.personas.find(p => p.id === selectedId);
        if (!personaDef) {
          return CORE_INSTRUCTIONS;
        }

        logger.info(`[PersonaManager] Active Persona: ${personaDef.name}`);

        // Combine core instructions with persona-specific guidance
        return `${CORE_INSTRUCTIONS}

## PERSONA: ${personaDef.name}
${personaDef.description}

## BEHAVIORAL FOCUS
${personaDef.instructions || "Focus on continuous improvement."}`;

      } catch (err) {
        logger.error('[PersonaManager] Failed to load persona', err);
        return CORE_INSTRUCTIONS;
      }
    };

    const getPersonas = async () => {
      const config = await loadConfig();
      return config?.personas || [];
    };

    return { getSystemPrompt, getPersonas };
  }
};

export default PersonaManager;
