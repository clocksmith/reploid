/**
 * @fileoverview Pure limits, context-envelope, and retry policies for AgentLoop.
 */

export const MAX_AGENT_ITERATIONS = 256;
export const MANAGED_SERVER_PROXY_TYPE = 'firebase-function';
export const MANAGED_SERVER_PROXY_MAX_ITERATIONS = 99;
export const MANAGED_SERVER_PROXY_REJECT_STATUSES = new Set([400, 413]);
export const TRANSIENT_PROVIDER_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export const DEFAULT_PROVIDER_THROTTLE = Object.freeze({
  minProviderRequestIntervalMs: 0,
  providerBackoffBaseMs: 15000,
  providerBackoffMaxMs: 300000,
  providerBackoffJitterRatio: 0.20,
  providerAutoResume: true
});

export const DEFAULT_AGENT_CYCLE_THROTTLE = Object.freeze({
  cycleIntervalMs: 7700
});

const MANAGED_SERVER_CONTEXT_ENVELOPE = Object.freeze({
  maxMessages: 64,
  targetMessages: 56,
  maxInputChars: 120000,
  targetInputChars: 100000,
  keepRecentMessages: 32,
  maxMessageChars: 16000
});

export const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

export const finiteNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const clampNumber = (value, fallback, min, max) => (
  Math.min(max, Math.max(min, finiteNumber(value, fallback)))
);

export function resolveProviderThrottleConfig(sources = []) {
  const configuredSources = sources.filter((entry) => entry && typeof entry === 'object');
  const configuredValue = (keys, fallback) => {
    for (let index = configuredSources.length - 1; index >= 0; index--) {
      const value = firstDefined(...keys.map((key) => configuredSources[index][key]));
      if (value !== undefined) return value;
    }
    return fallback;
  };
  const maxBackoff = Math.floor(clampNumber(
    configuredValue(
      ['providerBackoffMaxMs', 'backoffMaxMs'],
      DEFAULT_PROVIDER_THROTTLE.providerBackoffMaxMs
    ),
    DEFAULT_PROVIDER_THROTTLE.providerBackoffMaxMs,
    0,
    3600000
  ));
  return {
    minProviderRequestIntervalMs: Math.floor(clampNumber(
      configuredValue([
        'minProviderRequestIntervalMs',
        'providerMinRequestIntervalMs',
        'minRequestIntervalMs',
        'requestIntervalMs'
      ], DEFAULT_PROVIDER_THROTTLE.minProviderRequestIntervalMs),
      DEFAULT_PROVIDER_THROTTLE.minProviderRequestIntervalMs,
      0,
      3600000
    )),
    providerBackoffBaseMs: Math.floor(clampNumber(
      configuredValue(
        ['providerBackoffBaseMs', 'backoffBaseMs'],
        DEFAULT_PROVIDER_THROTTLE.providerBackoffBaseMs
      ),
      DEFAULT_PROVIDER_THROTTLE.providerBackoffBaseMs,
      0,
      maxBackoff
    )),
    providerBackoffMaxMs: maxBackoff,
    providerBackoffJitterRatio: clampNumber(
      configuredValue(
        ['providerBackoffJitterRatio', 'backoffJitterRatio', 'jitterRatio'],
        DEFAULT_PROVIDER_THROTTLE.providerBackoffJitterRatio
      ),
      DEFAULT_PROVIDER_THROTTLE.providerBackoffJitterRatio,
      0,
      1
    ),
    providerAutoResume: configuredValue(
      ['providerAutoResume', 'autoResume'],
      DEFAULT_PROVIDER_THROTTLE.providerAutoResume
    ) !== false
  };
}

export function resolveAgentCycleIntervalMs(sources = [], localSeconds = null) {
  const configuredSources = sources.filter((entry) => entry && typeof entry === 'object');
  let intervalMs;
  for (let index = configuredSources.length - 1; index >= 0 && intervalMs === undefined; index--) {
    const source = configuredSources[index];
    intervalMs = firstDefined(
      source.cycleIntervalMs,
      source.secondsBetweenCyclesMs,
      source.cycleDelayMs,
      source.minCycleIntervalMs,
      source.secondsBetweenCycles !== undefined ? Number(source.secondsBetweenCycles) * 1000 : undefined,
      source.cycleIntervalSeconds !== undefined ? Number(source.cycleIntervalSeconds) * 1000 : undefined
    );
  }
  intervalMs = firstDefined(
    localSeconds !== null ? localSeconds * 1000 : undefined,
    intervalMs,
    DEFAULT_AGENT_CYCLE_THROTTLE.cycleIntervalMs
  );
  return Math.floor(clampNumber(
    intervalMs,
    DEFAULT_AGENT_CYCLE_THROTTLE.cycleIntervalMs,
    0,
    3600000
  ));
}

