/**
 * Tool sources used to prove that Zero can grow file capabilities from its
 * CreateTool-only seed without preinstalling the broader Reploid tool surface.
 */

export const ZERO_READ_FILE_TOOL_CODE = `
export const tool = {
  name: 'ReadFile',
  description: 'Read a VFS file or list a VFS directory.',
  activation: {
    fixtures: {
      vfs: { '/activation/read.txt': 'activation-read' }
    },
    checks: [{
      name: 'reads a fixture file',
      args: { path: '/activation/read.txt' },
      expected: {
        path: '/activation/read.txt',
        kind: 'file',
        content: 'activation-read'
      }
    }]
  },
  inputSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string' }
    }
  }
};

export default async function(args = {}, deps = {}) {
  const { VFS } = deps;
  if (!VFS?.read || !VFS?.list) throw new Error('VFS read/list unavailable');
  const rawPath = String(args.path || '/').trim() || '/';
  const path = rawPath.startsWith('/') ? rawPath : '/' + rawPath;
  if (path.split('/').includes('..')) throw new Error('Path traversal is not allowed');
  try {
    const content = await VFS.read(path);
    return { path, kind: 'file', content };
  } catch (fileError) {
    try {
      const entries = await VFS.list(path.endsWith('/') ? path : path + '/');
      return { path, kind: 'directory', entries };
    } catch {
      throw fileError;
    }
  }
}
`.trim();

export const ZERO_WRITE_FILE_TOOL_CODE = `
const WRITABLE_PREFIXES = ['/shadow/', '/artifacts/'];

export const tool = {
  name: 'WriteFile',
  description: 'Write candidates under /shadow and evidence under /artifacts.',
  capabilities: ['vfs:write'],
  activation: {
    checks: [{
      name: 'writes an evidence fixture',
      args: {
        path: '/artifacts/activation-write.txt',
        content: 'activation-write'
      },
      expected: {
        path: '/artifacts/activation-write.txt',
        bytesWritten: 16
      }
    }]
  },
  inputSchema: {
    type: 'object',
    required: ['path', 'content'],
    properties: {
      path: { type: 'string' },
      content: { type: 'string' }
    }
  }
};

export default async function(args = {}, deps = {}) {
  const { VFS, EventBus } = deps;
  if (!VFS?.write) throw new Error('Writable VFS unavailable');
  const rawPath = String(args.path || '').trim();
  const path = rawPath.startsWith('/') ? rawPath : '/' + rawPath;
  if (!rawPath) throw new Error('Missing path argument');
  if (path.split('/').includes('..')) throw new Error('Path traversal is not allowed');
  if (!WRITABLE_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    throw new Error('Write candidates under /shadow or evidence under /artifacts.');
  }
  const content = typeof args.content === 'string'
    ? args.content
    : JSON.stringify(args.content, null, 2);
  await VFS.write(path, content);
  EventBus?.emit?.('artifact:created', { path });
  return {
    path,
    bytesWritten: new TextEncoder().encode(content).length
  };
}
`.trim();
