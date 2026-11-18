/**
 * @fileoverview Output constraints for tool calls and strict JSON responses: a schema
 * validator, a character-level acceptor compiled from the same schema, and a token mask
 * with Doppler's `logitMaskFn` signature.
 *
 * Supported JSON Schema subset (anything else throws, naming the keyword):
 *   type                  one of object, array, string, number, integer, boolean, null
 *                         (a single string; type lists are rejected)
 *   properties, required  objects are CLOSED whether or not `additionalProperties: false`
 *   additionalProperties  is written; only `false` is accepted. Generation emits declared
 *                         properties in declared order (optional ones may be skipped);
 *                         validation accepts any order.
 *   items                 one schema for every element (required for arrays)
 *   minItems, maxItems
 *   enum, const           of strings, finite numbers, booleans and null; generation emits
 *                         exactly `JSON.stringify(value)`
 *   maxLength             strings, counted in Unicode code points
 *   description, title    ignored
 * A schema needs `type`, `enum` or `const`. Limits: nesting depth 8, 64 properties per
 * object, 256 enum entries, 512 schema nodes in total. Rejected examples: `$ref`, `anyOf`,
 * `oneOf`, `pattern`, `format`, `minimum`/`maximum`, `minLength`, `default`, open objects.
 *
 * Generated text is narrower than validated values so a model cannot stall: inside JSON
 * only one optional space may follow `:` and `,`; at most GAP_LIMIT whitespace characters
 * sit around the wrapper tags; numbers carry at most 16 integer digits, 16 fraction digits
 * and 2 exponent digits; `integer` is written without fraction or exponent.
 *
 * Identity: `compileConstraint` is synchronous and Web Crypto is not, so the compiled
 * constraint always carries `identitySource` (canonical JSON of the constraint) and takes
 * its `sha256:` digest from the caller as `options.identity`. `digestConstraintIdentity`
 * computes that digest with the shared SHA-256, and `compileConstraintWithIdentity` does
 * both steps.
 */
import { sha256Hex } from '../vendor/reploid/hashing.js';

export const OUTPUT_CONSTRAINT_SCHEMA = 'reploid.output-constraint/v1';
export const TOOL_CALL_OPEN = '<tool_call>';
export const TOOL_CALL_CLOSE = '</tool_call>';
export const SCHEMA_LIMITS = Object.freeze({ depth: 8, properties: 64, enumEntries: 256, nodes: 512 });
/** Most whitespace characters accepted at each gap around the wrapper tags. */
export const GAP_LIMIT = 2;

const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const KEYWORDS = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'minItems',
  'maxItems', 'enum', 'const', 'maxLength', 'description', 'title']);
const KEYWORD_TYPE = { properties: 'object', required: 'object', additionalProperties: 'object',
  items: 'array', minItems: 'array', maxItems: 'array', maxLength: 'string' };
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const NUMBER_DIGITS = { integer: 16, fraction: 16, exponent: 2 };

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isPrimitive = value => value === null || typeof value === 'string' || typeof value === 'boolean'
  || (typeof value === 'number' && Number.isFinite(value));
const isCount = value => Number.isSafeInteger(value) && value >= 0;
const codePointLength = text => Array.from(text).length;

function typeMatches(type, value) {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    case 'array': return Array.isArray(value);
    default: return isPlainObject(value);
  }
}

