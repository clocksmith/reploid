// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { coldFillProblem, planLoading, sharesModelFiles, validateApproval } from '../fixtures/fleet-journey-phases.js';

// Four machines: one supplies the fill, one holds the model without supplying it, one must wait for the
// operator because a live service is using its GPU, and one starts without the model.
const fleet = () => [
  { computerId: 'supplier', shareModelFiles: true },
  { computerId: 'holder', shareModelFiles: false },
  { computerId: 'busy', deferLoadUntilBarrier: true },
  { computerId: 'empty', fillFromPeers: true, requireColdFill: true }
];
const barrierConfig = { maxMinutesAfterPause: 12 };

describe('planLoading', () => {
  it('keeps the plain journey unchanged: every holder loads first and supplies the one that fills', () => {
    const plan = planLoading([{ computerId: 'a' }, { computerId: 'b' }, { computerId: 'c', fillFromPeers: true }]);
    expect(plan).toEqual({ holders: ['a', 'b'], filler: 'c', sources: ['a', 'b'], deferred: [], barrier: null });
    expect(planLoading([{ computerId: 'a' }, { computerId: 'b' }])).toMatchObject({ holders: ['a', 'b'], filler: null, deferred: [] });
  });

  it('loads a waiting provider after the barrier and never counts it, or a holder told not to share, as a fill source', () => {
    expect(planLoading(fleet(), barrierConfig)).toEqual({ holders: ['supplier', 'holder'], filler: 'empty', sources: ['supplier'], deferred: ['busy'],
      barrier: { maxMinutesAfterPause: 12, approvalFile: null } });
  });

  it('refuses a fill whose only supplier would still be waiting at the barrier', () => {
    const providers = fleet().map(spec => spec.computerId === 'supplier' ? { ...spec, deferLoadUntilBarrier: true } : spec);
    expect(() => planLoading(providers, barrierConfig)).toThrow(/no holder to fill from/);
  });

  it('refuses a waiting provider without a bounded window, and a window with nobody waiting', () => {
    expect(() => planLoading(fleet())).toThrow(/maxMinutesAfterPause/);
    expect(() => planLoading(fleet(), { maxMinutesAfterPause: 0 })).toThrow(/maxMinutesAfterPause/);
    expect(() => planLoading(fleet().filter(spec => spec.computerId !== 'busy'), barrierConfig)).toThrow(/no provider has deferLoadUntilBarrier/);
  });

  it('refuses lists no run could complete', () => {
    expect(() => planLoading([...fleet(), { computerId: 'second-empty', fillFromPeers: true }], barrierConfig)).toThrow(/At most one/);
    expect(() => planLoading(fleet().map(spec => spec.computerId === 'empty' ? { ...spec, deferLoadUntilBarrier: true } : spec), barrierConfig)).toThrow(/cannot both/);
    expect(() => planLoading([{ computerId: 'a', deferLoadUntilBarrier: true }, { computerId: 'b', deferLoadUntilBarrier: true }], barrierConfig)).toThrow(/At least one provider/);
    expect(() => planLoading([{ computerId: 'a' }, { computerId: 'a' }])).toThrow(/its own computerId/);
  });
});

describe('sharesModelFiles', () => {
  it('defaults to sharing for a holder and not for the one filling, and takes an explicit answer', () => {
    expect(sharesModelFiles({ computerId: 'a' })).toBe(true);
    expect(sharesModelFiles({ computerId: 'a', fillFromPeers: true })).toBe(false);
    expect(sharesModelFiles({ computerId: 'a', shareModelFiles: false })).toBe(false);
    expect(() => sharesModelFiles({ computerId: 'a', shareModelFiles: 'yes' })).toThrow(/true or false/);
  });
});

