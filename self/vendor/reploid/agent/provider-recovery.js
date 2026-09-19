/** @typedef {{status?: number, statusCode?: number, retryAfterMs?: number, retryAfter?: string | number, message?: string, details?: ProviderFailure}} ProviderFailure */
/** @param {unknown} error @returns {ProviderFailure} */
const failure = error => error && typeof error === 'object' ? error : { message: String(error) };
export const TRANSIENT_PROVIDER_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
/** @param {unknown} input */
export function getProviderErrorStatus(input) {
  const error = failure(input);
  const direct = Number(error?.status ?? error?.details?.status ?? error?.details?.statusCode);
  if (Number.isFinite(direct)) return direct;
  const match = String(failure(error).message || error || '').match(/\b([45]\d\d)\b/);
  return match ? Number(match[1]) : null;
}
/** @param {unknown} input @param {number} [now] */
export function getProviderRetryAfterMs(input, now = Date.now()) {
  const error = failure(input);
  const direct = Number(error?.retryAfterMs ?? error?.details?.retryAfterMs);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const retryAfter = error?.retryAfter ?? error?.details?.retryAfter;
  if (retryAfter !== undefined && retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const retryAt = Date.parse(String(retryAfter));
    if (Number.isFinite(retryAt)) return Math.max(0, retryAt - now);
  }
  const match = String(failure(error).message || error || '').match(/retry in\s+([0-9]+(?:\.[0-9]+)?)\s*(ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?)?/i);
  if (!match) return null;
  const unit = (match[2] || 's').toLowerCase();
  return Math.ceil(Number(match[1]) * (unit.startsWith('ms') || unit.startsWith('millisecond') ? 1 : unit.startsWith('m') ? 60000 : 1000));
}
/** @param {unknown} error @param {{baseMs: number, maxMs: number, attempt?: number, jitterRatio?: number, random?: () => number}} options */
export function providerRetryDelay(error, { baseMs, maxMs, attempt = 0, jitterRatio = 0, random = Math.random }) {
  const explicit = getProviderRetryAfterMs(error);
  const base = Math.min(maxMs, baseMs * 2 ** Math.max(0, Math.floor(attempt)));
  return Math.min(maxMs, Math.max(0, Math.floor(explicit ?? base + base * jitterRatio * random())));
}
/** @param {unknown} error */
export function isTransientProviderFailure(error) {
  const status = getProviderErrorStatus(error);
  if (status !== null) return TRANSIENT_PROVIDER_STATUSES.has(status);
  return /quota|rate[-\s]?limit|too many requests|resource exhausted|retry in/i.test(String(failure(error).message || error || ''));
}
