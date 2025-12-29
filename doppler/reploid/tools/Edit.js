/**
 * @fileoverview Edit - Targeted file modifications
 * Supports literal match/replace operations with optional counts.
 * Emits audit:core_write events for L3 substrate changes (/core/, /infrastructure/)
 */

async function call(args = {}, deps = {}) {
  const { VFS, AuditLogger, EventBus } = deps;
  if (!VFS) return 'VFS unavailable';

  const { path, operations } = args;
  if (!path) throw new Error('Missing "path" argument');
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error('Provide at least one operation in "operations" array');
  }

  // Check if this is a core/infrastructure path (L3 substrate)
  const isCore = path.startsWith('/core/') || path.startsWith('/infrastructure/');

  let content = await VFS.read(path);
  const beforeLength = content.length;
  let changed = false;
  const results = [];

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i] || {};
    const match = op.match;
    const replacement = op.replacement ?? '';
    if (!match) throw new Error(`Operation #${i + 1} missing "match"`);
    if (match.length === 0) throw new Error(`Operation #${i + 1} cannot use empty match string`);

    const count = typeof op.count === 'number' ? op.count : 1;
    const maxReplacements = count <= 0 ? Infinity : count;

    let replacements = 0;
    let startIndex = 0;

    while (replacements < maxReplacements) {
      const idx = content.indexOf(match, startIndex);
      if (idx === -1) break;

      content = content.slice(0, idx) + replacement + content.slice(idx + match.length);
      replacements++;
      changed = true;
      startIndex = idx + replacement.length;
    }

    results.push({
      matchPreview: match.length > 60 ? match.slice(0, 57) + '...' : match,
      replacementPreview: replacement.length > 60 ? replacement.slice(0, 57) + '...' : replacement,
      replacements
    });
  }

  if (changed) {
    await VFS.write(path, content);

    // Audit log for core file changes (L3 substrate)
    if (isCore && AuditLogger) {
      await AuditLogger.logCoreWrite({
        path,
        operation: 'Edit',
        existed: true,
        bytesWritten: content.length,
        bytesBefore: beforeLength
      });
    }

    // Emit event for core writes
    if (isCore && EventBus) {
      EventBus.emit('tool:core_write', {
        path,
        operation: 'Edit',
        operationCount: results.reduce((sum, r) => sum + r.replacements, 0)
      });
    }
  }

  return {
    success: true,
    path,
    changed,
    isCore,
    operations: results
  };
}

export const tool = {
  name: "Edit",
  description: "Apply literal match/replacement edits to a file (operations array with match/replacement/count).",
  call
};

export default call;
