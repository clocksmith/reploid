/**
 * @fileoverview Canonical JSON serialization shared across Poolday runtimes.
 */

/**
 * Canonical JSON whose object keys follow `compare`; without one, keys sort by
 * UTF-16 code units, as Array.prototype.sort does. Signed records must contain
 * JSON values. The explicit `json` mode retains general server JSON's undefined
 * normalization: omit object members and use null for array/top-level values.
 */
export function canonicalizeWith(compare, { undefinedValues = 'reject' } = {}) {
  if (!['reject', 'json'].includes(undefinedValues)) throw new TypeError('Unknown canonical JSON undefined policy');
  const active = new Set();
  const serialize = (value) => {
    if (value === undefined && undefinedValues === 'json') return 'null';
    if (value === null || typeof value !== 'object') {
      const encoded = JSON.stringify(value);
      if (encoded === undefined) throw new TypeError('Canonical JSON requires JSON values');
      return encoded;
    }
    if (active.has(value)) throw new TypeError('Canonical JSON cannot encode cycles');
    active.add(value);
    try {
      if (Array.isArray(value)) {
        const items = [];
        for (let index = 0; index < value.length; index++) {
          items.push(serialize(Object.hasOwn(value, index) ? value[index] : undefined));
        }
        return `[${items.join(',')}]`;
      }
      const entries = [];
      for (const key of Object.keys(value).sort(compare)) {
        const item = value[key];
        if (item === undefined && undefinedValues === 'json') continue;
        entries.push(`${JSON.stringify(key)}:${serialize(item)}`);
      }
      return `{${entries.join(',')}}`;
    } finally {
      active.delete(value);
    }
  };
  return serialize;
}

export const canonicalize = canonicalizeWith();

export default canonicalize;