describe('validateApproval', () => {
  const now = Date.parse('2026-11-19T14:00:00.000Z');
  const barrier = { runId: 'run-1', barrierId: 'barrier-1', approvalToken: 'secret-token-of-this-run', manifestSha256: 'manifest-a', archiveSha256: 'archive-a', maxMinutesAfterPause: 12 };
  const answer = (changes = {}) => ({ approved: true, runId: 'run-1', barrierId: 'barrier-1', approvalToken: 'secret-token-of-this-run', manifestSha256: 'manifest-a',
    archiveSha256: 'archive-a', pauseUtc: '2026-11-19T13:59:30.000Z', ...changes });

  it('starts the window at the suspension, not at the moment the answer is read', () => {
    expect(validateApproval(answer(), barrier, now)).toEqual({ pauseUtc: '2026-11-19T13:59:30.000Z', deadline: Date.parse('2026-11-19T14:11:30.000Z') });
  });

  it('releases nothing for an answer written for another run, barrier or package', () => {
    for (const key of ['runId', 'barrierId', 'approvalToken', 'manifestSha256', 'archiveSha256']) {
      expect(() => validateApproval(answer({ [key]: 'something-else' }), barrier, now), key).toThrow(new RegExp('different ' + key));
      expect(() => validateApproval(answer({ [key]: undefined }), barrier, now), key).toThrow(new RegExp('different ' + key));
    }
    expect(() => validateApproval(answer({ approved: 'true' }), barrier, now)).toThrow(/approved: true/);
    expect(() => validateApproval(null, barrier, now)).toThrow(/approved: true/);
  });

  it('does not repeat either token in a refusal', () => {
    let message = '';
    try { validateApproval(answer({ approvalToken: 'a-guessed-token' }), barrier, now); } catch (error) { message = error.message; }
    expect(message).toMatch(/different approvalToken/);
    expect(message).not.toContain('secret-token-of-this-run');
    expect(message).not.toContain('a-guessed-token');
  });

  it('refuses a suspension time that is missing, stale or ahead of the clock', () => {
    expect(() => validateApproval(answer({ pauseUtc: undefined }), barrier, now)).toThrow(/needs pauseUtc/);
    expect(() => validateApproval(answer({ pauseUtc: 'soon' }), barrier, now)).toThrow(/needs pauseUtc/);
    expect(() => validateApproval(answer({ pauseUtc: '2026-11-19T13:57:59.000Z' }), barrier, now)).toThrow(/too old/);
    expect(() => validateApproval(answer({ pauseUtc: '2026-11-19T14:00:06.000Z' }), barrier, now)).toThrow(/in the future/);
    expect(validateApproval(answer({ pauseUtc: '2026-11-19T14:00:04.000Z' }), barrier, now).pauseUtc).toBe('2026-11-19T14:00:04.000Z');
  });

  it('accepts a package receipt without an archive digest only when the answer has none either', () => {
    const unarchived = { ...barrier, archiveSha256: null };
    expect(validateApproval(answer({ archiveSha256: undefined }), unarchived, now).deadline).toBeGreaterThan(now);
    expect(() => validateApproval(answer(), unarchived, now)).toThrow(/different archiveSha256/);
  });

  it('refuses to validate against a barrier that binds nothing', () => {
    expect(() => validateApproval(answer({ approvalToken: undefined }), { ...barrier, approvalToken: undefined }, now)).toThrow(/no approvalToken/);
  });
});

describe('coldFillProblem', () => {
  const filled = { fetchedBytes: 2087223456, fetchedPieces: 919, reusedPieces: 0, bySource: { 'authorized-custody-peers': 919 } };

  it('passes a fill that fetched everything from peers', () => {
    expect(coldFillProblem(filled)).toBeNull();
  });

  it('names what keeps a fill from being reported as cold', () => {
    expect(coldFillProblem(null)).toMatch(/no completion/);
    expect(coldFillProblem({ ...filled, fetchedBytes: 0 })).toMatch(/fetched nothing/);
    expect(coldFillProblem({ ...filled, reusedPieces: 4 })).toMatch(/zero reused/);
    expect(coldFillProblem({ ...filled, reusedPieces: null })).toMatch(/zero reused/);
    expect(coldFillProblem({ ...filled, bySource: { 'authorized-custody-peers': 900, 'model-origin': 19 } })).toMatch(/model-origin/);
  });
});
