// The public configuration schema owns structural validation. Semantic checks
// (grants, identifiers, routing and credential boundaries) stay with resolveConfig.
const keywords = new Set(['$id', '$schema', 'type', 'const', 'default', 'properties',
  'required', 'additionalProperties', 'minimum', 'maximum']);
const matchesType = (value, type) => {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isSafeInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
};

/** Evaluate the JSON Schema keywords used by this package; reject unsupported
 * additions so publishing a new constraint cannot silently leave it unenforced. */
export function validateSchema(value, schema, fail, path = '') {
  for (const keyword of Object.keys(schema)) {
    if (!keywords.has(keyword)) throw new TypeError(`Unsupported configuration schema keyword: ${keyword}`);
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) fail(path, 'unsupported constant');
  const types = schema.type === undefined ? [] : [schema.type].flat();
  if (types.length && !types.some(type => matchesType(value, type))) fail(path, `expected ${types.join(' or ')}`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) fail(path, `minimum is ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(path, `maximum is ${schema.maximum}`);
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (!Object.hasOwn(value, key)) fail(path ? `${path}.${key}` : key, 'required field');
    }
    for (const [key, entry] of Object.entries(value)) {
      const field = path ? `${path}.${key}` : key;
      if (Object.hasOwn(schema.properties || {}, key)) validateSchema(entry, schema.properties[key], fail, field);
      else if (schema.additionalProperties === false) fail(field, 'unknown field');
    }
  }
}