export function normalizeIterationLimit(value, fallback = MAX_AGENT_ITERATIONS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const limit = Math.floor(parsed);
  if (limit < 1) return fallback;
  return Math.min(limit, MAX_AGENT_ITERATIONS);
}

export const isManagedServerProxyModel = (model) => (
  Boolean(model?.managedServerProxy || model?.serverType === MANAGED_SERVER_PROXY_TYPE)
);

export function getModelIterationLimit(model) {
  if (isManagedServerProxyModel(model)) {
    return Math.min(
      normalizeIterationLimit(
        model?.maxIterations ?? model?.iterationLimit,
        MANAGED_SERVER_PROXY_MAX_ITERATIONS
      ),
      MANAGED_SERVER_PROXY_MAX_ITERATIONS
    );
  }
  return normalizeIterationLimit(model?.maxIterations ?? model?.iterationLimit);
}

export const getToolSchemaName = (schema = {}) => (
  schema?.function?.name || schema?.name || schema?.tool || ''
);

export function getManagedContextEnvelope(model) {
  if (!isManagedServerProxyModel(model)) return null;
  const configured = model?.contextEnvelope || model?.providerEnvelope || model?.requestEnvelope || {};
  const maxMessages = Math.floor(clampNumber(
    configured.maxMessages,
    MANAGED_SERVER_CONTEXT_ENVELOPE.maxMessages,
    4,
    256
  ));
  const maxInputChars = Math.floor(clampNumber(
    configured.maxInputChars,
    MANAGED_SERVER_CONTEXT_ENVELOPE.maxInputChars,
    4096,
    1000000
  ));
  return {
    maxMessages,
    targetMessages: Math.min(maxMessages, Math.floor(clampNumber(
      configured.targetMessages,
      MANAGED_SERVER_CONTEXT_ENVELOPE.targetMessages,
      4,
      maxMessages
    ))),
    maxInputChars,
    targetInputChars: Math.min(maxInputChars, Math.floor(clampNumber(
      configured.targetInputChars,
      MANAGED_SERVER_CONTEXT_ENVELOPE.targetInputChars,
      2048,
      maxInputChars
    ))),
    keepRecentMessages: Math.floor(clampNumber(
      configured.keepRecentMessages,
      MANAGED_SERVER_CONTEXT_ENVELOPE.keepRecentMessages,
      4,
      maxMessages
    )),
    maxMessageChars: Math.floor(clampNumber(
      configured.maxMessageChars,
      MANAGED_SERVER_CONTEXT_ENVELOPE.maxMessageChars,
      1000,
      maxInputChars
    ))
  };
}

export const stringifyMessageContent = (content) => {
  if (typeof content === 'string') return content;
  if (content === null || content === undefined) return '';
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
};

export const measureContextChars = (messages = []) => (
  messages.reduce((sum, message) => sum + stringifyMessageContent(message?.content).length, 0)
);

export function clipProviderMessage(message, maxChars) {
  const content = stringifyMessageContent(message?.content);
  if (content.length <= maxChars) return { ...message, content };
  const headLength = Math.max(200, Math.floor(maxChars * 0.62));
  const tailLength = Math.max(200, maxChars - headLength - 96);
  const omitted = content.length - headLength - tailLength;
  return {
    ...message,
    content: `${content.slice(0, headLength).trimEnd()}\n\n[provider context clipped ${omitted} chars]\n\n${content.slice(-tailLength).trimStart()}`
  };
}

