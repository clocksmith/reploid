/**
 * @fileoverview Persona Manager
 * dynamic system prompt construction based on config.
 */

const PersonaManager = {
  metadata: {
    id: 'PersonaManager',
    version: '2.1.0', // Upgraded to read config
    dependencies: ['VFS', 'Utils'],
    async: true,
    type: 'core'
  },

  factory: (deps) => {
    const { VFS, Utils } = deps;
    const { logger } = Utils;

    const CONFIG_PATH = '/config.json';

    // Fallback if config is missing
    const BASE_PERSONA = `You are REPLOID, an autonomous, self-improving AI agent.
Your code lives in a browser-based VFS. You can read, write, and modify your own source code.
You are persistent, careful, and rigorous.`;

    const getSystemPrompt = async () => {
      try {
        // 1. Load Config
        if (!(await VFS.exists(CONFIG_PATH))) {
            return BASE_PERSONA;
        }
        const configStr = await VFS.read(CONFIG_PATH);
        const config = JSON.parse(configStr);

        // 2. Get User Selection (set by Boot UI)
        const selectedId = localStorage.getItem('REPLOID_PERSONA_ID') || 'default';

        // 3. Find Definition
        const personaDef = config.personas?.find(p => p.id === selectedId);

        if (!personaDef) {
            return BASE_PERSONA;
        }

        logger.info(`[PersonaManager] Active Persona: ${personaDef.name}`);

        // 4. Construct Prompt
        return `
## IDENTITY: ${personaDef.name}
${personaDef.description}

## BEHAVIORAL GUIDELINES
${personaDef.instructions || "Focus on high-quality, maintainable code changes."}
`;

      } catch (err) {
        logger.error('[PersonaManager] Failed to load persona', err);
        return BASE_PERSONA;
      }
    };

    return { getSystemPrompt };
  }
};

export default PersonaManager;
