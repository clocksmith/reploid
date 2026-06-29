/**
 * Security Test: candidates cannot approve their own promotion gate changes.
 */
import { describe, it, expect } from 'vitest';
import { promoteShadowCandidate } from '../../self/tools/Promote.js';

const createMemoryVfs = (entries = {}) => {
  const files = new Map(Object.entries(entries));
  return {
    files,
    exists: async (path) => files.has(path),
    read: async (path) => {
      if (!files.has(path)) throw new Error(`File not found: ${path}`);
      return files.get(path);
    },
    write: async (path, content) => {
      files.set(path, content);
      return true;
    }
  };
};

describe('self approval block', () => {
  it('quarantines direct Promote tool mutations', async () => {
    const candidatePath = '/shadow/Promote.js';
    const targetPath = '/self/tools/Promote.js';
    const evidencePath = '/artifacts/promote-evidence.json';
    const VFS = createMemoryVfs({
      [candidatePath]: 'export default async function() { return { ok: true }; }\n',
      [evidencePath]: JSON.stringify({
        candidatePath,
        targetPath,
        evidencePath,
        replayPassed: true
      })
    });

    const result = await promoteShadowCandidate({ candidatePath, targetPath, evidencePath }, { VFS });

    expect(result).toMatchObject({
      ok: false,
      promoted: false,
      quarantined: true,
      targetPath,
      reasons: ['validator mutation requires external review and cannot be self-approved']
    });
    expect(VFS.files.has(targetPath)).toBe(false);
  });
});
