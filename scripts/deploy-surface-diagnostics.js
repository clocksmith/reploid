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

/** Whether a response or request is the signaling Worker's TURN credential route. */
export const isTurnCredentialRequest = (url) => new URL(url).pathname.endsWith('/rtc-config');

/**
 * The route check is one anonymous visitor, and every page load asks the signaling Worker for TURN
 * credentials once. The Worker admits `turnPerSubject` of those per `turnWindowMs` for one visitor
 * (server/cloudflare/policy.json), fewer than the check's page loads. Before another load, wait
 * until the visitor's own requests in the window leave room for that load's `perLoad` requests.
 */
export function turnBudgetWaitMs(requestTimes, now, { turnPerSubject, turnWindowMs }, perLoad = 1) {
  const recent = requestTimes.filter((time) => now - time < turnWindowMs).sort((a, b) => a - b);
  const excess = recent.length + perLoad - turnPerSubject;
  if (excess <= 0) return 0;
  // The request that must leave the window for this load to fit; a load that cannot fit at all waits out the window.
  const leaving = recent[Math.min(excess, recent.length) - 1];
  return leaving === undefined ? 0 : Math.max(0, leaving + turnWindowMs - now);
}

/**
 * A TURN refusal is the check's own doing only when this visitor alone had already been admitted
 * its whole per-visitor budget within the window before the refusal. Otherwise it came from the
 * Worker's total budget across visitors, or a fault, and remains a failure.
 */
export function selfInflictedTurnRefusal(admittedTimes, refusedAt, { turnPerSubject, turnWindowMs }) {
  return admittedTimes.filter((time) => time <= refusedAt && refusedAt - time < turnWindowMs).length >= turnPerSubject;
}
