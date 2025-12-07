/**
 * @fileoverview Cp - Copy files
 */

async function call(args = {}, deps = {}) {
  const { VFS } = deps;
  if (!VFS) throw new Error('VFS not available');

  const { source, dest, recursive = false } = args;
  if (!source || !dest) throw new Error('Missing "source" or "dest" argument');

  if (recursive) {
    // Copy all files under source prefix to dest prefix
    const files = await VFS.list(source);
    let copied = 0;
    for (const filePath of files) {
      const content = await VFS.read(filePath);
      const newPath = filePath.replace(source, dest);
      await VFS.write(newPath, content);
      copied++;
    }
    return `Copied ${copied} file(s) from ${source} to ${dest}`;
  }

  const content = await VFS.read(source);
  await VFS.write(dest, content);
  return `Copied: ${source} -> ${dest}`;
}

export const tool = {
  name: "Cp",
  description: "Copy files (cp)",
  call
};

export default call;
