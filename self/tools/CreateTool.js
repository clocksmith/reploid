/**
 * @fileoverview CreateTool - Create runtime tool candidates.
 */

import { defaultAllowTargetPath, isValidatorMutationTarget, sha256 } from '../core/promotion-policy.js';
import { loadVfsModule } from '../core/vfs-module-loader.js';

const getRuntimeMode = () => {
  try {
    if (typeof window !== 'undefined' && typeof window.getReploidMode === 'function') {
      return window.getReploidMode();
    }
  } catch {
    // Fall back to the broader staged behavior outside the browser runtime.
  }
  return 'reploid';
};

const getZeroTargetPath = (candidatePath) => {
  const cleanPath = String(candidatePath || '').trim();
  if (!cleanPath.startsWith('/shadow/tools/') || !cleanPath.endsWith('.js')) {
    throw new Error('Zero CreateTool activation requires a /shadow/tools/*.js candidate');
  }
  return `/self/tools/${cleanPath.split('/').pop()}`;
};

const getToolHandler = (mod = {}) => (
  typeof mod.default === 'function'
    ? mod.default
    : typeof mod.tool?.call === 'function'
      ? mod.tool.call
      : null
);

const MAX_ACTIVATION_CHECKS = 8;
const ACTIVATION_CHECK_TIMEOUT_MS = 5000;

const normalizeToolCapabilities = (capabilities = []) => {
  if (capabilities instanceof Set) {
    return new Set([...capabilities].map((capability) => String(capability || '').trim()).filter(Boolean));
  }
  if (Array.isArray(capabilities)) {
    return new Set(capabilities.map((capability) => String(capability || '').trim()).filter(Boolean));
  }
  if (typeof capabilities === 'string') {
    return new Set(capabilities.split(/[,\s]+/).map((capability) => capability.trim()).filter(Boolean));
  }
  return new Set();
};

const isRecord = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
);

const serializeStructuredField = (value, fallback, fieldName) => {
  try {
    const serialized = JSON.stringify(value === undefined ? fallback : value, null, 2);
    if (serialized === undefined) {
      throw new Error('value is not JSON-serializable');
    }
    return serialized;
  } catch (error) {
    throw new Error(`Invalid structured CreateTool ${fieldName}: ${error.message}`);
  }
};

const buildStructuredToolCode = (args = {}) => {
  const callSource = typeof args.call === 'string' ? args.call.trim() : '';
  if (!callSource) return null;

  const expression = callSource.replace(/;+\s*$/, '');
  const description = typeof args.description === 'string' ? args.description : '';
  const activation = serializeStructuredField(args.activation, null, 'activation');
  const inputSchema = serializeStructuredField(
    args.inputSchema,
    { type: 'object', properties: {} },
    'inputSchema'
  );
  const capabilities = serializeStructuredField(
    args.capabilities ?? args.zeroCapabilities,
    [],
    'capabilities'
  );

  return `const call = (
${expression}
);

export const tool = {
  name: ${JSON.stringify(String(args.name || '').trim())},
  description: ${JSON.stringify(description)},
  activation: ${activation},
  inputSchema: ${inputSchema},
  capabilities: ${capabilities},
  call
};

export default call;`;
};

const resolveToolCode = (args = {}) => {
  if (typeof args.code === 'string' && args.code.trim()) return args.code;
  const structuredCode = buildStructuredToolCode(args);
  if (structuredCode) return structuredCode;
  throw new Error(
    'Missing code argument: pass module source in code <<EOF ... EOF. '
    + 'Description, activation, inputSchema, capabilities, and call normally belong inside that code block.'
  );
};

const canonicalize = (value, seen = new Set()) => {
  if (value === undefined) return { $type: 'undefined' };
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('activation values must contain only finite numbers');
    }
    return value;
  }
  if (typeof value === 'bigint') return { $type: 'bigint', value: value.toString() };
  if (typeof value === 'function' || typeof value === 'symbol') {
    throw new Error(`activation values cannot contain ${typeof value}s`);
  }
  if (seen.has(value)) throw new Error('activation values cannot contain cycles');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => canonicalize(entry, seen));
    }
    if (value instanceof Date) {
      return { $type: 'date', value: value.toISOString() };
    }
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key], seen)])
    );
  } finally {
    seen.delete(value);
  }
};

