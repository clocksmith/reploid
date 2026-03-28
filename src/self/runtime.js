/**
 * @fileoverview Dedicated Reploid self runtime.
 */

import Utils from '../core/utils.js';
import ResponseParser from '../core/response-parser.js';
import { createSelfBridge } from './bridge.js';

const MAX_CYCLES = 2048;
const MAX_BATCH_TOOLS = 5;
const SINGLE_TOOL_NUDGE_THRESHOLD = 3;
const MILESTONE_AUTOPARK_THRESHOLD = 3;

const estimateTokens = (text) => {
  const value = String(text || '');
  return Math.max(0, Math.ceil(value.length / 4));
};

const formatToolResult = (name, result, kind = 'RESULT') => {
  const payload = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  return `[TOOL ${name} ${kind}]\n${payload}`.trim();
};

const extractPrefixedLine = (text, prefixes) => {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    for (const prefix of prefixes) {
      const marker = `${prefix.toUpperCase()}:`;
      if (line.toUpperCase().startsWith(marker)) {
        return line.slice(marker.length).trim();
      }
    }
  }

  return null;
};

const getMessageLabel = (message = {}) => {
  const origin = String(message.origin || '').toLowerCase();
  if (origin === 'bootstrap') return 'BOOT';
  if (origin === 'model') return 'MODEL';
  if (origin === 'tool') return 'TOOL';
  if (origin === 'system') return 'SYSTEM';
  return String(message.role || 'unknown').toUpperCase();
};

const formatContextMessage = (message = {}) => {
  const content = String(message.content || '').trim();
  const label = getMessageLabel(message);
  if (!content) {
    return `[${label}]`;
  }

  // Tool and system observations already carry a structured prefix that is useful
  // both to the model and to the human transcript.
  if (content.startsWith('[TOOL ') || content.startsWith('[SYSTEM')) {
    return content;
  }

  return `[${label}]\n${content}`.trim();
};

const parseSelfDirective = (responseParser, text) => {
  const cleaned = String(text || '').trim();
  if (!cleaned) return null;

  const calls = responseParser.parseToolCalls(cleaned).map((call) => ({
    name: String(call?.name || '').trim(),
    args: call?.args && typeof call.args === 'object' ? call.args : {},
    error: call?.error || null
  })).filter((call) => call.name);

  const milestoneReason = extractPrefixedLine(cleaned, ['MILESTONE', 'DONE']);
  const idleReason = extractPrefixedLine(cleaned, ['IDLE', 'PARK']);

  if (calls.length > 0) {
    return {
      type: 'tools',
      calls,
      milestoneReason,
      idleReason
    };
  }

  if (idleReason !== null) {
    return {
      type: 'idle',
      reason: idleReason,
      wakeOn: 'manual'
    };
  }

  if (milestoneReason !== null) {
    return {
      type: 'done',
      reason: milestoneReason
    };
  }

  return null;
};

const buildSystemNotice = (message) => `[SYSTEM]\n${String(message || '').trim()}`.trim();
const withTerminalPunctuation = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
};
const buildMilestoneNotice = (reason) => buildSystemNotice(
  reason
    ? `Milestone recorded: ${withTerminalPunctuation(reason)} Execution continues until you stop it or the cycle limit is reached.`
    : 'Milestone recorded. Execution continues until you stop it or the cycle limit is reached.'
);
const buildSelfImprovementNotice = (reason) => buildSystemNotice(
  reason
    ? `Foreground milestone reached: ${withTerminalPunctuation(reason)} Continue with safe self-improvement work. Prioritize reversible improvements to tools, runtime, memory, observability, evaluation, or the current artifact quality.`
    : 'Foreground milestone reached. Continue with safe self-improvement work. Prioritize reversible improvements to tools, runtime, memory, observability, evaluation, or the current artifact quality.'
);
const buildParkNotice = (reason, wakeOn = 'manual') => buildSystemNotice(
  reason
    ? `Parked: ${withTerminalPunctuation(reason)} Resume when new work is available. Wake condition: ${wakeOn}.`
    : `Parked. Resume when new work is available. Wake condition: ${wakeOn}.`
);

