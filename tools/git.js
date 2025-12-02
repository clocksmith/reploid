/**
 * @fileoverview git - Git version control operations in VFS
 */

async function call(args = {}, deps = {}) {
  const { GitTools } = deps;
  if (!GitTools) return 'Git not available';

  const { command, ...options } = args;
  if (!command) throw new Error('Missing git command (status, log, diff, add, commit)');

  switch (command) {
    case 'status':
      return await GitTools.status();
    case 'log':
      return await GitTools.log(options.limit || 10);
    case 'diff':
      return await GitTools.diff(options.path);
    case 'add':
      if (!options.path) throw new Error('Missing path for git add');
      return await GitTools.add(options.path);
    case 'commit':
      if (!options.message) throw new Error('Missing message for git commit');
      return await GitTools.commit(options.message);
    default:
      throw new Error(`Unsupported git command: ${command}`);
  }
}

export const tool = {
  name: "git",
  description: "Git version control operations in VFS (status, log, diff, add, commit)",
  call
};

export default call;
