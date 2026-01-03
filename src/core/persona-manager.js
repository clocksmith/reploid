/**
 * @fileoverview Persona Manager
 * dynamic system prompt construction based on config.
 */

const PersonaManager = {
  metadata: {
    id: 'PersonaManager',
    version: '1.0.0',
    genesis: { introduced: 'spark' },
    dependencies: ['Utils', 'VFS', 'EventBus?'],
    async: true,
    type: 'core'
  },

  factory: (deps) => {
    const { Utils, VFS, EventBus } = deps;
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
    let _overrides = null;
    const OVERRIDES_PATH = '/.memory/persona-overrides.json';

    const loadConfig = async () => {
      if (_config) return _config;
      try {
        const response = await fetch('/personas/config.json');
        if (response.ok) {
          _config = await response.json();
        }
      } catch (err) {
        logger.warn('[PersonaManager] Could not load config.json');
      }
      return _config;
    };

    const loadOverrides = async () => {
      if (_overrides) return _overrides;
      _overrides = { personas: {}, updatedAt: Date.now() };
      if (!VFS) return _overrides;
      try {
        if (await VFS.exists(OVERRIDES_PATH)) {
          const content = await VFS.read(OVERRIDES_PATH);
          const parsed = JSON.parse(content);
          _overrides = {
            personas: parsed?.personas || {},
            updatedAt: parsed?.updatedAt || Date.now()
          };
        }
      } catch (err) {
        logger.warn('[PersonaManager] Failed to load overrides', err.message);
      }
      return _overrides;
    };

    const saveOverrides = async () => {
      if (!VFS || !_overrides) return false;
      _overrides.updatedAt = Date.now();
      await VFS.write(OVERRIDES_PATH, JSON.stringify(_overrides, null, 2));
      if (EventBus) {
        EventBus.emit('persona:overrides_updated', { updatedAt: _overrides.updatedAt });
      }
      return true;
    };

    const getActivePersonaId = (config) => {
      return localStorage.getItem('REPLOID_PERSONA_ID')
        || config.defaultPersona
        || 'default';
    };

    const buildSystemPrompt = (personaDef, override = {}) => {
      if (!personaDef) return CORE_INSTRUCTIONS;
      const description = override.description || personaDef.description;
      const instructions = override.instructions || personaDef.instructions || 'Focus on continuous improvement.';
      return `${CORE_INSTRUCTIONS}

## PERSONA: ${personaDef.name}
${description}

## BEHAVIORAL FOCUS
${instructions}`;
    };

    const getSystemPrompt = async () => {
      try {
        const config = await loadConfig();
        if (!config?.personas?.length) {
          return CORE_INSTRUCTIONS;
        }

        // Get selection from localStorage, fallback to config default
        const selectedId = getActivePersonaId(config);

        const personaDef = config.personas.find(p => p.id === selectedId);
        if (!personaDef) {
          return CORE_INSTRUCTIONS;
        }

        const overrides = await loadOverrides();
        const personaOverride = overrides?.personas?.[selectedId] || {};

        logger.info(`[PersonaManager] Active Persona: ${personaDef.name}`);

        return buildSystemPrompt(personaDef, personaOverride);

      } catch (err) {
        logger.error('[PersonaManager] Failed to load persona', err);
        return CORE_INSTRUCTIONS;
      }
    };

    const getPersonas = async () => {
      const config = await loadConfig();
      return config?.personas || [];
    };

    const getActivePersona = async () => {
      const config = await loadConfig();
      const personaId = getActivePersonaId(config || {});
      const personaDef = config?.personas?.find(p => p.id === personaId) || null;
      const overrides = await loadOverrides();
      const personaOverride = overrides?.personas?.[personaId] || {};
      if (!personaDef) return null;
      return {
        ...personaDef,
        description: personaOverride.description || personaDef.description,
        instructions: personaOverride.instructions || personaDef.instructions
      };
    };

    const getPromptSlots = async (personaId = null) => {
      const config = await loadConfig();
      const resolvedId = personaId || getActivePersonaId(config || {});
      const personaDef = config?.personas?.find(p => p.id === resolvedId) || null;
      const overrides = await loadOverrides();
      const personaOverride = overrides?.personas?.[resolvedId] || {};
      return {
        coreInstructions: CORE_INSTRUCTIONS,
        personaId: resolvedId,
        personaName: personaDef?.name || null,
        description: personaOverride.description || personaDef?.description || '',
        instructions: personaOverride.instructions || personaDef?.instructions || ''
      };
    };

    const applySlotMutation = async ({ personaId, slot, content, mode = 'replace' }) => {
      if (!personaId || !slot) {
        throw new Error('personaId and slot required');
      }
      if (!['description', 'instructions'].includes(slot)) {
        throw new Error(`Unsupported slot: ${slot}`);
      }
      const overrides = await loadOverrides();
      const current = overrides.personas[personaId]?.[slot] || '';
      let next = content;
      if (mode === 'append') next = `${current}\n${content}`.trim();
      if (mode === 'prepend') next = `${content}\n${current}`.trim();
      overrides.personas[personaId] = {
        ...overrides.personas[personaId],
        [slot]: next
      };
      await saveOverrides();
      return { personaId, slot, content: next };
    };

    return { getSystemPrompt, getPersonas, getActivePersona, getPromptSlots, applySlotMutation, buildSystemPrompt };
  }
};

export default PersonaManager;
