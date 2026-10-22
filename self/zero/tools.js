/** Zero's explicit L0 host. Static checking is not a runtime JavaScript sandbox. */
import { createToolRunner } from '../vendor/reploid/agent/tool-runner.js';
import { filterToolDepsForTool } from '../core/tool-capabilities.js';
import ToolWriter from '../core/tool-writer.js';
import VerificationManager from '../core/verification-manager.js';
import SchemaRegistry from '../core/schema-registry.js';
import CreateTool, { tool as createToolSchema } from '../core/create-tool.js';
import { loadVfsModule } from '../core/vfs-module-loader.js';
import { sha256 } from '../core/promotion-policy.js';
import { assertWritableVfsPath, assertNoPathTraversal, normalizeVfsPath } from '../config/vfs-policy.js';
import { isSecurityEnabled } from '../core/security-config.js';
import { getCurrentReploidStorage, getSurfaceIdFromUrl } from '../instance.js';

const installedName = path => /^\/self\/tools\/([A-Z][A-Za-z0-9]*)\.js$/.exec(path)?.[1];
const evidencePath = name => `/artifacts/${name}-evidence.json`;
const reserved = name => name === 'CreateTool' || name === 'Promote';

// Saved receipts identify source, never grant a fresh runner execution authority.
export async function verifiedToolSource(VFS, path) {
  const name = installedName(path);
  if (!name || reserved(name)) throw new Error(`Invalid installed tool path: ${path}`);
  const code = await VFS.read(path);
  const evidence = JSON.parse(await VFS.read(evidencePath(name)));
  const hash = await sha256(code);
  const checks = evidence?.checks;
  if (typeof code !== 'string' || evidence?.schema !== 'reploid.zero.createToolEvidence.v3'
      || evidence.toolName !== name || evidence.targetPath !== path
      || evidence.evidencePath !== evidencePath(name) || evidence.action !== 'CreateTool.activate'
      || evidence.candidateHash !== hash || evidence.targetHash !== hash
      || evidence.activated !== true || evidence.validationPassed !== true
      || evidence.activationChecksPassed !== true || evidence.replayPassed !== true
      || checks?.verification?.kind !== 'static-worker' || checks.verification.passed !== true
      || checks.verification.skipped !== false || checks.verification.hash !== hash
      || checks?.validation?.passed !== true || checks.validation.activationContractValid !== true
      || checks?.activation?.passed !== true || checks.activation.executed !== true
      || checks.activation.declaredChecksPassed !== true || checks.activation.runtimeLoaded !== true
      || checks.activation.installedBytesMatch !== true
      || !Number.isInteger(checks.activation.checkCount) || checks.activation.checkCount < 1
      || checks?.replay?.passed !== true || checks.replay.executed !== true
      || checks.replay.checkCount !== checks.activation.checkCount
      || !/^[a-f0-9]{64}$/.test(checks.activation.transcriptHash || '')
      || !/^[a-f0-9]{64}$/.test(checks.replay.transcriptHash || '')
      || checks?.replay?.matchesActivationTranscript !== true
      || checks.activation.transcriptHash !== checks.replay.transcriptHash) {
    throw new Error(`Installed tool has no matching activation evidence: ${path}`);
  }
  return { name, code, hash, evidence };
}

