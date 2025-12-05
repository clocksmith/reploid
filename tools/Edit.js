/**
 * @fileoverview Edit - Targeted file modifications
 * Supports literal match/replace operations with optional counts.
 */

async function call(args = {}, deps = {}) {
  const { VFS } = deps;
  if (!VFS) return 'VFS unavailable';

  const { path, operations } = args;
  if (!path) throw new Error('Missing "path" argument');
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error('Provide at least one operation in "operations" array');
  }

  let content = await VFS.read(path);
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
  }

  return {
    success: true,
    path,
    changed,
    operations: results
  };
}

export const tool = {
  name: "Edit",
  description: "Apply literal match/replacement edits to a file (operations array with match/replacement/count).",
  call
};

export default call;
