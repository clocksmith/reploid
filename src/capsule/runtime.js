/**
 * @fileoverview Dedicated Absolute Zero capsule runtime.
 */

import Utils from '../core/utils.js';
import { createCapsuleHost } from './host.js';

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

const normalizeToolCall = (value) => {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.tool !== 'string' || !value.tool.trim()) return null;
  return {
    name: value.tool.trim(),
    args: value.args && typeof value.args === 'object' ? value.args : {}
  };
};

const normalizeMilestone = (value) => {
  if (!value || typeof value !== 'object') return null;

  if (value.done === true) {
    return {
      reason: typeof value.reason === 'string' ? value.reason : ''
    };
  }

  if (value.done && typeof value.done === 'object' && value.done.done === true) {
    return {
      reason: typeof value.done.reason === 'string' ? value.done.reason : ''
    };
  }

  if (value.milestone && typeof value.milestone === 'object') {
    return {
      reason: typeof value.milestone.reason === 'string' ? value.milestone.reason : ''
    };
  }

  return null;
};

const normalizeIdle = (value) => {
  if (!value || typeof value !== 'object') return null;

  if (value.idle === true) {
    return {
      reason: typeof value.reason === 'string' ? value.reason : '',
      wakeOn: typeof value.wakeOn === 'string' ? value.wakeOn : 'manual'
    };
  }

  if (value.idle && typeof value.idle === 'object') {
    return {
      reason: typeof value.idle.reason === 'string' ? value.idle.reason : '',
      wakeOn: typeof value.idle.wakeOn === 'string' ? value.idle.wakeOn : 'manual'
    };
  }

  return null;
};

const getMessageLabel = (message = {}) => {
  const origin = String(message.origin || '').toLowerCase();
  if (origin === 'bootstrap') return 'BOOT';
  if (origin === 'model') return 'MODEL';
  if (origin === 'tool') return 'TOOL';
  if (origin === 'host') return 'HOST';
  return String(message.role || 'unknown').toUpperCase();
};

const formatContextMessage = (message = {}) => {
  const content = String(message.content || '').trim();
  const label = getMessageLabel(message);
  if (!content) {
    return `[${label}]`;
  }

  // Tool and host observations already carry a structured prefix that is useful
  // both to the model and to the human transcript.
  if (content.startsWith('[TOOL ') || content.startsWith('[HOST')) {
    return content;
  }

  return `[${label}]\n${content}`.trim();
};

const parseCapsuleDirective = (utils, text) => {
  const cleaned = String(text || '').trim();
  if (!cleaned) return null;

  try {
    const { json } = utils.sanitizeLlmJsonRespPure(cleaned);
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object') {
      const milestone = normalizeMilestone(parsed);
      const idle = normalizeIdle(parsed);

      const batchedCalls = Array.isArray(parsed.tools)
        ? parsed.tools
        : Array.isArray(parsed.toolCalls)
          ? parsed.toolCalls
          : null;
      if (batchedCalls) {
        const calls = batchedCalls.map(normalizeToolCall).filter(Boolean);
        if (calls.length > 0) {
          return {
            type: 'tools',
            calls,
            milestoneReason: milestone ? (milestone.reason || '') : null,
            idleReason: idle ? (idle.reason || '') : null,
            wakeOn: idle?.wakeOn || 'manual'
          };
        }
      }

      const singleCall = normalizeToolCall(parsed);
      if (singleCall) {
        return {
          type: 'tools',
          calls: [singleCall],
          milestoneReason: milestone ? (milestone.reason || '') : null,
          idleReason: idle ? (idle.reason || '') : null,
          wakeOn: idle?.wakeOn || 'manual'
        };
      }

      if (idle) {
        return {
          type: 'idle',
          reason: idle.reason,
          wakeOn: idle.wakeOn
        };
      }

      if (milestone) {
        return {
          type: 'done',
          reason: milestone.reason
        };
      }
    }
  } catch {
    return null;
  }

  return null;
};

