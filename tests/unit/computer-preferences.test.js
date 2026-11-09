import { describe, it, expect, vi } from 'vitest';
import { createComputerPreferences } from '../../apps/poolday/host/computer-preferences.js';
import policy from '../../packages/reploid/src/mesh/gpu-signature.policy.json' with { type: 'json' };

const key = 'peer:' + 'a'.repeat(24);
const storage = () => { const values = new Map(); return { getItem: name => values.get(name) ?? null,
  setItem: (name, value) => values.set(name, value) }; };
const sample = () => ({ schema: policy.schema, profile: policy.profile, status: 'measured', source: 'local-webgpu',
  collectedAt: '2026-11-09T12:00:00.000Z', workgroups: policy.workgroups, trials: policy.trials,
  samples: policy.seeds.map((seed, workload) => ({ seed, workload,
    orders: Array.from({ length: policy.trials }, () => Array.from({ length: policy.workgroups }, (_, i) => i)) })) });

describe('Local computer preferences', () => {
  it('does no GPU or identity work on construction, and requires an explicit GPU action', async () => {
    const capture = vi.fn(), verifyPeer = vi.fn();
    const preferences = createComputerPreferences({ storage: storage(), capture, verifyPeer });
    expect(capture).not.toHaveBeenCalled(); expect(verifyPeer).not.toHaveBeenCalled();
    await expect(preferences.measure()).rejects.toThrow('Approve');
    expect(capture).not.toHaveBeenCalled();
  });
  it('saves a nickname only after channel verification, and restores or clears it by full key', async () => {
    const store = storage();
    const preferences = createComputerPreferences({ storage: store, verifyPeer: async () => key });
    await preferences.rename('wire-a', 'Desk');
    expect(preferences.getState().names).toEqual({ [key]: 'Desk' });
    const restored = createComputerPreferences({ storage: store, verifyPeer: async () => key });
    expect(restored.getState().names).toEqual({ [key]: 'Desk' });
    await restored.rename('wire-b', '');
    expect(restored.getState().names).toEqual({});
    const invalid = createComputerPreferences({ storage: store, verifyPeer: async () => null });
    await expect(invalid.rename('unknown', 'Wrong')).rejects.toThrow('verified');
    expect(invalid.getState().names).toEqual({});
  });
  it('keeps capture separate from saving and reports even identical comparisons as uncertain', async () => {
    const store = storage(), capture = vi.fn(async () => sample());
    const preferences = createComputerPreferences({ storage: store, capture });
    await preferences.measure({ consent: true });
    expect(capture.mock.calls[0][1].consent).toBe(true);
    expect(createComputerPreferences({ storage: store }).getState().baselineAt).toBeNull();
    preferences.saveBaseline();
    expect(preferences.getState().baselineFromCurrent).toBe(true);
    const restored = createComputerPreferences({ storage: store, capture });
    expect(restored.getState().baselineAt).toBe(sample().collectedAt);
    await restored.measure({ consent: true });
    expect(restored.getState().baselineFromCurrent).toBe(false);
    expect(restored.getState().comparison).toMatchObject({ status: 'uncertain', distance: 0, reason: 'calibration-required' });
    restored.clearBaseline();
    expect(createComputerPreferences({ storage: store }).getState().baselineAt).toBeNull();
  });
  it('does not report a saved name when persistence fails', async () => {
    const preferences = createComputerPreferences({ storage: { getItem: () => null, setItem() { throw new Error('Quota reached'); } }, verifyPeer: async () => key });
    await expect(preferences.rename('wire', 'Desk')).rejects.toThrow('Quota');
    expect(preferences.getState()).toMatchObject({ names: {}, error: 'Quota reached' });
  });
  it('does not offer an old measurement after a later check fails', async () => {
    const capture = vi.fn().mockResolvedValueOnce(sample()).mockRejectedValueOnce(new Error('Device lost'));
    const preferences = createComputerPreferences({ storage: storage(), capture });
    await preferences.measure({ consent: true });
    await expect(preferences.measure({ consent: true })).rejects.toThrow('Device lost');
    expect(preferences.getState().canSave).toBe(false);
    expect(() => preferences.saveBaseline()).toThrow('Run a GPU check');
  });
  it('rejects a different identity returned for the displayed computer', async () => {
    const preferences = createComputerPreferences({ storage: storage(), verifyPeer: async () => 'peer:' + 'b'.repeat(24) });
    await expect(preferences.rename('reused-wire', 'Desk', { participantId: key })).rejects.toThrow('another computer');
    expect(preferences.getState().names).toEqual({});
  });
  it('waits for cancelled capture cleanup and rejects a late sample', async () => {
    let finish, receivedSignal;
    const capture = vi.fn((_, { signal }) => { receivedSignal = signal; return new Promise(resolve => { finish = resolve; }); });
    const preferences = createComputerPreferences({ storage: storage(), capture });
    const measured = preferences.measure({ consent: true });
    await Promise.resolve();
    let settled = false;
    const closing = preferences.close().then(() => { settled = true; });
    expect(receivedSignal.aborted).toBe(true);
    await Promise.resolve(); expect(settled).toBe(false);
    finish(sample());
    await expect(measured).rejects.toMatchObject({ name: 'AbortError' });
    await closing;
    expect(preferences.getState().latest).toBeNull();
  });
  it('rejects a malformed saved signature instead of presenting a comparison', () => {
    const store = storage(), preferences = createComputerPreferences({ storage: store });
    expect(preferences.getState().comparison.status).toBe('unmeasured');
    const raw = JSON.stringify({ schema: 'poolday.computer-preferences/v1', names: {}, baseline: { status: 'measured', profile: 'fabricated', schema: 'fabricated' } });
    let replacement;
    const restored = createComputerPreferences({ storage: { getItem: () => raw, setItem: (_, value) => { replacement = value; } } });
    expect(restored.getState().error).toMatch(/invalid|signature/i);
    expect(restored.getState().baselineAt).toBeNull();
    expect(restored.getState().baselineStored).toBe(true);
    restored.clearBaseline();
    expect(restored.getState().baselineStored).toBe(false);
    expect(JSON.parse(replacement).baseline).toBeNull();
  });
});
