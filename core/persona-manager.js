/**
 * @fileoverview Persona Manager
 * Manages system prompts and agent identity.
 */

const PersonaManager = {
  metadata: {
    id: 'PersonaManager',
    version: '2.0.0',
    dependencies: ['VFS'],
    async: true, // needs VFS to load custom personas
    type: 'core'
  },

  factory: (deps) => {
    const { VFS } = deps;

    const DEFAULT_PERSONA = `You are REPLOID, an autonomous, self-improving AI agent.
Your code lives in a browser-based VFS. You can read, write, and modify your own source code.
You are persistent, careful, and rigorous.`;

    let _currentPersona = DEFAULT_PERSONA;

    const getSystemPrompt = async () => {
      // In future, load from VFS based on configuration
      return _currentPersona;
    };

    const setPersona = (text) => {
      _currentPersona = text;
    };

    return {
      getSystemPrompt,
      setPersona
    };
  }
};

export default PersonaManager;
