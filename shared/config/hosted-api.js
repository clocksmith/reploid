/**
 * Where the page and hosts reach the hosted backend (pool coordinator, search, Zero Gemini, landing
 * counts). An empty apiOrigin keeps today's same-origin paths, which Firebase Hosting rewrites to Cloud
 * Run; the Cloudflare cutover sets it to the reploid-api Worker origin. Signaling and TURN credentials
 * are configured separately in swarm-bootstrap.json.
 */
import hostedApi from './hosted-api.json' with { type: 'json' };

export const HOSTED_API_ORIGIN = String(hostedApi.apiOrigin || '').replace(/\/$/, '');

/** Absolute URL on the API origin, or the same-origin path while apiOrigin is empty. */
export const hostedApiUrl = (path) => `${HOSTED_API_ORIGIN}${path}`;
