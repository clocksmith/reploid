// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseDeployArgs, resolveDeployRevision } from '../../scripts/deploy-revision.js';

const TIP = '1'.repeat(40), OLD = '2'.repeat(40), OFF = '3'.repeat(40), LOCAL_MAIN = '4'.repeat(40);

// A git stand-in: origin/main is TIP once fetched; local `main` and HEAD lag behind; OLD is an
// ancestor of TIP and OFF is on another branch.
function fakeGit({ fetchFails = false } = {}) {
  const calls = [];
  let fetched = false;
  const commits = { main: LOCAL_MAIN, HEAD: LOCAL_MAIN, [TIP]: TIP, [OLD]: OLD, [OFF]: OFF, old: OLD, side: OFF };
  const git = async args => {
    calls.push(args);
    if (args[0] === 'fetch') { if (fetchFails) throw new Error('network'); fetched = true; return ''; }
    if (args[0] === 'rev-parse') {
      const name = args.at(-1).replace(/\^\{commit\}$/, '');
      if (name === 'refs/remotes/origin/main') return `${fetched ? TIP : LOCAL_MAIN}\n`;
      if (commits[name]) return `${commits[name]}\n`;
      throw new Error(`unknown revision ${name}`);
    }
    if (args[0] === 'merge-base') { if (args[2] === OLD && args[3] === TIP) return ''; throw new Error('not ancestor'); }
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  return { git, calls };
}

describe('deploy revision', () => {
  it('fetches and returns origin/main, not local main or HEAD', async () => {
    const { git, calls } = fakeGit();
    await expect(resolveDeployRevision({ git })).resolves.toBe(TIP);
    expect(calls[0]).toEqual(['fetch', '--quiet', 'origin', '+refs/heads/main:refs/remotes/origin/main']);
  });

  it('accepts a ref that names the fetched tip', async () => {
    await expect(resolveDeployRevision({ git: fakeGit().git, ref: TIP })).resolves.toBe(TIP);
  });

  it('refuses a ref behind origin/main', async () => {
    await expect(resolveDeployRevision({ git: fakeGit().git, ref: 'old' })).rejects.toThrow(/is behind origin\/main/);
  });

  it('refuses a ref that is not on origin/main', async () => {
    await expect(resolveDeployRevision({ git: fakeGit().git, ref: 'side' })).rejects.toThrow(/is not on origin\/main/);
  });

  it('refuses an unknown ref and a failed fetch', async () => {
    await expect(resolveDeployRevision({ git: fakeGit().git, ref: 'nope' })).rejects.toThrow(/does not name a commit/);
    await expect(resolveDeployRevision({ git: fakeGit({ fetchFails: true }).git })).rejects.toThrow(/network/);
  });

  it('parses --ref forms and rejects unknown options', () => {
    expect(parseDeployArgs([])).toEqual({ ref: undefined });
    expect(parseDeployArgs(['--ref', 'abc'])).toEqual({ ref: 'abc' });
    expect(parseDeployArgs(['--ref=abc'])).toEqual({ ref: 'abc' });
    expect(parseDeployArgs(['abc'])).toEqual({ ref: 'abc' });
    expect(() => parseDeployArgs(['--ref'])).toThrow(/needs a revision/);
    expect(() => parseDeployArgs(['a', 'b'])).toThrow(/at most one/);
    expect(() => parseDeployArgs(['--force'])).toThrow(/Unknown deploy option/);
  });
});