// One normalized node per schema: `values` for a finite set of primitives, otherwise the
// declared type with its own fields. Validation, generation and identity all read this.
function normalize(schema, path, depth, budget) {
  if (!isPlainObject(schema)) throw new Error(`JSON Schema at ${path} must be an object`);
  if (depth > SCHEMA_LIMITS.depth) throw new Error(`JSON Schema at ${path} is nested deeper than ${SCHEMA_LIMITS.depth} levels`);
  budget.nodes += 1;
  if (budget.nodes > SCHEMA_LIMITS.nodes) throw new Error(`JSON Schema has more than ${SCHEMA_LIMITS.nodes} nodes`);
  for (const key of Object.keys(schema)) {
    if (!KEYWORDS.has(key)) throw new Error(`Unsupported JSON Schema keyword "${key}" at ${path}`);
  }
  const has = key => Object.hasOwn(schema, key);
  const bad = (key, reason) => new Error(`Unsupported JSON Schema keyword "${key}" at ${path}: ${reason}`);
  const type = has('type') ? schema.type : null;
  if (has('type') && (typeof type !== 'string' || !TYPES.has(type))) {
    throw bad('type', `expected one of ${[...TYPES].join(', ')} as a single string`);
  }
  for (const [key, owner] of Object.entries(KEYWORD_TYPE)) {
    if (has(key) && type !== owner) throw bad(key, `it applies only to type "${owner}"`);
  }
  if (has('maxLength') && !isCount(schema.maxLength)) throw bad('maxLength', 'expected a non-negative integer');
  const maxLength = has('maxLength') ? schema.maxLength : null;

  let values = null;
  if (has('enum')) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0) throw bad('enum', 'expected a non-empty list');
    if (schema.enum.length > SCHEMA_LIMITS.enumEntries) throw bad('enum', `more than ${SCHEMA_LIMITS.enumEntries} entries`);
    if (!schema.enum.every(isPrimitive)) throw bad('enum', 'entries must be strings, finite numbers, booleans or null');
    values = [...new Set(schema.enum)];
  }
  if (has('const')) {
    if (!isPrimitive(schema.const)) throw bad('const', 'expected a string, finite number, boolean or null');
    if (values && !values.includes(schema.const)) throw bad('const', 'the value is not in "enum"');
    values = [schema.const];
  }
  if (values) {
    const keyword = has('const') ? 'const' : 'enum';
    if (type && !values.every(value => typeMatches(type, value))) throw bad(keyword, `a value is not of type "${type}"`);
    if (maxLength !== null && !values.every(value => codePointLength(value) <= maxLength)) {
      throw bad(keyword, 'a value is longer than "maxLength"');
    }
    return { type, values };
  }
  if (!type) throw new Error(`JSON Schema at ${path} needs "type", "enum" or "const"; open schemas are unsupported`);
  if (type === 'boolean') return { type, values: [false, true] };
  if (type === 'null') return { type, values: [null] };
  if (type === 'string') return { type, values: null, maxLength };
  if (type === 'number' || type === 'integer') return { type, values: null };

  if (type === 'array') {
    if (!has('items')) throw new Error(`JSON Schema at ${path} needs "items"; arrays of anything are unsupported`);
    if (!isPlainObject(schema.items)) throw bad('items', 'expected one schema for every element');
    for (const key of ['minItems', 'maxItems']) {
      if (has(key) && !isCount(schema[key])) throw bad(key, 'expected a non-negative integer');
    }
    const min = has('minItems') ? schema.minItems : 0, max = has('maxItems') ? schema.maxItems : null;
    if (max !== null && min > max) throw bad('minItems', 'it is greater than "maxItems"');
    return { type, values: null, min, max, items: normalize(schema.items, `${path}.items`, depth + 1, budget) };
  }

  if (has('additionalProperties') && schema.additionalProperties !== false) {
    throw bad('additionalProperties', 'only false is supported; objects are closed');
  }
  const properties = has('properties') ? schema.properties : {};
  if (!isPlainObject(properties)) throw bad('properties', 'expected an object of schemas');
  const names = Object.keys(properties);
  if (names.length > SCHEMA_LIMITS.properties) throw bad('properties', `more than ${SCHEMA_LIMITS.properties} properties`);
  const required = has('required') ? schema.required : [];
  if (!Array.isArray(required) || !required.every(name => typeof name === 'string')
    || new Set(required).size !== required.length) throw bad('required', 'expected a list of distinct property names');
  for (const name of required) {
    if (!Object.hasOwn(properties, name)) throw bad('required', `"${name}" is not a declared property`);
  }
  const props = names.map(name => ({ name, required: required.includes(name),
    node: normalize(properties[name], `${path}.properties.${name}`, depth + 1, budget) }));
  return { type, values: null, props };
}

const normalizeRoot = schema => normalize(schema, '$', 1, { nodes: 0 });

/** Throw unless `schema` lies inside the supported subset documented at the top of this file. */
export function assertSupportedSchema(schema) {
  normalizeRoot(schema);
}

function check(node, value, path) {
  if (node.values) return node.values.includes(value) ? null : `${path}: value is not one of the allowed values`;
  if (!typeMatches(node.type, value)) return `${path}: expected ${node.type}`;
  if (node.type === 'string') {
    return node.maxLength !== null && codePointLength(value) > node.maxLength
      ? `${path}: string is longer than ${node.maxLength} characters` : null;
  }
  if (node.type === 'array') {
    if (value.length < node.min) return `${path}: fewer than ${node.min} items`;
    if (node.max !== null && value.length > node.max) return `${path}: more than ${node.max} items`;
    for (let index = 0; index < value.length; index += 1) {
      const error = check(node.items, value[index], `${path}[${index}]`);
      if (error) return error;
    }
    return null;
  }
  if (node.type !== 'object') return null;
  const declared = new Set(node.props.map(prop => prop.name));
  for (const key of Object.keys(value)) {
    if (!declared.has(key)) return `${path}: unexpected property "${key}"`;
  }
  for (const prop of node.props) {
    if (!Object.hasOwn(value, prop.name)) {
      if (prop.required) return `${path}: missing required property "${prop.name}"`;
      continue;
    }
    const error = check(prop.node, value[prop.name], `${path}.${prop.name}`);
    if (error) return error;
  }
  return null;
}

const NORMALIZED = new WeakMap();

/**
 * Validate a finished value. An unsupported schema is reported as invalid, with the
 * same message `assertSupportedSchema` throws.
 */
export function validateAgainstSchema(schema, value) {
  let node = isPlainObject(schema) ? NORMALIZED.get(schema) : undefined;
  if (!node) {
    try {
      node = normalizeRoot(schema);
    } catch (error) {
      return { valid: false, error: error.message };
    }
    NORMALIZED.set(schema, node);
  }
  const error = check(node, value, '$');
  return { valid: error === null, error };
}

