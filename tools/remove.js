/**
 * @fileoverview remove - Remove files or directories
 */

async function call(args = {}, deps = {}) {
  const { Shell } = deps;
  if (!Shell) return 'Shell not available';

  const { path, recursive = false, force = false } = args;
  if (!path) throw new Error('Missing path argument');

  const flags = [];
  if (recursive) flags.push('-r');
  if (force) flags.push('-f');

  const result = await Shell.execute(`rm ${flags.join(' ')} ${path}`);
  return result.output || result;
}

export const tool = {
  name: "remove",
  description: "Remove files or directories (rm)",
  call
};

export default call;
