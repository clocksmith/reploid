/**
 * @fileoverview move - Move or rename file
 */

async function call(args = {}, deps = {}) {
  const { Shell } = deps;
  if (!Shell) return 'Shell not available';

  const { source, dest } = args;
  if (!source || !dest) throw new Error('Missing source or dest argument');

  const result = await Shell.execute(`mv ${source} ${dest}`);
  return result.output || result;
}

export const tool = {
  name: "move",
  description: "Move or rename file (mv)",
  call
};

export default call;
