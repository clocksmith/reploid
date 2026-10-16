import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from '../../self/core/schema-validator.js';
import { createVfsProgressBinding } from '../../self/ui/components/vfs-progress.js';
import { tokensEqual } from '../../server/token-auth.js';
import { createAssignmentEntryReader } from '../../server/pool/routes/assignment-entry.js';
import { resetWizard, getState } from '../../self/ui/boot-wizard/state.js';

let dispose;
afterEach(() => dispose?.());

describe('shared cleanup contracts', () => {
  it('keeps schema chains independent and preserves object error paths', () => {
    const base = z.string().min(3);
    const optional = base.optional();
    expect(base.safeParse(undefined).success).toBe(false);
    expect(optional.parse(undefined)).toBeUndefined();
    expect(optional.nullable().parse(null)).toBeNull();
    expect(base.default('fallback').parse(undefined)).toBe('fallback');
    expect(() => optional.parse('a')).toThrow('at least 3');
    expect(() => z.object({ title: base }).parse({ title: 42 })).toThrow('title: Expected string');
    expect(z.literal('one').optional().parse(undefined)).toBeUndefined();
    expect(z.union([z.string(), z.number()]).optional().parse(undefined)).toBeUndefined();
    expect(z.record(z.string(), z.number()).optional().parse(undefined)).toBeUndefined();
  });

  it('creates fresh nested wizard state on reset', () => {
    resetWizard();
    getState().directConfig.apiKey = 'temporary-test-key';
    getState().detection.webgpu.supported = true;
    resetWizard();
    expect(getState().directConfig.apiKey).toBeNull();
    expect(getState().detection.webgpu.supported).toBe(false);
  });

  it('attaches progress once, ignores invalid updates, and releases the listener', () => {
    const onProgress = vi.fn();
    const binding = createVfsProgressBinding(onProgress);
    dispose = binding.dispose;
    binding.attachVfsProgressListener();
    binding.attachVfsProgressListener();
    window.dispatchEvent(new CustomEvent('reploid:vfs-seed-progress', { detail: { current: 2, total: 4 } }));
    expect(onProgress).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ percent: 50 }));
    binding.setVfsProgress(null);
    binding.dispose();
    window.dispatchEvent(new CustomEvent('reploid:vfs-seed-progress', { detail: { current: 4, total: 4 } }));
    expect(onProgress).toHaveBeenCalledTimes(1);
  });

  it('rejects non-string or unequal authentication tokens without coercion', () => {
    expect(tokensEqual('α-key', 'α-key')).toBe(true);
    expect(tokensEqual('same-length-a', 'same-length-b')).toBe(false);
    expect(tokensEqual('long', 'shorter')).toBe(false);
    expect(tokensEqual({ toString: () => 'token' }, 'token')).toBe(false);
    expect(tokensEqual(undefined, undefined)).toBe(false);
  });

  it('authenticates the recovered assignment rather than the stale first read', async () => {
    const store = { getAssignment: vi.fn().mockResolvedValueOnce({ jobId: 'old' })
      .mockResolvedValueOnce({ jobId: 'new', providerId: 'new-provider' }) };
    const recoverHostedAssignments = vi.fn().mockResolvedValue({ summary: { recovered: 1 } });
    const requireBoundRole = vi.fn().mockReturnValue(true);
    const result = await createAssignmentEntryReader({ store, recoverHostedAssignments, requireBoundRole })(
      { params: { assignmentId: 'a' } }, {});
    expect(recoverHostedAssignments).toHaveBeenCalledWith({ store, targetJobId: 'old' });
    expect(requireBoundRole.mock.calls[0][3]).toBe('new-provider');
    expect(result.assignment.jobId).toBe('new');
  });

  it('stops the route after a denied role', async () => {
    const reader = createAssignmentEntryReader({ store: { getAssignment: async () => ({ providerId: 'p' }) },
      recoverHostedAssignments: async () => ({ summary: {} }), requireBoundRole: () => false });
    expect(await reader({ params: { assignmentId: 'a' } }, {})).toBeNull();
  });
});
