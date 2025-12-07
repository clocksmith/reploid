/**
 * @fileoverview Touch - Create empty files or update timestamps
 */

async function call(args = {}, deps = {}) {
  const { VFS } = deps;
  if (!VFS) throw new Error('VFS not available');

  const { path } = args;
  if (!path) throw new Error('Missing "path" argument');

  const exists = await VFS.exists(path);
  if (exists) {
    // Read and rewrite to update timestamp
    const content = await VFS.read(path);
    await VFS.write(path, content);
    return `Updated: ${path}`;
  }

  // Create empty file
  await VFS.write(path, '');
  return `Created: ${path}`;
}

export const tool = {
  name: "Touch",
  description: "Create empty files or update timestamps (touch)",
  call
};

export default call;
