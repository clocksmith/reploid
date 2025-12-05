/**
 * @fileoverview Git - git version control operations in VFS
 */

async function call(args = {}, deps = {}) {
  const { gitTools } = deps;
  if (!gitTools) return 'git not available';

  const { command, ...options } = args;
  if (!command) throw new Error('Missing git command (status, log, diff, add, commit)');

  switch (command) {
    case 'status':
      return await gitTools.status();
    case 'log':
      return await gitTools.log(options.limit || 10);
    case 'diff':
      return await gitTools.diff(options.path);
    case 'add':
      if (!options.path) throw new Error('Missing path for git add');
      return await gitTools.add(options.path);
    case 'commit':
      if (!options.message) throw new Error('Missing message for git commit');
      return await gitTools.commit(options.message);
    default:
      throw new Error(`Unsupported git command: ${command}`);
  }
}

export const tool = {
  name: "Git",
  description: "git version control operations in VFS (status, log, diff, add, commit)",
  call
};

export default call;
