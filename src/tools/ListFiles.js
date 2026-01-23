/**
 * @fileoverview ListFiles - List files in VFS directory
 */

async function call(args = {}, deps = {}) {
  const { VFS } = deps;
  if (!VFS) throw new Error('VFS not available');

  const { path = '/', directory, dir, long = false, recursive = false } = args;
  const targetPath = path || directory || dir || '/';

  const files = await VFS.list(targetPath);

  if (long) {
    const results = [];
    for (const filePath of files) {
      // Filter if recursive is false (VFS.list is usually recursive by default, need check)
      // Assuming VFS.list returns all descendants.
      if (!recursive && filePath.split('/').length > targetPath.split('/').length + (targetPath === '/' ? 0 : 1)) {
        continue;
      }

      const stat = await VFS.stat(filePath);
      if (stat) {
        const date = new Date(stat.updated).toISOString().split('T')[0];
        results.push(`${stat.size.toString().padStart(8)} ${date} ${filePath}`);
      }
    }
    return results.join('\n');
  }

  // Simple list
  if (!recursive) {
    // If VFS.list is recursive, filter for immediate children
    const depth = targetPath === '/' ? 1 : targetPath.split('/').length + 1;
    return files.filter(f => f.split('/').length === depth).join('\n');
  }

  return files.join('\n');
}

export const tool = {
  name: "ListFiles",
  description: "List files in a VFS directory",
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path (default: /)' },
      long: { type: 'boolean', description: 'Show size and date' },
      recursive: { type: 'boolean', description: 'List subdirectories recursively' }
    }
  },
  call
};

export default call;
