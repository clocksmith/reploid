/**
 * @fileoverview Git Tools - isomorphic-git wrapper for CLI mode
 * Provides local-only git operations backed by the VFS.
 */

const GitTools = {
  metadata: {
    id: 'GitTools',
    version: '1.0.0',
    dependencies: ['Utils', 'VFS', 'EventBus'],
    async: false,
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, VFS, EventBus } = deps;
    const { logger } = Utils;

    let git = null;
    let gitLoaded = false;

    // Load isomorphic-git on demand
    const ensureGit = async () => {
      if (gitLoaded) return;

      try {
        const module = await import('https://cdn.jsdelivr.net/npm/isomorphic-git@1.25.0/+esm');
        git = module.default;
        gitLoaded = true;
        logger.info('[GitTools] isomorphic-git loaded');
      } catch (e) {
        throw new Error('Failed to load git: ' + e.message);
      }
    };

    // VFS adapter for isomorphic-git
    const createFS = () => ({
      promises: {
        readFile: async (path, opts) => {
          const content = await VFS.read(path);
          if (opts?.encoding === 'utf8') return content;
          return new TextEncoder().encode(content);
        },
        writeFile: async (path, data) => {
          const content = typeof data === 'string' ? data : new TextDecoder().decode(data);
          await VFS.write(path, content);
        },
        unlink: async (path) => {
          await VFS.delete(path);
        },
        readdir: async (path) => {
          const allFiles = await VFS.list('/');
          const prefix = path === '/' ? '/' : path + '/';
          const entries = new Set();

          for (const file of allFiles) {
            if (file.startsWith(prefix)) {
              const relative = file.slice(prefix.length);
              const firstPart = relative.split('/')[0];
              if (firstPart) entries.add(firstPart);
            }
          }

          return [...entries];
        },
        mkdir: async (path) => {
          await VFS.mkdir(path);
        },
        rmdir: async () => {
          // No-op for flat VFS
        },
        stat: async (path) => {
          const stat = await VFS.stat(path);
          if (stat) {
            return {
              isFile: () => true,
              isDirectory: () => false,
              isSymbolicLink: () => false,
              size: stat.size,
              mtimeMs: stat.updated
            };
          }

          // Check if it's a "directory" (has files under it)
          const allFiles = await VFS.list('/');
          const prefix = path === '/' ? '/' : path + '/';
          const hasChildren = allFiles.some(f => f.startsWith(prefix));

          if (hasChildren || path === '/') {
            return {
              isFile: () => false,
              isDirectory: () => true,
              isSymbolicLink: () => false,
              size: 0,
              mtimeMs: Date.now()
            };
          }

          throw new Error('ENOENT: ' + path);
        },
        lstat: async (path) => {
          return await createFS().promises.stat(path);
        },
        readlink: async () => {
          throw new Error('Symlinks not supported');
        },
        symlink: async () => {
          throw new Error('Symlinks not supported');
        },
        chmod: async () => {
          // No-op
        }
      }
    });

    const fs = createFS();

    // Git commands
    const init = async (dir = '/') => {
      await ensureGit();
      await git.init({ fs, dir });
      return `Initialized empty Git repository in ${dir}`;
    };

    const status = async (dir = '/') => {
      await ensureGit();

      try {
        const matrix = await git.statusMatrix({ fs, dir });
        const results = [];

        for (const [filepath, head, workdir, stage] of matrix) {
          let status = '';

          if (head === 0 && workdir === 2 && stage === 0) {
            status = 'new file (untracked)';
          } else if (head === 0 && workdir === 2 && stage === 2) {
            status = 'new file (staged)';
          } else if (head === 1 && workdir === 2 && stage === 1) {
            status = 'modified';
          } else if (head === 1 && workdir === 2 && stage === 2) {
            status = 'modified (staged)';
          } else if (head === 1 && workdir === 0 && stage === 0) {
            status = 'deleted';
          } else if (head === 1 && workdir === 1 && stage === 1) {
            continue; // Unchanged
          }

          if (status) {
            results.push(`  ${status}: ${filepath}`);
          }
        }

        if (results.length === 0) {
          return 'nothing to commit, working tree clean';
        }

        return results.join('\n');
      } catch (e) {
        if (e.message.includes('Could not find')) {
          return 'fatal: not a git repository (run git init first)';
        }
        throw e;
      }
    };

    const add = async (filepath, dir = '/') => {
      await ensureGit();
      await git.add({ fs, dir, filepath });
      return '';
    };

    const commit = async (message, dir = '/') => {
      await ensureGit();

      const sha = await git.commit({
        fs,
        dir,
        message,
        author: {
          name: 'Reploid Agent',
          email: 'agent@reploid.local'
        }
      });

      return `[${sha.slice(0, 7)}] ${message}`;
    };

    const log = async (dir = '/', depth = 10) => {
      await ensureGit();

      try {
        const commits = await git.log({ fs, dir, depth });
        const results = [];

        for (const c of commits) {
          const date = new Date(c.commit.author.timestamp * 1000);
          results.push(`commit ${c.oid}`);
          results.push(`Author: ${c.commit.author.name} <${c.commit.author.email}>`);
          results.push(`Date:   ${date.toLocaleString()}`);
          results.push('');
          results.push(`    ${c.commit.message}`);
          results.push('');
        }

        return results.join('\n');
      } catch (e) {
        if (e.message.includes('Could not find')) {
          return 'fatal: your current branch does not have any commits yet';
        }
        throw e;
      }
    };

    const branch = async (name, dir = '/') => {
      await ensureGit();

      if (!name) {
        // List branches
        const branches = await git.listBranches({ fs, dir });
        const current = await git.currentBranch({ fs, dir });
        return branches.map(b => b === current ? `* ${b}` : `  ${b}`).join('\n');
      }

      // Create branch
      await git.branch({ fs, dir, ref: name });
      return '';
    };

    const checkout = async (ref, dir = '/') => {
      await ensureGit();
      await git.checkout({ fs, dir, ref });
      return `Switched to branch '${ref}'`;
    };

    const diff = async (dir = '/') => {
      await ensureGit();

      try {
        const matrix = await git.statusMatrix({ fs, dir });
        const results = [];

        for (const [filepath, head, workdir] of matrix) {
          if (head === 1 && workdir === 2) {
            // Modified file
            results.push(`diff --git a/${filepath} b/${filepath}`);
            results.push(`--- a/${filepath}`);
            results.push(`+++ b/${filepath}`);
            results.push('(content diff not implemented)');
            results.push('');
          }
        }

        return results.join('\n') || 'No changes';
      } catch (e) {
        return 'fatal: not a git repository';
      }
    };

    const currentBranch = async (dir = '/') => {
      await ensureGit();
      try {
        return await git.currentBranch({ fs, dir }) || 'HEAD detached';
      } catch (e) {
        return null;
      }
    };

    return {
      init,
      status,
      add,
      commit,
      log,
      branch,
      checkout,
      diff,
      currentBranch
    };
  }
};

export default GitTools;
