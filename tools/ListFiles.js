/**
 * @fileoverview ListFiles - List files in VFS directory
 */

async function call(args = {}, deps = {}) {
  const { VFS } = deps;
  if (!VFS) throw new Error('VFS not available');

  const path = args.path || args.directory || args.dir || '/';
  return await VFS.list(path);
}

export const tool = {
  name: "ListFiles",
  description: "List files in a VFS directory",
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path (default: /)' }
    }
  },
  call
};

export default call;
