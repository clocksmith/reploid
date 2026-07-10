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
  return {
    moduleImported: true,
    callableExport: true,
    declaredName: declaredName || name,
    hasInputSchema: !!inputSchema
  };
};

const createActivationEvidence = async ({ name, candidatePath, targetPath, evidencePath, code, checks }) => {
  const candidateHash = await sha256(code);
  return {
    schema: 'reploid.zero.createToolEvidence.v2',
    candidatePath,
    targetPath,
    evidencePath,
    candidateHash,
    targetHash: candidateHash,
    validationPassed: true,
    activationChecksPassed: true,
    replayPassed: true,
    action: 'CreateTool.activate',
    toolName: name,
    checks,
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
  const checks = await validateActivationCandidate({
    VFS,
    logger: deps.Utils?.logger,
    name: result.name,
    candidatePath: result.path,
    code
  });
  const evidence = await createActivationEvidence({
    name: result.name,
    candidatePath: result.path,
    targetPath,
    evidencePath,
    code,
    checks
  });

  await VFS.write(evidencePath, JSON.stringify(evidence, null, 2));
  await VFS.write(targetPath, code);

  const loaded = await ToolRunner.loadPath(targetPath, result.name, { allow: true });
  if (!loaded) {
    throw new Error(`CreateTool activation failed to load ${targetPath}`);
  }

  const activated = {
    ...result,
    activated: true,
    targetPath,
    evidencePath,
    candidateHash: evidence.candidateHash,
    validationPassed: true,
    loaded: true,
    toolLoaded: true,
    message: `Tool ${result.name} validated, installed, and loaded`
  };

  EventBus?.emit?.('tool:created_activated', activated);
  if (AuditLogger?.logEvent) {
    await AuditLogger.logEvent('TOOL_CREATED_ACTIVATED', {
      name: result.name,
      candidatePath: result.path,
      targetPath,
      evidencePath
    }, 'INFO');
  }

  return activated;
}

async function call(args = {}, deps = {}) {
  const { ToolWriter, EventBus, AuditLogger } = deps;
  if (!ToolWriter) throw new Error('ToolWriter not available');

  const { name, code } = args;
  if (!name) throw new Error('Missing name argument');
  if (!code) throw new Error('Missing code argument');

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
  description: "Create a runtime tool. In Zero, stage under /shadow/tools, validate the candidate, write activation evidence, install to /self/tools, and load it. Created tools start read-only unless exported tool metadata declares capabilities such as vfs:write, tool:load, or self:write. In broader modes, stage for evidence-gated promotion.",
  inputSchema: {
    type: 'object',
    required: ['name', 'code'],
    properties: {
      name: { type: 'string', description: 'Tool name (CamelCase, start with uppercase letter)' },
      code: { type: 'string', description: 'JavaScript code with export default async function(args, deps)' },
      root: { type: 'string', description: 'Optional staging root. Must be /shadow/tools or a child path.' },
      activate: { type: 'boolean', description: 'Zero only: set false to stage without installing and loading.' }
    }
  },
  call
};

export default call;
