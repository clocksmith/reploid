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
  const { GEPAOptimizer, PersonaManager, PromptMemory } = deps;
  if (!GEPAOptimizer?.api?.evolve) {
    throw new Error('GEPAOptimizer not available (requires FULL SUBSTRATE genesis level)');
  }

  // Handle resume from checkpoint
  if (args.resume) {
    const checkpointPath = args.checkpointPath || '/.memory/gepa/';
    const taskSet = args.tasks || args.taskSet;

    if (!Array.isArray(taskSet) || taskSet.length === 0) {
      throw new Error('Missing tasks array for resume');
    }

    const evaluationModel = resolveModelConfig(args.evaluationModel) || getDefaultModelConfig();
    const reflectionModel = resolveModelConfig(args.reflectionModel) || evaluationModel;

    if (!evaluationModel) {
      throw new Error('No evaluation model configured for resume');
    }

    const result = await GEPAOptimizer.api.resumeEvolution(checkpointPath, taskSet, {
      evaluationModel,
      reflectionModel,
      ...(args.options || {})
    });

    return {
      resumed: true,
      generations: result.generations,
      resumedFromGeneration: result.resumedFromGeneration,
      frontierSize: result.frontier?.length || 0,
      bestCandidate: result.bestOverall ? {
        id: result.bestOverall.id,
        scores: result.bestOverall.scores,
        preview: (result.bestOverall.content || '').slice(0, 500)
      } : null
    };
  }

  // Handle list checkpoints request
  if (args.listCheckpoints) {
    const checkpointPath = args.checkpointPath || '/.memory/gepa/';
    const checkpoints = await GEPAOptimizer.api.listCheckpoints(checkpointPath);
    return { checkpoints };
  }

  const targetType = args.targetType || args.options?.targetType || 'prompt';
  const targetMeta = { ...(args.options?.targetMeta || {}) };
  const personaSlot = args.personaSlot || targetMeta.slot || null;
  const personaId = args.personaId || targetMeta.personaId || null;

  let seedPrompt = args.seedPrompt || args.prompt;
  const taskSet = args.tasks || args.taskSet;
  const taskDescription = args.taskDescription || args.options?.taskDescription || '';
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
    taskDescription,
    promoteBest: args.promote || options.promoteBest || false,
    promoteOptions,
    evaluationModel,
    reflectionModel,
    storeEvolved: args.storeEvolved !== false, // Store by default
    storeFrontier: args.storeFrontier || false
  });

  const best = result.bestOverall;
  return {
    generations: result.generations,
    totalEvaluations: result.totalEvaluations,
    frontierSize: result.frontier.length,
    promotion: result.promotion || null,
    storedPromptId: result.storedPromptId || null,
    bestCandidate: best ? {
      id: best.id,
      scores: best.scores,
      preview: (best.content || '').slice(0, 500)
    } : null
  };
}

export const tool = {
  name: 'RunGEPA',
  description: 'Run GEPA prompt evolution on a task set. Supports checkpointing and resume.',
  inputSchema: {
    type: 'object',
    required: [],
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
      taskDescription: {
        type: 'string',
        description: 'Description of the task type (enables transfer learning)'
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
      resume: {
        type: 'boolean',
        description: 'Resume from last checkpoint'
      },
      listCheckpoints: {
        type: 'boolean',
        description: 'List available checkpoints'
      },
      checkpointPath: {
        type: 'string',
        description: 'Path to checkpoint directory (default: /.memory/gepa/)'
      },
      storeEvolved: {
        type: 'boolean',
        description: 'Store evolved prompts in PromptMemory (default: true)'
      },
      storeFrontier: {
        type: 'boolean',
        description: 'Store entire Pareto frontier, not just best'
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