const stableStringify = (value) => JSON.stringify(canonicalize(value));

const cloneActivationValue = (value) => {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
};

const matchesExpected = (actual, expected) => {
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && actual.length === expected.length
      && expected.every((entry, index) => matchesExpected(actual[index], entry));
  }
  if (isRecord(expected)) {
    return isRecord(actual)
      && Object.keys(expected).every((key) => (
        Object.hasOwn(actual, key) && matchesExpected(actual[key], expected[key])
      ));
  }
  return Object.is(actual, expected);
};

const formatActivationValue = (value) => {
  const text = stableStringify(value);
  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
};

const normalizeActivationPath = (rawPath = '/') => {
  const value = String(rawPath || '/').trim() || '/';
  const path = value.startsWith('/') ? value : `/${value}`;
  if (path.split('/').includes('..')) throw new Error('activation fixture path traversal is not allowed');
  return path.replace(/\/{2,}/g, '/');
};

const validateActivationContract = (mod, candidatePath) => {
  const activation = mod.tool?.activation;
  if (!isRecord(activation)) {
    throw new Error(`CreateTool activation failed validation: ${candidatePath} must declare tool.activation`);
  }
  if (!Array.isArray(activation.checks) || activation.checks.length === 0) {
    throw new Error(`CreateTool activation failed validation: ${candidatePath} tool.activation.checks must be a non-empty array`);
  }
  if (activation.checks.length > MAX_ACTIVATION_CHECKS) {
    throw new Error(`CreateTool activation failed validation: tool.activation.checks supports at most ${MAX_ACTIVATION_CHECKS} checks`);
  }
  const fixtures = activation.fixtures ?? {};
  if (!isRecord(fixtures)) {
    throw new Error('CreateTool activation failed validation: tool.activation.fixtures must be an object');
  }
  if (fixtures.vfs !== undefined && !isRecord(fixtures.vfs)) {
    throw new Error('CreateTool activation failed validation: tool.activation.fixtures.vfs must be an object');
  }
  if (fixtures.tools !== undefined && !isRecord(fixtures.tools)) {
    throw new Error('CreateTool activation failed validation: tool.activation.fixtures.tools must be an object');
  }

  const names = new Set();
  const checks = activation.checks.map((check, index) => {
    if (!isRecord(check)) {
      throw new Error(`CreateTool activation failed validation: activation check ${index + 1} must be an object`);
    }
    const checkName = typeof check.name === 'string' ? check.name.trim() : '';
    if (!checkName) {
      throw new Error(`CreateTool activation failed validation: activation check ${index + 1} requires a name`);
    }
    if (names.has(checkName)) {
      throw new Error(`CreateTool activation failed validation: duplicate activation check name ${checkName}`);
    }
    names.add(checkName);
    if (!isRecord(check.args)) {
      throw new Error(`CreateTool activation failed validation: activation check ${checkName} args must be an object`);
    }
    if (!Object.hasOwn(check, 'expected')) {
      throw new Error(`CreateTool activation failed validation: activation check ${checkName} requires expected`);
    }
    return {
      name: checkName,
      args: check.args,
      expected: check.expected
    };
  });

  const normalized = { fixtures, checks };
  stableStringify(normalized);
  return cloneActivationValue(normalized);
};

