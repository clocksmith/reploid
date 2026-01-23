/**
 * @fileoverview Mv - Move or rename files
 */

async function call(args = {}, deps = {}) {
  const { VFS } = deps;
  if (!VFS) throw new Error('VFS not available');

  const { source, dest } = args;
  if (!source || !dest) throw new Error('Missing "source" or "dest" argument');

  // Read source, write to dest, delete source
  const content = await VFS.read(source);
  await VFS.write(dest, content);
  await VFS.delete(source);

  return `Moved: ${source} -> ${dest}`;
}

export const tool = {
  name: "MoveFile",
  description: "Move or rename files",
  call
};

export default call;
