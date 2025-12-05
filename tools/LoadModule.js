/**
 * @fileoverview LoadModule - Hot-reload a module from VFS
 */

async function call(args = {}, deps = {}) {
  const { SubstrateLoader } = deps;
  if (!SubstrateLoader) throw new Error('SubstrateLoader not available (requires reflection+ genesis level)');

  const { path } = args;
  if (!path) throw new Error('Missing path argument');

  await SubstrateLoader.loadModule(path);
  return `Hot-reloaded module from ${path}`;
}

export const tool = {
  name: "LoadModule",
  description: "Hot-reload a module from the VFS into the running system",
  inputSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string', description: 'VFS path to module (e.g. /core/utils.js)' }
    }
  },
  call
};

export default call;
