import { describe, expect, it, vi } from 'vitest';
import { prepareLocalPackRelease } from '../../self/pool/pack-release-policy.js';

// Synthetic verification objects isolate application checkpoint ownership.
const digest = letter => `sha256:${letter.repeat(64)}`;
const model = { executablePack: { schema: 'doppler.pack/v3' }, application: { applicationId: 'documents' },
  packOpenOptions: { releaseEvents: [{ signature: { authority: 'publisher' } }],
    releasePolicy: { minimumSequence: 1, now: '2000-01-01T00:00:00.000Z', checkpoint: { sequence: 99, digest: digest('a') } } } };

describe('local Pack release policy', () => {
  it('uses saved checkpoints and current time, then checks cached sessions against newer history', async () => {
    let checkpoint = { sequence: 0, digest: null };
    let clock = Date.parse('2026-09-06T00:00:00.000Z');
    const storage = { read: vi.fn(async () => checkpoint), advance: vi.fn(async (_key, prior, next) => {
      expect(prior).toEqual(checkpoint); checkpoint = next; return checkpoint;
    }), close: vi.fn() };
    const policy = await prepareLocalPackRelease({ model, now: () => clock, openCheckpoints: async () => storage });
    expect(policy.options.releasePolicy).toEqual({ minimumSequence: 1, now: new Date(clock).toISOString(), checkpoint });
    const accepted = { sequence: 1, digest: digest('b') };
    await policy.options.persistReleaseCheckpoint(accepted);
    const session = { verification: { lifecycle: { event: { sequence: 1, issuedAtUtc: '2026-09-05T00:00:00.000Z',
      expiresAtUtc: '2026-09-07T00:00:00.000Z' }, checkpoint: accepted } } };
    await policy.assertCurrent(session);
    checkpoint = { sequence: 2, digest: digest('c') };
    await expect(policy.assertCurrent(session)).rejects.toThrow('checkpoint changed');
    clock = Date.parse('2026-09-07T00:00:00.000Z');
    expect(() => policy.checkTime(session)).toThrow('expired');
    clock = Date.parse('2026-09-04T00:00:00.000Z');
    expect(() => policy.checkTime(session)).toThrow('future');
    policy.close();
    expect(storage.close).toHaveBeenCalledOnce();
  });

  it('closes storage on failed reads and refuses missing lifecycle policy', async () => {
    const storage = { read: async () => { throw new Error('Disk unavailable'); }, close: vi.fn() };
    await expect(prepareLocalPackRelease({ model, openCheckpoints: async () => storage })).rejects.toThrow('Disk unavailable');
    expect(storage.close).toHaveBeenCalledOnce();
    await expect(prepareLocalPackRelease({ model: { ...model, packOpenOptions: {} } })).rejects.toThrow('authority');
  });
});
