/**
 * @fileoverview Browser-local run replay bundle helpers.
 */

export const RUN_REPLAY_SCHEMA = 'reploid.run-replay.v1';
export const RUN_REPLAY_STORAGE_KEY = 'REPLOID_IMPORTED_RUN_REPLAY';

export const RUN_TRACE_SCHEMA = 'reploid.run-trace.v1';
export const RUN_TRACE_LIMITS = Object.freeze({ events: 4096, eventBytes: 128 * 1024, bytes: 4 * 1024 * 1024, durationMs: 7 * 86400000 });
export const RUN_TRACE_EVENT_TYPES = Object.freeze([
  'model_text', 'tool_call', 'tool_result', 'tool_observation', 'status', 'error'
]);
const jsonBytes = (value) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
const PRIVATE_KEY_RE = /api.?key|auth|bearer|token|secret|passw|credential|cookie|private.?key|system.?prompt|context|reasoning|thought/i;
const redactText = (text) => text
  .replace(/<(think|analysis|reasoning)\b[^>]*>[\s\S]*?(?:<\/\1>|$)/gi, '[reasoning omitted]')
  .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[redacted]')
  .replace(/\b(?:sk-[a-z0-9_-]{8,}|gh[pousr]_[a-z0-9_]{12,}|eyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+)\b/gi, '[redacted]')
  .replace(/\b(Bearer\s+)\S+/gi, '$1[redacted]')
  .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization|cookie)["']?\s*[:=]\s*["']?)[^\s,"';}]+/gi, '$1[redacted]')
  .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@');

// A reviewable export, not a guarantee that arbitrary prose contains no private data.
export function sanitizeRunTraceValue(value, depth = 0) {
  if (depth > 12) throw new Error('Run trace nesting exceeds the limit.');
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (Array.isArray(value)) return value.map(item => sanitizeRunTraceValue(item, depth + 1));
  if (!value || typeof value !== 'object') return null;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Unsafe run trace key.');
    out[key] = PRIVATE_KEY_RE.test(key) ? '[redacted]' : sanitizeRunTraceValue(item, depth + 1);
  }
  return out;
}

export function validateRunTrace(input) {
  if (jsonBytes(input) > RUN_TRACE_LIMITS.bytes) throw new Error('Run trace exceeds the size limit.');
  const trace = typeof input === 'string' ? JSON.parse(input) : input;
  if (!trace || trace.schema !== RUN_TRACE_SCHEMA || !Array.isArray(trace.events)
      || trace.events.length > RUN_TRACE_LIMITS.events) throw new Error('Unsupported or oversized run trace.');
  if (!Number.isSafeInteger(trace.droppedEvents) || trace.droppedEvents < 0
      || typeof trace.startedAt !== 'number' || !Number.isFinite(trace.startedAt) || trace.startedAt < 0
      || !trace.provenance || typeof trace.provenance !== 'object' || Array.isArray(trace.provenance)) {
    throw new Error('Invalid run trace metadata.');
  }
  let previous = trace.startedAt;
  const calls = new Map();
  const events = trace.events.map((event, index) => {
    if (!event || event.seq !== index || !RUN_TRACE_EVENT_TYPES.includes(event.type)
        || !Number.isFinite(event.ts) || event.ts < previous
        || event.ts - trace.startedAt > RUN_TRACE_LIMITS.durationMs || !event.data || typeof event.data !== 'object'
        || Array.isArray(event.data) || jsonBytes(event) > RUN_TRACE_LIMITS.eventBytes) {
      throw new Error(`Invalid run trace event or order at ${index}.`);
    }
    if (event.type === 'tool_observation' && typeof event.data.tool !== 'string') throw new Error('Observed tool name is required.');
    if (event.type === 'model_text' && typeof event.data.content !== 'string') throw new Error('Model text is required.');
    if (['tool_call', 'tool_result'].includes(event.type) && (typeof event.data.callId !== 'string' || typeof event.data.tool !== 'string')) {
      throw new Error('Tool trace identity is required.');
    }
    if (event.type === 'tool_call') {
      if (calls.has(event.data.callId)) throw new Error('Duplicate tool trace identity.');
      calls.set(event.data.callId, { tool: event.data.tool, settled: false });
    }
    if (event.type === 'tool_result') {
      const call = calls.get(event.data.callId);
      if (!call || call.settled || call.tool !== event.data.tool) throw new Error('Unmatched tool trace result.');
      call.settled = true;
    }
    previous = event.ts;
    const sanitized = sanitizeRunTraceValue(event);
    if (jsonBytes(sanitized) > RUN_TRACE_LIMITS.eventBytes) throw new Error(`Sanitized run trace event exceeds the size limit at ${index}.`);
    return sanitized;
  });
  const normalized = { schema: RUN_TRACE_SCHEMA, startedAt: trace.startedAt,
    provenance: sanitizeRunTraceValue(trace.provenance), droppedEvents: trace.droppedEvents, events };
  // Redaction can enlarge values. Bound the canonical output before a caller
  // replaces retained playback or execution state with this validated trace.
  if (jsonBytes(normalized) > RUN_TRACE_LIMITS.bytes) throw new Error('Sanitized run trace exceeds the size limit.');
  return normalized;
}

