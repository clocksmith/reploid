/**
 * @fileoverview Browser-local run replay bundle helpers.
 */

export const RUN_REPLAY_SCHEMA = 'reploid.run-replay.v1';
export const RUN_REPLAY_STORAGE_KEY = 'REPLOID_IMPORTED_RUN_REPLAY';

const COMPATIBLE_SCHEMAS = new Set([
  RUN_REPLAY_SCHEMA,
  'reploid-run-replay/v1',
  'reploid/run-replay/v1'
]);

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
    models
  };
}

const getModelId = (model = {}) => normalizeText(model.id || model.model || model.modelId || model.name);
const getModelName = (model = {}) => normalizeText(model.name || model.id || model.model || model.modelId);

export function deriveBootStateFromRunReplayBundle(bundle, currentState = {}) {
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

  if (model) {
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
  const activities = safeJsonClone(options.activities || []) || [];
  const context = safeJsonClone(options.context || []) || [];
  const messageQueue = safeJsonClone(options.messageQueue || []) || [];
  const vfs = safeJsonClone(options.vfsFiles || options.vfs || {}) || {};
  const cycles = extractCyclesFromVfs(vfs);
  const replay = extractReplayRecords(activities, cycles);
  const state = safeJsonClone(options.state || {}) || {};
  const importedReplay = options.importedReplay ? safeJsonClone(options.importedReplay) : null;

  return {
    schema: RUN_REPLAY_SCHEMA,
    exportedAt: Date.now(),
    route,
    mode,
    goal,
    model: modelConfigs[0] || redactModelConfig(options.modelConfig) || null,
    models: modelConfigs,
    systemPrompt: normalizeText(options.systemPrompt),
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
