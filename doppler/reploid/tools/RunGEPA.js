/**
 * @fileoverview RunGEPA - Trigger GEPA prompt evolution
 */

const resolveModelConfig = (modelRef) => {
  if (!modelRef) return null;
  if (typeof modelRef === 'object') return modelRef;
  if (typeof modelRef === 'string') {
    try {
      const stored = localStorage.getItem('SELECTED_MODELS');
      const models = stored ? JSON.parse(stored) : [];
      return models.find(m => m.id === modelRef) || null;
    } catch {
      return null;
    }
  }
  return null;
};

const getDefaultModelConfig = () => {
  try {
    const stored = localStorage.getItem('SELECTED_MODELS');
    const models = stored ? JSON.parse(stored) : [];
    return models[0] || null;
  } catch {
    return null;
  }
};

async function call(args = {}, deps = {}) {
  const { GEPAOptimizer, PersonaManager } = deps;
  if (!GEPAOptimizer?.api?.evolve) {
    throw new Error('GEPAOptimizer not available (requires FULL SUBSTRATE genesis level)');
  }

  const targetType = args.targetType || args.options?.targetType || 'prompt';
  const targetMeta = { ...(args.options?.targetMeta || {}) };
  const personaSlot = args.personaSlot || targetMeta.slot || null;
  const personaId = args.personaId || targetMeta.personaId || null;

  let seedPrompt = args.seedPrompt || args.prompt;
  const taskSet = args.tasks || args.taskSet;
  const options = args.options || {};

  if (targetType === 'persona_slot') {
    if (!personaSlot) {
      throw new Error('Missing personaSlot for persona_slot targetType');
    }
    if (!seedPrompt) {
      if (!PersonaManager?.getPromptSlots) {
        throw new Error('PersonaManager not available for persona_slot seed');
      }
      const slots = await PersonaManager.getPromptSlots(personaId);
      seedPrompt = slots[personaSlot] || '';
    }
    targetMeta.slot = personaSlot;
    if (personaId) targetMeta.personaId = personaId;
  }

  if (!seedPrompt || typeof seedPrompt !== 'string') {
    throw new Error('Missing seedPrompt (string)');
  }
  if (!Array.isArray(taskSet) || taskSet.length === 0) {
    throw new Error('Missing tasks array');
  }

  const evaluationModel = resolveModelConfig(args.evaluationModel)
    || resolveModelConfig(options.evaluationModel)
    || getDefaultModelConfig();
  const reflectionModel = resolveModelConfig(args.reflectionModel)
    || resolveModelConfig(options.reflectionModel)
    || evaluationModel;

  if (!evaluationModel) {
    throw new Error('No evaluation model configured. Provide evaluationModel or set SELECTED_MODELS.');
  }
  if (!reflectionModel) {
    throw new Error('No reflection model configured.');
  }

  const promoteOptions = {
    arenaValidate: true,
    ...(args.promoteOptions || options.promoteOptions || {})
  };

  const result = await GEPAOptimizer.api.evolve(seedPrompt, taskSet, {
    ...options,
    targetType,
    targetMeta,
    promoteBest: args.promote || options.promoteBest || false,
    promoteOptions,
    evaluationModel,
    reflectionModel
  });

  const best = result.bestOverall;
  return {
    generations: result.generations,
    totalEvaluations: result.totalEvaluations,
    frontierSize: result.frontier.length,
    promotion: result.promotion || null,
    bestCandidate: best ? {
      id: best.id,
      scores: best.scores,
      preview: (best.content || '').slice(0, 500)
    } : null
  };
}

export const tool = {
  name: 'RunGEPA',
  description: 'Run GEPA prompt evolution on a task set',
  inputSchema: {
    type: 'object',
    required: ['tasks'],
    properties: {
      seedPrompt: { type: 'string', description: 'Seed prompt to evolve' },
      tasks: {
        type: 'array',
        description: 'Task set: {input, expectedOutput?} objects',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            input: { type: 'string' },
            expectedOutput: { type: 'string' }
          }
        }
      },
      evaluationModel: {
        description: 'Model config object or model id from SELECTED_MODELS',
        oneOf: [{ type: 'string' }, { type: 'object' }]
      },
      reflectionModel: {
        description: 'Model config object or model id from SELECTED_MODELS',
        oneOf: [{ type: 'string' }, { type: 'object' }]
      },
      targetType: {
        type: 'string',
        description: 'Target type to evolve (prompt or persona_slot)'
      },
      personaSlot: {
        type: 'string',
        description: 'Persona slot to evolve (description or instructions)'
      },
      personaId: {
        type: 'string',
        description: 'Persona id to target (default: active persona)'
      },
      promote: {
        type: 'boolean',
        description: 'Promote best candidate into safe prompt store'
      },
      promoteOptions: {
        type: 'object',
        description: 'Promotion options (storagePath, arenaValidate, applyToPersona)'
      },
      options: { type: 'object', description: 'GEPA options override' }
    }
  },
  call
};

export default call;