export function importRunTrace(input) {
  if (jsonBytes(input) > RUN_TRACE_LIMITS.bytes) throw new Error('Run trace exceeds the size limit.');
  const value = typeof input === 'string' ? JSON.parse(input) : input;
  if (value?.schema === RUN_TRACE_SCHEMA) return validateRunTrace(value);
  // A declared trace must pass its own validator, never fall back to legacy data.
  if (value && Object.hasOwn(value, 'trace')) {
    if ((value.schema !== undefined && !COMPATIBLE_SCHEMAS.has(value.schema))
        || (value.type !== undefined && !COMPATIBLE_SCHEMAS.has(value.type))) throw new Error('Unsupported run replay schema.');
    return validateRunTrace(value.trace);
  }
  return importLegacyRunTimeline(value);
}

const COMPATIBLE_SCHEMAS = new Set([
  RUN_REPLAY_SCHEMA,
  'reploid-run-replay/v1',
  'reploid/run-replay/v1'
]);

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const PRIVATE_LEGACY_EVENT_RE = /(^|[:_-])((?:model|llm)[:_-]request|prompt|context|reasoning|thought|analysis)($|[:_-])/i;

// The version 1.1 state exporter and pre-trace run-replay bundles stored the
// TelemetryTimeline { ts, type, payload } records in VFS JSONL files. Normalize
// evidence only: never restore those files, infer tool-call authority, or dispatch
// their event names. Native traces still pass the stricter trace contract above.
const importLegacyRunTimeline = bundle => {
  if (!isRecord(bundle) || !isRecord(bundle.vfs)) throw new Error('Invalid run data: missing vfs');
  if ((bundle.schema !== undefined && !COMPATIBLE_SCHEMAS.has(bundle.schema))
      || (bundle.type !== undefined && !COMPATIBLE_SCHEMAS.has(bundle.type))
      || (bundle.version !== undefined && bundle.version !== '1.1')) {
    throw new Error('Unsupported legacy run schema.');
  }
  for (const key of ['state', 'metadata']) {
    if (bundle[key] !== undefined && !isRecord(bundle[key])) throw new Error('Invalid legacy run metadata.');
  }
  const totalCycles = bundle.metadata?.totalCycles ?? bundle.state?.totalCycles ?? 0;
  if (!Number.isSafeInteger(totalCycles) || totalCycles < 0) throw new Error('Invalid legacy run cycle count.');
  const exportedAt = bundle.exportedAt ?? null;
  if (exportedAt !== null && !(typeof exportedAt === 'string' && Number.isFinite(Date.parse(exportedAt)))
      && !(typeof exportedAt === 'number' && Number.isFinite(exportedAt) && exportedAt >= 0)) {
    throw new Error('Invalid legacy run export timestamp.');
  }
  const goal = bundle.state?.currentGoal?.text ?? bundle.state?.goal?.text ?? bundle.state?.goal ?? bundle.goal ?? null;
  if (goal !== null && typeof goal !== 'string') throw new Error('Invalid legacy run goal.');
  const records = [];
  const paths = Object.keys(bundle.vfs).filter(path => /^\/\.logs\/timeline\/[^/]+\.jsonl$/.test(path)).sort();
  for (const path of paths) {
    const content = bundle.vfs[path];
    if (typeof content !== 'string') throw new Error('Invalid legacy timeline file.');
    let previous = 0;
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      if (records.length >= RUN_TRACE_LIMITS.events || jsonBytes(line) > RUN_TRACE_LIMITS.eventBytes) {
        throw new Error('Legacy timeline exceeds the event limit.');
      }
      const event = JSON.parse(line);
      if (!isRecord(event) || !Number.isFinite(event.ts) || event.ts < previous
          || typeof event.type !== 'string' || !event.type.trim() || !isRecord(event.payload)) {
        throw new Error('Invalid legacy timeline event or order.');
      }
      previous = event.ts;
      records.push(sanitizeRunTraceValue(event));
    }
  }
  // Legacy records have no sequence numbers. Merge dated files chronologically,
  // retaining their append order for equal timestamps.
  records.sort((a, b) => a.ts - b.ts);
  const events = records.map((event, seq) => {
    const payload = event.payload;
    let type = event.severity === 'error' || event.severity === 'ERROR' ? 'error' : 'status';
    let data = { legacyType: event.type, payload };
    if ([event.type, payload.type, payload.kind, payload.action].some(label =>
      typeof label === 'string' && PRIVATE_LEGACY_EVENT_RE.test(label))) {
      data = { legacyType: event.type, omittedPayload: 'Private request or reasoning evidence is not imported.' };
    } else if (event.type === 'agent:history') {
      if (payload.type === 'llm_response') {
        type = 'model_text';
        data = { legacyType: event.type, content: payload.content, cycle: payload.cycle ?? null,
          model: payload.model ?? payload.modelUsed?.id ?? null, provider: payload.provider ?? payload.modelUsed?.provider ?? null };
      } else if (payload.type === 'tool_result') {
        // Legacy observations have no paired call identity. Do not manufacture one.
        type = 'tool_observation';
        data = { legacyType: event.type, tool: payload.tool, args: payload.args ?? {},
          result: payload.result ?? null, cycle: payload.cycle ?? null };
      } else {
        data = { legacyType: event.type, omittedPayload: 'Non-output history is not imported.' };
      }
    }
    return { seq, ts: event.ts, type, data };
  });
  return validateRunTrace({ schema: RUN_TRACE_SCHEMA, startedAt: events[0]?.ts ?? 0,
    droppedEvents: 0, events, provenance: { source: 'legacy-vfs-timeline',
      importedSchema: bundle.schema ?? bundle.type ?? 'reploid-state/1.1',
      exportedAt, totalCycles, fileCount: Object.keys(bundle.vfs).length, goal } });
};

