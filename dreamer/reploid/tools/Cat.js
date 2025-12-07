/**
 * @fileoverview Cat - Output file contents
 */

async function call(args = {}, deps = {}) {
  const { VFS } = deps;
  if (!VFS) throw new Error('VFS not available');

  const { path } = args;
  if (!path) throw new Error('Missing "path" argument');

  const content = await VFS.read(path);
  return content;
}

export const tool = {
  name: "Cat",
  description: "Output file contents (cat)",
  call
};

export default call;
