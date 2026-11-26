// Which revision a deployment ships: exactly origin/main as fetched at deploy time, never the local
// `main` branch or the HEAD of the checkout the script runs from (either can be commits behind).

const COMMIT = /^[0-9a-f]{40}$/;

/** Parse deploy arguments: an optional `--ref <revision>`, `--ref=<revision>` or bare revision. */
export function parseDeployArgs(argv) {
  let ref;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    let value;
    if (arg === '--ref') value = argv[++index];
    else if (arg.startsWith('--ref=')) value = arg.slice('--ref='.length);
    else if (!arg.startsWith('-')) value = arg;
    else throw new Error(`Unknown deploy option ${arg}; usage: deploy.js [--ref <revision>]`);
    if (!value) throw new Error('--ref needs a revision');
    if (ref !== undefined) throw new Error('Give at most one revision to deploy');
    ref = value;
  }
  return { ref };
}

/**
 * Fetch origin/main and return its commit. `git(args)` runs git in the source checkout and resolves to
 * stdout, rejecting on a non-zero exit. A requested ref must name that same commit: a ref that is not
 * on origin/main, or is behind its tip, is refused rather than deployed.
 */
export async function resolveDeployRevision({ git, ref }) {
  await git(['fetch', '--quiet', 'origin', '+refs/heads/main:refs/remotes/origin/main']);
  const revision = String(await git(['rev-parse', '--verify', 'refs/remotes/origin/main^{commit}'])).trim();
  if (!COMMIT.test(revision)) throw new Error(`origin/main did not resolve to a commit (${revision})`);
  if (ref === undefined) return revision;
  let requested;
  try { requested = String(await git(['rev-parse', '--verify', `${ref}^{commit}`])).trim(); }
  catch { throw new Error(`--ref ${ref} does not name a commit in this checkout`); }
  if (requested === revision) return revision;
  const onMain = await git(['merge-base', '--is-ancestor', requested, revision]).then(() => true, () => false);
  if (onMain) throw new Error(`--ref ${ref} (${requested}) is behind origin/main ${revision}; deploy ships only origin/main as fetched`);
  throw new Error(`--ref ${ref} (${requested}) is not on origin/main ${revision}; push it to main first`);
}
