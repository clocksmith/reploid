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

  const stats = await VFS.stat(path);
  if (!stats) throw new Error(`File not found: ${path}`);

  const { startLine, endLine } = args;
  const hasRange = startLine !== undefined || endLine !== undefined;

  // Allow large files if reading a specific range
  if (!hasRange && stats.size > MAX_FILE_SIZE) {
    const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
    const lines = Math.round(stats.size / 50); // rough estimate
    return `Error: File too large (${sizeMB} MB, ~${lines} lines). Use startLine/endLine to read a range, e.g. { "path": "${path}", "startLine": 1, "endLine": 100 }`;
  }

  const content = await VFS.read(path);

  // Return full content if no range specified
  if (!hasRange) return content;

  // Extract line range
  const lines = content.split('\n');
  const start = Math.max(1, startLine || 1) - 1; // 1-indexed to 0-indexed
  const end = endLine ? Math.min(endLine, lines.length) : lines.length;

  const slice = lines.slice(start, end);
  const header = `[Lines ${start + 1}-${end} of ${lines.length}]\n`;
  return header + slice.join('\n');
}

export const tool = {
  name: "ReadFile",
  description: "Read contents of a file from the virtual filesystem. For large files (>1MB), use startLine/endLine to read specific ranges.",
  readOnly: true,
  inputSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string', description: 'VFS path to read (e.g. /core/agent-loop.js)' },
      startLine: { type: 'number', description: 'First line to read (1-indexed, inclusive)' },
      endLine: { type: 'number', description: 'Last line to read (1-indexed, inclusive)' }
    }
  },
  call
};

export default call;
