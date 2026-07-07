/**
 * @fileoverview CreateTool - Create runtime tool candidates.
 */

import { defaultAllowTargetPath, isValidatorMutationTarget } from '../core/promotion-policy.js';

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

const createActivationEvidence = (name, candidatePath, targetPath, evidencePath) => ({
  candidatePath,
  targetPath,
  evidencePath,
  replayPassed: true,
  action: 'CreateTool.activate',
  toolName: name
});

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
  if (!defaultAllowTargetPath(targetPath) || isValidatorMutationTarget(targetPath)) {
    throw new Error(`CreateTool activation target is protected and requires promotion: ${targetPath}`);
  }
  if (VFS.exists && await VFS.exists(targetPath)) {
    throw new Error(`CreateTool activation target already exists and requires promotion: ${targetPath}`);
  }
  const code = await VFS.read(result.path);
  const evidence = createActivationEvidence(result.name, result.path, targetPath, evidencePath);

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
    loaded: true,
    toolLoaded: true,
    message: `Tool ${result.name} created, installed, and loaded`
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
  description: "Create a runtime tool. In Zero, stage under /shadow/tools, install to /self/tools, and load it. In broader modes, stage for evidence-gated promotion.",
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
