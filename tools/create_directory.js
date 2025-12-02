/**
 * @fileoverview create_directory - Create directory
 */

async function call(args = {}, deps = {}) {
  const { Shell } = deps;
  if (!Shell) return 'Shell not available';

  const { path, parents = false } = args;
  if (!path) throw new Error('Missing path argument');

  const flags = parents ? '-p' : '';
  const result = await Shell.execute(`mkdir ${flags} ${path}`);
  return result.output || result;
}

export const tool = {
  name: "create_directory",
  description: "Create directory (mkdir)",
  call
};

export default call;