const EXPORT_ROOTS = Object.freeze([
  '/cycles',
  '/artifacts',
  '/.logs/timeline',
  '/.system'
]);

const SECRET_KEY_RE = /(^|[_-])(api[-_]?key|authorization|bearer|token|secret|password|credential|cookie)([_-]|$)/i;
const MAX_REPLAY_FILE_BYTES = 256 * 1024;
const MAX_REPLAY_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_REPLAY_FILES = 160;

const safeJsonClone = (value) => {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
};

const normalizeText = (value) => String(value || '').trim();

const normalizeMode = (value) => {
  const mode = normalizeText(value).toLowerCase();
  if (mode === 'zero' || mode === 'x' || mode === 'reploid') return mode;
  if (mode.includes('zero')) return 'zero';
  if (mode === '/x' || mode.includes('/x')) return 'x';
  return 'zero';
};

const redactSecrets = (value, depth = 0, seen = new WeakSet()) => {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  if (depth > 8) return Array.isArray(value) ? [] : {};

  seen.add(value);
  if (Array.isArray(value)) {
    const next = value.map((item) => redactSecrets(item, depth + 1, seen));
    seen.delete(value);
    return next;
  }

  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY_RE.test(key)) {
      next[key] = '[redacted]';
    } else {
      next[key] = redactSecrets(item, depth + 1, seen);
    }
  }
  seen.delete(value);
  return next;
};

export const redactModelConfig = (model = null) => {
  if (!model || typeof model !== 'object') return null;
  const redacted = redactSecrets(model);
  return redacted && typeof redacted === 'object' ? redacted : null;
};

const normalizeModelList = (input = []) => {
  const raw = Array.isArray(input) ? input : (input ? [input] : []);
  return raw
    .map(redactModelConfig)
    .filter(Boolean);
};