const createActivationHarness = ({ Utils = {}, logger, fixtures = {}, capabilities = [] }) => {
  const files = new Map(
    Object.entries(fixtures.vfs || {}).map(([path, content]) => [normalizeActivationPath(path), content])
  );
  const directories = new Set(['/']);
  const calls = [];
  const events = [];
  const audit = [];
  const loadedTools = new Map();
  const fixtureTools = fixtures.tools || {};
  const capabilitySet = normalizeToolCapabilities(capabilities);
  const canWriteVfs = capabilitySet.has('vfs:write') || capabilitySet.has('self:write');
  const canLoadTools = capabilitySet.has('tool:load') || capabilitySet.has('self:write');
  let generatedId = 0;
  let activationDeps = null;

  const recordCall = (service, method, args = []) => {
    calls.push({ service, method, args: cloneActivationValue(args) });
  };

  const activationVFS = {
    read: async (rawPath) => {
      const path = normalizeActivationPath(rawPath);
      recordCall('VFS', 'read', [path]);
      if (!files.has(path)) throw new Error(`Activation VFS file not found: ${path}`);
      return files.get(path);
    },
    write: async (rawPath, content) => {
      const path = normalizeActivationPath(rawPath);
      recordCall('VFS', 'write', [path, content]);
      files.set(path, content);
      return true;
    },
    delete: async (rawPath) => {
      const path = normalizeActivationPath(rawPath);
      recordCall('VFS', 'delete', [path]);
      files.delete(path);
      return true;
    },
    list: async (rawPath = '/') => {
      const path = normalizeActivationPath(rawPath);
      const prefix = path === '/' || path.endsWith('/') ? path : `${path}/`;
      recordCall('VFS', 'list', [path]);
      return [...files.keys()].filter((filePath) => filePath.startsWith(prefix)).sort();
    },
    exists: async (rawPath) => {
      const path = normalizeActivationPath(rawPath);
      const prefix = path === '/' || path.endsWith('/') ? path : `${path}/`;
      recordCall('VFS', 'exists', [path]);
      return files.has(path)
        || directories.has(path)
        || [...files.keys()].some((filePath) => filePath.startsWith(prefix));
    },
    stat: async (rawPath) => {
      const path = normalizeActivationPath(rawPath);
      recordCall('VFS', 'stat', [path]);
      if (files.has(path)) {
        const content = files.get(path);
        return { path, type: 'file', size: String(content ?? '').length };
      }
      return directories.has(path) ? { path, type: 'directory', size: 0 } : null;
    },
    getMetadata: async (rawPath) => activationVFS.stat(rawPath),
    mkdir: async (rawPath) => {
      const path = normalizeActivationPath(rawPath);
      recordCall('VFS', 'mkdir', [path]);
      directories.add(path);
      return true;
    }
  };

  const activationToolRunner = {
    list: () => [...new Set([...Object.keys(fixtureTools), ...loadedTools.keys()])].sort(),
    has: (toolName) => Object.hasOwn(fixtureTools, toolName) || loadedTools.has(toolName),
    allow: (toolName) => {
      recordCall('ToolRunner', 'allow', [toolName]);
      return true;
    },
    refresh: async () => {
      recordCall('ToolRunner', 'refresh');
      return true;
    },
    loadPath: async (rawPath, forcedName = null) => {
      const path = normalizeActivationPath(rawPath);
      const code = await activationVFS.read(path);
      const mod = await loadVfsModule({
        VFS: activationVFS,
        logger,
        path,
        code,
        forceReload: true
      });
      const handler = getToolHandler(mod);
      if (!handler) throw new Error(`Activation ToolRunner could not load ${path}`);
      const name = forcedName || mod.tool?.name || path.split('/').pop().replace(/\.js$/, '');
      recordCall('ToolRunner', 'loadPath', [path, name]);
      loadedTools.set(name, handler);
      return true;
    },
    unload: (toolName) => {
      recordCall('ToolRunner', 'unload', [toolName]);
      return loadedTools.delete(toolName);
    },
    execute: async (toolName, args = {}) => {
      recordCall('ToolRunner', 'execute', [toolName, args]);
      if (loadedTools.has(toolName)) {
        return loadedTools.get(toolName)(cloneActivationValue(args), activationDeps);
      }
      if (!Object.hasOwn(fixtureTools, toolName)) {
        throw new Error(`Activation ToolRunner fixture not found: ${toolName}`);
      }
      const fixture = fixtureTools[toolName];
      if (isRecord(fixture) && typeof fixture.error === 'string') {
        throw new Error(fixture.error);
      }
      return cloneActivationValue(
        isRecord(fixture) && Object.hasOwn(fixture, 'result') ? fixture.result : fixture
      );
    }
  };

  const listeners = new Map();
  const activationEventBus = {
    emit: (event, payload) => {
      events.push({ event, payload: cloneActivationValue(payload) });
      for (const listener of listeners.get(event) || []) listener(payload);
      return true;
    },
    on: (event, listener) => {
      const eventListeners = listeners.get(event) || [];
      eventListeners.push(listener);
      listeners.set(event, eventListeners);
      return () => activationEventBus.off(event, listener);
    },
    off: (event, listener) => {
      listeners.set(event, (listeners.get(event) || []).filter((entry) => entry !== listener));
    }
  };

  const activationAuditLogger = {
    logEvent: async (...args) => {
      audit.push({ method: 'logEvent', args: cloneActivationValue(args) });
      return true;
    },
    logToolExec: async (...args) => {
      audit.push({ method: 'logToolExec', args: cloneActivationValue(args) });
      return true;
    }
  };

  const silentLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {}
  };

  const exposedVFS = canWriteVfs
    ? activationVFS
    : {
        read: activationVFS.read,
        list: activationVFS.list,
        exists: activationVFS.exists,
        stat: activationVFS.stat,
        getMetadata: activationVFS.getMetadata
      };
  const exposedToolRunner = {
    list: activationToolRunner.list,
    execute: activationToolRunner.execute,
    has: activationToolRunner.has,
    refresh: canLoadTools ? activationToolRunner.refresh : undefined,
    allow: canLoadTools ? activationToolRunner.allow : undefined,
    load: canLoadTools
      ? async (toolName) => activationToolRunner.loadPath(`/tools/${toolName}.js`, toolName)
      : undefined,
    loadPath: canLoadTools ? activationToolRunner.loadPath : undefined,
    unload: canLoadTools ? activationToolRunner.unload : undefined
  };

  activationDeps = {
    VFS: exposedVFS,
    ToolRunner: exposedToolRunner,
    EventBus: activationEventBus,
    AuditLogger: activationAuditLogger,
    Utils: {
      ...Utils,
      logger: silentLogger,
      now: () => 0,
      generateId: (prefix = 'activation') => `${prefix}_${++generatedId}`
    }
  };

  return {
    deps: activationDeps,
    snapshot: () => ({
      files: Object.fromEntries([...files.entries()].sort(([left], [right]) => left.localeCompare(right))),
      directories: [...directories].sort(),
      calls,
      events,
      audit,
      loadedTools: [...loadedTools.keys()].sort()
    })
  };
};

