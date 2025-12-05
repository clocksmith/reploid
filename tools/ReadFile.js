/**
 * @fileoverview ReadFile - Read content from VFS
 */

async function call(args = {}, deps = {}) {
  const { VFS } = deps;
  if (!VFS) throw new Error('VFS not available');

  const path = args.path || args.file;
  if (!path) throw new Error('Missing path argument');

  return await VFS.read(path);
}

export const tool = {
  name: "ReadFile",
  description: "Read contents of a file from the virtual filesystem",
  inputSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string', description: 'VFS path to read (e.g. /core/agent-loop.js)' }
    }
  },
  call
};

export default call;
