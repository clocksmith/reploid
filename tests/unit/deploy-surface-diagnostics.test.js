import { describe, expect, it } from 'vitest';
import { consoleFailure, httpResponseFailure } from '../../scripts/deploy-surface-diagnostics.js';

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
  it('fails required modules and signaling/authentication responses without logging query secrets', () => {
    for (const [path, status] of [['/ui/pool-home/app.bundle.js', 404], ['/pool/signals?token=secret', 400], ['/rtc-config', 401]]) {
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
});
