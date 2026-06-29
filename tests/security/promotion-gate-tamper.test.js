/**
 * Security Test: permission and genesis tampering is quarantined.
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

describe('promotion gate tamper quarantine', () => {
  it('quarantines genesis-level mutations', async () => {
    const candidatePath = '/shadow/genesis-levels.json';
    const targetPath = '/self/config/genesis-levels.json';
    const evidencePath = '/artifacts/genesis-evidence.json';
    const VFS = createMemoryVfs({
      [candidatePath]: '{"levels":{}}\n',
      [evidencePath]: JSON.stringify({
        candidatePath,
        targetPath,
        evidencePath,
        replayPassed: true
      })
    });

    const result = await promoteShadowCandidate({ candidatePath, targetPath, evidencePath }, { VFS });

    expect(result.quarantined).toBe(true);
    expect(result.promoted).toBe(false);
    expect(VFS.files.has(targetPath)).toBe(false);
    expect(VFS.files.has(result.quarantinePath)).toBe(true);
  });
});
