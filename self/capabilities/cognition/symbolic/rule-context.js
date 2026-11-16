const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);

/** Pure rule context projection and condition matching; no persistence, tools or policy authority. */
/**
 * Get a nested value from an object using dot notation or array path.
 * Supports wildcards (*) for array matching.
 * @param {Object} obj - The object to query
 * @param {string|string[]} path - Path like "a.b.c" or ["a", "b", "c"]
 * @returns {*} The value at the path or undefined
 * @private
 */
export const getNestedValue = (obj, path) => {
  if (!obj || !path) return undefined;
  const parts = Array.isArray(path) ? path : path.split('.');
  let current = obj;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (unsafeKeys.has(part)) return undefined;

    if (current === null || current === undefined) {
      return undefined;
    }

    // Handle array wildcard
    if (part === '*' && Array.isArray(current)) {
      const remainingPath = parts.slice(i + 1);
      if (remainingPath.length === 0) {
        return current;
      }
      return current.map(item => getNestedValue(item, remainingPath));
    }

    // Handle array index
    if (/^\d+$/.test(part)) {
      const index = parseInt(part, 10);
      current = Object.hasOwn(current, index) ? current[index] : undefined;
    } else {
      current = Object.hasOwn(current, part) ? current[part] : undefined;
    }
  }

  return current;
};

/**
 * Set a nested value in an object using dot notation.
 * @param {Object} obj - The object to modify
 * @param {string} path - Path like "a.b.c"
 * @param {*} value - Value to set
 * @returns {Object} Modified object (new reference)
 * @private
 */
export const setNestedValue = (obj, path, value) => {
  if (typeof path !== 'string' || !path) throw new Error('Rule context path is required');
  const parts = path.split('.');
  if (parts.some(part => !part || unsafeKeys.has(part))) throw new Error('Unsafe rule context path');
  const result = JSON.parse(JSON.stringify(obj || {}));
  let current = result;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    }
    current = current[part];
  }

  current[parts[parts.length - 1]] = value;
  return result;
};

/**
 * Resolve a template string with context values.
 * Supports ${path} syntax for variable interpolation.
 * @param {string} template - Template string
 * @param {Object} context - Context object for variable resolution
 * @returns {string} Resolved string
 * @private
 */
export const resolveTemplate = (template, context) => {
  if (typeof template !== 'string') return template;
  return template.replace(/\$\{([^}]+)\}/g, (match, path) => {
    const value = getNestedValue(context, path.trim());
    return value !== undefined ? String(value) : match;
  });
};

/**
 * Resolve a value that may contain template references.
 * Recursively processes objects and arrays.
 * @param {*} value - Value to resolve
 * @param {Object} context - Context object
 * @returns {*} Resolved value
 * @private
 */
export const resolveValue = (value, context) => {
  if (typeof value === 'string') {
    // Check if entire string is a variable reference
    const varMatch = value.match(/^\$\{([^}]+)\}$/);
    if (varMatch) {
      return getNestedValue(context, varMatch[1].trim());
    }
    return resolveTemplate(value, context);
  }
  if (Array.isArray(value)) {
    return value.map(v => resolveValue(v, context));
  }
  if (value && typeof value === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(value)) {
      const key = resolveTemplate(k, context);
      if (unsafeKeys.has(key)) throw new Error('Unsafe rule context key');
      result[key] = resolveValue(v, context);
    }
    return result;
  }
  return value;
};

/**
 * Match a single condition against context.
 * Supports various operators: eq, neq, gt, gte, lt, lte, in, nin,
 * contains, startsWith, endsWith, matches, exists, typeof, and, or, not.
 * @param {Object} condition - Condition object
 * @param {Object} context - Context to match against
 * @returns {boolean} True if condition matches
 * @private
 */
export const matchCondition = (condition, context) => {
  if (!condition || typeof condition !== 'object') {
    return Boolean(condition);
  }

  // Handle logical operators
  if ('and' in condition) {
    return condition.and.every(c => matchCondition(c, context));
  }
  if ('or' in condition) {
    return condition.or.some(c => matchCondition(c, context));
  }
  if ('not' in condition) {
    return !matchCondition(condition.not, context);
  }

  // Get the path and actual value from context
  const path = condition.path || condition.field;
  if (!path) {
    // Direct value comparison
    if ('value' in condition && 'eq' in condition) {
      return condition.value === condition.eq;
    }
    return false;
  }

  const actualValue = getNestedValue(context, path);
  const expectedValue = resolveValue(condition.value, context);

  // Handle operators
  const op = condition.op || condition.operator || 'eq';

  switch (op) {
    case 'eq':
    case 'equals':
    case '==':
      return actualValue === expectedValue;

    case 'neq':
    case 'notEquals':
    case '!=':
      return actualValue !== expectedValue;

    case 'gt':
    case '>':
      return actualValue > expectedValue;

    case 'gte':
    case '>=':
      return actualValue >= expectedValue;

    case 'lt':
    case '<':
      return actualValue < expectedValue;

    case 'lte':
    case '<=':
      return actualValue <= expectedValue;

    case 'in':
      return Array.isArray(expectedValue) && expectedValue.includes(actualValue);

    case 'nin':
    case 'notIn':
      return !Array.isArray(expectedValue) || !expectedValue.includes(actualValue);

    case 'contains':
      if (Array.isArray(actualValue)) {
        return actualValue.includes(expectedValue);
      }
      if (typeof actualValue === 'string') {
        return actualValue.includes(String(expectedValue));
      }
      return false;

    case 'startsWith':
      return typeof actualValue === 'string' && actualValue.startsWith(String(expectedValue));

    case 'endsWith':
      return typeof actualValue === 'string' && actualValue.endsWith(String(expectedValue));

    case 'matches':
    case 'regex':
      try {
        const regex = expectedValue instanceof RegExp
          ? expectedValue
          : new RegExp(expectedValue);
        return regex.test(String(actualValue));
      } catch {
        return false;
      }

    case 'exists':
      return expectedValue ? actualValue !== undefined : actualValue === undefined;

    case 'typeof':
      return typeof actualValue === expectedValue;

    case 'isEmpty':
      if (expectedValue) {
        return actualValue === null || actualValue === undefined ||
               actualValue === '' ||
               (Array.isArray(actualValue) && actualValue.length === 0) ||
               (typeof actualValue === 'object' && Object.keys(actualValue).length === 0);
      }
      return !(actualValue === null || actualValue === undefined ||
              actualValue === '' ||
              (Array.isArray(actualValue) && actualValue.length === 0) ||
              (typeof actualValue === 'object' && Object.keys(actualValue).length === 0));

    case 'hasProperty':
      return actualValue && typeof actualValue === 'object' && expectedValue in actualValue;

    default:
      // Default to equality check
      return actualValue === expectedValue;
  }
};
