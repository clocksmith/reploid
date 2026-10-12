/** Discovery only: a page origin never grants execution or file access. */
export function allowsSwarmOrigin(origin, policy) {
  if (typeof origin !== 'string' || !origin) return false;
  if (policy.allowedOrigins.includes(origin)) return true;
  if (policy.allowLoopbackOrigins !== true) return false;
  try {
    const url = new URL(origin);
    // Require a serialized HTTP origin, never a suffix match or DNS lookup.
    return url.origin === origin && ['http:', 'https:'].includes(url.protocol)
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}