function canonicalNode(node) {
  if (node.values) return { values: node.values.map(value => JSON.stringify(value)).sort() };
  if (node.type === 'object') {
    return { type: 'object', properties: node.props.map(prop => [prop.name, prop.required, canonicalNode(prop.node)]) };
  }
  if (node.type === 'array') return { type: 'array', min: node.min, max: node.max, items: canonicalNode(node.items) };
  if (node.type === 'string') return { type: 'string', maxLength: node.maxLength };
  return { type: node.type };
}

// Resolve a specification to what the acceptor needs: `free` (no constraint), `auto`,
// `required` (one of `tools`) or `json` (one value of `node`).
function planConstraint(spec) {
  if (!isPlainObject(spec)) throw new TypeError('A constraint specification is required');
  if (spec.kind === 'json') return { kind: 'json', mode: 'json', tools: [], node: normalizeRoot(spec.schema) };
  if (spec.kind !== 'tool-call') throw new TypeError('Constraint kind must be "tool-call" or "json"');
  const declared = spec.tools ?? [];
  if (!Array.isArray(declared) || declared.length > 16) throw new TypeError('tools must be a list of at most 16 tools');
  const tools = declared.map(tool => {
    if (!isPlainObject(tool) || typeof tool.name !== 'string' || !TOOL_NAME.test(tool.name)) {
      throw new TypeError('Each tool needs a name of 1 to 64 letters, digits, "_" or "-"');
    }
    let node;
    try {
      node = normalizeRoot(tool.parameters);
    } catch (error) {
      throw new Error(`Tool "${tool.name}" parameters: ${error.message}`);
    }
    if (node.type !== 'object' || node.values) throw new Error(`Tool "${tool.name}" parameters must be an object schema`);
    return { name: tool.name, node };
  });
  if (new Set(tools.map(tool => tool.name)).size !== tools.length) throw new TypeError('Tool names must be unique');
  const choice = spec.toolChoice ?? 'auto';
  const plan = (mode, allowed) => ({ kind: 'tool-call', mode, node: null,
    tools: [...allowed].sort((a, b) => (a.name < b.name ? -1 : 1)) });
  if (isPlainObject(choice)) {
    const tool = tools.find(candidate => candidate.name === choice.name);
    if (!tool) throw new Error(`Tool choice names undeclared tool ${JSON.stringify(String(choice.name).slice(0, 64))}`);
    return plan('required', [tool]);
  }
  if (!['none', 'auto', 'required'].includes(choice)) throw new TypeError('toolChoice must be "none", "auto", "required" or { name }');
  if (choice === 'required' && tools.length === 0) throw new Error('Tool choice "required" needs at least one tool');
  return choice === 'none' || tools.length === 0 ? plan('free', []) : plan(choice, tools);
}

const sourceOf = plan => JSON.stringify({ schema: OUTPUT_CONSTRAINT_SCHEMA, kind: plan.kind, mode: plan.mode,
  tools: plan.tools.map(tool => [tool.name, canonicalNode(tool.node)]),
  value: plan.node ? canonicalNode(plan.node) : null });

/** Canonical JSON of a constraint: equal sources accept exactly the same output. */
export function constraintIdentitySource(spec) {
  return sourceOf(planConstraint(spec));
}

/** `sha256:` digest of a constraint, from its specification or its `identitySource` string. */
export function digestConstraintIdentity(specOrSource, cryptoApi = globalThis.crypto) {
  return sha256Hex(typeof specOrSource === 'string' ? specOrSource : constraintIdentitySource(specOrSource), cryptoApi);
}

// Acceptor states are interned: equal states are the same object, so they copy by
// reference, compare with === and key a Map. `next` is the state that follows the
// construct a state belongs to; `skip` and `plain` remember computed transitions.
// Callers treat states as opaque and never change them.
const K_END = 0, K_FREE = 1, K_AUTO = 2, K_LIT = 3, K_ALT = 4, K_STR = 5, K_NUM = 6,
  K_OBJ_OPEN = 7, K_OBJ_AFTER = 8, K_OBJ_SEP = 9, K_ARR = 10;
