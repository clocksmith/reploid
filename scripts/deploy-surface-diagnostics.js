const OPTIONAL_DISCOVERY_PATHS = new Set(['/v1/client', '/v1/fleet/client']);

/** Classify route diagnostics without treating optional service discovery as a broken page. */
export function httpResponseFailure({ url, status, method = 'GET' }, baseUrl) {
  if (status < 400) return null;
  const request = new URL(url);
  const base = new URL(baseUrl);
  // Browser credits are off when this origin does not publish the earning service, and the
  // self-serve account is off when it does not publish GET /v1/fleet/client (fleet-account.js).
  // Only these exact absences are optional: authentication, server and asset errors fail.
  if (method === 'GET' && status === 404 && request.origin === base.origin
    && OPTIONAL_DISCOVERY_PATHS.has(request.pathname)) return null;
  return `${method} ${request.origin}${request.pathname}: HTTP ${status}`;
}

export function consoleFailure(type, text) {
  if (type !== 'error') return null;
  // Responses are checked with their URL/status separately, including 400 and 401.
  if (/^Failed to load resource: the server responded with a status of \d+/.test(text)) return null;
  // A remote channel can close while the public swarm is negotiating. This is
  // transport evidence, not an uncaught application exception or layout failure.
  if (/^\[ERROR\] \[WebRTCSwarm\] Data channel error with [^:]+: RTCErrorEvent$/.test(text)) return null;
  return `${type}: ${text}`;
}
