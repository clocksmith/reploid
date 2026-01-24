/**
 * @fileoverview ListFiles - List files in VFS directory
 */

const normalizeTargetPath = (input) => {
  if (!input || typeof input !== 'string') return '/';
  let clean = input.trim().replace(/\\/g, '/');
  if (!clean.startsWith('/')) clean = '/' + clean;
  if (clean.length > 1 && clean.endsWith('/')) clean = clean.slice(0, -1);
  return clean || '/';
};

const listImmediateEntries = (files, targetPath) => {
  const baseSegments = targetPath === '/' ? [] : targetPath.split('/').filter(Boolean);
  const basePrefix = baseSegments.length ? '/' + baseSegments.join('/') : '';
  const results = new Set();

  for (const filePath of files) {
    const segments = filePath.split('/').filter(Boolean);
    if (segments.length <= baseSegments.length) continue;
    const child = segments[baseSegments.length];
    if (!child) continue;
    if (segments.length === baseSegments.length + 1) {
      results.add(`${basePrefix}/${child}`);
    } else {
      results.add(`${basePrefix}/${child}/`);
    }
  }

  return Array.from(results).sort();
};

async function call(args = {}, deps = {}) {
  const { VFS } = deps;
  if (!VFS) throw new Error('VFS not available');

  const { path = '/', directory, dir, long = false, recursive = false } = args;
  const targetPath = normalizeTargetPath(path || directory || dir || '/');

  const files = await VFS.list(targetPath);

  if (long) {
    const results = [];
    const baseSegments = targetPath === '/' ? [] : targetPath.split('/').filter(Boolean);
    const depth = baseSegments.length + 1;
    for (const filePath of files) {
      // Filter if recursive is false (VFS.list is usually recursive by default, need check)
      // Assuming VFS.list returns all descendants.
      if (!recursive && filePath.split('/').filter(Boolean).length !== depth) {
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
    return listImmediateEntries(files, targetPath).join('\n');
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
