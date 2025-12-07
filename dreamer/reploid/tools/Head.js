/**
 * @fileoverview Head - View the first N lines of a file
 */

async function call(args = {}, deps = {}) {
  const { VFS } = deps;
  if (!VFS) throw new Error('VFS not available');

  const { path, lines = 10 } = args;
  if (!path) throw new Error('Missing "path" argument');

  const content = await VFS.read(path);
  const allLines = content.split('\n');
  const n = parseInt(lines, 10);
  return allLines.slice(0, n).join('\n');
}

export const tool = {
  name: "Head",
  description: "Show the first N lines of a file (head)",
  call
};

export default call;