const runActivationChecks = async ({ handler, contract, capabilities, Utils, logger }) => {
  const harness = createActivationHarness({
    Utils,
    logger,
    fixtures: contract.fixtures,
    capabilities
  });
  const results = [];
  for (const check of contract.checks) {
    let timeoutId = null;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`CreateTool activation check ${check.name} timed out`));
      }, ACTIVATION_CHECK_TIMEOUT_MS);
    });
    let result;
    try {
      result = await Promise.race([
        Promise.resolve().then(() => handler(cloneActivationValue(check.args), harness.deps)),
        timeout
      ]);
    } finally {
      clearTimeout(timeoutId);
    }
    if (!matchesExpected(result, check.expected)) {
      throw new Error(
        `CreateTool activation check ${check.name} failed: expected ${formatActivationValue(check.expected)}, received ${formatActivationValue(result)}`
      );
    }
    results.push({ name: check.name, result });
  }
  const transcript = { results, harness: harness.snapshot() };
  const transcriptText = stableStringify(transcript);
  return {
    passed: true,
    executed: true,
    checkCount: contract.checks.length,
    checkNames: contract.checks.map((check) => check.name),
    transcript,
    transcriptText
  };
};

const validateActivationCandidate = async ({ VFS, logger, name, candidatePath, code }) => {
  const mod = await loadVfsModule({
    VFS,
    logger,
    path: candidatePath,
    code,
    forceReload: true
  });
  const handler = getToolHandler(mod);
  if (!handler) {
    throw new Error(`CreateTool activation failed validation: ${candidatePath} has no callable export`);
  }
  const declaredName = typeof mod.tool?.name === 'string' ? mod.tool.name.trim() : '';
  if (declaredName && declaredName !== name) {
    throw new Error(`CreateTool activation failed validation: declared tool name ${declaredName} does not match ${name}`);
  }
  const inputSchema = mod.tool?.inputSchema || null;
  if (inputSchema && typeof inputSchema !== 'object') {
    throw new Error(`CreateTool activation failed validation: inputSchema must be an object`);
  }
  const activation = validateActivationContract(mod, candidatePath);
  const capabilities = [...normalizeToolCapabilities(mod.tool?.zeroCapabilities || mod.tool?.capabilities || [])].sort();
  return {
    mod,
    handler,
    activation,
    capabilities,
    checks: {
      passed: true,
      moduleImported: true,
      callableExport: true,
      declaredName: declaredName || name,
      declaredNameMatches: true,
      inputSchemaValid: true,
      hasInputSchema: !!inputSchema,
      activationContractValid: true,
      activationCheckCount: activation.checks.length,
      declaredCapabilities: capabilities
    }
  };
};

