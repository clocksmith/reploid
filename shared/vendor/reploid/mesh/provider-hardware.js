/** Bounded, self-reported GPU metadata. Never an identity or an admission input. */
export function publicProviderHardware(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const key of ['vendor', 'architecture', 'device', 'description']) {
    if (typeof value[key] !== 'string') continue;
    const text = value[key].replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160);
    if (text) result[key] = text;
  }
  return Object.keys(result).length ? result : null;
}