const getBundleGoal = (bundle = {}) => normalizeText(
  bundle.goal
  || bundle.objective
  || bundle.state?.currentGoal?.text
  || bundle.state?.goal?.text
  || bundle.state?.goal
  || bundle.metadata?.goal
);

const getBundleModels = (bundle = {}) => {
  if (Array.isArray(bundle.models)) return normalizeModelList(bundle.models);
  if (Array.isArray(bundle.modelConfigs)) return normalizeModelList(bundle.modelConfigs);
  return normalizeModelList(bundle.model || bundle.modelConfig || bundle.metadata?.model);
};

export function validateRunReplayBundle(input) {
  if (jsonBytes(input) > RUN_TRACE_LIMITS.bytes) throw new Error('Run replay exceeds the size limit.');
  const bundle = typeof input === 'string' ? JSON.parse(input) : input;
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw new Error('Run replay JSON must be an object.');
  }

  const schema = normalizeText(bundle.schema || bundle.type);
  if (!COMPATIBLE_SCHEMAS.has(schema)) {
    throw new Error(`Unsupported run replay schema: ${schema || 'missing'}.`);
  }

  const goal = getBundleGoal(bundle);
  if (!goal) {
    throw new Error('Run replay JSON is missing a goal.');
  }

  const mode = normalizeMode(bundle.mode || bundle.route || bundle.metadata?.mode);
  const models = getBundleModels(bundle);

  return {
    ...safeJsonClone(bundle),
    schema: RUN_REPLAY_SCHEMA,
    importedSchema: schema,
    mode,
    route: normalizeText(bundle.route) || `/${mode}`,
    goal,
    model: models[0] || null,
    models,
    ...(bundle.trace ? { trace: validateRunTrace(bundle.trace) } : {})
  };
}

const getModelId = (model = {}) => normalizeText(model.id || model.model || model.modelId || model.name);
const getModelName = (model = {}) => normalizeText(model.name || model.id || model.model || model.modelId);

export function deriveBootStateFromRunReplayBundle(bundle, currentState = {}, options = {}) {
  const normalized = validateRunReplayBundle(bundle);
  const stateUpdates = {
    goal: normalized.goal,
    goalGenerator: {
      status: 'ready',
      error: null,
      source: 'run-replay'
    }
  };
  const model = normalized.models[0] || null;
  const storageModels = [];
  const hasExternalModel = normalized.models.some((entry) => (
    normalizeText(entry.provider).toLowerCase() === 'external'
      || getModelId(entry) === 'external-brain'
  ));

  if (hasExternalModel) {
    if (normalized.models.length !== 1
        || model?.provider !== 'external'
        || model.id !== 'external-brain'
        || model.hostType !== 'direct') {
      throw new Error('Connected agent replay must select one external-brain model with the direct host type.');
    }
    // The host supplies current availability; a replay cannot grant local access.
    if (options.externalBrainAvailable !== true
        || normalized.mode !== 'x'
        || currentState.mode !== 'x'
        || (currentState.routeLockedMode && currentState.routeLockedMode !== 'x')) {
      throw new Error('Connected agent replay is available only on local X.');
    }
    stateUpdates.connectionType = 'external';
    stateUpdates.externalConfig = {
      enabled: false,
      verifyState: 'unverified',
      verifyError: null
    };
    storageModels.push({
      id: 'external-brain',
      name: 'Connected agent',
      provider: 'external',
      hostType: 'direct'
    });
  }

  if (model && !hasExternalModel) {
    const provider = normalizeText(model.provider).toLowerCase();
    const hostType = normalizeText(model.hostType).toLowerCase();
    const modelId = getModelId(model);
    const modelName = getModelName(model) || modelId;

    if (provider === 'doppler' || hostType === 'browser-local') {
      stateUpdates.connectionType = 'browser';
      stateUpdates.dopplerConfig = {
        ...(currentState.dopplerConfig || {}),
        model: modelId || modelName,
        verifyState: currentState.dopplerConfig?.verifyState || 'verified'
      };
      storageModels.push({
        ...model,
        id: modelId || modelName,
        name: modelName || modelId,
        provider: 'doppler',
        hostType: 'browser-local'
      });
    } else if (
      model.proxyUrl
      || model.localUrl
      || model.endpoint
      || model.serverType
      || hostType.startsWith('proxy')
      || normalized.mode === 'zero'
    ) {
      const url = normalizeText(model.proxyUrl || model.localUrl || model.endpoint || currentState.proxyConfig?.url);
      stateUpdates.connectionType = 'proxy';
      stateUpdates.proxyConfig = {
        ...(currentState.proxyConfig || {}),
        url,
        endpoint: normalizeText(model.endpoint) || currentState.proxyConfig?.endpoint || url,
        serverType: normalizeText(model.serverType || currentState.proxyConfig?.serverType || 'reploid'),
        provider: normalizeText(model.provider || currentState.proxyConfig?.provider || 'proxy'),
        model: modelId || modelName,
        verifyState: currentState.proxyConfig?.verifyState || 'unverified',
        verifyError: null,
        modelVerifyState: currentState.proxyConfig?.modelVerifyState || 'unverified',
        modelVerifyError: null
      };
      storageModels.push({
        ...model,
        id: modelId || modelName,
        name: modelName || modelId,
        provider: normalizeText(model.provider || 'proxy'),
        hostType: hostType || 'proxy-cloud',
        proxyUrl: url,
        endpoint: normalizeText(model.endpoint) || undefined,
        serverType: normalizeText(model.serverType || stateUpdates.proxyConfig.serverType)
      });
    } else {
      stateUpdates.connectionType = 'direct';
      stateUpdates.directConfig = {
        ...(currentState.directConfig || {}),
        provider: normalizeText(model.provider || currentState.directConfig?.provider),
        model: modelId || modelName,
        apiKey: null,
        verifyState: 'unverified',
        verifyError: 'Imported replay does not contain browser secrets.'
      };
    }
  }

  return {
    bundle: normalized,
    stateUpdates,
    storageModels,
    summary: getImportedRunReplaySummary(normalized)
  };
}

