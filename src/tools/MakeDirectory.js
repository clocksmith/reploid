/**
 * @fileoverview Mkdir - Create directories (virtual in VFS)
 */

async function call(args = {}, deps = {}) {
  const { VFS } = deps;
  if (!VFS) throw new Error('VFS not available');

  const { path } = args;
  if (!path) throw new Error('Missing "path" argument');

  // VFS is flat, mkdir is virtual but kept for API compatibility
  await VFS.mkdir(path);
  return `Created directory: ${path}`;
}

export const tool = {
  name: "MakeDirectory",
  description: "Create a directory",
  call
};

export default call;