const OPT_SPACE = -1, GAP = -2;
const isSpace = code => code === 32 || code === 10 || code === 13 || code === 9;
const isHex = code => (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
const SIMPLE_ESCAPES = new Set([34, 92, 47, 98, 102, 110, 114, 116]);

function buildMachine(plan) {
  let ids = 0;
  const interned = new Map();
  const tag = thing => {
    thing.id ??= ++ids;
    return thing;
  };
  const NONE = tag({});
  const mk = (k, n, a, b, next) => {
    const key = `${k}:${n.id}:${a}:${b}:${next === null ? 0 : next.id}`;
    let state = interned.get(key);
    if (state === undefined) {
      state = { id: interned.size + 1, k, n, a, b, next, skip: undefined, plain: undefined };
      interned.set(key, state);
    }
    return state;
  };
  const END = mk(K_END, NONE, 0, 0, null), FREE = mk(K_FREE, NONE, 0, 0, null);

  // A pattern is literal text with OPT_SPACE (one optional space) and GAP (up to
  // GAP_LIMIT whitespace characters) markers.
  const pattern = (...parts) => {
    const codes = [];
    for (const part of parts) {
      if (typeof part === 'number') codes.push(part);
      else for (let i = 0; i < part.length; i += 1) codes.push(part.charCodeAt(i));
    }
    return tag({ codes });
  };
  const lit = (p, index, gap, next) => {
    let i = index, used = gap;
    while (i < p.codes.length && p.codes[i] === GAP && used >= GAP_LIMIT) {
      i += 1;
      used = 0;
    }
    return i === p.codes.length ? next : mk(K_LIT, p, i, used, next);
  };

  // A set of literal alternatives matched through a character trie; `complete` maps the
  // matched alternative to the state that follows it.
  const altSet = (texts, complete) => {
    const nodes = [{ edges: new Map(), terminal: -1 }];
    texts.forEach((text, index) => {
      let at = 0;
      for (let i = 0; i < text.length; i += 1) {
        const code = text.charCodeAt(i);
        let child = nodes[at].edges.get(code);
        if (child === undefined) {
          child = nodes.length;
          nodes.push({ edges: new Map(), terminal: -1 });
          nodes[at].edges.set(code, child);
        }
        at = child;
      }
      if (nodes[at].terminal < 0) nodes[at].terminal = index;
    });
    return tag({ nodes, complete });
  };
  const alt = (set, at, next) => {
    const node = set.nodes[at];
    return node.terminal >= 0 && node.edges.size === 0 ? set.complete(node.terminal, next) : mk(K_ALT, set, at, 0, next);
  };

  const P_SPACE = pattern(OPT_SPACE), P_OBJECT = pattern('{'), P_ARRAY = pattern('['), P_STRING = pattern('"');

  const enter = (node, next) => {
    tag(node);
    if (node.values) {
      node.alt ??= altSet(node.values.map(value => JSON.stringify(value)), (index, after) => after);
      return alt(node.alt, 0, next);
    }
    if (node.type === 'object') {
      if (!node.windows) {
        const count = node.props.length;
        node.closes = new Array(count + 1).fill(true);
        node.limit = new Array(count + 1).fill(count);
        for (let i = count - 1; i >= 0; i -= 1) {
          node.closes[i] = !node.props[i].required && node.closes[i + 1];
          node.limit[i] = node.props[i].required ? i : node.limit[i + 1];
        }
        node.windows = new Array(count);
      }
      return lit(P_OBJECT, 0, 0, mk(K_OBJ_OPEN, node, 0, 0, next));
    }
    if (node.type === 'array') return lit(P_ARRAY, 0, 0, mk(K_ARR, node, 0, 0, next));
    if (node.type === 'string') return lit(P_STRING, 0, 0, mk(K_STR, node, 0, 0, next));
    return mk(K_NUM, node, 0, 0, next);
  };
  // The keys that may come next once properties before `from` are settled: every
  // optional property up to and including the next required one.
  const keys = (node, from, next) => {
    if (from >= node.props.length) return null;
    if (!node.windows[from]) {
      const last = Math.min(node.limit[from], node.props.length - 1), texts = [];
      for (let i = from; i <= last; i += 1) texts.push(`${JSON.stringify(node.props[i].name)}:`);
      node.windows[from] = altSet(texts, (index, after) => lit(P_SPACE, 0, 0,
        enter(node.props[from + index].node, mk(K_OBJ_AFTER, node, from + index + 1, 0, after))));
    }
    return alt(node.windows[from], 0, next);
  };
  // Item counts saturate where they stop mattering, so the state set stays finite.
  const item = state => {
    const { n, a } = state;
    return enter(n.items, mk(K_ARR, n, n.max === null ? Math.min(a + 1, n.min) : a + 1, 1, state.next));
  };
  const string = (state, a, b) => mk(K_STR, state.n, state.n.maxLength === null ? 0 : a, b, state.next);

  function consumeNumber(state, code) {
    const { n, a, b, next } = state, digit = code >= 48 && code <= 57, whole = n.type === 'integer';
    const exponent = code === 101 || code === 69;
    switch (a) {
      case 0: case 1:
        if (a === 0 && code === 45) return mk(K_NUM, n, 1, 0, next);
        if (code === 48) return mk(K_NUM, n, 2, 0, next);
        return digit ? mk(K_NUM, n, 3, 1, next) : null;
      case 2: case 3:
        if (digit) return a === 3 && b < NUMBER_DIGITS.integer ? mk(K_NUM, n, 3, b + 1, next) : null;
        if (whole) return null;
        if (code === 46) return mk(K_NUM, n, 4, 0, next);
        return exponent ? mk(K_NUM, n, 6, 0, next) : null;
      case 4: return digit ? mk(K_NUM, n, 5, 1, next) : null;
      case 5:
        if (digit) return b < NUMBER_DIGITS.fraction ? mk(K_NUM, n, 5, b + 1, next) : null;
        return exponent ? mk(K_NUM, n, 6, 0, next) : null;
      case 6: case 7:
        if (a === 6 && (code === 43 || code === 45)) return mk(K_NUM, n, 7, 0, next);
        return digit ? mk(K_NUM, n, 8, 1, next) : null;
      default: return digit && b < NUMBER_DIGITS.exponent ? mk(K_NUM, n, 8, b + 1, next) : null;
    }
  }

  // String phases in `b`: 0 text, 1 after a backslash, 2..5 hex digits of \u, 6 after a
  // counted high surrogate. `a` counts code points only when maxLength is declared.
  function consumeString(state, code) {
    const max = state.n.maxLength, { a, b } = state;
    if (b === 1) {
      if (code === 117) return string(state, a, 2);
      return SIMPLE_ESCAPES.has(code) ? string(state, a + 1, 0) : null;
    }
    if (b >= 2 && b <= 5) {
      if (!isHex(code)) return null;
      return b === 5 ? string(state, a + 1, 0) : string(state, a, b + 1);
    }
    if (b === 6 && code >= 0xdc00 && code <= 0xdfff) return string(state, a, 0);
    if (code === 34) return state.next;
    if (code < 32) return null;
    if (max === null) return code === 92 ? string(state, 0, 1) : state;
    if (a >= max) return null;
    if (code === 92) return string(state, a, 1);
    if (code >= 0xd800 && code <= 0xdbff) return string(state, a + 1, 6);
    // The commonest step of a bounded string, remembered on the state.
    return state.plain ??= mk(K_STR, state.n, a + 1, 0, state.next);
  }

  function consume(state, code) {
    const { n, a, b, next } = state;
    switch (state.k) {
      case K_FREE: return state;
      case K_AUTO:
        // Leading whitespace keeps the decision open; a full tag commits to a call.
        if (a === 0 && isSpace(code)) return state;
        if (code !== TOOL_CALL_OPEN.charCodeAt(a)) return FREE;
        return a + 1 === TOOL_CALL_OPEN.length ? next : mk(K_AUTO, NONE, a + 1, 0, next);
      case K_LIT: {
        const expected = n.codes[a];
        if (expected === GAP) return isSpace(code) ? lit(n, a, b + 1, next) : null;
        return code === (expected === OPT_SPACE ? 32 : expected) ? lit(n, a + 1, 0, next) : null;
      }
      case K_ALT: {
        const child = n.nodes[a].edges.get(code);
        return child === undefined ? null : alt(n, child, next);
      }
      case K_STR: return consumeString(state, code);
      case K_NUM: return consumeNumber(state, code);
      case K_OBJ_OPEN: return code === 125 && n.closes[0] ? next : null;
      case K_OBJ_AFTER:
        if (code === 44) return a < n.props.length ? mk(K_OBJ_SEP, n, a, 0, next) : null;
        return code === 125 && n.closes[a] ? next : null;
      case K_OBJ_SEP: return code === 32 ? keys(n, a, next) : null;
      case K_ARR:
        if (b === 2) return code === 32 ? item(state) : null;
        if (code === 93) return a >= n.min ? next : null;
        return b === 1 && code === 44 && (n.max === null || a < n.max) ? mk(K_ARR, n, a, 2, next) : null;
      default: return null;
    }
  }

  // The state reached without consuming a character: past an optional element, out of a
  // number that may end here, or into the first character of the next value.
  function skipOf(state) {
    if (state.skip !== undefined) return state.skip;
    const { n, a, b, next } = state;
    let target = null;
    if (state.k === K_LIT) target = n.codes[a] < 0 ? lit(n, a + 1, 0, next) : null;
    else if (state.k === K_ALT) target = n.nodes[a].terminal >= 0 ? n.complete(n.nodes[a].terminal, next) : null;
    else if (state.k === K_NUM) target = a === 2 || a === 3 || a === 5 || a === 8 ? next : null;
    else if (state.k === K_OBJ_OPEN) target = keys(n, 0, next);
    else if (state.k === K_OBJ_SEP) target = keys(n, a, next);
    else if (state.k === K_ARR && b !== 1) target = n.max === null || a < n.max ? item(state) : null;
    state.skip = target;
    return target;
  }

  function step(state, code) {
    for (let at = state; at !== null; at = skipOf(at)) {
      const reached = consume(at, code);
      if (reached !== null) return reached;
    }
    return null;
  }

  let start = FREE;
  if (plan.mode === 'json') {
    const gap = pattern(GAP);
    start = lit(gap, 0, 0, enter(plan.node, lit(gap, 0, 0, END)));
  } else if (plan.mode !== 'free') {
    const tail = lit(pattern('}', GAP, TOOL_CALL_CLOSE, GAP), 0, 0, END);
    const argumentsKey = pattern(',', OPT_SPACE, '"arguments":', OPT_SPACE);
    const names = altSet(plan.tools.map(tool => `${tool.name}"`),
      (index, after) => lit(argumentsKey, 0, 0, enter(plan.tools[index].node, after)));
    const body = lit(pattern(GAP, '{"name":', OPT_SPACE, '"'), 0, 0, alt(names, 0, tail));
    start = plan.mode === 'auto' ? mk(K_AUTO, NONE, 0, 0, body) : lit(pattern(GAP, TOOL_CALL_OPEN), 0, 0, body);
  }

  return {
    start,
    step,
    isAccepting(state) {
      for (let at = state; at !== null; at = skipOf(at)) {
        if (at.k === K_END || at.k === K_FREE || at.k === K_AUTO) return true;
      }
      return false;
    },
    plainRun(state) {
      if (state.k !== K_STR || state.b !== 0) return -1;
      return state.n.maxLength === null ? Infinity : state.n.maxLength - state.a;
    }
  };
}

/**
 * Compile a constraint into an incremental character-level acceptor.
 *
 * `{ kind: 'tool-call', tools, toolChoice }`
 *   'required' or `{ name }`: the whole output is one wrapper,
 *       <tool_call>\n{"name": "<tool>", "arguments": {...}}\n</tool_call>
 *     naming an allowed tool, with arguments that satisfy its schema.
 *   'auto': the output is free text unless its first non-whitespace characters are
 *     exactly `<tool_call>`. The decision is made character by character from the start
 *     of the output: while what has been written is whitespace followed by a prefix of
 *     the tag (for example just `<`), both readings stay open and the output may end
 *     there as text. The first character that departs from the tag makes the whole
 *     output free text for good; completing the tag makes the rest one wrapper. A
 *     `<tool_call>` that appears after other text is therefore not constrained here.
 *   'none', or no tools: unconstrained.
 * `{ kind: 'json', schema }`: the whole output is one value of the schema.
 *
 * `identity` is `options.identity` (a `sha256:` digest of `identitySource`) or null.
 * The token sets `createLogitMask` computes are remembered per compiled constraint, so
 * a provider that keeps one object for equal constraints (keyed by `identitySource`)
 * starts later requests warm.
 */
export function compileConstraint(spec, options = {}) {
  const plan = planConstraint(spec);
  const identity = options.identity ?? null;
  if (identity !== null && !DIGEST.test(identity)) throw new TypeError('Constraint identity must be a sha256: digest');
  const machine = buildMachine(plan);
  return Object.freeze({
    schema: OUTPUT_CONSTRAINT_SCHEMA,
    kind: plan.kind,
    identity,
    identitySource: sourceOf(plan),
    start: () => machine.start,
    advance(state, text) {
      let at = state;
      for (let i = 0; i < text.length && at !== null; i += 1) at = machine.step(at, text.charCodeAt(i));
      return at;
    },
    isAccepting: machine.isAccepting,
    /** True once any further text is acceptable; the token mask then leaves logits alone. */
    isUnconstrained: state => state.k === K_FREE,
    /** `advance` for one UTF-16 code unit. */
    advanceCode: machine.step,
    /**
     * Inside string text: how many more plain characters (not `"`, `\`, a control
     * character or a surrogate) are accepted, each of them whichever it is, and no more
     * than that. -1 elsewhere. The token mask uses it to settle whole runs of tokens.
     */
    plainRun: machine.plainRun
  });
}

/** `compileConstraint` with `identity` computed from the constraint itself. */
export async function compileConstraintWithIdentity(spec, cryptoApi = globalThis.crypto) {
  return compileConstraint(spec, { identity: await digestConstraintIdentity(constraintIdentitySource(spec), cryptoApi) });
}

/** The `logitMaskIdentity` Doppler's generation evidence expects beside `logitMaskFn`. */
export function logitMaskIdentity(constraint) {
  if (!DIGEST.test(constraint?.identity ?? '')) throw new Error('The constraint was compiled without an identity digest');
  return { id: OUTPUT_CONSTRAINT_SCHEMA, contentDigest: constraint.identity };
}

const TOKEN_TABLES = new WeakMap();
const MEMO_BUDGET = 4 * 1024 * 1024;
const isPlainCode = code => code >= 32 && code !== 34 && code !== 92 && (code < 0xd800 || code > 0xdfff);

/**
 * Build, once per tokenizer and vocabulary size, the token texts and a trie over them.
 * Token text is `tokenizer.decode([id], true, false)`, the call Doppler's own JSON mask
 * uses. Tokens with no text (special tokens, unused ids) are never allowed while output
 * is constrained; tokens holding part of a UTF-8 sequence (decoded with U+FFFD) are
 * allowed only where the output becomes free text. Providers may call this when a model
 * loads so the first constrained request does not pay for it.
 */
export function prepareTokenTable(tokenizer, vocabSize) {
  if (typeof tokenizer?.decode !== 'function') throw new Error('Output constraint requires a tokenizer with decode()');
  if (!isCount(vocabSize) || vocabSize === 0) throw new Error('Output constraint requires a vocabulary size');
  const cached = TOKEN_TABLES.get(tokenizer);
  if (cached?.vocabSize === vocabSize) return cached;

  const textOf = id => {
    let text;
    try {
      text = tokenizer.decode([id], true, false);
    } catch {
      return '';
    }
    if (typeof text?.then === 'function') throw new Error('Output constraint requires synchronous token decoding');
    return typeof text === 'string' ? text : '';
  };
  const groups = new Map(), untexted = [], partialIds = [], partialTexts = [];
  let known = 0;
  for (let id = 0; id < vocabSize; id += 1) {
    const text = textOf(id);
    if (text === '') untexted.push(id);
    else if (text.includes('\ufffd')) {
      partialIds.push(id);
      partialTexts.push(text);
    } else {
      const seen = groups.get(text);
      if (seen === undefined) groups.set(text, id);
      else if (typeof seen === 'number') groups.set(text, [seen, id]);
      else seen.push(id);
      known += 1;
    }
  }
  // Text taken one token at a time is only right when tokens decode independently.
  const sample = [...groups.keys()].filter((text, index, all) => index % Math.ceil(all.length / 16) === 0);
  for (let i = 1; i < sample.length; i += 1) {
    const [a, b] = [groups.get(sample[i - 1]), groups.get(sample[i])].map(ids => (typeof ids === 'number' ? ids : ids[0]));
    if (tokenizer.decode([a, b], true, false) !== sample[i - 1] + sample[i]) {
      throw new Error('Output constraint requires a tokenizer that decodes each token independently of its neighbours');
    }
  }

  // Trie nodes in preorder over the sorted texts, so every subtree is one contiguous
  // run of `order` (token ids grouped by text in the same sorted order).
  const texts = [...groups.keys()].sort();
  let capacity = 1;
  for (const text of texts) capacity += text.length;
  const code = new Uint16Array(capacity), subtreeEnd = new Int32Array(capacity), from = new Int32Array(capacity),
    own = new Int32Array(capacity), to = new Int32Array(capacity), height = new Uint16Array(capacity),
    special = new Uint8Array(capacity), order = new Int32Array(known), position = new Int32Array(vocabSize).fill(-1);
  const path = [0];
  let nodes = 1, placed = 0, previous = '';
  const close = depth => {
    while (path.length - 1 > depth) {
      const node = path.pop(), parent = path[path.length - 1];
      subtreeEnd[node] = nodes;
      to[node] = placed;
      height[parent] = Math.max(height[parent], Math.min(65535, height[node] + 1));
      special[parent] |= special[node] | (height[node] >= 65535 ? 1 : 0);
    }
  };
  for (const text of texts) {
    let shared = 0;
    const limit = Math.min(text.length, previous.length);
    while (shared < limit && text.charCodeAt(shared) === previous.charCodeAt(shared)) shared += 1;
    close(shared);
    for (let i = shared; i < text.length; i += 1) {
      const node = nodes;
      nodes += 1;
      code[node] = text.charCodeAt(i);
      special[node] = isPlainCode(code[node]) ? 0 : 1;
      from[node] = own[node] = placed;
      path.push(node);
    }
    const ids = groups.get(text);
    for (const id of typeof ids === 'number' ? [ids] : ids) {
      position[id] = placed;
      order[placed] = id;
      placed += 1;
    }
    own[path[path.length - 1]] = placed;
    previous = text;
  }
  close(0);
  subtreeEnd[0] = nodes;
  to[0] = placed;

  const table = { vocabSize, known, order, position, textOf,
    blocked: Int32Array.from([...untexted, ...partialIds]), partialIds, partialTexts,
    trie: { code: code.slice(0, nodes), subtreeEnd: subtreeEnd.slice(0, nodes), from: from.slice(0, nodes),
      own: own.slice(0, nodes), to: to.slice(0, nodes), height: height.slice(0, nodes), special: special.slice(0, nodes) },
    scratch: new Float32Array(known + partialIds.length), memos: new WeakMap() };
  TOKEN_TABLES.set(tokenizer, table);
  return table;
}

// The tokens that may follow `state`: runs of `order` positions, plus the partial
// tokens that turn the output into free text.
function allowedAfter(constraint, table, state) {
  const { code, subtreeEnd, from, own, to, height, special } = table.trie;
  let ranges = new Int32Array(1024), used = 0, count = 0;
  const add = (start, end) => {
    if (end <= start) return;
    count += end - start;
    if (used && ranges[used - 1] === start) ranges[used - 1] = end;
    else {
      if (used === ranges.length) {
        const grown = new Int32Array(used * 2);
        grown.set(ranges);
        ranges = grown;
      }
      ranges[used] = start;
      ranges[used + 1] = end;
      used += 2;
    }
  };
  // Tokens of plain characters that fit in `room` more characters, `node` included.
  const shallow = (node, room) => {
    add(from[node], own[node]);
    if (room === 1) return;
    for (let child = node + 1, end = subtreeEnd[node]; child < end; child = subtreeEnd[child]) {
      if (room - 1 > height[child]) add(from[child], to[child]);
      else shallow(child, room - 1);
    }
  };
  const walk = (node, at) => {
    add(from[node], own[node]);
    const end = subtreeEnd[node], run = constraint.plainRun(at);
    for (let child = node + 1; child < end; child = subtreeEnd[child]) {
      if (run >= 0 && !special[child]) {
        if (run > height[child]) add(from[child], to[child]);
        else if (run > 0) shallow(child, run);
        continue;
      }
      const reached = constraint.advanceCode(at, code[child]);
      if (reached === null) continue;
      if (constraint.isUnconstrained(reached)) add(from[child], to[child]);
      else walk(child, reached);
    }
  };
  walk(0, state);
  const partial = [];
  table.partialTexts.forEach((text, index) => {
    const reached = constraint.advance(state, text);
    if (reached !== null && constraint.isUnconstrained(reached)) partial.push(table.partialIds[index]);
  });
  return { ranges: ranges.slice(0, used), count, partial: Int32Array.from(partial),
    accepting: constraint.isAccepting(state) };
}

function inRanges(ranges, position) {
  let low = 0, high = ranges.length / 2 - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (position < ranges[2 * middle]) high = middle - 1;
    else if (position >= ranges[2 * middle + 1]) low = middle + 1;
    else return true;
  }
  return false;
}