export async function createZeroTools({ VFS, source = null, emit = () => {}, logger = console }) {
  const Utils = { logger, Errors: { ValidationError: Error, ToolError: Error } };
  // Schemas are rebuilt from approved modules, not mutable persisted declarations.
  const registry = SchemaRegistry.factory({ Utils });
  registry.registerToolSchema('CreateTool', {
    description: createToolSchema.description, parameters: createToolSchema.inputSchema
  }, { builtin: true });
  const exportedSources = new Map((source?.files || []).filter(entry => installedName(`/${entry.path}`))
    .map(entry => [`/${entry.path}`, { ...entry }]));
  const installed = new Map();
  const installing = new Set();
  const shutdown = new AbortController();
  const bindSignal = signal => signal ? AbortSignal.any([signal, shutdown.signal]) : shutdown.signal;
  let disposed = false;
  let queue = Promise.resolve();
  const assertActive = signal => {
    if (disposed) throw new Error('Zero tools are disposed');
    signal?.throwIfAborted();
    if (globalThis.window?.getReploidMode?.() !== 'zero' || getSurfaceIdFromUrl() !== 'zero') {
      throw new Error('Zero tools require the Zero host and verifier scope');
    }
    if (isSecurityEnabled()) throw new Error('Configured security requires its PolicyEngine; Zero cannot bypass it');
    for (const saved of new Set([getCurrentReploidStorage().getItem('REPLOID_HITL_CONFIG'),
      globalThis.localStorage?.getItem('REPLOID_HITL_CONFIG')])) {
      if (!saved) continue;
      const config = JSON.parse(saved);
      if ([config?.approvalMode, ...Object.values(config?.moduleOverrides || {})]
        .some(mode => mode && mode !== 'autonomous' && mode !== 'inherit')) {
        throw new Error('Configured approvals require their HITLController; Zero cannot bypass them');
      }
    }
  };
  const notify = (event, data) => {
    try { emit(event, data); } catch (error) { logger.warn('Zero tool event listener failed', error); }
  };
  const enqueue = work => {
    const next = queue.then(() => { assertActive(); return work(); });
    queue = next.catch(() => {});
    return next;
  };
  const remove = name => {
    installed.get(name)?.runner.close();
    installed.delete(name);
    registry.unregisterToolSchema(name);
  };
  const runtimeVfs = signal => Object.fromEntries(['read', 'list', 'exists', 'write', 'delete'].map(method => [method,
    async (rawPath = '/', ...args) => {
      assertActive(signal);
      const path = normalizeVfsPath(rawPath);
      assertNoPathTraversal(path);
      if (method === 'write' || method === 'delete') {
        assertWritableVfsPath(path, 'Zero tool');
        if (/^\/artifacts\/[^/]+-evidence\.json$/.test(path)) throw new Error('Tool activation evidence is protected');
      }
      // Mutation cancellation belongs to the host, never tool-supplied options.
      let value;
      if (method === 'write') value = await VFS.write(path, args[0], { signal });
      else if (method === 'delete') value = await VFS.delete(path, { signal });
      else value = await VFS[method](path, ...args);
      assertActive(signal);
      return value;
    }
  ]));
  const invoke = async (name, args = {}, { signal } = {}) => {
    const scope = new AbortController();
    signal = AbortSignal.any([bindSignal(signal), scope.signal]);
    try {
      assertActive(signal);
      const schema = registry.getToolSchema(name);
      if (!schema || (name !== 'CreateTool' && !installed.get(name)?.committed)) throw new Error(`Tool not available: ${name}`);
      const validation = registry.validateSchema(args, schema.parameters);
      if (!validation.valid) throw new Error(`Invalid ${name} arguments: ${validation.errors.join('; ')}`);
      const result = await (name === 'CreateTool' ? creator : installed.get(name).runner).executeTool(name, args, { signal });
      assertActive(signal);
      return result;
    } finally {
      // Settled calls cannot retain ports, even while a later call is active.
      scope.abort(new Error('Tool invocation ended'));
    }
  };

  // A transactional view lets the unchanged CreateTool recheck/replay restored
  // source without deleting the original or treating saved evidence as approval.
  const install = async (args, signal, restored = null) => {
    signal = bindSignal(signal);
    assertActive(signal);
    const name = typeof args.name === 'string' ? args.name.trim() : args.name;
    args = { ...args, name };
    if (reserved(name)) throw new Error(`Protected tool name: ${name}`);
    if (installed.has(name) || installing.has(name)) throw new Error(`Tool already installed or installing: ${name}`);
    installing.add(name);
    const target = `/self/tools/${name}.js`;
    const changes = new Map();
    const events = [];
    const transaction = {
      read: async path => {
        assertActive(signal);
        return changes.has(path) ? changes.get(path) : VFS.read(path);
      },
      write: async (path, code) => { assertActive(signal); changes.set(path, code); },
      delete: async path => { changes.delete(path); },
      exists: async path => changes.has(path) || (restored && path === target ? false : VFS.exists(path)),
      list: VFS.list.bind(VFS)
    };
    const EventBus = { emit: (event, data) => events.push([event, data]) };
    const verifier = VerificationManager.factory({ Utils, VFS: transaction, EventBus });
    const writer = ToolWriter.factory({ Utils, VFS: transaction, VerificationManager: verifier });
    const loader = {
      has: toolName => installed.has(toolName),
      unload: remove,
      loadPath: async (path, toolName, options) => {
        assertActive(signal);
        if (path !== target || toolName !== name || !options?.expectedSha256) throw new Error('Missing installation binding');
        const mod = await loadVfsModule({ VFS: transaction, logger, path, forceReload: true,
          expectedSha256: options.expectedSha256 });
        assertActive(signal);
        const handler = typeof mod.default === 'function' ? mod.default : mod.tool?.call;
        const record = { path, hash: options.expectedSha256, committed: false, runner: null };
        const capabilities = structuredClone(mod.tool?.zeroCapabilities || mod.tool?.capabilities || []);
        record.runner = createToolRunner({
          authorize: async ({ name: requested }) => requested === name && installed.get(name) === record && record.committed,
          builtInTools: { [name]: async (input, context) => {
            assertActive(context.signal);
            if (await sha256(await VFS.read(path)) !== record.hash) {
              remove(name);
              throw new Error(`Installed tool source changed: ${name}`);
            }
            assertActive(context.signal);
            const reload = async (loadPath, forcedName = installedName(loadPath)) => {
              assertActive(context.signal);
              const existing = installed.get(forcedName);
              if (!existing?.committed || existing.path !== loadPath
                  || await sha256(await VFS.read(loadPath)) !== existing.hash) throw new Error('Tool load requires current activation authority');
              assertActive(context.signal);
              return true;
            };
            const scoped = action => (...args) => { assertActive(context.signal); return action(...args); };
            const scopedLogger = Object.fromEntries(['debug', 'info', 'warn', 'error', 'log', 'trace']
              .filter(method => typeof logger[method] === 'function')
              .map(method => [method, scoped(logger[method].bind(logger))]));
            const deps = filterToolDepsForTool({
              Utils: { logger: scopedLogger }, VFS: runtimeVfs(context.signal),
              EventBus: { emit: (event, payload) => {
                assertActive(context.signal);
                notify('tool:event', { tool: name, event, payload });
              } },
              ToolRunner: {
                list: scoped(() => ['CreateTool', ...[...installed].filter(([, tool]) => tool.committed).map(([key]) => key)]),
                has: scoped(toolName => toolName === 'CreateTool' || installed.get(toolName)?.committed === true),
                execute: (toolName, inputArgs) => invoke(toolName, inputArgs, context),
                loadPath: reload, load: toolName => reload(`/self/tools/${toolName}.js`, toolName),
                allow: scoped(toolName => installed.get(toolName)?.committed === true)
              }
            }, 'zero', name, { capabilities });
            const result = await handler(input, deps);
            assertActive(context.signal);
            return result;
          } }
        });
        installed.set(name, record);
        registry.registerToolSchema(name, structuredClone({ description: mod.tool?.description || `Tool: ${name}`,
          parameters: mod.tool?.inputSchema || { type: 'object', properties: {} } }));
        return true;
      }
    };
    const originals = new Map();
    const written = [];
    try {
      const result = await CreateTool(args, { Utils, VFS: transaction, ToolWriter: writer, ToolRunner: loader, EventBus }, { minimalMode: true });
      assertActive(signal);
      if (restored ? await VFS.read(target) !== restored.code : await VFS.exists(target)) {
        throw new Error('Installation target changed during validation');
      }
      for (const path of changes.keys()) {
        originals.set(path, await VFS.exists(path) ? await VFS.read(path) : undefined);
        assertActive(signal);
      }
      for (const [path, content] of changes) {
        assertActive(signal);
        written.push(path);
        await VFS.write(path, content, { signal });
        assertActive(signal);
        if (await VFS.read(path) !== content) throw new Error(`Installation write mismatch: ${path}`);
      }
      assertActive(signal);
      if (result.activated) installed.get(name).committed = true;
      for (const [event, data] of events) notify(event, data);
      return result;
    } catch (error) {
      remove(name);
      const failures = [];
      // Compensation must finish even when the operation was aborted or disposed.
      for (const path of written.reverse()) {
        try {
          const previous = originals.get(path);
          if (previous === undefined) {
            await VFS.delete(path);
            if (await VFS.exists(path)) throw new Error('Rollback target still exists');
          } else {
            await VFS.write(path, previous);
            if (await VFS.read(path) !== previous) throw new Error('Rollback bytes changed');
          }
        } catch (cleanupError) { failures.push(`${path}: ${cleanupError.message}`); }
      }
      notify('tool:create_activation_failed', { name, error: error.message, rollbackErrors: failures });
      if (failures.length) throw new AggregateError([error, ...failures.map(message => new Error(message))], 'Tool installation failed; rollback incomplete');
      throw error;
    } finally {
      installing.delete(name);
    }
  };
  const creator = createToolRunner({ authorize: ({ name }) => name === 'CreateTool',
    builtInTools: { CreateTool: (args, { signal }) => install(args, signal) } });
  assertActive();
  return {
    execute: (name, args, { signal } = {}) => {
      const input = structuredClone(args || {});
      return enqueue(() => invoke(name, input, { signal }));
    },
    schemas: () => disposed ? [] : ['CreateTool', ...[...installed].filter(([, tool]) => tool.committed).map(([name]) => name)]
      .map(name => ({ type: 'function', function: { name, ...structuredClone(registry.getToolSchema(name)) } })),
    restore: () => enqueue(async () => {
      const restored = [], rejected = [];
      for (const path of await VFS.list('/self/tools/')) {
        assertActive();
        const current = installed.get(installedName(path));
        if (current?.committed && await sha256(await VFS.read(path)) === current.hash) continue;
        if (current) remove(installedName(path));
        try {
          let saved;
          const name = installedName(path), entry = exportedSources.get(path);
          if (entry && !await VFS.exists(evidencePath(name))) {
            const code = await VFS.read(path);
            if (reserved(name) || typeof code !== 'string' || await sha256(code) !== entry.sha256
                || new TextEncoder().encode(code).length !== entry.bytes) throw new Error(`Exported tool source changed: ${path}`);
            saved = { name, code };
          } else saved = await verifiedToolSource(VFS, path);
          assertActive();
          await install({ name: saved.name, code: saved.code }, undefined, saved);
          restored.push(saved.name);
        } catch (error) {
          assertActive();
          rejected.push({ path, error: error.message });
          notify('tool:restore_rejected', { path, error: error.message });
        }
      }
      return { restored, rejected };
    }),
    dispose: () => {
      disposed = true;
      shutdown.abort(new Error('Zero tools are disposed'));
      creator.close();
      for (const name of installed.keys()) remove(name);
    }
  };
}