export function createSelfRuntime(options = {}) {
  const goal = String(options.goal || '').trim();
  const environment = String(options.environment || '').trim();
  const includeBootstrapperWithinSelf = !!options.includeBootstrapperWithinSelf;
  const swarmEnabled = !!options.swarmEnabled;
  const bridge = createSelfBridge({
    modelConfig: options.modelConfig || null,
    includeBootstrapperWithinSelf,
    swarmEnabled
  });
  const runtimeUtils = Utils.factory();
  const responseParser = ResponseParser.factory({ Utils: runtimeUtils });
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

  if (typeof bridge.on === 'function') {
    bridge.on('provider-ready', () => {
      if (!(parked && wakeOn === 'provider-ready' && !running && !stopped)) {
        return;
      }

      const notice = buildSystemNotice('Swarm provider discovered. Resuming remote generation.');
      appendMessage('user', notice, 'system');
      tokenUsage += estimateTokens(notice);
      parked = false;
      wakeOn = 'manual';
      status = 'IDLE';
      activity = 'Provider discovered';
      notify();
      start().catch(() => {});
    });

    bridge.on('swarm-state', () => {
      notify();
    });
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

  const seedContext = async () => {
    const files = await bridge.seedSystemFiles({
      goal,
      environment,
      includeBootstrapperWithinSelf,
      swarmEnabled
    });
    messages = [
      { role: 'user', origin: 'bootstrap', content: `Self:\n${files['/.system/self.json']}` }
    ];
  };

  const getRenderedBlocks = () => {
    const blocks = [...messages].reverse().map(formatContextMessage);
    if (draft.trim()) {
      blocks.unshift(`[MODEL]\n${draft}`.trim());
    }
    return blocks;
  };

  const getSnapshot = () => ({
    running,
    stopped,
    status,
    activity,
    parked,
    wakeOn,
    cycle,
    goal,
    model: bridge.getModelLabel(),
    tokens: {
      used: tokenUsage,
      limit: 0
    },
    context: [...messages],
    draft,
    swarm: typeof bridge.getSwarmSnapshot === 'function' ? bridge.getSwarmSnapshot() : null,
    renderedBlocks: getRenderedBlocks(),
    renderedText: getRenderedBlocks().join('\n\n').trim()
  });

  const subscribe = (listener) => {
    listeners.add(listener);
    listener(getSnapshot());
    return () => listeners.delete(listener);
  };

  const stop = () => {
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

  const start = async () => {
    if (running) return;
    if (!goal) {
      activity = 'Missing goal';
      notify();
      return;
    }

    if (messages.length === 0) {
      if (typeof bridge.initialize === 'function') {
        await bridge.initialize();
      }
      await seedContext();
      cycle = 0;
      tokenUsage = messages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
    }

    if (!bridge.getModelConfig() && swarmEnabled && !bridge.hasAvailableProvider?.()) {
      const notice = buildSystemNotice(
        'No local inference is configured. Swarm consumer mode is active, so the runtime is parking until provider-side inference is available.'
      );
      appendMessage('user', notice, 'system');
      tokenUsage += estimateTokens(notice);
      parkRuntime('Waiting for swarm provider', 'provider-ready');
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

    while (!stopped && cycle < MAX_CYCLES) {
      cycle += 1;
      activity = `Generating cycle ${cycle}`;
      draft = '';
      notify();

      let response;
      try {
        response = await bridge.generate(messages, (chunk) => {
          draft += chunk;
          notify();
        });
      } catch (error) {
        appendMessage('user', `[SYSTEM ERROR]\n${error.message || error}`, 'system');
        tokenUsage += estimateTokens(error.message || String(error));
        running = false;
        status = 'ERROR';
        activity = 'Generation failed';
        draft = '';
        notify();
        return;
      }

      const assistantText = String(response?.raw || response?.content || '').trim();
      draft = '';
      if (assistantText) {
        appendMessage('assistant', assistantText, 'model');
        tokenUsage += estimateTokens(assistantText);
      }

      const directive = parseSelfDirective(responseParser, assistantText);
      if (!directive) {
        const systemNotice = buildSystemNotice(
          'Ignored non-directive model response. Use TOOL_CALL / ARGS blocks, MILESTONE:, or IDLE:. Do not use markdown fences.'
        );
        appendMessage('user', systemNotice, 'system');
        tokenUsage += estimateTokens(systemNotice);
        activity = 'Ignored non-directive response';
        consecutiveMilestoneOnlyCycles = 0;
        repeatedMilestoneCount = 0;
        lastMilestoneReason = '';
        notify();
        continue;
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
          const redirectNotice = buildSelfImprovementNotice(
            'Repeated milestone-only cycles detected with no new tool work'
          );
          appendMessage('user', redirectNotice, 'system');
          tokenUsage += estimateTokens(redirectNotice);
          activity = 'Redirected to self-improvement';
          consecutiveMilestoneOnlyCycles = 0;
          repeatedMilestoneCount = 0;
          lastMilestoneReason = '';
          notify();
          continue;
        }
        notify();
        continue;
      }

      if (directive.type === 'idle') {
        const redirectNotice = buildSelfImprovementNotice(directive.reason);
        appendMessage('user', redirectNotice, 'system');
        tokenUsage += estimateTokens(redirectNotice);
        activity = 'Redirected to self-improvement';
        consecutiveMilestoneOnlyCycles = 0;
        repeatedMilestoneCount = 0;
        lastMilestoneReason = '';
        notify();
        continue;
      }

      const requestedCalls = Array.isArray(directive.calls) ? directive.calls : [];
      const callsToExecute = requestedCalls.slice(0, MAX_BATCH_TOOLS);
      consecutiveMilestoneOnlyCycles = 0;
      repeatedMilestoneCount = 0;
      lastMilestoneReason = '';

      if (requestedCalls.length > MAX_BATCH_TOOLS) {
        const systemNotice = buildSystemNotice(
          `Tool call limit (${MAX_BATCH_TOOLS}) reached. Executing the first ${MAX_BATCH_TOOLS} tool calls in order.`
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

      for (const [index, call] of callsToExecute.entries()) {
        if (stopped) break;

        activity = callsToExecute.length === 1
          ? `Running ${call.name}`
          : `Running ${call.name} (${index + 1}/${callsToExecute.length})`;
        notify();

        if (call.error) {
          const toolError = formatToolResult(call.name, call.error, 'ERROR');
          appendMessage('user', toolError, 'tool');
          tokenUsage += estimateTokens(toolError);
          activity = `${call.name} failed`;
          continue;
        }

        try {
          const result = await bridge.executeTool(call.name, call.args);
          const toolMessage = formatToolResult(call.name, result, 'RESULT');
          appendMessage('user', toolMessage, 'tool');
          tokenUsage += estimateTokens(toolMessage);
          activity = `${call.name} complete`;
        } catch (error) {
          const toolError = formatToolResult(call.name, error?.message || String(error), 'ERROR');
          appendMessage('user', toolError, 'tool');
          tokenUsage += estimateTokens(toolError);
          activity = `${call.name} failed`;
        }
      }

      if (!stopped && directive.milestoneReason !== undefined && directive.milestoneReason !== null) {
        const systemNotice = buildMilestoneNotice(directive.milestoneReason);
        appendMessage('user', systemNotice, 'system');
        tokenUsage += estimateTokens(systemNotice);
        activity = 'Milestone recorded';
      }

      if (!stopped && directive.idleReason !== undefined && directive.idleReason !== null && directive.idleReason !== '') {
        const redirectNotice = buildSelfImprovementNotice(directive.idleReason);
        appendMessage('user', redirectNotice, 'system');
        tokenUsage += estimateTokens(redirectNotice);
        activity = 'Redirected to self-improvement';
      }

      notify();
    }

    running = false;
    status = stopped ? 'IDLE' : 'LIMIT';
    activity = stopped ? 'Stopped by user' : `Stopped at ${MAX_CYCLES} cycles`;
    draft = '';
    notify();
  };

  return {
    subscribe,
    start,
    stop,
    isRunning: () => running,
    getSnapshot
  };
}
