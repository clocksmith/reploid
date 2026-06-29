/**
 * Security Test: validator mutations are quarantined.
 */
import { describe, it, expect, vi } from 'vitest';
import { promoteShadowCandidate } from '../../self/tools/Promote.js';

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

const createEvidence = (candidatePath, targetPath, evidencePath) => JSON.stringify({
  candidatePath,
  targetPath,
  evidencePath,
  replayPassed: true
});

describe('validator quarantine', () => {
  it('quarantines VerificationManager mutations instead of promoting them', async () => {
    const candidatePath = '/shadow/verification-manager.js';
    const targetPath = '/self/core/verification-manager.js';
    const evidencePath = '/artifacts/verification-manager-evidence.json';
    const VFS = createMemoryVfs({
      [candidatePath]: 'export default {};\n',
      [evidencePath]: createEvidence(candidatePath, targetPath, evidencePath)
    });
    const EventBus = { emit: vi.fn() };
    const AuditLogger = { logEvent: vi.fn() };

    const result = await promoteShadowCandidate({ candidatePath, targetPath, evidencePath }, {
      VFS,
      EventBus,
      AuditLogger
    });

    expect(result).toMatchObject({
      ok: false,
      promoted: false,
      quarantined: true,
      targetPath
    });
    expect(VFS.files.has(targetPath)).toBe(false);
    expect(VFS.files.has(result.quarantinePath)).toBe(true);
    expect(JSON.parse(VFS.files.get(result.quarantinePath))).toMatchObject({
      schema: 'reploid/validator-quarantine/v1',
      targetPath,
      quarantined: true
    });
    expect(EventBus.emit).toHaveBeenCalledWith('promotion:quarantined', expect.objectContaining({ targetPath }));
    expect(AuditLogger.logEvent).toHaveBeenCalledWith('PROMOTE_QUARANTINED', expect.any(Object), 'WARN');
  });
});
