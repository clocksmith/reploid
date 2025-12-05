/**
 * @fileoverview Rm - Remove files or directories
 */

async function call(args = {}, deps = {}) {
  const { VFS } = deps;
  if (!VFS) throw new Error('VFS not available');

  const { path, recursive = false } = args;
  if (!path) throw new Error('Missing "path" argument');

  if (recursive) {
    // Delete all files under this path prefix
    const files = await VFS.list(path);
    let deleted = 0;
    for (const filePath of files) {
      await VFS.delete(filePath);
      deleted++;
    }
    return `Deleted ${deleted} file(s) under ${path}`;
  }

  await VFS.delete(path);
  return `Deleted: ${path}`;
}

export const tool = {
  name: "Rm",
  description: "Remove files or directories (rm)",
  call
};

export default call;