export function getImportedRunReplaySummary(bundle) {
  const normalized = validateRunReplayBundle(bundle);
  return {
    schema: RUN_REPLAY_SCHEMA,
    importedAt: Date.now(),
    exportedAt: normalized.exportedAt || normalized.metadata?.exportedAt || null,
    mode: normalized.mode,
    route: normalized.route,
    goal: normalized.goal,
    model: normalized.model,
    cycles: Object.keys(normalized.cycles || {}).length || normalized.metadata?.cycleCount || 0,
    activities: Array.isArray(normalized.history) ? normalized.history.length : 0,
    files: normalized.vfs && typeof normalized.vfs === 'object'
      ? Object.keys(normalized.vfs).length
      : 0
  };
}

export function writeImportedRunReplaySummary(storage, bundle) {
  if (!storage?.setItem) return null;
  const summary = getImportedRunReplaySummary(bundle);
  storage.setItem(RUN_REPLAY_STORAGE_KEY, JSON.stringify(summary));
  return summary;
}

export function readImportedRunReplaySummary(storage) {
  if (!storage?.getItem) return null;
  try {
    const raw = storage.getItem(RUN_REPLAY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const listVfsRoot = async (VFS, root) => {
  try {
    const paths = await VFS?.list?.(root);
    return Array.isArray(paths) ? paths : [];
  } catch {
    return [];
  }
};

const shouldExportVfsPath = (path) => (
  typeof path === 'string'
  && EXPORT_ROOTS.some((root) => path === root || path.startsWith(`${root}/`))
);

export async function collectReplayVfsFiles(VFS, options = {}) {
  if (!VFS?.list || !VFS?.read) return {};

  const maxFiles = Math.max(1, Number(options.maxFiles) || MAX_REPLAY_FILES);
  const maxFileBytes = Math.max(1024, Number(options.maxFileBytes) || MAX_REPLAY_FILE_BYTES);
  const maxTotalBytes = Math.max(maxFileBytes, Number(options.maxTotalBytes) || MAX_REPLAY_TOTAL_BYTES);
  const paths = new Set();

  for (const root of EXPORT_ROOTS) {
    const listed = await listVfsRoot(VFS, root);
    listed.forEach((path) => {
      if (shouldExportVfsPath(path)) paths.add(path);
    });
  }

  const files = {};
  let totalBytes = 0;
  for (const path of [...paths].sort()) {
    if (Object.keys(files).length >= maxFiles) break;
    try {
      const content = await VFS.read(path);
      if (typeof content !== 'string') continue;
      const bytes = content.length;
      if (bytes > maxFileBytes || totalBytes + bytes > maxTotalBytes) continue;
      files[path] = content;
      totalBytes += bytes;
    } catch {
      // skip unreadable paths
    }
  }

  return files;
}

const parseVfsJson = (content) => {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
};

const extractCyclesFromVfs = (vfs = {}) => {
  const cycles = {};
  for (const [path, content] of Object.entries(vfs || {})) {
    const match = path.match(/^\/cycles\/(cycle-\d+)\/([^/]+\.json)$/);
    if (!match) continue;
    const [, cycleId, name] = match;
    cycles[cycleId] = cycles[cycleId] || {};
    cycles[cycleId][name.replace(/\.json$/, '')] = parseVfsJson(content) || content;
  }
  return cycles;
};

const extractReplayRecords = (activities = [], cycles = {}) => {
  const llmResponses = [];
  const toolCalls = [];
  const toolResults = [];

  for (const entry of activities || []) {
    if (entry?.kind === 'llm_response' || entry?.type === 'llm_response') {
      llmResponses.push({
        cycle: entry.cycle || null,
        modelUsed: entry.modelUsed || null,
        content: normalizeText(entry.content)
      });
    }
    if (entry?.kind === 'tool_result' || entry?.type === 'tool_result') {
      toolResults.push(safeJsonClone(entry));
    }
  }

  for (const [cycleId, cycle] of Object.entries(cycles || {})) {
    const toolcalls = cycle?.toolcalls;
    if (!toolcalls || typeof toolcalls !== 'object') continue;
    for (const call of toolcalls.calls || []) {
      toolCalls.push({ cycleId, ...safeJsonClone(call) });
    }
    for (const result of toolcalls.results || []) {
      toolResults.push({ cycleId, ...safeJsonClone(result) });
    }
  }

  return { llmResponses, toolCalls, toolResults };
};

export function buildRunReplayBundle(options = {}) {
  const mode = normalizeMode(options.mode || options.route || 'zero');
  const route = normalizeText(options.route) || `/${mode}`;
  const goal = normalizeText(options.goal || options.state?.currentGoal?.text || options.state?.goal?.text);
  const modelConfigs = normalizeModelList(options.modelConfigs || options.models || options.modelConfig);
  const activities = sanitizeRunTraceValue((options.trace ? [] : options.activities || []).filter(entry => ['llm_response', 'tool_result'].includes(entry.kind || entry.type))) || [];
  const context = [];
  const messageQueue = [];
  const vfs = {}; // Raw files can contain credentials, prompts and unrelated private context.
  const cycles = extractCyclesFromVfs(vfs);
  const replay = extractReplayRecords(activities, cycles);
  const state = { totalCycles: options.state?.totalCycles || 0 };
  const importedReplay = options.importedReplay ? safeJsonClone(options.importedReplay) : null;

  return {
    schema: RUN_REPLAY_SCHEMA,
    exportedAt: Date.now(),
    route,
    mode,
    goal,
    model: modelConfigs[0] || redactModelConfig(options.modelConfig) || null,
    models: modelConfigs,
    systemPrompt: '',
    ...(options.trace ? { trace: validateRunTrace(options.trace) } : {}),
    context,
    messageQueue,
    history: activities,
    cycles,
    artifacts: Object.fromEntries(
      Object.entries(vfs).filter(([path]) => path.startsWith('/artifacts/'))
    ),
    vfs,
    state: {
      ...state,
      currentGoal: state.currentGoal || (goal ? { text: goal } : null),
      totalCycles: state.totalCycles || Object.keys(cycles).length || 0
    },
    replay,
    importedReplay,
    metadata: {
      source: 'reploid-zero-runtime',
      schema: RUN_REPLAY_SCHEMA,
      route,
      mode,
      goal,
      modelCount: modelConfigs.length,
      activityCount: activities.length,
      contextMessageCount: context.length,
      cycleCount: Object.keys(cycles).length,
      fileCount: Object.keys(vfs).length
    }
  };
}

export function formatRunReplayFilename(bundle = {}) {
  const mode = normalizeMode(bundle.mode || bundle.route || 'zero');
  const goal = normalizeText(bundle.goal || 'run')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'run';
  const stamp = new Date(bundle.exportedAt || Date.now()).toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  return `reploid-${mode}-${goal}-${stamp}.json`;
}
