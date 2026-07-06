/**
 * @fileoverview Unit tests for Promote tool argument handling.
 */

import { describe, it, expect, vi } from 'vitest';
import { promoteShadowCandidate } from '../../../self/tools/Promote.js';

const createMemoryVfs = (entries = {}) => {
  const files = new Map(Object.entries(entries));
  return {
    files,
    exists: vi.fn(async (path) => files.has(path)),
    read: vi.fn(async (path) => {
      if (!files.has(path)) throw new Error(`File not found: ${path}`);
      return files.get(path);
    }),
    write: vi.fn(async (path, content) => {
      files.set(path, content);
      return true;
    })
  };
};

describe('Promote', () => {
  it('accepts source, target, and evidence aliases for the canonical paths', async () => {
    const candidatePath = '/shadow/tools/KatamariEngine.js';
    const targetPath = '/self/tools/KatamariEngine.js';
    const evidencePath = '/artifacts/KatamariEngine-evidence.json';
    const code = 'export default async function() { return { ok: true }; }\n';
    const VFS = createMemoryVfs({
      [candidatePath]: code,
      [evidencePath]: JSON.stringify({
        candidatePath,
        targetPath,
        evidencePath,
        replayPassed: true
      })
    });

    const result = await promoteShadowCandidate({
      source: candidatePath,
      target: targetPath,
      evidence: evidencePath
    }, { VFS });

    expect(result).toMatchObject({
      ok: true,
      promoted: true,
      candidatePath,
      targetPath,
      evidencePath
    });
    expect(VFS.files.get(targetPath)).toBe(code);
  });

  it('returns actionable reasons for missing evidence and invalid targets', async () => {
    const VFS = createMemoryVfs({
      '/shadow/tools/KatamariEngine.js': 'export default async function() { return {}; }\n'
    });

    const result = await promoteShadowCandidate({
      source: '/shadow/tools/KatamariEngine.js',
      target: '/tools/KatamariEngine.js'
    }, { VFS });

    expect(result).toMatchObject({
      ok: false,
      promoted: false,
      candidatePath: '/shadow/tools/KatamariEngine.js',
      targetPath: '/tools/KatamariEngine.js',
      evidencePath: ''
    });
    expect(result.reasons).toContain('targetPath must be under /self');
    expect(result.reasons.join('\n')).toContain('evidencePath missing');
    expect(VFS.files.has('/tools/KatamariEngine.js')).toBe(false);
  });
});