const createActivationEvidence = ({
  name,
  candidatePath,
  targetPath,
  evidencePath,
  candidateHash,
  targetHash = null,
  validation = null,
  activation = null,
  replay = null,
  activated = false,
  failure = null
}) => {
  const validationPassed = validation?.passed === true;
  const activationChecksPassed = activation?.passed === true;
  const replayPassed = replay?.passed === true;
  return {
    schema: 'reploid.zero.createToolEvidence.v3',
    candidatePath,
    targetPath,
    evidencePath,
    candidateHash,
    targetHash,
    validationPassed,
    activationChecksPassed,
    replayPassed,
    activated: activated === true,
    action: 'CreateTool.activate',
    toolName: name,
    checks: {
      validation,
      activation,
      replay
    },
    failure,
    createdAt: new Date().toISOString()
  };
};

const getQuarantinePath = (name) => {
  const safeName = String(name || 'tool').replace(/[^A-Za-z0-9_-]/g, '-');
  return `/artifacts/quarantine/${safeName}-create-tool-quarantine.json`;
};

async function activateZeroTool(result = {}, deps = {}) {
  const { VFS, ToolRunner, EventBus, AuditLogger } = deps;
  if (!VFS?.read || !VFS?.write) {
    throw new Error('VFS not available for CreateTool activation');
  }
  if (!ToolRunner?.loadPath) {
    throw new Error('ToolRunner.loadPath not available for CreateTool activation');
  }

  const targetPath = getZeroTargetPath(result.path);
  const evidencePath = `/artifacts/${result.name}-evidence.json`;
  if (isValidatorMutationTarget(targetPath)) {
    const quarantinePath = getQuarantinePath(result.name);
    const quarantine = {
      schema: 'reploid.createTool.quarantine.v1',
      ok: false,
      quarantined: true,
      reason: 'protected_validator_mutation_target',
      action: 'CreateTool.activate',
      name: result.name,
      candidatePath: result.path,
      targetPath,
      evidencePath,
      quarantinePath,
      createdAt: new Date().toISOString()
    };

    await VFS.write(quarantinePath, JSON.stringify(quarantine, null, 2));
    EventBus?.emit?.('tool:create_quarantined', quarantine);
    if (AuditLogger?.logEvent) {
      await AuditLogger.logEvent('TOOL_CREATE_QUARANTINED', {
        name: result.name,
        candidatePath: result.path,
        targetPath,
        quarantinePath,
        reason: quarantine.reason
      }, 'WARN');
    }
    return {
      ...result,
      ok: false,
      success: false,
      activated: false,
      quarantined: true,
      reason: quarantine.reason,
      targetPath,
      evidencePath,
      quarantinePath,
      message: `Tool ${result.name} targets a protected validator path and was quarantined`
    };
  }
  if (!defaultAllowTargetPath(targetPath)) {
    throw new Error(`CreateTool activation target is protected and requires promotion: ${targetPath}`);
  }
  if (VFS.exists && await VFS.exists(targetPath)) {
    throw new Error(`CreateTool activation target already exists and requires promotion: ${targetPath}`);
  }
  const code = await VFS.read(result.path);
  const candidateHash = await sha256(code);
  const logger = deps.Utils?.logger;
  let validation = { passed: false, executed: false, reason: 'not_run' };
  let activation = {
    kind: 'declared_fixture_checks',
    passed: false,
    executed: false,
    reason: 'not_run'
  };
  let replay = {
    kind: 'fresh_module_fixture_replay',
    passed: false,
    executed: false,
    reason: 'not_run'
  };
  let targetHash = null;
  let targetWritten = false;
  let runtimeLoadAttempted = false;
  let runtimeLoaded = false;
  let cleanup = null;
  let stage = 'validation';

  const writeFailureEvidence = async (error) => {
    const evidence = createActivationEvidence({
      name: result.name,
      candidatePath: result.path,
      targetPath,
      evidencePath,
      candidateHash,
      targetHash,
      validation,
      activation,
      replay,
      activated: activation.runtimeLoaded === true,
      failure: {
        stage,
        message: error.message,
        cleanup
      }
    });
    try {
      await VFS.write(evidencePath, JSON.stringify(evidence, null, 2));
    } catch (evidenceError) {
      logger?.warn?.(`[CreateTool] Failed to write rejection evidence: ${evidenceError.message}`);
    }
    try {
      EventBus?.emit?.('tool:create_activation_failed', {
        name: result.name,
        candidatePath: result.path,
        targetPath,
        evidencePath,
        stage,
        error: error.message
      });
    } catch (eventError) {
      logger?.warn?.(`[CreateTool] Failed to emit activation rejection: ${eventError.message}`);
    }
    if (AuditLogger?.logEvent) {
      try {
        await AuditLogger.logEvent('TOOL_CREATE_ACTIVATION_FAILED', {
          name: result.name,
          candidatePath: result.path,
          targetPath,
          evidencePath,
          stage,
          error: error.message
        }, 'WARN');
      } catch (auditError) {
        logger?.warn?.(`[CreateTool] Failed to audit activation rejection: ${auditError.message}`);
      }
    }
  };

  const cleanupFailedActivation = async () => {
    const cleanupResult = {
      runtimeUnloadAttempted: false,
      runtimeUnloadSucceeded: !runtimeLoadAttempted,
      targetRemovalAttempted: false,
      targetRemovalSucceeded: !targetWritten,
      runtimeStillLoaded: false,
      targetStillExists: false,
      errors: []
    };
    if (runtimeLoadAttempted && ToolRunner.unload) {
      cleanupResult.runtimeUnloadAttempted = true;
      try {
        await ToolRunner.unload(result.name);
        cleanupResult.runtimeUnloadSucceeded = true;
      } catch (unloadError) {
        cleanupResult.errors.push(`unload: ${unloadError.message}`);
        logger?.warn?.(`[CreateTool] Failed to unload rejected tool ${result.name}: ${unloadError.message}`);
      }
    } else if (runtimeLoadAttempted) {
      cleanupResult.errors.push('unload: ToolRunner.unload unavailable');
    }
    if (targetWritten && VFS.delete) {
      cleanupResult.targetRemovalAttempted = true;
      try {
        await VFS.delete(targetPath);
        cleanupResult.targetRemovalSucceeded = true;
      } catch (deleteError) {
        cleanupResult.errors.push(`delete: ${deleteError.message}`);
        logger?.warn?.(`[CreateTool] Failed to remove rejected target ${targetPath}: ${deleteError.message}`);
      }
    } else if (targetWritten) {
      cleanupResult.errors.push('delete: VFS.delete unavailable');
    }

    try {
      cleanupResult.runtimeStillLoaded = ToolRunner.has
        ? ToolRunner.has(result.name) === true
        : runtimeLoaded && cleanupResult.runtimeUnloadSucceeded !== true;
    } catch (hasError) {
      cleanupResult.runtimeStillLoaded = runtimeLoaded && cleanupResult.runtimeUnloadSucceeded !== true;
      cleanupResult.errors.push(`runtime status: ${hasError.message}`);
    }
    try {
      cleanupResult.targetStillExists = VFS.exists
        ? await VFS.exists(targetPath) === true
        : targetWritten && cleanupResult.targetRemovalSucceeded !== true;
    } catch (existsError) {
      cleanupResult.targetStillExists = targetWritten && cleanupResult.targetRemovalSucceeded !== true;
      cleanupResult.errors.push(`target status: ${existsError.message}`);
    }
    if (cleanupResult.runtimeUnloadAttempted) {
      cleanupResult.runtimeUnloadSucceeded = !cleanupResult.runtimeStillLoaded;
    }
    if (cleanupResult.targetRemovalAttempted) {
      cleanupResult.targetRemovalSucceeded = !cleanupResult.targetStillExists;
    }
    activation.runtimeLoaded = cleanupResult.runtimeStillLoaded;
    return cleanupResult;
  };

  try {
    const candidate = await validateActivationCandidate({
      VFS,
      logger,
      name: result.name,
      candidatePath: result.path,
      code
    });
    const activationContractText = stableStringify(candidate.activation);
    validation = {
      ...candidate.checks,
      activationContractHash: await sha256(activationContractText)
    };

    stage = 'activation_checks';
    const activationRun = await runActivationChecks({
      handler: candidate.handler,
      contract: candidate.activation,
      capabilities: candidate.capabilities,
      Utils: deps.Utils,
      logger
    });
    activation = {
      kind: 'declared_fixture_checks',
      passed: false,
      executed: activationRun.executed,
      declaredChecksPassed: activationRun.passed,
      capabilities: candidate.capabilities,
      checkCount: activationRun.checkCount,
      checkNames: activationRun.checkNames,
      timeoutMsPerCheck: ACTIVATION_CHECK_TIMEOUT_MS,
      transcriptHash: await sha256(activationRun.transcriptText),
      installedBytesMatch: false,
      runtimeLoaded: false
    };

    stage = 'replay';
    const replayCode = `${code}\n// reploid-create-tool-replay:${candidateHash}`;
    const replayCandidate = await validateActivationCandidate({
      VFS,
      logger,
      name: result.name,
      candidatePath: result.path,
      code: replayCode
    });
    if (stableStringify(replayCandidate.activation) !== activationContractText) {
      throw new Error('CreateTool replay failed: activation contract changed after re-import');
    }
    if (stableStringify(replayCandidate.capabilities) !== stableStringify(candidate.capabilities)) {
      throw new Error('CreateTool replay failed: tool capabilities changed after re-import');
    }
    const replayRun = await runActivationChecks({
      handler: replayCandidate.handler,
      contract: replayCandidate.activation,
      capabilities: replayCandidate.capabilities,
      Utils: deps.Utils,
      logger
    });
    const replayTranscriptHash = await sha256(replayRun.transcriptText);
    const matchesActivationTranscript = replayRun.transcriptText === activationRun.transcriptText;
    replay = {
      kind: 'fresh_module_fixture_replay',
      passed: replayRun.passed && matchesActivationTranscript,
      executed: replayRun.executed,
      checkCount: replayRun.checkCount,
      checkNames: replayRun.checkNames,
      transcriptHash: replayTranscriptHash,
      matchesActivationTranscript
    };
    if (!replay.passed) {
      throw new Error('CreateTool replay failed: activation transcript did not match replay transcript');
    }
  } catch (error) {
    if (stage === 'validation') {
      validation = { passed: false, executed: true, error: error.message };
    } else if (stage === 'activation_checks') {
      activation = {
        kind: 'declared_fixture_checks',
        passed: false,
        executed: true,
        declaredChecksPassed: false,
        error: error.message
      };
    } else if (stage === 'replay' && replay.executed !== true) {
      replay = {
        kind: 'fresh_module_fixture_replay',
        passed: false,
        executed: true,
        error: error.message
      };
    }
    await writeFailureEvidence(error);
    throw error;
  }

  try {
    stage = 'install';
    await VFS.write(targetPath, code);
    targetWritten = true;
    const installedCode = await VFS.read(targetPath);
    targetHash = await sha256(installedCode);
    activation.installedBytesMatch = targetHash === candidateHash;
    if (!activation.installedBytesMatch) {
      throw new Error(`CreateTool activation failed: installed bytes do not match ${result.path}`);
    }

    stage = 'runtime_load';
    runtimeLoadAttempted = true;
    runtimeLoaded = await ToolRunner.loadPath(targetPath, result.name, { allow: true });
    activation.runtimeLoaded = runtimeLoaded === true;
    activation.passed = activation.declaredChecksPassed === true
      && activation.installedBytesMatch === true
      && activation.runtimeLoaded === true;
    if (!activation.passed) {
      throw new Error(`CreateTool activation failed to load ${targetPath}`);
    }

    stage = 'evidence';
    const evidence = createActivationEvidence({
      name: result.name,
      candidatePath: result.path,
      targetPath,
      evidencePath,
      candidateHash,
      targetHash,
      validation,
      activation,
      replay,
      activated: true
    });
    await VFS.write(evidencePath, JSON.stringify(evidence, null, 2));

    const activated = {
      ...result,
      activated: evidence.activated,
      targetPath,
      evidencePath,
      candidateHash: evidence.candidateHash,
      validationPassed: evidence.validationPassed,
      activationChecksPassed: evidence.activationChecksPassed,
      replayPassed: evidence.replayPassed,
      loaded: activation.runtimeLoaded,
      toolLoaded: activation.runtimeLoaded,
      message: `Tool ${result.name} validated, replayed, installed, and loaded`
    };

    EventBus?.emit?.('tool:created_activated', activated);
    if (AuditLogger?.logEvent) {
      await AuditLogger.logEvent('TOOL_CREATED_ACTIVATED', {
        name: result.name,
        candidatePath: result.path,
        targetPath,
        evidencePath,
        candidateHash,
        activationTranscriptHash: activation.transcriptHash,
        replayTranscriptHash: replay.transcriptHash
      }, 'INFO');
    }

    return activated;
  } catch (error) {
    activation.passed = false;
    activation.error = error.message;
    cleanup = await cleanupFailedActivation();
    activation.cleanup = cleanup;
    await writeFailureEvidence(error);
    throw error;
  }
}

