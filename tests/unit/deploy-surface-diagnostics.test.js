import { describe, expect, it } from 'vitest';
import {
  consoleFailure,
  httpResponseFailure,
  isTurnCredentialRequest,
  selfInflictedTurnRefusal,
  turnBudgetWaitMs
} from '../../scripts/deploy-surface-diagnostics.js';
import policy from '../../server/cloudflare/policy.json' with { type: 'json' };

describe('deployment route diagnostics', () => {
  const base = 'https://replo.id';
  const check = (path, status, method = 'GET') => httpResponseFailure({ url: `${base}${path}`, status, method }, base);
  it('accepts only an absent same-origin optional earning service', () => {
    expect(check('/v1/client', 404)).toBeNull();
    expect(check('/v1/client', 200)).toBeNull();
    expect(check('/v1/client', 401)).toContain('HTTP 401');
    expect(check('/v1/client', 500)).toContain('HTTP 500');
    expect(check('/v1/client', 404, 'POST')).toContain('HTTP 404');
    expect(httpResponseFailure({ url: 'https://other.test/v1/client', status: 404 }, base)).toContain('HTTP 404');
  });
  it('accepts only an absent self-serve discovery route, not the rest of /v1/fleet', () => {
    expect(check('/v1/fleet/client', 404)).toBeNull();
    expect(check('/v1/fleet/client', 500)).toContain('HTTP 500');
    expect(check('/v1/fleet/client', 404, 'POST')).toContain('HTTP 404');
    expect(check('/v1/fleet/account', 404)).toContain('HTTP 404');
    expect(check('/v1/fleet', 404)).toContain('HTTP 404');
    expect(httpResponseFailure({ url: 'https://other.test/v1/fleet/client', status: 404 }, base)).toContain('HTTP 404');
  });
  it('fails required modules and signaling/authentication responses without logging query secrets', () => {
    for (const [path, status] of [['/ui/react/app.js', 404], ['/pool/signals?token=secret', 400], ['/rtc-config', 401]]) {
      const failure = check(path, status);
      expect(failure).toContain(`HTTP ${status}`);
      expect(failure).not.toContain('secret');
    }
  });
  it('reports warning-level peer churn separately and retains real console errors', () => {
    expect(consoleFailure('warning', '[WARN] [WebRTCSwarm] Target peer is not in this namespace')).toBeNull();
    expect(consoleFailure('error', '[ERROR] [WebRTCSwarm] Data channel error with peer-1: RTCErrorEvent')).toBeNull();
    expect(consoleFailure('error', 'Firebase auth token required')).toContain('Firebase auth token required');
    expect(consoleFailure('error', '[ERROR] [WebRTCSwarm] Initialization failed')).toContain('Initialization failed');
  });
  it('checks HTTP failures by response rather than duplicated anonymous browser console text', () => {
    expect(consoleFailure('error', 'Failed to load resource: the server responded with a status of 401 ()')).toBeNull();
    expect(check('/pool/signals', 401)).toContain('HTTP 401');
    expect(consoleFailure('error', 'Failed to load resource: net::ERR_CONNECTION_REFUSED')).toContain('ERR_CONNECTION_REFUSED');
  });

  it('identifies the TURN credential route on the signaling Worker and the API', () => {
    expect(isTurnCredentialRequest('https://reploid-swarm.reploid.workers.dev/rtc-config')).toBe(true);
    expect(isTurnCredentialRequest('https://api.test/pool/rtc-config?x=1')).toBe(true);
    expect(isTurnCredentialRequest('https://replo.id/compute')).toBe(false);
  });
});

describe('TURN credential pacing for the route check', () => {
  const budget = { turnPerSubject: 6, turnWindowMs: 60000 };
  it('loads at once while the visitor has room and waits for the oldest request to leave the window', () => {
    expect(turnBudgetWaitMs([], 0, budget, 2)).toBe(0);
    expect(turnBudgetWaitMs([0, 1000, 2000, 3000], 4000, budget, 2)).toBe(0);
    // Five recent requests leave room for one; a two-request load waits for the first to expire.
    expect(turnBudgetWaitMs([0, 1000, 2000, 3000, 4000], 5000, budget, 2)).toBe(55000);
    expect(turnBudgetWaitMs([0, 1000, 2000, 3000, 4000, 5000], 6000, budget, 2)).toBe(55000);
    // Requests older than the window no longer count.
    expect(turnBudgetWaitMs([0, 1000, 2000, 3000, 4000], 61000, budget, 2)).toBe(0);
  });
  it('never lets a paced sequence of loads exceed the Worker budget in any window', () => {
    const times = [];
    let now = 0;
    for (let load = 0; load < 30; load += 1) {
      now += turnBudgetWaitMs(times, now, policy, 2);
      times.push(now, now + 10);
      now += 3000;
    }
    for (const start of times) {
      expect(times.filter((time) => time >= start && time - start < policy.turnWindowMs).length).toBeLessThanOrEqual(policy.turnPerSubject);
    }
  });
  it('blames a refusal on the check only when this visitor was admitted its whole budget in the window', () => {
    expect(selfInflictedTurnRefusal([0, 1, 2, 3, 4, 5], 10, budget)).toBe(true);
    expect(selfInflictedTurnRefusal([0, 1, 2, 3, 4], 10, budget)).toBe(false);
    expect(selfInflictedTurnRefusal([0, 1, 2, 3, 4, 5], 60001, budget)).toBe(false);
  });
});
