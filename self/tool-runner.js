/**
 * @fileoverview Minimal tool execution for the awakened Reploid self.
 */

import { loadVfsModule } from './core/vfs-module-loader.js';

export function createSelfToolRunner(options = {}) {
  const utils = options.Utils;
  const logger = options.logger || utils?.logger || console;
  const vfs = options.VFS;
  const readFile = options.readFile;
  const writeFile = options.writeFile;
  const isLoadablePath = typeof options.isLoadablePath === 'function'
    ? options.isLoadablePath
    : () => false;
  const builtInTools = new Map(Object.entries(options.builtInTools || {}));
  const dynamicTools = new Map();

  const executeDynamicTool = async (handler, args = {}) => {
    const deps = {
      Utils: utils,
      VFS: vfs,
      readFile,
      writeFile,
      loadModule,
      callTool: executeTool
    };
    return handler(args, deps);
  };

  const loadModule = async (args = {}) => {
    const path = typeof args === 'string' ? args : args.path;
    if (!path) {
      throw new Error('Missing path argument');
    }

    const normalized = path.startsWith('/') ? path : `/${path}`;
    if (!isLoadablePath(normalized)) {
      throw new Error('LoadModule only supports /self paths');
    }

    const mod = await loadVfsModule({
      VFS: vfs,
      logger,
      path: normalized,
      forceReload: !!args.force
    });

    const toolMeta = mod.tool || {};
    const handler = typeof mod.default === 'function'
      ? mod.default
      : typeof toolMeta.call === 'function'
        ? toolMeta.call
        : null;

    if (!handler) {
      return {
        path: normalized,
        loaded: true,
        callable: false
      };
    }

    const toolName = toolMeta.name || normalized.split('/').pop().replace(/\.m?js$/, '');
    dynamicTools.set(toolName, {
      name: toolName,
      description: toolMeta.description || `Dynamic tool loaded from ${normalized}`,
      inputSchema: toolMeta.inputSchema || null,
      handler
    });

    return {
      path: normalized,
      loaded: true,
      callable: true,
      toolName
    };
  };

  builtInTools.set('LoadModule', loadModule);

  const executeTool = async (name, args = {}) => {
    if (builtInTools.has(name)) {
      return builtInTools.get(name)(args);
    }

    const dynamic = dynamicTools.get(name);
    if (!dynamic) {
      throw new Error(`Unknown tool: ${name}`);
    }

    return executeDynamicTool(dynamic.handler, args);
  };

  const listToolNames = () => {
    const names = new Set([
      ...builtInTools.keys(),
      ...dynamicTools.keys()
    ]);
    return Array.from(names);
  };

  return {
    executeTool,
    loadModule,
    listToolNames
  };
}

export default {
  createSelfToolRunner
};