async function call(args = {}, deps = {}) {
  const { ToolWriter, EventBus, AuditLogger } = deps;
  if (!ToolWriter) throw new Error('ToolWriter not available');

  const { name } = args;
  if (!name) throw new Error('Missing name argument');
  const code = resolveToolCode(args);

  const cleanName = typeof name === 'string' ? name.trim() : name;
  const normalizedCode = typeof code === 'string'
    ? code.replace(/\bToolRunner\.run\b/g, 'ToolRunner.execute')
    : code;

  const result = await ToolWriter.create(cleanName, normalizedCode, {
    root: args.root || '/shadow/tools',
    load: false
  });

  const autoActivate = getRuntimeMode() === 'zero' && args.activate !== false;
  if (autoActivate) {
    return activateZeroTool(result, deps);
  }

  EventBus?.emit?.('tool:candidate_created', result);
  if (AuditLogger?.logEvent) {
    await AuditLogger.logEvent('TOOL_CANDIDATE_CREATED', {
      name: result.name,
      path: result.path,
      staged: true
    }, 'INFO');
  }

  return result;
}

export const tool = {
  name: "CreateTool",
  description: "Create a runtime tool from module source in code, or from structured description, activation, inputSchema, capabilities, and call fields. In Zero, tool.activation must declare fixture-backed checks. CreateTool runs the checks, re-imports and replays them in a fresh harness, requires matching transcripts, installs to /self/tools, loads the tool, and writes derived activation evidence. Created tools start read-only unless exported tool metadata declares capabilities such as vfs:write, tool:load, or self:write. In broader modes, stage for evidence-gated promotion.",
  inputSchema: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', description: 'Tool name (CamelCase, start with uppercase letter)' },
      code: { type: 'string', description: 'Preferred: complete JavaScript module source. In text protocol use code <<EOF ... EOF.' },
      description: { type: 'string', description: 'Structured-source alternative: tool description.' },
      activation: { type: 'object', description: 'Structured-source alternative: fixtures and deterministic checks with name, args, and expected.' },
      inputSchema: { type: 'object', description: 'Structured-source alternative: JSON Schema for the created tool arguments.' },
      capabilities: { type: 'array', items: { type: 'string' }, description: 'Structured-source alternative: declared tool capabilities.' },
      call: { type: 'string', description: 'Structured-source alternative: async JavaScript function expression.' },
      root: { type: 'string', description: 'Optional staging root. Must be /shadow/tools or a child path.' },
      activate: { type: 'boolean', description: 'Zero only: set false to stage without installing and loading.' }
    }
  },
  call
};

export default call;
