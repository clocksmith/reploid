/**
 * @fileoverview ReadFile - Read content from VFS
 */

// 1MB limit - prevents context explosion from huge files (see: quine incident)
const MAX_FILE_SIZE = 1 * 1024 * 1024;

async function call(args = {}, deps = {}) {
  const { VFS } = deps;
  if (!VFS) throw new Error('VFS not available');

  const path = args.path || args.file;
  if (!path) throw new Error('Missing path argument');

  // Check file size before reading to prevent context explosion
  const stats = await VFS.stat(path);
  if (stats && stats.size > MAX_FILE_SIZE) {
    const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
    return `Error: File too large (${sizeMB} MB, limit is 1 MB). Use FileOutline for structure, or read specific line ranges.`;
  }

  return await VFS.read(path);
}

export const tool = {
  name: "ReadFile",
  description: "Read contents of a file from the virtual filesystem",
  readOnly: true,
  inputSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string', description: 'VFS path to read (e.g. /core/agent-loop.js)' }
    }
  },
  call
};

export default call;
