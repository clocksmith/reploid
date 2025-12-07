/**
 * @fileoverview Ls - List directory contents
 */

async function call(args = {}, deps = {}) {
  const { VFS } = deps;
  if (!VFS) throw new Error('VFS not available');

  const { path = '/', long = false } = args;

  const files = await VFS.list(path);

  if (long) {
    // Long format with stats
    const results = [];
    for (const filePath of files) {
      const stat = await VFS.stat(filePath);
      if (stat) {
        const date = new Date(stat.updated).toISOString().split('T')[0];
        results.push(`${stat.size.toString().padStart(8)} ${date} ${filePath}`);
      }
    }
    return results.join('\n');
  }

  return files.join('\n');
}

export const tool = {
  name: "Ls",
  description: "List directory contents (ls)",
  call
};

export default call;
