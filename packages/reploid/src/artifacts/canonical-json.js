/**
 * @fileoverview Canonical JSON serialization shared across Poolday runtimes.
 */

/**
 * Canonical JSON whose object keys follow `compare`; without one, keys sort by
 * UTF-16 code units, as Array.prototype.sort does.
 */
export function canonicalizeWith(compare) {
  const serialize = (value) => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
      return `[${value.map((item) => serialize(item)).join(',')}]`;
    }
    const keys = Object.keys(value).sort(compare);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(value[key])}`).join(',')}}`;
  };
  return serialize;
}

export const canonicalize = canonicalizeWith();

export default canonicalize;
