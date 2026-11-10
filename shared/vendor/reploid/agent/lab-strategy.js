import { createExecutionEngine } from './engine.js';
import { TURN_STOP, TURN_RETURN } from './engine.js';
/**
 * @fileoverview Agent Loop
 * The main cognitive cycle: Think -> Act -> Observe.
 * This entry owns the loop state, the attempt lifecycle and the public AgentLoop.
 * Cycle preparation, model generation, FunctionGemma routing, tool execution and
 * provider parking live in the lab-strategy-*.js modules it composes.
 */

import { createCycleArtifactWriter } from './cycle-artifacts.js';
import { requireResolvedConfig, freezeJson } from '../config/index.js';
import { createLabCycle } from './lab-strategy-cycle.js';
import { createLabFunctionGemma } from './lab-strategy-function-gemma.js';
import { createLabGeneration } from './lab-strategy-generation.js';
import { createLabProviderRecovery } from './lab-strategy-provider-recovery.js';
import { createLabTools } from './lab-strategy-tools.js';

const AgentLoop = {
  metadata: {
    id: 'AgentLoop',
    version: '1.2.0', // MemoryManager integration
    genesis: { introduced: 'capsule' },
    dependencies: [
      'Utils', 'EventBus', 'VFS?', 'LLMClient', 'ToolRunner', 'ContextManager',
      'ResponseParser', 'StateManager', 'PersonaManager', 'CircuitBreaker', 'SchemaRegistry',
      'ToolExecutor',
      'ReflectionStore?', 'ReflectionAnalyzer?', 'CognitionAPI?', 'MultiModelCoordinator?', 'FunctionGemmaOrchestrator?', 'TraceStore?',
      'MemoryManager?'
    ],
    type: 'core'
  },

  factory: (deps) => {
    // Loop state shared with the cycle, generation, tool and provider modules.
    const loop = {
      policy: requireResolvedConfig(deps.config),
      closed: false,
      isRunning: false,
      abortController: null,
      modelConfig: null,
      modelConfigs: [], // Array of models for multi-model mode
      consensusStrategy: 'arena', // arena, peer-review, swarm
      traceSessionId: null,
      // Debug visibility - track current context and system prompt
      currentContext: [],
      currentSystemPrompt: '',
      providerResumeState: null,
      providerResumePromise: null
    };
    const engine = createExecutionEngine({ onEvent: deps.onExecutionEvent });
    let activeAttempt = null, runtimeMode = null;
    if (!deps.Storage || typeof deps.getRuntimeMode !== 'function' || typeof deps.buildInitialContext !== 'function' || !deps.Policies) {
      throw new TypeError('Legacy agent requires explicit storage, mode, prompt and policy ports');
    }
    const { getModelIterationLimit, parseWaitDirective } = deps.Policies;
    const subscriptions = [];
    const borrowedEvents = deps.EventBus;
    deps = { ...deps, EventBus: { ...borrowedEvents, on(...args) {
      const unsubscribe = borrowedEvents.on(...args);
      subscriptions.push(unsubscribe);
      return unsubscribe;
    } } };
    const {
      Utils, EventBus, VFS, ResponseParser, StateManager, PersonaManager, SchemaRegistry, TraceStore, MemoryManager
    } = deps;

    const { logger, Errors } = Utils;
    const BUILD_READ_ONLY_DISCOVERY_LIMIT = loop.policy.legacyAgent.discoveryLimit;

    const getMaxToolCalls = () => loop.policy.legacyAgent.maxToolCalls;

    const sleepWithAbort = delayMs => engine.delay(Math.max(0, Math.floor(Number(delayMs) || 0)));

    const getConfiguredMaxIterations = () =>
      getModelIterationLimit(loop.modelConfig || loop.modelConfigs[0]);

    const isBuildGoal = (goalText = '') => /\b(build|create|make|implement|write|edit|modify|update|fix|patch|add|inject|stage|load|promote)\b/i
      .test(String(goalText || ''));

    // Use SchemaRegistry for read-only tool detection (no longer hardcoded)
    const isReadOnlyTool = (name) => {
      if (SchemaRegistry?.isToolReadOnly) {
        return SchemaRegistry.isToolReadOnly(name);
      }
      // Fallback if SchemaRegistry not available
      const FALLBACK_READ_ONLY = ['ReadFile', 'ListFiles', 'Grep', 'Find', 'Head', 'Tail', 'FileOutline', 'ListTools'];
      return FALLBACK_READ_ONLY.includes(name);
    };

    const MAX_ACTIVITY_LOG = 200;
    const _activityLog = [];

    // Human-in-the-loop message queue
    const _humanMessageQueue = [];

    // Helper to update tracked context whenever it changes
    const _syncContext = (context) => {
      loop.currentContext = [...context];
    };

    // Inject a human message into the agent's context
    const injectHumanMessage = (content, type = 'context') => {
      _humanMessageQueue.push({ content, type, timestamp: Date.now() });
      EventBus.emit('human:message-queued', { content, type });
      logger.info(`[Agent] Human message queued (${type}): ${content.substring(0, 50)}...`);
    };

    // Listen for human messages from UI
    EventBus.on('human:message', ({ content, type }) => {
      injectHumanMessage(content, type);
    }, 'AgentLoop');

    const _pushActivity = (entry) => {
      _activityLog.push({ ts: Date.now(), ...entry });
      if (_activityLog.length > MAX_ACTIVITY_LOG) {
        _activityLog.shift();
      }
    };

    const getRuntimeMode = () => runtimeMode ?? deps.getRuntimeMode();

    const getMutationProgressToolList = () => (
      ['zero', 'x'].includes(getRuntimeMode())
        ? 'CreateTool or a created mutation tool'
        : 'WriteFile, CreateTool, EditFile, Promote, or LoadModule'
    );

    const cycleArtifacts = createCycleArtifactWriter({ VFS, EventBus, logger });
    const _writeCycleArtifact = (iteration, name, payload = {}) => (
      cycleArtifacts.writeCycleArtifact(iteration, name, payload)
    );
    const _writeCycleOutcomeArtifacts = (payload) => (
      cycleArtifacts.writeCycleOutcomeArtifacts(payload)
    );

    const ctx = {
      deps, engine, loop, BUILD_READ_ONLY_DISCOVERY_LIMIT, getMaxToolCalls, sleepWithAbort, isReadOnlyTool,
      getMutationProgressToolList, humanMessageQueue: _humanMessageQueue, pushActivity: _pushActivity,
      syncContext: _syncContext, writeCycleArtifact: _writeCycleArtifact,
      writeCycleOutcomeArtifacts: _writeCycleOutcomeArtifacts,
      startRun: (goal, resumeState) => startRun(goal, resumeState)
    };
    const functionGemma = createLabFunctionGemma(ctx);
    const providerRecovery = createLabProviderRecovery(ctx);
    const generation = createLabGeneration(ctx, { functionGemma, providerRecovery });
    const cycle = createLabCycle(ctx, { generation });
    const tools = createLabTools(ctx, { providerRecovery });
    const { resolveFunctionGemmaConfig, ensureFunctionGemmaReady, resetFunctionGemmaState } = functionGemma;
    const {
      isTransientProviderError, isManagedProviderRequestError, clearProviderResumeTimer, scheduleProviderResume,
      parkTransientProviderFailure, parkRejectedProviderRequest
    } = providerRecovery;
    const { generate, recordResponse } = generation;
    const {
      resetModelRequestSnapshot, waitForCycleInterval, resetLoopHealth, checkLoopHealth, handleStuckLoop,
      prepareCycleContext, announceModelRequest
    } = cycle;
    const { resetToolCircuitBreaker, executeToolBatch } = tools;

    const runAttempt = async (goal, resumeState, signal) => {
      if (loop.isRunning) throw new Errors.StateError('Agent already running');
      if (!loop.modelConfig) throw new Errors.ConfigError('No model configured');

      const isResume = !!resumeState;
      if (!isResume) {
        clearProviderResumeTimer();
      }

      loop.isRunning = true;
      loop.abortController = { signal, abort: reason => engine.cancel(reason) };
      if (!isResume) {
        resetLoopHealth();
        resetToolCircuitBreaker();
        resetModelRequestSnapshot();
      }

      logger.info(`[Agent] ${isResume ? 'Resuming' : 'Starting'} cycle. Goal: "${goal}"`);
      EventBus.emit('agent:status', {
        state: isResume ? 'RESUMING' : 'STARTING',
        activity: isResume ? 'Resuming after provider backoff' : 'Initializing...',
        cycle: resumeState?.iteration ?? 0
      });

      if (!isResume) {
        await StateManager.setGoal(goal);
      }
      if (TraceStore) {
        loop.traceSessionId = await TraceStore.startSession({
          source: 'agent',
          goal,
          modelId: loop.modelConfig?.id || null,
          resumedFromProviderBackoff: isResume,
          resumeAttempt: resumeState?.providerRetryAttempt ?? 0
        });
      }

      // Initialize MemoryManager for this session
      if (MemoryManager && !isResume) {
        try {
          await MemoryManager.init();
          await MemoryManager.newSession();
          // Store the initial goal
          await MemoryManager.add({ role: 'user', content: goal, metadata: { type: 'goal' } });
          logger.debug('[Agent] MemoryManager initialized for session');
        } catch (e) {
          logger.warn('[Agent] MemoryManager initialization failed:', e.message);
        }
      }

      // Per-attempt state the cycle, generation, tool and provider phases read and update.
      const attempt = {
        goal,
        context: isResume && Array.isArray(resumeState.context)
          ? resumeState.context.map((entry) => ({ ...entry }))
          : await _buildInitialContext(goal),
        iteration: Number.isFinite(Number(resumeState?.iteration))
          ? Math.max(0, Math.floor(Number(resumeState.iteration)))
          : 0,
        providerParked: false,
        providerParkReason: null,
        scheduledProviderResume: false,
        providerRetryAttempt: Math.max(0, Math.floor(Number(resumeState?.providerRetryAttempt) || 0)),
        consecutiveReadOnlyBuildBatches: Math.max(0, Math.floor(Number(resumeState?.consecutiveReadOnlyBuildBatches) || 0)),
        mutationGateAnnounced: false,
        buildGoal: isBuildGoal(goal)
      };
      attempt.mutationGateAnnounced = attempt.consecutiveReadOnlyBuildBatches >= BUILD_READ_ONLY_DISCOVERY_LIMIT;
      if (!isResume) {
        EventBus.emit('agent:history', {
          type: 'system_prompt',
          cycle: 0,
          content: loop.currentSystemPrompt
        });
        _pushActivity({ kind: 'system_prompt', cycle: 0, content: loop.currentSystemPrompt });
      }
      const maxIterations = getConfiguredMaxIterations();
      const functionGemmaConfig = resolveFunctionGemmaConfig();
      let functionGemmaEnabled = !!functionGemmaConfig;
      if (functionGemmaEnabled) {
        functionGemmaEnabled = await ensureFunctionGemmaReady(attempt.context, functionGemmaConfig);
      }

      // Update tracked context after initialization
      loop.currentContext = [...attempt.context];

      try {
        if (await engine.turns({ canContinue: () => loop.isRunning && attempt.iteration < maxIterations, turn: async () => {
          if (loop.abortController.signal.aborted) return TURN_STOP;

          await waitForCycleInterval(attempt.iteration + 1);
          if (loop.abortController.signal.aborted) return TURN_STOP;

          attempt.iteration++;
          const { iteration } = attempt;
          await StateManager.incrementCycle();
          logger.info(`[Agent] Iteration ${iteration}`);
          const stateBefore = iteration === 1 ? 'Seed' : 'Shadow';
          await _writeCycleArtifact(iteration, 'input.json', {
            stateBefore,
            event: 'cycle:start',
            goal,
            model: loop.modelConfig?.id || null,
            provider: loop.modelConfig?.provider || null,
            contextLength: attempt.context.length,
            contextPreview: attempt.context.slice(-5)
          });

          await prepareCycleContext(attempt);
          const activeToolSchemas = announceModelRequest(attempt);
          const generated = await generate(attempt, { activeToolSchemas, functionGemmaConfig, functionGemmaEnabled });
          const { response } = generated;
          const { responseContent, toolCalls, modelUsed } = await recordResponse(attempt, { ...generated, stateBefore });

          // Check for stuck loop
          const executableToolCallCount = toolCalls.filter((call) => !call.error).length;
          const healthCheck = checkLoopHealth(iteration, executableToolCallCount, responseContent.length);
          if (healthCheck.stuck) {
            const shouldBreak = await handleStuckLoop(healthCheck, attempt.context, iteration);
            if (shouldBreak) return TURN_STOP;
          }

          if (toolCalls.length > 0) {
            if (await executeToolBatch(attempt, { toolCalls, modelUsed, stateBefore, responseContent }) === TURN_STOP) {
              return TURN_STOP;
            }
          } else {
            const { context, providerRetryAttempt, consecutiveReadOnlyBuildBatches } = attempt;
            const waitDirective = parseWaitDirective(response.content);
            if (waitDirective?.delayMs > 0) {
              await _writeCycleOutcomeArtifacts({
                iteration,
                stateBefore,
                modelUsed,
                responseContent,
                toolCalls,
                callsToExecute: [],
                allResults: [],
                reason: 'wait directive',
                done: false
              });
              attempt.providerParked = true;
              attempt.scheduledProviderResume = true;
              attempt.providerParkReason = `${waitDirective.directive}: ${waitDirective.reason}`;
              scheduleProviderResume({
                goal,
                context,
                iteration,
                providerRetryAttempt,
                consecutiveReadOnlyBuildBatches,
                resumeKind: 'tool_cooldown',
                resumeContent: `Resuming after ${waitDirective.directive.toLowerCase()} wait`,
                resumeActivity: 'Retrying after wait directive'
              }, waitDirective.delayMs);
              return TURN_STOP;
            }
            if (ResponseParser.isDone(response.content)) {
              await _writeCycleOutcomeArtifacts({
                iteration,
                stateBefore,
                modelUsed,
                responseContent,
                toolCalls,
                callsToExecute: [],
                allResults: [],
                reason: 'done',
                done: true
              });
              logger.info('[Agent] Goal achieved.');
              return TURN_STOP;
            }
            await _writeCycleOutcomeArtifacts({
              iteration,
              stateBefore,
              modelUsed,
              responseContent,
              toolCalls,
              callsToExecute: [],
              allResults: [],
              reason: 'no executable tool call',
              done: false
            });
            // WebLLM requires last message to be user/tool - add continuation prompt
            let continuationMsg = 'No executable tool call detected. Use REPLOID/0 format with only key: value argument lines after TOOL:\n\nREPLOID/0\n\nTOOL: ToolName\nkey: value';
            if (iteration > 3) {
              continuationMsg = 'You must use a valid tool block or say DONE. Do not put commentary inside argument lines.';
            }
            context.push({ role: 'user', content: continuationMsg });
          }

    } }) === TURN_RETURN) return;
      } catch (err) {
        if (err instanceof Errors.AbortError || loop.abortController?.signal.aborted) {
          logger.info('[Agent] Cycle aborted.');
        } else if (isTransientProviderError(err)) {
          await parkTransientProviderFailure(attempt, err);
        } else if (isManagedProviderRequestError(err)) {
          await parkRejectedProviderRequest(attempt, err);
        } else {
          logger.error('[Agent] Critical Error', err);
          throw err;
        }
      } finally {
        loop.isRunning = false;
        loop.abortController = null;
        if (TraceStore && loop.traceSessionId) {
          await TraceStore.endSession(loop.traceSessionId, {
            goal,
            status: attempt.providerParked ? 'parked' : 'completed',
            iterations: attempt.iteration
          });
          loop.traceSessionId = null;
        }
        EventBus.emit('agent:status', attempt.providerParked
          ? {
              state: 'PARKED',
              activity: attempt.providerParkReason || 'Provider unavailable',
              cycle: attempt.iteration,
              retryAttempt: loop.providerResumeState?.providerRetryAttempt ?? attempt.providerRetryAttempt,
              retryDelayMs: loop.providerResumeState?.delayMs ?? null,
              retryAt: loop.providerResumeState?.retryAt ?? null,
              autoResume: attempt.scheduledProviderResume
            }
          : { state: 'IDLE', activity: 'Stopped' });
      }
    };

    const _buildInitialContext = async (goal) => {
      const context = await deps.buildInitialContext({ goal,
        personaPrompt: await PersonaManager.getSystemPrompt(), runtimeMode: getRuntimeMode(),
        maxToolCalls: getMaxToolCalls(), discoveryLimit: BUILD_READ_ONLY_DISCOVERY_LIMIT });
      if (!Array.isArray(context)) throw new TypeError('Initial context port must return messages');
      loop.currentSystemPrompt = String(context.find(message => message.role === 'system')?.content || '');
      loop.currentContext = [...context];
      return context;
    };

    const getRecentActivities = () => [..._activityLog];
    const normalizeGoalInput = (goal) => {
      if (goal && typeof goal === 'object' && !Array.isArray(goal)) {
        return String(goal.goal ?? goal.text ?? goal.objective ?? '').trim();
      }
      return String(goal ?? '').trim();
    };
    const startRun = (goal, resumeState = null) => {
      if (loop.closed) return Promise.reject(new Errors.StateError('Agent is closed'));
      if (activeAttempt) return Promise.reject(new Errors.StateError('Agent already running'));
      if (!resumeState) {
        loop.policy = requireResolvedConfig(deps.resolveAttemptConfig?.(loop.modelConfig) || deps.config);
        runtimeMode = deps.getRuntimeMode();
      }
      activeAttempt = engine.start(signal => runAttempt(goal, resumeState, signal), { timeoutMs: loop.policy.agent.timeoutMs })
        .finally(() => { activeAttempt = null; loop.isRunning = false; });
      return activeAttempt;
    };
    const run = goal => startRun(normalizeGoalInput(goal), null);
    const setModel = c => {
      if (activeAttempt || loop.providerResumeState) throw new Errors.StateError('Pause before changing the model');
      loop.modelConfig = c ? freezeJson(structuredClone(c)) : null;
      resetFunctionGemmaState();
    };

    return {
      run,
      close: async () => {
        loop.closed = true;
        clearProviderResumeTimer();
        loop.abortController?.abort();
        loop.isRunning = false;
        for (const unsubscribe of subscriptions.splice(0)) unsubscribe?.();
        await engine.close();
      },
      stop: () => {
        clearProviderResumeTimer();
        if (loop.abortController) loop.abortController.abort();
        loop.isRunning = false;
      },
      setModel,
      setModels: (models) => {
        if (activeAttempt || loop.providerResumeState) throw new Errors.StateError('Pause before changing models');
        loop.modelConfigs = freezeJson(structuredClone(models || []));
        // Set primary model as first one for fallback
        if (models && models.length > 0) {
          loop.modelConfig = loop.modelConfigs[0];
        }
        resetFunctionGemmaState();
      },
      setConsensusStrategy: (strategy) => {
        if (activeAttempt || loop.providerResumeState) throw new Errors.StateError('Pause before changing strategy');
        loop.consensusStrategy = strategy || 'arena';
      },
      isRunning: () => loop.isRunning,
      hasPendingProviderResume: () => !!loop.providerResumeState,
      getRecentActivities,
      getExecutionEvents: engine.getEvents,
      checkpoint: () => engine.checkpoint({ schema: 'reploid.lab-checkpoint/v1',
        context: loop.currentContext, model: loop.modelConfig, activities: _activityLog }),
      getProviderRetryState: () => (loop.providerResumeState ? { ...loop.providerResumeState } : null),
      getProviderResumePromise: () => loop.providerResumePromise,
      // Debug visibility
      getSystemPrompt: () => loop.currentSystemPrompt,
      getContext: () => structuredClone(loop.currentContext),
      // Human-in-the-loop
      injectHumanMessage,
      getMessageQueue: () => [..._humanMessageQueue]
    };
  }
};

export default AgentLoop;