/**
 * Token mask with Doppler's `logitMaskFn` signature:
 * `(logits, { generatedIds, tokenizer, vocabSize }) => void`, synchronous, in place.
 *
 * Each call advances the acceptor over the generated tokens it has not seen yet, then
 * sets to -Infinity every token whose text cannot follow. `endTokenIds` (every token that
 * ends generation, for example both chat end tokens) are allowed exactly when the output
 * is complete, and are the only tokens left once nothing else can follow. While the
 * output is free text the logits are left untouched. It throws rather than mask every
 * token: when the generated tokens already break the constraint, or when no token in the
 * vocabulary can continue.
 */
export function createLogitMask({ constraint, endTokenIds }) {
  if (typeof constraint?.advanceCode !== 'function') throw new TypeError('createLogitMask requires a compiled constraint');
  if (!Array.isArray(endTokenIds) || !endTokenIds.every(isCount)) throw new TypeError('endTokenIds must be a list of token ids');
  const ends = [...new Set(endTokenIds)], endSet = new Set(ends), endLogits = new Float32Array(ends.length);
  let seen = [], states = [constraint.start()];

  return function logitMask(logits, context) {
    const generatedIds = context?.generatedIds;
    if (!Array.isArray(generatedIds)) throw new Error('Output constraint requires the generated token ids');
    let common = 0;
    while (common < seen.length && common < generatedIds.length && seen[common] === generatedIds[common]) common += 1;
    seen = seen.slice(0, common);
    states = states.slice(0, common + 1);
    let state = states[common], table = null;
    const size = Math.min(isCount(context.vocabSize) && context.vocabSize > 0 ? context.vocabSize : logits.length, logits.length);
    for (let i = common; i < generatedIds.length; i += 1) {
      const id = generatedIds[i];
      if (!constraint.isUnconstrained(state) && !endSet.has(id)) {
        table ??= prepareTokenTable(context.tokenizer, size);
        state = constraint.advance(state, table.textOf(id));
        if (state === null) throw new Error(`Output constraint is already broken by generated token ${id} at position ${i}`);
      }
      seen.push(id);
      states.push(state);
    }
    if (constraint.isUnconstrained(state)) return;
    table ??= prepareTokenTable(context.tokenizer, size);

    let memo = table.memos.get(constraint);
    if (!memo) table.memos.set(constraint, memo = { entries: new Map(), cost: 0 });
    let entry = memo.entries.get(state);
    if (!entry) {
      entry = allowedAfter(constraint, table, state);
      memo.cost += entry.ranges.length + entry.partial.length + 8;
      if (memo.cost > MEMO_BUDGET) {
        memo.entries.clear();
        memo.cost = 0;
      }
      memo.entries.set(state, entry);
    }

    const { ranges, partial } = entry, { order, position } = table;
    let allowed = entry.count + partial.length;
    for (const id of ends) {
      if (id >= logits.length) continue;
      const counted = id < size && ((position[id] >= 0 && inRanges(ranges, position[id])) || partial.includes(id));
      allowed += (entry.accepting ? 1 : 0) - (counted ? 1 : 0);
    }
    if (allowed === 0) {
      throw new Error('Output constraint cannot continue: no token in the vocabulary may follow the generated output');
    }

    for (let i = 0; i < ends.length; i += 1) endLogits[i] = ends[i] < logits.length ? logits[ends[i]] : -Infinity;
    const kept = table.scratch;
    let saved = 0;
    for (let i = 0; i < partial.length; i += 1) kept[saved++] = logits[partial[i]];
    if (entry.count * 2 <= table.known) {
      for (let r = 0; r < ranges.length; r += 2) {
        for (let p = ranges[r]; p < ranges[r + 1]; p += 1) kept[saved++] = logits[order[p]];
      }
      logits.fill(-Infinity);
      saved = partial.length;
      for (let r = 0; r < ranges.length; r += 2) {
        for (let p = ranges[r]; p < ranges[r + 1]; p += 1) logits[order[p]] = kept[saved++];
      }
    } else {
      let p = 0;
      for (let r = 0; r <= ranges.length; r += 2) {
        const stop = r < ranges.length ? ranges[r] : table.known;
        for (; p < stop; p += 1) logits[order[p]] = -Infinity;
        p = ranges[r + 1];
      }
      for (let i = 0; i < table.blocked.length; i += 1) logits[table.blocked[i]] = -Infinity;
      if (logits.length > size) logits.fill(-Infinity, size);
    }
    for (let i = 0; i < partial.length; i += 1) logits[partial[i]] = kept[i];
    for (let i = 0; i < ends.length; i += 1) {
      if (ends[i] < logits.length) logits[ends[i]] = entry.accepting ? endLogits[i] : -Infinity;
    }
  };
}