export function compactContextForManagedProvider(context, model) {
  const envelope = getManagedContextEnvelope(model);
  const previousMessages = context.length;
  const previousChars = measureContextChars(context);
  if (!envelope || (previousMessages <= envelope.targetMessages && previousChars <= envelope.targetInputChars)) {
    return {
      context,
      changed: false,
      previousMessages,
      newMessages: previousMessages,
      previousChars,
      newChars: previousChars
    };
  }

  const anchored = new Map();
  const addIndex = (index) => {
    if (index >= 0 && index < context.length) anchored.set(index, context[index]);
  };
  addIndex(context.findIndex((message) => message?.role === 'system'));
  addIndex(context.findIndex((message) => message?.role === 'user'));
  const lastCompactionIndex = context.findLastIndex
    ? context.findLastIndex((message) => stringifyMessageContent(message?.content).includes('[CONTEXT COMPACTED'))
    : (() => {
        for (let index = context.length - 1; index >= 0; index--) {
          if (stringifyMessageContent(context[index]?.content).includes('[CONTEXT COMPACTED')) return index;
        }
        return -1;
      })();
  addIndex(lastCompactionIndex);

  let tailCount = Math.min(envelope.keepRecentMessages, context.length);
  let selected = [];
  while (tailCount >= 4) {
    const picked = new Map(anchored);
    const tailStart = Math.max(0, context.length - tailCount);
    for (let index = tailStart; index < context.length; index++) picked.set(index, context[index]);
    selected = [...picked.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, message]) => clipProviderMessage(message, envelope.maxMessageChars));

    while (selected.length > envelope.targetMessages) {
      const removableIndex = selected.findIndex((message, index) => (
        index > 1 && !stringifyMessageContent(message?.content).includes('[CONTEXT COMPACTED')
      ));
      if (removableIndex === -1) break;
      selected.splice(removableIndex, 1);
    }
    if (measureContextChars(selected) <= envelope.targetInputChars && selected.length <= envelope.targetMessages) break;
    tailCount -= 4;
  }

  let newChars = measureContextChars(selected);
  if (newChars > envelope.targetInputChars && selected.length > 0) {
    const perMessageBudget = Math.max(800, Math.floor(envelope.targetInputChars / selected.length) - 64);
    selected = selected.map((message) => clipProviderMessage(
      message,
      Math.min(envelope.maxMessageChars, perMessageBudget)
    ));
    newChars = measureContextChars(selected);
  }
  return {
    context: selected,
    changed: true,
    previousMessages,
    newMessages: selected.length,
    previousChars,
    newChars
  };
}

export function renderModelContextForTrace(messages = [], tools = []) {
  const renderedMessages = messages.map((message, index) => {
    const role = String(message?.role || 'unknown').toUpperCase();
    return `## Message ${index + 1} / ${messages.length} [${role}]\n${stringifyMessageContent(message?.content)}`;
  }).join('\n\n');
  const toolNames = tools.map((schema) => getToolSchemaName(schema)).filter(Boolean);
  const toolText = toolNames.length > 0
    ? `\n\n## Tools offered\n${toolNames.map((name) => `- ${name}`).join('\n')}`
    : '\n\n## Tools offered\n- none';
  return `${renderedMessages}${toolText}`;
}

export function getProviderErrorStatus(error) {
  const direct = Number(error?.status ?? error?.details?.status ?? error?.details?.statusCode);
  if (Number.isFinite(direct)) return direct;
  const match = String(error?.message || error || '').match(/\b([45]\d\d)\b/);
  return match ? Number(match[1]) : null;
}

export function getProviderRetryAfterMs(error, now = Date.now()) {
  const direct = Number(error?.retryAfterMs ?? error?.details?.retryAfterMs);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const retryAfter = error?.retryAfter ?? error?.details?.retryAfter;
  if (retryAfter === undefined || retryAfter === null) return null;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const retryAt = Date.parse(String(retryAfter));
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - now) : null;
}

export function parseWaitDirective(content = '') {
  const text = String(content || '').trim();
  const match = text.match(/(?:^|\n)\s*(IDLE|PARK):\s*([\s\S]*)$/i);
  if (!match) return null;
  const directive = match[1].toUpperCase();
  const reason = match[2].trim();
  const durationMatch = reason.match(/\b(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec|secs|seconds?|m|min|mins|minutes?)\b/i);
  if (!durationMatch) return { directive, reason, delayMs: 0 };
  const amount = Number(durationMatch[1]);
  const unit = durationMatch[2].toLowerCase();
  let multiplier = 1000;
  if (unit.startsWith('ms') || unit.startsWith('millisecond')) multiplier = 1;
  if (unit === 'm' || unit.startsWith('min')) multiplier = 60000;
  return {
    directive,
    reason,
    delayMs: Math.max(0, Math.floor(amount * multiplier))
  };
}
