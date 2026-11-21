// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  PUBLIC_CHALLENGE_MAX_OUTPUT_TOKENS,
  createPublicChallengeGate,
  derivePublicChallengeCaps
} from '../../server/circles/public-challenge-gate.js';

const MODEL = `sha256:${'e'.repeat(64)}`;
const PROJECT_HOST = {
  hostPeerId: 'peer:project-host-1',
  hostLabel: 'Reploid Project Host 1',
  modelIdentity: MODEL,
  tier: 'project',
  maxConcurrent: 2
};

describe('Wave 2 public challenge gate', () => {
  it('derives host rate caps from measured attempts per minute and enforces <= 16 token ceiling', () => {
    const caps = derivePublicChallengeCaps({
      measuredAttemptsPerMinute: 15,
      hostCount: 1,
      safetyFactor: 0.8,
      maxTurnsPerVisitor: 3
    });
    expect(caps.perHostAttemptsPerMinute).toBe(12);
    expect(caps.maxOutputTokens).toBe(PUBLIC_CHALLENGE_MAX_OUTPUT_TOKENS);
    expect(caps.maxOutputTokens).toBe(16);
    expect(caps.estimatedTurnMs).toBe(4000);
  });

  it('defaults to replay-only, rejects open public chat, enforces caps and >20s wait, and returns to replay-only on kill switch', () => {
    let time = 1_000_000;
    const caps = derivePublicChallengeCaps({ measuredAttemptsPerMinute: 10, maxTurnsPerVisitor: 2, safetyFactor: 0.5 });
    // perHostAttemptsPerMinute = 5, estimatedTurnMs = 6000
    const gate = createPublicChallengeGate({
      enabled: false,
      host: PROJECT_HOST,
      caps,
      maxExpectedWaitMs: 20_000,
      now: () => time
    });

    // Off by default: challenge requests get replay-only and open chat is explicitly forbidden.
    expect(gate.status().mode).toBe('replay-only');
    expect(gate.admit({ kind: 'daily-challenge', visitorId: 'v1', modelIdentity: MODEL, maxOutputTokens: 16 }))
      .toMatchObject({ admitted: false, code: 'CHALLENGE_REPLAY_ONLY', fallback: ['replay', 'host-your-own'] });
    expect(() => gate.admit({ kind: 'open-chat', visitorId: 'v1', modelIdentity: MODEL, maxOutputTokens: 16 }))
      .toThrow(/Open public chat is disabled/);

    // Switch Wave 2 challenge lane on.
    gate.setEnabled(true);
    expect(gate.status().mode).toBe('public-challenge');
    expect(gate.status().openChatAllowed).toBe(false);

    // > 16 output tokens rejected even when enabled.
    expect(() => gate.admit({ kind: 'daily-challenge', visitorId: 'v1', modelIdentity: MODEL, maxOutputTokens: 17 }))
      .toThrow(/hard-capped at 16/);

    // Valid turn succeeds with explicit host disclosure.
    const r1 = gate.admit({ kind: 'daily-challenge', visitorId: 'v1', modelIdentity: MODEL, maxOutputTokens: 16, challengeDay: '2026-11-21' });
    expect(r1.admitted).toBe(true);
    expect(r1.disclosure.readableBy).toBe('Readable by: Reploid Project Host 1');
    expect(r1.disclosure.notice).toBe('This runs on Reploid Project Host 1. Its operator can read your prompt.');
    const r2 = gate.admit({ kind: 'daily-challenge', visitorId: 'v1', modelIdentity: MODEL, maxOutputTokens: 16, challengeDay: '2026-11-21' });
    expect(r2.admitted).toBe(true);

    // Host concurrency (maxConcurrent = 2) blocks 3rd concurrent request.
    expect(gate.admit({ kind: 'daily-challenge', visitorId: 'v2', modelIdentity: MODEL, maxOutputTokens: 16, challengeDay: '2026-11-21' }))
      .toMatchObject({ admitted: false, code: 'CHALLENGE_CAPACITY_FULL', fallback: ['replay', 'host-your-own'] });

    r1.release();
    r2.release();

    // Per-visitor cap (maxTurnsPerVisitor = 2) blocks v1's 3rd turn.
    expect(gate.admit({ kind: 'daily-challenge', visitorId: 'v1', modelIdentity: MODEL, maxOutputTokens: 16, challengeDay: '2026-11-21' }))
      .toMatchObject({ admitted: false, code: 'CHALLENGE_VISITOR_CAP' });

    // Fill remaining per-minute host cap (3 more turns across v2, v3, v4 -> total 5).
    for (const id of ['v2', 'v3', 'v4']) {
      const r = gate.admit({ kind: 'daily-challenge', visitorId: id, modelIdentity: MODEL, maxOutputTokens: 16, challengeDay: '2026-11-21' });
      expect(r.admitted).toBe(true);
      r.release();
    }
    expect(gate.admit({ kind: 'daily-challenge', visitorId: 'v5', modelIdentity: MODEL, maxOutputTokens: 16, challengeDay: '2026-11-21' }))
      .toMatchObject({ admitted: false, code: 'CHALLENGE_HOST_RATE_CAP', fallback: ['replay', 'host-your-own'] });

    // Advance minute window and flip kill switch: immediately returns to replay-only.
    time += 61_000;
    gate.setKillSwitch(true);
    expect(gate.status().mode).toBe('replay-only');
    expect(gate.admit({ kind: 'daily-challenge', visitorId: 'v5', modelIdentity: MODEL, maxOutputTokens: 16 }))
      .toMatchObject({ admitted: false, code: 'CHALLENGE_REPLAY_ONLY', fallback: ['replay', 'host-your-own'] });
  });

  it('rejects unapproved community hosts, forbids unauthorized rented GPU spend, and falls back past 20s expected wait', () => {
    const caps = derivePublicChallengeCaps({ measuredAttemptsPerMinute: 2, maxTurnsPerVisitor: 3 }); // estimatedTurnMs = 30_000 > 20_000
    expect(() => createPublicChallengeGate({
      enabled: true,
      host: { ...PROJECT_HOST, tier: 'rented' },
      caps
    })).toThrow(/Rented GPU hosts are disabled/);

    expect(() => createPublicChallengeGate({
      enabled: true,
      host: { ...PROJECT_HOST, tier: 'community' },
      caps
    })).toThrow(/approved-host rules/);

    const approved = createPublicChallengeGate({
      enabled: true,
      host: { ...PROJECT_HOST, tier: 'community', approved: true },
      approvedCommunityHostRule: host => host.approved === true,
      caps,
      maxExpectedWaitMs: 20_000
    });
    expect(approved.admit({ kind: 'daily-challenge', visitorId: 'v1', modelIdentity: MODEL, maxOutputTokens: 16 }))
      .toMatchObject({ admitted: false, code: 'CHALLENGE_WAIT_EXCEEDED', fallback: ['replay', 'host-your-own'] });
  });
});
