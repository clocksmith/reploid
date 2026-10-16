export const validateAgainstSchema = (value, schema) => {
  if (!schema || typeof schema !== 'object') return { valid: true, errors: [] };
  const errors = [];
  const required = Array.isArray(schema.required) ? schema.required : [];
  const properties = schema.properties || {};

  if (schema.type === 'object' && (value === null || typeof value !== 'object' || Array.isArray(value))) {
    errors.push('Expected object');
    return { valid: false, errors };
  }

  for (const key of required) {
    if (!(key in (value || {}))) {
      errors.push(`Missing required field: ${key}`);
    }
  }

  for (const [key, def] of Object.entries(properties)) {
    if (!(key in (value || {}))) continue;
    const expectedType = def?.type;
    if (!expectedType) continue;
    const actual = value[key];
    if (expectedType === 'array' && !Array.isArray(actual)) {
      errors.push(`Field ${key} expected array`);
    } else if (expectedType === 'object' && (typeof actual !== 'object' || actual === null || Array.isArray(actual))) {
      errors.push(`Field ${key} expected object`);
    } else if (expectedType !== 'array' && expectedType !== 'object' && typeof actual !== expectedType) {
      errors.push(`Field ${key} expected ${expectedType}`);
    }
  }

  return { valid: errors.length === 0, errors };
};