const buildHostNotice = (message) => `[HOST]\n${String(message || '').trim()}`.trim();
const withTerminalPunctuation = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
};
const buildMilestoneNotice = (reason) => buildHostNotice(
  reason
    ? `Milestone recorded: ${withTerminalPunctuation(reason)} Execution continues until you stop it or the cycle limit is reached.`
    : 'Milestone recorded. Execution continues until you stop it or the cycle limit is reached.'
);
const buildSelfImprovementNotice = (reason) => buildHostNotice(
  reason
    ? `Foreground milestone reached: ${withTerminalPunctuation(reason)} Continue with safe self-improvement work. Prioritize reversible improvements to tools, runtime, memory, observability, evaluation, or the current artifact quality.`
    : 'Foreground milestone reached. Continue with safe self-improvement work. Prioritize reversible improvements to tools, runtime, memory, observability, evaluation, or the current artifact quality.'
);
const buildParkNotice = (reason, wakeOn = 'manual') => buildHostNotice(
  reason
    ? `Parked: ${withTerminalPunctuation(reason)} Resume when new work is available. Wake condition: ${wakeOn}.`
    : `Parked. Resume when new work is available. Wake condition: ${wakeOn}.`
);

export function createCapsuleRuntime(options = {}) {
  const goal = String(options.goal || '').trim();
  const environment = String(options.environment || '').trim();
  const includeHostWithinSelf = !!options.includeHostWithinSelf;
  const host = createCapsuleHost({
    modelConfig: options.modelConfig || null,
    includeHostWithinSelf
  });
  const capsuleUtils = Utils.factory();
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
    const files = await host.seedSystemFiles({
      goal,
      environment,
      includeHostWithinSelf
    });
    messages = [
      { role: 'user', origin: 'bootstrap', content: `Goal:\n${files['/.system/goal.txt']}` },
      { role: 'user', origin: 'bootstrap', content: `Environment:\n${files['/.system/environment.txt']}` },
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
    model: host.getModelLabel(),
    tokens: {
      used: tokenUsage,
      limit: 0
    },
    context: [...messages],
    draft,
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
      await seedContext();
      cycle = 0;
      tokenUsage = messages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
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
        response = await host.generate(messages, (chunk) => {
          draft += chunk;
          notify();
        });
      } catch (error) {
        appendMessage('user', `[HOST ERROR]\n${error.message || error}`, 'host');
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

      const directive = parseCapsuleDirective(capsuleUtils, assistantText);
      if (!directive) {
        const hostNotice = buildHostNotice(
          'Ignored non-directive model response. Reply with exactly one JSON object to call tools, record a milestone, or park.'
        );
        appendMessage('user', hostNotice, 'host');
        tokenUsage += estimateTokens(hostNotice);
        activity = 'Ignored non-directive response';
        consecutiveMilestoneOnlyCycles = 0;
        repeatedMilestoneCount = 0;
        lastMilestoneReason = '';
        notify();
        continue;
      }

      if (directive.type === 'done') {
        const hostNotice = buildMilestoneNotice(directive.reason);
        appendMessage('user', hostNotice, 'host');
        tokenUsage += estimateTokens(hostNotice);
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
          appendMessage('user', redirectNotice, 'host');
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
        appendMessage('user', redirectNotice, 'host');
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
        const hostNotice = buildHostNotice(
          `Tool call limit (${MAX_BATCH_TOOLS}) reached. Executing the first ${MAX_BATCH_TOOLS} tool calls in order.`
        );
        appendMessage('user', hostNotice, 'host');
        tokenUsage += estimateTokens(hostNotice);
      }

      if (callsToExecute.length === 1) {
        consecutiveSingleToolCycles += 1;
        if (consecutiveSingleToolCycles >= SINGLE_TOOL_NUDGE_THRESHOLD) {
          const hostNotice = buildHostNotice(
            `Tip: you can batch up to ${MAX_BATCH_TOOLS} tool calls in one JSON object using {"tools":[{"tool":"ReadFile","args":{"path":"/.system/self.json"}},{"tool":"ReadFile","args":{"path":"/.system/goal.txt"}}]}.`
          );
          appendMessage('user', hostNotice, 'host');
          tokenUsage += estimateTokens(hostNotice);
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

        try {
          const result = await host.executeTool(call.name, call.args);
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
        const hostNotice = buildMilestoneNotice(directive.milestoneReason);
        appendMessage('user', hostNotice, 'host');
        tokenUsage += estimateTokens(hostNotice);
        activity = 'Milestone recorded';
      }

      if (!stopped && directive.idleReason !== undefined && directive.idleReason !== null && directive.idleReason !== '') {
        const redirectNotice = buildSelfImprovementNotice(directive.idleReason);
        appendMessage('user', redirectNotice, 'host');
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
