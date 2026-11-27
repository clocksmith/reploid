/**
 * A small, strict validator for the JSON Schema draft 2020-12 subset the
 * requester contract uses. It refuses any keyword it does not implement, so a
 * schema can never be "valid" because a rule was silently skipped.
 *
 * `$ref` values are JSON pointers from the root of the contract document
 * (for example "#/objects/sha256Digest").
 *
 * Two readings of an object schema:
 *   - validate(): `additionalProperties` absent means other members are allowed.
 *     That is the rule a receiver applies.
 *   - undeclared(): lists members no schema describes, wherever
 *     `additionalProperties` is absent. The contract verifier uses it on frames
 *     captured from the current code, so a new member shows up as drift.
 *     `additionalProperties: true` marks a free-form object and is never reported.
 */
const ANNOTATIONS = new Set(['$comment', 'description', 'title', 'examples', 'default']);
const KEYWORDS = new Set(['$ref', 'type', 'enum', 'const', 'properties', 'required', 'additionalProperties', 'items',
  'minItems', 'maxItems', 'uniqueItems', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum', 'exclusiveMinimum',
  'minProperties', 'maxProperties', 'oneOf', 'anyOf', 'allOf', 'not']);

const typeOf = value => value === null ? 'null' : Array.isArray(value) ? 'array'
  : typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : 'number') : typeof value;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const escapePointer = key => String(key).replace(/~/g, '~0').replace(/\//g, '~1');

export function resolvePointer(document, pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('#')) throw new Error(`Unsupported $ref ${pointer}`);
  let node = document;
  for (const part of pointer.slice(1).split('/').slice(1)) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node === null || typeof node !== 'object' || !Object.hasOwn(node, key)) throw new Error(`Unresolved $ref ${pointer}`);
    node = node[key];
  }
  return node;
}

/** Every keyword in a schema (and the schemas it contains) is one this validator implements. */
export function assertSupportedSchema(schema, document, path = '#', seen = new Set()) {
  if (schema === true || schema === false) return;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error(`${path}: a schema must be an object or a boolean`);
  if (seen.has(schema)) return;
  seen.add(schema);
  for (const key of Object.keys(schema)) {
    if (ANNOTATIONS.has(key) || key.startsWith('x-')) continue;
    if (!KEYWORDS.has(key)) throw new Error(`${path}: unsupported schema keyword "${key}"`);
  }
  if (schema.$ref !== undefined) assertSupportedSchema(resolvePointer(document, schema.$ref), document, schema.$ref, seen);
  if (schema.pattern !== undefined) new RegExp(schema.pattern, 'u');
  for (const [key, child] of Object.entries(schema.properties || {})) assertSupportedSchema(child, document, `${path}/properties/${escapePointer(key)}`, seen);
  if (schema.additionalProperties !== undefined) assertSupportedSchema(schema.additionalProperties, document, `${path}/additionalProperties`, seen);
  if (schema.items !== undefined) assertSupportedSchema(schema.items, document, `${path}/items`, seen);
  if (schema.not !== undefined) assertSupportedSchema(schema.not, document, `${path}/not`, seen);
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    (schema[key] || []).forEach((child, index) => assertSupportedSchema(child, document, `${path}/${key}/${index}`, seen));
  }
}

/** Returns a list of error strings; empty when `value` satisfies `schema`. */
export function validate(schema, value, document, path = '$') {
  const errors = [];
  check(schema, value, document, path, errors);
  return errors;
}

function check(schema, value, document, path, errors) {
  if (schema === true) return;
  if (schema === false) { errors.push(`${path}: no value is allowed here`); return; }
  if (schema.$ref !== undefined) check(resolvePointer(document, schema.$ref), value, document, path, errors);
  const actual = typeOf(value);
  if (schema.type !== undefined) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowed.some(type => type === actual || type === 'number' && actual === 'integer')) {
      errors.push(`${path}: expected ${allowed.join(' or ')}, found ${actual}`);
      return;
    }
  }
  if (schema.const !== undefined && !same(schema.const, value)) errors.push(`${path}: expected ${JSON.stringify(schema.const)}`);
  if (schema.enum !== undefined && !schema.enum.some(item => same(item, value))) errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  if (actual === 'string') {
    // Lengths count Unicode code points, as JSON Schema defines them.
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && length > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength}`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${path}: does not match ${schema.pattern}`);
  }
  if (actual === 'integer' || actual === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) errors.push(`${path}: not above ${schema.exclusiveMinimum}`);
  }
  if (actual === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.uniqueItems === true && new Set(value.map(item => JSON.stringify(item))).size !== value.length) errors.push(`${path}: items are not unique`);
    if (schema.items !== undefined) value.forEach((item, index) => check(schema.items, item, document, `${path}[${index}]`, errors));
  }
  if (actual === 'object') {
    const keys = Object.keys(value);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) errors.push(`${path}: fewer than ${schema.minProperties} members`);
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) errors.push(`${path}: more than ${schema.maxProperties} members`);
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) errors.push(`${path}: missing "${key}"`);
    for (const key of keys) {
      if (schema.properties && Object.hasOwn(schema.properties, key)) check(schema.properties[key], value[key], document, `${path}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}: "${key}" is not allowed`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') check(schema.additionalProperties, value[key], document, `${path}.${key}`, errors);
    }
  }
  if (schema.allOf) for (const part of schema.allOf) check(part, value, document, path, errors);
  if (schema.anyOf && !schema.anyOf.some(part => validate(part, value, document, path).length === 0)) errors.push(`${path}: matches none of the anyOf alternatives`);
  if (schema.oneOf) {
    const matches = schema.oneOf.filter(part => validate(part, value, document, path).length === 0).length;
    if (matches !== 1) errors.push(`${path}: matches ${matches} of the oneOf alternatives, expected exactly 1`);
  }
  if (schema.not !== undefined && validate(schema.not, value, document, path).length === 0) errors.push(`${path}: matches a schema it must not match`);
}

/**
 * Members of `value` that no schema describes. For oneOf and anyOf the
 * alternatives that accept the value are followed.
 */
export function undeclared(schema, value, document, path = '$') {
  const found = [];
  walk(schema, value, document, path, found);
  return [...new Set(found)];
}

function declaredProperties(schema, value, document) {
  // Collects the object schemas that apply to `value` at this location.
  if (schema === true || schema === false || !schema) return [];
  const applied = [schema];
  if (schema.$ref !== undefined) applied.push(...declaredProperties(resolvePointer(document, schema.$ref), value, document));
  for (const part of schema.allOf || []) applied.push(...declaredProperties(part, value, document));
  for (const key of ['oneOf', 'anyOf']) for (const part of schema[key] || []) {
    if (validate(part, value, document).length === 0) applied.push(...declaredProperties(part, value, document));
  }
  return applied;
}

function walk(schema, value, document, path, found) {
  const applied = declaredProperties(schema, value, document);
  if (Array.isArray(value)) {
    for (const part of applied) if (part.items !== undefined) value.forEach((item, index) => walk(part.items, item, document, `${path}[${index}]`, found));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const freeForm = applied.some(part => part.additionalProperties === true || part.additionalProperties && typeof part.additionalProperties === 'object');
  for (const key of Object.keys(value)) {
    const owners = applied.filter(part => part.properties && Object.hasOwn(part.properties, key));
    if (!owners.length) { if (!freeForm) found.push(`${path}.${key}`); continue; }
    for (const owner of owners) walk(owner.properties[key], value[key], document, `${path}.${key}`, found);
  }
}
