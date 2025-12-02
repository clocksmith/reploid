/**
 * @fileoverview search_content - Search file contents for pattern
 */

async function call(args = {}, deps = {}) {
  const { Shell } = deps;
  if (!Shell) return 'Shell not available';

  const { pattern, path = '.', recursive = false, ignoreCase = false } = args;
  if (!pattern) throw new Error('Missing pattern argument');

  const flags = [];
  if (recursive) flags.push('-r');
  if (ignoreCase) flags.push('-i');

  const result = await Shell.execute(`grep ${flags.join(' ')} "${pattern}" ${path}`);
  return result.output || result;
}

export const tool = {
  name: "search_content",
  description: "Search files for text pattern matching a string or regex",
  call
};

export default call;
