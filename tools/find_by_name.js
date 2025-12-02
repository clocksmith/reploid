/**
 * @fileoverview find_by_name - Find files by name pattern
 */

async function call(args = {}, deps = {}) {
  const { Shell } = deps;
  if (!Shell) return 'Shell not available';

  const { path = '.', name } = args;
  const nameArg = name ? `-name "${name}"` : '';

  const result = await Shell.execute(`find ${path} ${nameArg}`);
  return result.output || result;
}

export const tool = {
  name: "find_by_name",
  description: "Find files matching a name pattern (supports wildcards like *.js)",
  call
};

export default call;
