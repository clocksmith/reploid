import { createTaskToolPolicy } from './task-tools.js';
import { createTaskArchivePolicy } from './task-archive.js';
import { createTaskProtocol } from './task-protocol.js';
import { isTransientProviderFailure, providerRetryDelay } from './provider-recovery.js';
import { createExecutionEngine } from './engine.js';
import { TURN_NEXT, TURN_RETURN } from './engine.js';
import { requireResolvedConfig, snapshotJson } from '../config/index.js';

export function createTaskStrategy(options) {
  const policy = requireResolvedConfig(options.config);
  const taskTools = createTaskToolPolicy(policy);
  const { formatToolResult, formatToolCallParseError, normalizeToolName, buildToolExecutionGroups, formatToolBatchResult } = taskTools;
  const { MAX_BATCH_TOOLS, REQUIRED_ANCHOR_OBSERVATIONS, RGR_SCORE_KEYS, clamp01, summarizeToolEntries, normalizeAnchorObservations, buildRgrCandidateIdentity, isDominatedBy, evaluatePromotionGate, buildRgrArchiveEntry } = createTaskArchivePolicy(policy, taskTools);
  const { formatContextMessage, parseSelfDirective, buildSystemNotice, buildMilestoneNotice, buildParkNotice } = createTaskProtocol(taskTools);
  const MAX_CYCLES = policy.agent.maxCycles;

  const SINGLE_TOOL_NUDGE_THRESHOLD = policy.agent.singleToolNudgeThreshold;
  const MILESTONE_AUTOPARK_THRESHOLD = policy.agent.milestoneAutoparkThreshold;
  const RGR_ARCHIVE_LIMIT = policy.agent.rgrArchiveLimit;

  const RGR_SLOT_ROLES = Object.freeze([
    'elite',
    'performance',
    'robustness',
    'repair',
    'low-cost',
    'safety',
    'fallback'
  ]);

  const DEFAULT_GENERATION_RETRY_DELAY_MS = policy.agent.retryDelayMs;
  const MAX_GENERATION_RETRY_DELAY_MS = policy.agent.maxRetryDelayMs;

  const estimateTokens = (text) => {
    const value = String(text || '');
    return Math.max(0, Math.ceil(value.length / 4));
  };

  const getErrorMessage = (error) => String(error?.message || error || '').trim();

  const getRetryableGenerationError = error => isTransientProviderFailure(error) ? {
    message: getErrorMessage(error),
    retryDelayMs: providerRetryDelay(error, { baseMs: DEFAULT_GENERATION_RETRY_DELAY_MS,
      maxMs: MAX_GENERATION_RETRY_DELAY_MS })
  } : null;

  const goal = String(options.goal || '').trim();
  const environment = String(options.environment || '').trim();
  const swarmEnabled = policy.mesh.enabled;
  const instanceId = options.instanceId;
  const bridge = options.ports;
  const responseParser = options.responseParser;
  if (!instanceId || !bridge || !responseParser) throw new TypeError('Agent requires instanceId, ports and responseParser');
  for (const name of ['initialContext', 'generate', 'executeTool', 'getModelLabel', 'getModelConfig']) {
    if (typeof bridge[name] !== 'function') throw new TypeError(`Agent port ${name} is required`);
  }
  const subscriptions = [];
  let closed = false;
  let activeRun = null;
  let controller = null;
  const engine = createExecutionEngine({ onEvent: options.onExecutionEvent });
  const wait = operation => engine.invoke(operation);
  const listeners = new Set();

  let running = false;
  let stopped = false;
  let cycle = 0;
  let activity = 'Awaiting goal';
  let status = 'IDLE';
  let tokenUsage = 0;
  let draft = '';
  let messages = [];
  let parked = false;
  let wakeOn = 'manual';
  let consecutiveSingleToolCycles = 0;
  let consecutiveMilestoneOnlyCycles = 0;
  let lastMilestoneReason = '';
  let repeatedMilestoneCount = 0;
  let candidateCount = 0;
  let toolCallCount = 0;
  let errorCount = 0;
  let rgrArchive = [];
  let latestRgrReceiptPath = '';

  const clearGenerationRetryTimer = () => engine.cancelRetry();

  const scheduleGenerationRetry = (delayMs) => {
    clearGenerationRetryTimer();
    engine.scheduleRetry(delayMs, () => {
      if (!(parked && wakeOn === 'generation-retry' && !running && !stopped)) {
        return;
      }

      const notice = buildSystemNotice('Provider retry window opened. Resuming generation.');
      appendMessage('user', notice, 'system');
      tokenUsage += estimateTokens(notice);
      parked = false;
      wakeOn = 'manual';
      status = 'IDLE';
      activity = 'Provider retry';
      notify();
      start().catch(() => {});
    });
  };

  if (typeof bridge.on === 'function') {
    subscriptions.push(bridge.on('provider-ready', () => {
      if (!(parked && wakeOn === 'provider-ready' && !running && !stopped)) {
        return;
      }

      const notice = buildSystemNotice('Remote host slot discovered. Resuming generation.');
      appendMessage('user', notice, 'system');
      tokenUsage += estimateTokens(notice);
      parked = false;
      wakeOn = 'manual';
      status = 'IDLE';
      activity = 'Provider discovered';
      notify();
      start().catch(() => {});
    }));

    subscriptions.push(bridge.on('swarm-state', () => {
      notify();
    }));
  }

  const notify = () => {
    const snapshot = getSnapshot();
    listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch {
        // Ignore listener errors
      }
    });
  };

  const appendMessage = (role, content, origin = null) => {
    messages.push({
      role,
      content: String(content || ''),
      origin: origin || (role === 'assistant' ? 'model' : 'observation')
    });
  };

  const persistRgrArchiveEntry = async (entry) => {
    const receiptPath = `/artifacts/rgr/${entry.id}.json`;
    const nextEntry = {
      ...entry,
      receiptPath,
      persisted: false
    };

    if (typeof bridge.writeRuntimeArtifact !== 'function') {
      return nextEntry;
    }

    try {
      const persistedEntry = {
        ...nextEntry,
        persisted: true
      };
      await wait(() => bridge.writeRuntimeArtifact(receiptPath, JSON.stringify(persistedEntry, null, 2)));
      return persistedEntry;
    } catch (error) {
      return {
        ...nextEntry,
        persistenceError: error?.message || String(error)
      };
    }
  };

  const recordRgrArchiveEntry = async ({ candidateText, entries, groups }) => {
    if (!entries.length) return null;
    const summary = summarizeToolEntries(entries);
    const parentId = rgrArchive[0]?.id || 'seed';
    const identity = buildRgrCandidateIdentity({
      cycle,
      instanceId,
      candidateText,
      summary,
      parentId
    });
    const anchorObservations = typeof bridge.getAnchorObservations === 'function'
      ? await wait(() => bridge.getAnchorObservations({
          candidateId: identity.id,
          digest: identity.digest,
          parentId,
          cycle,
          instanceId,
          summary
        }))
      : [];
    let entry = buildRgrArchiveEntry({
      cycle,
      instanceId,
      candidateText,
      entries,
      groups,
      parentId,
      archive: rgrArchive,
      anchorObservations
    });
    entry = await persistRgrArchiveEntry(entry);
    latestRgrReceiptPath = entry.receiptPath || latestRgrReceiptPath;
    rgrArchive = [entry, ...rgrArchive].slice(0, RGR_ARCHIVE_LIMIT);
    return entry;
  };

  const refreshRgrArchiveAnchors = async () => {
    if (!rgrArchive.length || typeof bridge.getAnchorObservations !== 'function') {
      return false;
    }

    const rescored = [];
    let changed = false;
    for (const entry of rgrArchive) {
      const anchorObservations = normalizeAnchorObservations(
        await wait(() => bridge.getAnchorObservations({
          candidateId: entry.id,
          digest: entry.digest,
          parentId: entry.parentId,
          cycle: entry.cycle,
          instanceId: entry.instanceId,
          summary: entry.summary,
          lineage: [entry.id, entry.parentId].filter(Boolean)
        }))
      );
      const qAnchor = Number(clamp01(anchorObservations.length / REQUIRED_ANCHOR_OBSERVATIONS).toFixed(3));
      const priorAnchors = entry.anchor?.observations || [];
      if (
        qAnchor !== Number(entry.score?.qAnchor || 0) ||
        anchorObservations.length !== priorAnchors.length
      ) {
        changed = true;
      }
      rescored.push({
        ...entry,
        score: {
          ...(entry.score || {}),
          qAnchor
        },
        anchor: {
          ...(entry.anchor || {}),
          required: REQUIRED_ANCHOR_OBSERVATIONS,
          observations: anchorObservations,
          qAnchor
        }
      });
    }

    const replayed = rescored.map((entry) => {
      const pareto = {
        survives: !rescored.some((other) => other !== entry && isDominatedBy(entry.score, other)),
        comparedAgainst: Math.max(0, rescored.length - 1),
        keys: [...RGR_SCORE_KEYS]
      };
      const gate = evaluatePromotionGate({
        score: entry.score,
        summary: entry.summary,
        pareto
      });
      return {
        ...entry,
        pareto,
        gate,
        promotion: {
          ...(entry.promotion || {}),
          allowed: gate.state === 'passed'
        }
      };
    });

    rgrArchive = replayed;
    return changed;
  };

  const seedContext = async () => {
    const context = await wait(() => bridge.initialContext({ goal, environment, swarmEnabled, signal: controller.signal }));
    if (!Array.isArray(context)) throw new TypeError('initialContext must return messages');
    messages = snapshotJson(context);
  };

  const getRenderedBlocks = () => {
    const blocks = [...messages].reverse().map(formatContextMessage);
    if (draft.trim()) {
      blocks.unshift(`[MODEL]\n${draft}`.trim());
    }
    return blocks;
  };

  // Keep the runtime state machine unchanged, but expose clearer UI semantics.
  const getDisplayRunState = () => {
    if (running) return 'RUNNING';
    if (status === 'ERROR') return 'FAILED';
    if (status === 'LIMIT') return 'HALTED_AT_CYCLE_LIMIT';
    if (parked) {
      return wakeOn === 'provider-ready' ? 'WAITING_ON_PROVIDER' : 'WAITING';
    }
    if (stopped) return 'PAUSED_BY_USER';
    if (cycle > 0 && status === 'IDLE') return 'READY_TO_CONTINUE';
    return 'READY';
  };

  const getDisplayPolicy = () => {
    if (parked && wakeOn === 'provider-ready') return 'auto-resume on provider-ready';
    if (parked && wakeOn === 'generation-retry') return 'auto-resume after provider retry';
    if (parked) return 'manual resume required';
    if (status === 'ERROR') return 'manual restart required';
    if (status === 'LIMIT') return 'cycle limit reached';
    if (stopped) return 'manual resume required';
    if (running || (cycle > 0 && status === 'IDLE')) return 'auto-continue enabled';
    return 'manual start required';
  };

  const getRgrMode = () => {
    if (cycle <= 0 && messages.length <= 1 && !running && !parked) return 'seed';
    return 'shadow';
  };

  const getSlotState = ({ mode, slot, placement, gateState }) => {
    if (placement === 'empty') return 'empty';
    if (gateState === 'blocked') return 'blocked';
    if (placement === 'remote' && slot.waitingForHost) return 'pending host';
    if (mode === 'seed') return placement === 'local' ? 'ready' : 'pending';
    if (slot.id === 'elite') return running ? 'running' : 'archived';
    if (slot.id === 'performance') return running ? 'scoring' : 'idle';
    if (slot.id === 'robustness') return running ? 'replay' : 'idle';
    if (slot.id === 'repair') return parked || status === 'ERROR' ? 'repairing' : 'archived';
    if (slot.id === 'safety') return running ? 'validating' : 'idle';
    if (slot.id === 'fallback') return 'archived';
    return 'idle';
  };

  const buildRgrSlots = ({ hasLocalHost, effectiveSwarmEnabled, swarm, mode, gateState }) => {
    const peerCount = Math.max(0, Number(swarm?.peerCount || 0));
    const providerCount = Math.max(0, Number(swarm?.providerCount || 0));
    const remoteAvailable = effectiveSwarmEnabled && peerCount > 0;
    const waitingForHost = effectiveSwarmEnabled && !hasLocalHost && providerCount === 0;
    const remotePreferred = new Set(['performance', 'robustness', 'safety']);

    return RGR_SLOT_ROLES.map((id) => {
      let placement = 'empty';
      if (hasLocalHost) {
        placement = remoteAvailable && remotePreferred.has(id) ? 'remote' : 'local';
      } else if (effectiveSwarmEnabled) {
        placement = 'remote';
      }

      const slot = { id, waitingForHost };
      return {
        id,
        placement,
        state: getSlotState({ mode, slot, placement, gateState })
      };
    });
  };

  const getRgrSnapshot = (swarm) => {
    const hasLocalHost = !!bridge.getModelConfig();
    const effectiveSwarmEnabled = !!(swarm?.enabled || swarmEnabled);
    const mode = getRgrMode();
    const latestArchive = rgrArchive[0] || null;
    const anchorObservations = latestArchive?.anchor?.observations?.length || 0;
    let gateState = latestArchive?.gate?.state
      || (anchorObservations >= REQUIRED_ANCHOR_OBSERVATIONS ? 'passed' : 'pending-anchors');
    if (status === 'ERROR') gateState = 'rejected';
    if (parked && wakeOn === 'provider-ready') gateState = 'blocked';
    const gateReasons = parked && wakeOn === 'provider-ready'
      ? ['waiting for remote host slot']
      : latestArchive?.gate?.reasons || [];
    let role = 'dead', slotMode = 'empty', hostStatus = 'none';
    if (hasLocalHost) {
      role = 'solo'; slotMode = 'local'; hostStatus = 'local only';
      if (effectiveSwarmEnabled) {
        role = 'provider'; slotMode = 'local/remote'; hostStatus = 'hosting local slots';
      }
    } else if (effectiveSwarmEnabled) {
      role = 'consumer'; slotMode = 'remote'; hostStatus = 'waiting for host';
    }

    return {
      name: 'Recursive GEPA Ring',
      mode,
      stage: getDisplayRunState(),
      topology: effectiveSwarmEnabled ? 'peer-assisted' : 'local',
      role,
      slotMode,
      slots: buildRgrSlots({
        hasLocalHost,
        effectiveSwarmEnabled,
        swarm,
        mode,
        gateState
      }),
      gate: {
        state: gateState,
        anchors: anchorObservations,
        required: REQUIRED_ANCHOR_OBSERVATIONS,
        reasons: gateReasons
      },
      counters: {
        candidates: candidateCount,
        toolCalls: toolCallCount,
        errors: errorCount,
        tokens: tokenUsage,
        archive: rgrArchive.length,
        replay: rgrArchive.length,
        receipts: rgrArchive.length
      },
      archive: {
        count: rgrArchive.length,
        limit: RGR_ARCHIVE_LIMIT,
        latest: latestArchive,
        frontier: rgrArchive
          .filter((entry) => entry.pareto?.survives)
          .slice(0, 5)
          .map((entry) => ({
            id: entry.id,
            kind: entry.kind,
            score: entry.score,
            gate: entry.gate,
            receiptPath: entry.receiptPath
          }))
      },
      receipts: {
        count: rgrArchive.length,
        latestPath: latestRgrReceiptPath || null
      },
      hostStatus,
      promotionGate: 'anchor',
      validator: 'quarantined',
      anchor: 'version-frozen',
      instances: [],
      peerCount: swarm?.peerCount || 0,
      providerCount: swarm?.providerCount || 0,
      consumerCount: swarm?.consumerCount || 0,
      transport: swarm?.transport || null,
      connectionState: swarm?.connectionState || 'disconnected'
    };
  };

  const getSnapshot = () => {
    const swarm = typeof bridge.getSwarmSnapshot === 'function' ? bridge.getSwarmSnapshot() : null;
    return {
      running,
      stopped,
      status,
      activity,
      parked,
      wakeOn,
      cycle,
      instanceId,
      goal,
      model: bridge.getModelLabel(),
      tokens: {
        used: tokenUsage,
        limit: 0
      },
      context: structuredClone(messages),
      draft,
      swarm,
      rgr: getRgrSnapshot(swarm),
      ecosystem: {
        instances: []
      },
      display: {
        runState: getDisplayRunState(),
        policy: getDisplayPolicy()
      },
      renderedBlocks: getRenderedBlocks(),
      renderedText: getRenderedBlocks().join('\n\n').trim()
    };
  };

  const subscribe = (listener) => {
    if (closed) throw new Error('Agent is closed');
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    listeners.add(listener);
    listener(getSnapshot());
    return () => listeners.delete(listener);
  };

  const stop = () => {
    clearGenerationRetryTimer();
    engine.cancel(new Error('Agent cancelled'));
    stopped = true;
    running = false;
    parked = false;
    wakeOn = 'manual';
    status = 'IDLE';
    activity = 'Stopped by user';
    draft = '';
    notify();
  };

  const parkRuntime = (reason = '', nextWakeOn = 'manual') => {
    parked = true;
    wakeOn = nextWakeOn || 'manual';
    running = false;
    stopped = false;
    status = 'PARKED';
    activity = reason ? `Parked: ${reason}` : 'Parked';
    draft = '';
    notify();
  };

  const run = async () => {
    if (running) return;
    clearGenerationRetryTimer();
    if (!goal) {
      activity = 'Missing goal';
      notify();
      return;
    }

    if (messages.length === 0) {
      if (typeof bridge.initialize === 'function') {
        await wait(() => bridge.initialize({ signal: controller.signal }));
      }
      await seedContext();
      cycle = 0;
      tokenUsage = messages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
    }

    if (!bridge.getModelConfig() && swarmEnabled && !bridge.hasAvailableProvider?.()) {
      const notice = buildSystemNotice(
        'No local host is configured. Remote slot topology is active, so the runtime is parking until a peer host is available.'
      );
      appendMessage('user', notice, 'system');
      tokenUsage += estimateTokens(notice);
      parkRuntime('Waiting for remote host slot', 'provider-ready');
      return;
    }

    running = true;
    stopped = false;
    parked = false;
    wakeOn = 'manual';
    consecutiveSingleToolCycles = 0;
    consecutiveMilestoneOnlyCycles = 0;
    repeatedMilestoneCount = 0;
    lastMilestoneReason = '';
    status = 'RUNNING';
    activity = 'Generating';
    draft = '';
    notify();

    if (await engine.turns({ canContinue: () => !stopped && cycle < MAX_CYCLES, turn: async () => {
      if (messages.reduce((size, message) => size + String(message.content).length, 0) > policy.agent.maxContextChars) {
        status = 'LIMIT';
        activity = 'Context budget exceeded';
        running = false;
        notify();
        return TURN_RETURN;
      }
      cycle += 1;
      if (await refreshRgrArchiveAnchors()) {
        latestRgrReceiptPath = rgrArchive[0]?.receiptPath || latestRgrReceiptPath;
        notify();
      }
      activity = `Generating cycle ${cycle}`;
      draft = '';
      notify();

      let response;
      try {
        response = await engine.provider(() => bridge.generate(snapshotJson(messages), (chunk) => {
          if (controller.signal.aborted || closed) return;
          draft += chunk;
          notify();
        }, { signal: controller.signal }));
      } catch (error) {
        if (stopped || closed || controller.signal.aborted) return TURN_RETURN;
        const retryableGenerationError = getRetryableGenerationError(error);
        if (retryableGenerationError) {
          errorCount += 1;
          const systemNotice = buildSystemNotice([
            'Generation paused by provider quota or rate limit.',
            retryableGenerationError.message,
            'The runtime will resume when the provider retry window opens.'
          ].join('\n'));
          appendMessage('user', systemNotice, 'system');
          tokenUsage += estimateTokens(systemNotice);
          running = false;
          scheduleGenerationRetry(retryableGenerationError.retryDelayMs);
          parkRuntime('Provider quota or rate limit', 'generation-retry');
          return TURN_RETURN;
        }

        errorCount += 1;
        const errorMessage = getErrorMessage(error);
        appendMessage('user', `[SYSTEM ERROR]\n${errorMessage}`, 'system');
        tokenUsage += estimateTokens(errorMessage);
        running = false;
        status = 'ERROR';
        activity = 'Generation failed';
        draft = '';
        notify();
        return TURN_RETURN;
      }

      const interpreted = engine.interpret(response, text => responseParser.parseToolCalls(text));
      const assistantText = interpreted.content;
      draft = '';
      if (assistantText) {
        candidateCount += 1;
        appendMessage('assistant', assistantText, 'model');
        tokenUsage += estimateTokens(assistantText);
      }

      const directive = parseSelfDirective(interpreted.calls, assistantText);
      if (!directive) {
        errorCount += 1;
        const systemNotice = buildSystemNotice(
          'Ignored non-directive model response. Use REPLOID/0 with TOOL: blocks, PLAN:, MILESTONE:, or IDLE:. Do not use markdown fences.'
        );
        appendMessage('user', systemNotice, 'system');
        tokenUsage += estimateTokens(systemNotice);
        activity = 'Ignored non-directive response';
        consecutiveMilestoneOnlyCycles = 0;
        repeatedMilestoneCount = 0;
        lastMilestoneReason = '';
        notify();
        return TURN_NEXT;
      }

      if (directive.type === 'done') {
        const systemNotice = buildMilestoneNotice(directive.reason);
        appendMessage('user', systemNotice, 'system');
        tokenUsage += estimateTokens(systemNotice);
        activity = 'Milestone recorded';
        consecutiveMilestoneOnlyCycles += 1;
        if (directive.reason && directive.reason === lastMilestoneReason) {
          repeatedMilestoneCount += 1;
        } else {
          lastMilestoneReason = directive.reason || '';
          repeatedMilestoneCount = 1;
        }
        if (
          consecutiveMilestoneOnlyCycles >= MILESTONE_AUTOPARK_THRESHOLD ||
          repeatedMilestoneCount >= MILESTONE_AUTOPARK_THRESHOLD
        ) {
          const parkNotice = buildParkNotice(
            'Repeated milestone-only cycles detected with no new tool work'
          );
          appendMessage('user', parkNotice, 'system');
          tokenUsage += estimateTokens(parkNotice);
          parkRuntime('Repeated milestone-only cycles detected with no new tool work');
          consecutiveMilestoneOnlyCycles = 0;
          repeatedMilestoneCount = 0;
          lastMilestoneReason = '';
          notify();
          return TURN_RETURN;
        }
        notify();
        return TURN_NEXT;
      }

      if (directive.type === 'idle') {
        const parkNotice = buildParkNotice(directive.reason);
        appendMessage('user', parkNotice, 'system');
        tokenUsage += estimateTokens(parkNotice);
        parkRuntime(directive.reason);
        consecutiveMilestoneOnlyCycles = 0;
        repeatedMilestoneCount = 0;
        lastMilestoneReason = '';
        notify();
        return TURN_RETURN;
      }

      const requestedCalls = Array.isArray(directive.calls) ? directive.calls : [];
      const callsToExecute = requestedCalls.slice(0, MAX_BATCH_TOOLS);
      toolCallCount += callsToExecute.length;
      consecutiveMilestoneOnlyCycles = 0;
      repeatedMilestoneCount = 0;
      lastMilestoneReason = '';

      if (requestedCalls.length > MAX_BATCH_TOOLS) {
        const systemNotice = buildSystemNotice(
          `Tool call limit (${MAX_BATCH_TOOLS}) reached. Executing the first ${MAX_BATCH_TOOLS} tool calls with safe read-only groups batched.`
        );
        appendMessage('user', systemNotice, 'system');
        tokenUsage += estimateTokens(systemNotice);
      }

      if (callsToExecute.length === 1) {
        consecutiveSingleToolCycles += 1;
        if (consecutiveSingleToolCycles >= SINGLE_TOOL_NUDGE_THRESHOLD) {
          const systemNotice = buildSystemNotice(
            `Tip: you can batch up to ${MAX_BATCH_TOOLS} tool calls by emitting multiple TOOL_CALL / ARGS blocks in one response.`
          );
          appendMessage('user', systemNotice, 'system');
          tokenUsage += estimateTokens(systemNotice);
          consecutiveSingleToolCycles = 0;
        }
      } else {
        consecutiveSingleToolCycles = 0;
      }

      const executeToolCall = async (call) => {
        if (call.error) {
          return {
            call,
            kind: 'ERROR',
            message: formatToolCallParseError(call)
          };
        }

        try {
          const outcome = await engine.tool({ call, policy, instanceId,
            listToolNames: () => bridge.listToolNames?.() || [], authorize: request => bridge.authorize?.(request),
            execute: (name, args, control) => bridge.executeTool(name, args, control) });
          if (outcome.status !== 'completed') throw outcome.error;
          const result = outcome.value;
          return {
            call,
            kind: 'RESULT',
            message: formatToolResult(call.name, result, 'RESULT')
          };
        } catch (error) {
          if (controller.signal.aborted) throw error;
          return {
            call,
            kind: 'ERROR',
            message: formatToolResult(call.name, error?.message || String(error), 'ERROR')
          };
        }
      };

      const executionGroups = buildToolExecutionGroups(callsToExecute);
      const groupLabel = group => group.mode === 'parallel' && group.calls.length > 1
        ? `${group.calls.length} read-only tools`
        : normalizeToolName(group.calls[0]?.name) || 'tool';
      const batchEntries = await engine.batch({ groups: executionGroups, execute: executeToolCall,
        before: (group, index) => {
          activity = executionGroups.length === 1 ? `Running ${groupLabel(group)}`
            : `Running ${groupLabel(group)} (${index + 1}/${executionGroups.length})`;
          notify();
        },
        after: (entries, group) => {
          const groupErrorCount = entries.filter(entry => entry.kind === 'ERROR').length;
          errorCount += groupErrorCount;
          activity = `${groupLabel(group)} ${groupErrorCount > 0 ? 'failed' : 'complete'}`;
        }
      });

      if (batchEntries.length > 0) {
        await recordRgrArchiveEntry({
          candidateText: assistantText,
          entries: batchEntries,
          groups: executionGroups
        });
        const toolMessage = batchEntries.length === 1
          ? batchEntries[0].message
          : formatToolBatchResult(batchEntries, executionGroups);
        appendMessage('user', toolMessage, 'tool');
        tokenUsage += estimateTokens(toolMessage);
      }

      if (!stopped && directive.milestoneReason !== undefined && directive.milestoneReason !== null) {
        const systemNotice = buildMilestoneNotice(directive.milestoneReason);
        appendMessage('user', systemNotice, 'system');
        tokenUsage += estimateTokens(systemNotice);
        activity = 'Milestone recorded';
      }

      if (!stopped && directive.idleReason !== undefined && directive.idleReason !== null && directive.idleReason !== '') {
        const parkNotice = buildParkNotice(directive.idleReason);
        appendMessage('user', parkNotice, 'system');
        tokenUsage += estimateTokens(parkNotice);
        parkRuntime(directive.idleReason);
        notify();
        return TURN_RETURN;
      }

      notify();

    } }) === TURN_RETURN) return;

    running = false;
    status = stopped ? 'IDLE' : 'LIMIT';
    activity = stopped ? 'Stopped by user' : `Stopped at ${MAX_CYCLES} cycles`;
    draft = '';
    notify();
  };

  const start = () => {
    if (closed) return Promise.reject(new Error('Agent is closed'));
    if (activeRun) return activeRun;
    stopped = false;
    activeRun = engine.start(async signal => {
      controller = { signal };
      return run();
    }, { timeoutMs: policy.agent.timeoutMs, onTimeout: () => {
      stop();
      status = 'LIMIT';
      activity = 'Execution deadline reached';
      notify();
    } }).finally(() => { activeRun = null; });
    return activeRun;
  };

  const close = async () => {
    if (closed) return;
    closed = true;
    stop();
    for (const unsubscribe of subscriptions.splice(0)) unsubscribe?.();
    listeners.clear();
    await engine.close();
  };

  const checkpoint = () => {
    if (activeRun || engine.retryPending) throw new Error('Pause execution before checkpointing');
    return engine.checkpoint({ schema: 'reploid.agent-checkpoint/v1', instanceId, goal, environment,
      cycle, messages, tokenUsage, rgrArchive, latestRgrReceiptPath, candidateCount, toolCallCount, errorCount });
  };
  const restore = (input) => {
    if (closed || activeRun || messages.length) throw new Error('Restore requires an unused, stopped agent');
    const state = snapshotJson(input);
    if (state.schema !== 'reploid.agent-checkpoint/v1' || state.instanceId !== instanceId || state.goal !== goal
      || !Array.isArray(state.messages) || !Array.isArray(state.rgrArchive)) throw new Error('Checkpoint identity or shape mismatch');
    for (const field of ['cycle', 'tokenUsage', 'candidateCount', 'toolCallCount', 'errorCount']) {
      if (!Number.isSafeInteger(state[field]) || state[field] < 0) throw new Error(`Invalid checkpoint ${field}`);
    }
    if (state.cycle > MAX_CYCLES) throw new Error('Checkpoint exceeds cycle budget');
    ({ cycle, messages, tokenUsage, rgrArchive, latestRgrReceiptPath, candidateCount, toolCallCount, errorCount } = state);
    activity = 'Restored; explicit execution required';
    notify();
  };

  return {
    subscribe,
    close,
    settle: engine.settle,
    checkpoint,
    getExecutionEvents: engine.getEvents,
    restore,
    on: bridge.on,
    start,
    stop,
    rotateIdentity: bridge.rotateIdentity,
    isRunning: () => running,
    getSnapshot
  };
}
