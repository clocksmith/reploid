/** Classify route diagnostics without treating optional service discovery as a broken page. */
export function httpResponseFailure({ url, status, method = 'GET' }, baseUrl) {
  if (status < 400) return null;
  const request = new URL(url);
  const base = new URL(baseUrl);
  // Browser credits are off when this origin does not publish the earning service.
  // Only this exact absence is optional: authentication, server and asset errors fail.
  if (method === 'GET' && status === 404 && request.origin === base.origin
    && request.pathname === '/v1/client') return null;
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
