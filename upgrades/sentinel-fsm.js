// Enhanced Sentinel FSM with REFLECTING state for REPLOID
// Implements the complete Guardian Agent cognitive cycle

const SentinelFSM = {
  metadata: {
    id: 'SentinelFSM',
    version: '2.0.0',
    dependencies: ['StateManager', 'ToolRunner', 'ApiClient', 'EventBus', 'Utils', 'SentinelTools', 'GitVFS'],
    async: false,
    type: 'service'
  },

  factory: (deps) => {
    const { StateManager, ToolRunner, ApiClient, EventBus, Utils, SentinelTools, GitVFS } = deps;
    const { logger } = Utils;

    let currentState = 'IDLE';
    let cycleContext = null;
    let stateHistory = [];
    let reflectionInsights = [];

    // Define valid state transitions
    const validTransitions = {
      'IDLE': ['CURATING_CONTEXT'],
      'CURATING_CONTEXT': ['AWAITING_CONTEXT_APPROVAL', 'ERROR'],
      'AWAITING_CONTEXT_APPROVAL': ['PLANNING_WITH_CONTEXT', 'CURATING_CONTEXT', 'IDLE'],
      'PLANNING_WITH_CONTEXT': ['GENERATING_PROPOSAL', 'ERROR'],
      'GENERATING_PROPOSAL': ['AWAITING_PROPOSAL_APPROVAL', 'ERROR'],
      'AWAITING_PROPOSAL_APPROVAL': ['APPLYING_CHANGESET', 'PLANNING_WITH_CONTEXT', 'IDLE'],
      'APPLYING_CHANGESET': ['REFLECTING', 'ERROR'],
      'REFLECTING': ['IDLE', 'CURATING_CONTEXT'],
      'ERROR': ['IDLE']
    };

    // Transition to a new state
    const transitionTo = (newState) => {
      const oldState = currentState;

      // Validate transition
      if (!validTransitions[currentState]?.includes(newState)) {
        logger.error(`[SentinelFSM] Invalid transition: ${currentState} -> ${newState}`);
        return false;
      }

      currentState = newState;
      stateHistory.push({
        from: oldState,
        to: newState,
        timestamp: Date.now(),
        context: { ...cycleContext }
      });

      logger.info(`[SentinelFSM] State transition: ${oldState} -> ${newState}`);

      EventBus.emit('fsm:state:changed', {
        oldState,
        newState,
        context: cycleContext
      });

      return true;
    };

    // Start a new cycle with a goal
    const startCycle = async (goal) => {
      if (currentState !== 'IDLE') {
        logger.warn(`[SentinelFSM] Cannot start cycle in state: ${currentState}`);
        return false;
      }

      // Create new session
      const sessionId = await StateManager.sessionManager.createSession(goal);
      const turn = await StateManager.sessionManager.createTurn(sessionId);

      cycleContext = {
        goal,
        sessionId,
        turn,
        startTime: Date.now(),
        iterations: 0,
        maxIterations: 10
      };

      transitionTo('CURATING_CONTEXT');
      await executeState();

      return true;
    };

    // Execute the current state
    const executeState = async () => {
      logger.info(`[SentinelFSM] Executing state: ${currentState}`);

      try {
        switch (currentState) {
          case 'IDLE':
            await executeIdle();
            break;

          case 'CURATING_CONTEXT':
            await executeCuratingContext();
            break;

          case 'AWAITING_CONTEXT_APPROVAL':
            await executeAwaitingContextApproval();
            break;

          case 'PLANNING_WITH_CONTEXT':
            await executePlanningWithContext();
            break;

          case 'GENERATING_PROPOSAL':
            await executeGeneratingProposal();
            break;

          case 'AWAITING_PROPOSAL_APPROVAL':
            await executeAwaitingProposalApproval();
            break;

          case 'APPLYING_CHANGESET':
            await executeApplyingChangeset();
            break;

          case 'REFLECTING':
            await executeReflecting();
            break;

          case 'ERROR':
            await executeError();
            break;

          default:
            logger.error(`[SentinelFSM] Unknown state: ${currentState}`);
        }
      } catch (error) {
        logger.error(`[SentinelFSM] Error in state ${currentState}:`, error);
        transitionTo('ERROR');
        await executeState();
      }
    };

    // State: IDLE
    const executeIdle = async () => {
      EventBus.emit('agent:idle');
      // Wait for a new goal
    };

    // State: CURATING_CONTEXT
    const executeCuratingContext = async () => {
      EventBus.emit('agent:curating', { goal: cycleContext.goal });

      // Use AI to curate relevant files
      const relevantFiles = await SentinelTools.curateFilesWithAI(cycleContext.goal);

      // Create cats bundle
      const result = await SentinelTools.createCatsBundle({
        file_paths: relevantFiles,
        reason: `Context for goal: ${cycleContext.goal}`,
        turn_path: cycleContext.turn.cats_path,
        ai_curate: true
      });

      if (result.success) {
        cycleContext.catsPath = result.path;
        transitionTo('AWAITING_CONTEXT_APPROVAL');
        await executeState();
      } else {
        throw new Error('Failed to create context bundle');
      }
    };

    // State: AWAITING_CONTEXT_APPROVAL
    const executeAwaitingContextApproval = async () => {
      EventBus.emit('agent:awaiting:context', {
        cats_path: cycleContext.catsPath,
        session_id: cycleContext.sessionId
      });

      // Set up approval handlers
      const handleApproval = () => {
        EventBus.off('user:approve:context', handleApproval);
        EventBus.off('user:reject:context', handleRejection);
        EventBus.off('user:revise:context', handleRevision);
        transitionTo('PLANNING_WITH_CONTEXT');
        executeState();
      };

      const handleRejection = () => {
        EventBus.off('user:approve:context', handleApproval);
        EventBus.off('user:reject:context', handleRejection);
        EventBus.off('user:revise:context', handleRevision);
        transitionTo('IDLE');
        executeState();
      };

      const handleRevision = (data) => {
        EventBus.off('user:approve:context', handleApproval);
        EventBus.off('user:reject:context', handleRejection);
        EventBus.off('user:revise:context', handleRevision);
        cycleContext.revisionRequest = data.feedback;
        transitionTo('CURATING_CONTEXT');
        executeState();
      };

      EventBus.on('user:approve:context', handleApproval);
      EventBus.on('user:reject:context', handleRejection);
      EventBus.on('user:revise:context', handleRevision);

      // Timeout after 5 minutes
      setTimeout(() => {
        if (currentState === 'AWAITING_CONTEXT_APPROVAL') {
          logger.warn('[SentinelFSM] Context approval timeout');
          transitionTo('IDLE');
          executeState();
        }
      }, 300000);
    };

    // State: PLANNING_WITH_CONTEXT
    const executePlanningWithContext = async () => {
      EventBus.emit('agent:planning');

      // Load approved context
      const catsContent = await StateManager.getArtifactContent(cycleContext.catsPath);

      // Add reflection insights to prompt if available
      let reflectionContext = '';
      if (reflectionInsights.length > 0) {
        reflectionContext = '\n\nPrevious insights from reflection:\n' +
          reflectionInsights.slice(-3).map(i => `- ${i}`).join('\n');
      }

      // Generate prompt with context
      const prompt = `Based on the following context, your goal is: ${cycleContext.goal}

Context:
${catsContent}
${reflectionContext}

Analyze the context carefully and plan your approach. When ready, use the create_dogs_bundle tool to propose specific changes.`;

      cycleContext.planPrompt = prompt;
      transitionTo('GENERATING_PROPOSAL');
      await executeState();
    };

    // State: GENERATING_PROPOSAL
    const executeGeneratingProposal = async () => {
      EventBus.emit('agent:generating');

      // Send prompt to LLM
      const response = await ApiClient.sendMessage([{
        role: 'system',
        content: 'You are a Guardian Agent. Generate structured change proposals using the create_dogs_bundle tool.'
      }, {
        role: 'user',
        content: cycleContext.planPrompt
      }]);

      // Parse response for proposed changes
      const changes = parseProposedChanges(response.content);

      // Create dogs bundle
      const result = await SentinelTools.createDogsBundle({
        changes,
        turn_path: cycleContext.turn.dogs_path,
        summary: `Proposal for: ${cycleContext.goal}`
      });

      if (result.success) {
        cycleContext.dogsPath = result.path;
        cycleContext.proposedChanges = changes;
        transitionTo('AWAITING_PROPOSAL_APPROVAL');
        await executeState();
      } else {
        throw new Error('Failed to create proposal bundle');
      }
    };

    // State: AWAITING_PROPOSAL_APPROVAL
    const executeAwaitingProposalApproval = async () => {
      // Show diff viewer
      EventBus.emit('diff:show', {
        dogs_path: cycleContext.dogsPath,
        session_id: cycleContext.sessionId,
        turn: cycleContext.turn
      });

      // Set up approval handlers
      const handleApproval = (data) => {
        EventBus.off('proposal:approved', handleApproval);
        EventBus.off('proposal:cancelled', handleCancellation);
        EventBus.off('proposal:edit', handleEdit);

        cycleContext.approvedChanges = data.approved_changes;
        cycleContext.filteredDogsPath = data.filtered_dogs_path;
        transitionTo('APPLYING_CHANGESET');
        executeState();
      };

      const handleCancellation = () => {
        EventBus.off('proposal:approved', handleApproval);
        EventBus.off('proposal:cancelled', handleCancellation);
        EventBus.off('proposal:edit', handleEdit);
        transitionTo('IDLE');
        executeState();
      };

      const handleEdit = (data) => {
        EventBus.off('proposal:approved', handleApproval);
        EventBus.off('proposal:cancelled', handleCancellation);
        EventBus.off('proposal:edit', handleEdit);

        cycleContext.editRequest = data;
        transitionTo('PLANNING_WITH_CONTEXT');
        executeState();
      };

      EventBus.on('proposal:approved', handleApproval);
      EventBus.on('proposal:cancelled', handleCancellation);
      EventBus.on('proposal:edit', handleEdit);

      // Timeout after 10 minutes
      setTimeout(() => {
        if (currentState === 'AWAITING_PROPOSAL_APPROVAL') {
          logger.warn('[SentinelFSM] Proposal approval timeout');
          transitionTo('IDLE');
          executeState();
        }
      }, 600000);
    };

    // State: APPLYING_CHANGESET
    const executeApplyingChangeset = async () => {
      EventBus.emit('agent:applying');

      const dogsPath = cycleContext.filteredDogsPath || cycleContext.dogsPath;

      // Apply the approved changes
      const result = await SentinelTools.applyDogsBundle({
        dogs_path: dogsPath,
        session_id: cycleContext.sessionId,
        verify_command: cycleContext.verifyCommand
      });

      cycleContext.applyResult = result;

      if (result.success) {
        // Commit to Git VFS
        if (GitVFS.isInitialized()) {
          await GitVFS.commitChanges(
            `Applied ${result.changes_applied.length} changes for: ${cycleContext.goal}`,
            {
              session: cycleContext.sessionId,
              turn: cycleContext.turn.turn,
              checkpoint: result.checkpoint
            }
          );
        }

        transitionTo('REFLECTING');
      } else {
        logger.error('[SentinelFSM] Failed to apply changes:', result.message);
        transitionTo('ERROR');
      }

      await executeState();
    };

    // State: REFLECTING
    const executeReflecting = async () => {
      EventBus.emit('agent:reflecting');

      // Analyze the outcome of this cycle
      const reflection = await performReflection();

      // Store insights for future cycles
      reflectionInsights.push(reflection.insight);

      // Log reflection
      logger.info(`[SentinelFSM] Reflection: ${reflection.insight}`);

      // Save reflection to session
      const reflectionPath = `/sessions/${cycleContext.sessionId}/reflection-${cycleContext.turn.turn}.md`;
      await StateManager.createArtifact(reflectionPath, 'markdown',
        `# Reflection for Turn ${cycleContext.turn.turn}\n\n` +
        `**Goal:** ${cycleContext.goal}\n\n` +
        `**Outcome:** ${reflection.outcome}\n\n` +
        `**Insight:** ${reflection.insight}\n\n` +
        `**Recommendations:**\n${reflection.recommendations.map(r => `- ${r}`).join('\n')}\n\n` +
        `**Metrics:**\n` +
        `- Duration: ${reflection.metrics.duration}ms\n` +
        `- Changes Applied: ${reflection.metrics.changesApplied}\n` +
        `- Success Rate: ${reflection.metrics.successRate}%\n`,
        'Cycle reflection'
      );

      // Determine next action based on reflection
      if (reflection.shouldContinue && cycleContext.iterations < cycleContext.maxIterations) {
        // Continue with refined goal
        cycleContext.goal = reflection.refinedGoal || cycleContext.goal;
        cycleContext.iterations++;

        // Create new turn
        cycleContext.turn = await StateManager.sessionManager.createTurn(cycleContext.sessionId);

        transitionTo('CURATING_CONTEXT');
        await executeState();
      } else {
        // Cycle complete
        EventBus.emit('cycle:complete', {
          session_id: cycleContext.sessionId,
          iterations: cycleContext.iterations,
          reflection
        });

        transitionTo('IDLE');
        await executeState();
      }
    };

    // State: ERROR
    const executeError = async () => {
      EventBus.emit('agent:error', {
        state: stateHistory[stateHistory.length - 1],
        context: cycleContext
      });

      // Log error details
      logger.error('[SentinelFSM] Error state reached', {
        previous_state: stateHistory[stateHistory.length - 2],
        context: cycleContext
      });

      // Clean up and return to IDLE
      cycleContext = null;
      transitionTo('IDLE');
    };

    // Perform reflection analysis
    const performReflection = async () => {
      const duration = Date.now() - cycleContext.startTime;
      const applyResult = cycleContext.applyResult || {};

      // Analyze the results
      const changesApplied = applyResult.changes_applied?.length || 0;
      const totalProposed = cycleContext.proposedChanges?.length || 0;
      const successRate = totalProposed > 0 ? (changesApplied / totalProposed * 100) : 0;

      // Generate insight using patterns from history
      const patterns = analyzePatterns();

      // Determine if we should continue
      const shouldContinue = successRate > 50 && cycleContext.iterations < 3;

      // Generate recommendations
      const recommendations = generateRecommendations(patterns, successRate);

      // Build reflection object
      const reflection = {
        outcome: applyResult.success ? 'successful' : 'failed',
        insight: generateInsight(patterns, successRate),
        recommendations,
        shouldContinue,
        refinedGoal: shouldContinue ? refineGoal(cycleContext.goal, patterns) : null,
        metrics: {
          duration,
          changesApplied,
          totalProposed,
          successRate
        }
      };

      // Learn from this experience
      await updateLearningModel(reflection);

      return reflection;
    };

    // Analyze patterns from state history
    const analyzePatterns = () => {
      const patterns = {
        averageContextSize: 0,
        commonFailurePoints: [],
        successfulStrategies: [],
        timeSpentInStates: {}
      };

      // Analyze state durations
      for (let i = 1; i < stateHistory.length; i++) {
        const duration = stateHistory[i].timestamp - stateHistory[i - 1].timestamp;
        const state = stateHistory[i - 1].to;
        patterns.timeSpentInStates[state] = (patterns.timeSpentInStates[state] || 0) + duration;
      }

      // Identify bottlenecks
      const totalTime = Date.now() - cycleContext.startTime;
      for (const [state, time] of Object.entries(patterns.timeSpentInStates)) {
        if (time / totalTime > 0.3) {
          patterns.commonFailurePoints.push(`Bottleneck in ${state}`);
        }
      }

      return patterns;
    };

    // Generate insight from patterns
    const generateInsight = (patterns, successRate) => {
      if (successRate === 100) {
        return 'All proposed changes were successfully applied. The context curation was highly effective.';
      } else if (successRate > 75) {
        return 'Most changes were applied successfully. Minor adjustments to the proposal process could improve results.';
      } else if (successRate > 50) {
        return 'Moderate success rate. Consider refining the context selection or breaking down complex changes.';
      } else if (successRate > 0) {
        return 'Low success rate indicates misalignment between goal and approach. Significant strategy revision needed.';
      } else {
        return 'No changes were applied. The approach needs fundamental reconsideration.';
      }
    };

    // Generate recommendations based on patterns
    const generateRecommendations = (patterns, successRate) => {
      const recommendations = [];

      if (patterns.commonFailurePoints.length > 0) {
        recommendations.push(`Address identified bottlenecks: ${patterns.commonFailurePoints.join(', ')}`);
      }

      if (successRate < 50) {
        recommendations.push('Break down complex changes into smaller, atomic operations');
        recommendations.push('Improve context curation to include more relevant files');
      }

      if (patterns.timeSpentInStates['AWAITING_CONTEXT_APPROVAL'] > 60000) {
        recommendations.push('Optimize context bundle size for faster review');
      }

      if (patterns.timeSpentInStates['AWAITING_PROPOSAL_APPROVAL'] > 120000) {
        recommendations.push('Generate more concise, focused proposals');
      }

      return recommendations;
    };

    // Refine goal based on learnings
    const refineGoal = (originalGoal, patterns) => {
      // This would use more sophisticated NLP in production
      if (patterns.commonFailurePoints.length > 0) {
        return `${originalGoal} (focusing on addressing ${patterns.commonFailurePoints[0]})`;
      }
      return originalGoal;
    };

    // Update learning model (placeholder for ML integration)
    const updateLearningModel = async (reflection) => {
      // Store learning data for future analysis
      const learningPath = `/sessions/${cycleContext.sessionId}/learning.json`;
      const existingData = await StateManager.getArtifactContent(learningPath);
      const learningData = existingData ? JSON.parse(existingData) : { episodes: [] };

      learningData.episodes.push({
        timestamp: Date.now(),
        goal: cycleContext.goal,
        outcome: reflection.outcome,
        metrics: reflection.metrics,
        insight: reflection.insight
      });

      await StateManager.updateArtifact(learningPath, JSON.stringify(learningData, null, 2));
    };

    // Parse proposed changes from LLM response
    const parseProposedChanges = (content) => {
      // This would parse the actual LLM response
      // For now, return a placeholder
      return [{
        operation: 'MODIFY',
        file_path: '/example.js',
        new_content: '// Modified content'
      }];
    };

    // Get current FSM status
    const getStatus = () => {
      return {
        currentState,
        cycleContext,
        stateHistory: stateHistory.slice(-10),
        reflectionInsights: reflectionInsights.slice(-5)
      };
    };

    // Pause the current cycle
    const pauseCycle = () => {
      if (currentState !== 'IDLE' && currentState !== 'ERROR') {
        logger.info('[SentinelFSM] Cycle paused');
        EventBus.emit('cycle:paused', { state: currentState, context: cycleContext });
        return true;
      }
      return false;
    };

    // Resume a paused cycle
    const resumeCycle = async () => {
      if (currentState !== 'IDLE' && cycleContext) {
        logger.info('[SentinelFSM] Resuming cycle');
        EventBus.emit('cycle:resumed', { state: currentState, context: cycleContext });
        await executeState();
        return true;
      }
      return false;
    };

    // Export public API
    return {
      api: {
        startCycle,
        getStatus,
        pauseCycle,
        resumeCycle,
        getCurrentState: () => currentState,
        getStateHistory: () => stateHistory,
        getReflectionInsights: () => reflectionInsights
      }
    };
  }
};

// Register module if running in REPLOID environment
if (typeof window !== 'undefined' && window.ModuleRegistry) {
  window.ModuleRegistry.register(SentinelFSM);
}

export default SentinelFSM;