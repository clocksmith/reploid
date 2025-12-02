/**
 * @fileoverview copy - Copy file
 */

async function call(args = {}, deps = {}) {
  const { Shell } = deps;
  if (!Shell) return 'Shell not available';

  const { source, dest, recursive = false } = args;
  if (!source || !dest) throw new Error('Missing source or dest argument');

  const flags = recursive ? '-r' : '';
  const result = await Shell.execute(`cp ${flags} ${source} ${dest}`);
  return result.output || result;
}

export const tool = {
  name: "copy",
  description: "Copy file or directory (cp)",
  call
};

export default call;
