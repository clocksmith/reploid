/** Versioned, data-only settings of one whole-model generation request, and the digest that
 * binds the effective request (model identity, adapters, messages and settings) into credit
 * admission, receipts and failure evidence. A request without settings has no settings object
 * and no digest: it stays the earlier text contract, byte for byte. These functions validate
 * shape and limits only; they do not interpret a JSON Schema or apply any setting. */
import { canonicalize } from '../artifacts/canonical-json.js';
import { hashJson } from '../artifacts/signatures.js';

export const GENERATION_SETTINGS_SCHEMA = 'reploid.generation-settings/v1';
export const EFFECTIVE_REQUEST_SCHEMA = 'reploid.effective-request/v1';
/** The capability shape with nothing supported. A provider host spreads it and turns on what it
 * enforces, for example `{ ...GENERATION_SETTINGS_CAPABILITY, maxOutputTokens: true }`. */
export const GENERATION_SETTINGS_CAPABILITY = Object.freeze({ schema: GENERATION_SETTINGS_SCHEMA,
  maxOutputTokens: false, tools: false, outputSchema: false, thinking: false });

const SETTING_KEYS = ['schema', 'maxOutputTokens', 'tools', 'toolChoice', 'outputSchema', 'thinking'];
const CAPABILITY_FLAGS = ['maxOutputTokens', 'tools', 'outputSchema', 'thinking'];
const MAX_TOOLS = 16, MAX_DESCRIPTION_CHARACTERS = 1024, MAX_JSON_DEPTH = 8, MAX_CANONICAL_BYTES = 16384;
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
// The mesh's JSON snapshot refuses these keys, so a request carrying one would be dropped in transit.
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const invalid = (message, param) => Object.assign(new Error(`Invalid generation settings: ${message}`),
  { code: 'INVALID_GENERATION_SETTINGS', status: 400, param });
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/** Copy plain JSON data with sorted keys, refusing anything JSON cannot carry unchanged. */
function jsonData(value, path, depth) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalid(`${path} holds a non-finite number`, path);
    return value === 0 ? 0 : value;
  }
  if (depth > MAX_JSON_DEPTH) throw invalid(`${path} is nested deeper than ${MAX_JSON_DEPTH} levels`, path);
  if (Array.isArray(value)) {
    const copy = [];
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) throw invalid(`${path}[${index}] is missing`, path);
      copy.push(jsonData(value[index], `${path}[${index}]`, depth + 1));
    }
    return copy;
  }
  if (!plainObject(value)) throw invalid(`${path} must be plain JSON data`, path);
  const copy = {};
  for (const key of Object.keys(value).sort()) {
    if (UNSAFE_KEYS.has(key)) throw invalid(`${path} uses the reserved key ${key}`, path);
    copy[key] = jsonData(value[key], `${path}.${key}`, depth + 1);
  }
  return copy;
}
const jsonObject = (value, path) => {
  if (!plainObject(value)) throw invalid(`${path} must be a plain JSON object`, path);
  return jsonData(value, path, 1);
};
const deepFreeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
};

/**
 * Canonical settings, or `undefined` when the request has none. Omitted keys take their
 * defaults (`maxOutputTokens: null`, `tools: []`, `toolChoice: 'none'` without tools and
 * `'auto'` with them, `outputSchema: null`, `thinking: null`); a tool's `description`
 * defaults to the empty string. Tool order is kept. The result is deeply frozen, has
 * exactly the six keys, and normalizes to itself.
 * `assertSchema(schema, path)`, when given, is called for each tool's `parameters` and for a
 * non-null `outputSchema`, so a host can refuse schemas outside the subset it supports.
 */
export function normalizeGenerationSettings(value, { assertSchema } = {}) {
  if (value === undefined) return undefined;
  if (assertSchema !== undefined && typeof assertSchema !== 'function') throw new TypeError('assertSchema must be a function');
  if (!plainObject(value)) throw invalid('a plain object is required', 'settings');
  for (const key of Object.keys(value)) if (!SETTING_KEYS.includes(key)) throw invalid(`unknown key ${key}`, key);
  if (value.schema !== undefined && value.schema !== GENERATION_SETTINGS_SCHEMA) {
    throw invalid(`schema must be ${GENERATION_SETTINGS_SCHEMA}`, 'schema');
  }
  const maxOutputTokens = value.maxOutputTokens ?? null;
  if (maxOutputTokens !== null && !(Number.isSafeInteger(maxOutputTokens) && maxOutputTokens > 0)) {
    throw invalid('maxOutputTokens must be a positive integer or null', 'maxOutputTokens');
  }
  const declared = value.tools === undefined ? [] : value.tools;
  if (!Array.isArray(declared) || declared.length > MAX_TOOLS) throw invalid(`tools must be an array of at most ${MAX_TOOLS} entries`, 'tools');
  const names = new Set();
  const tools = [];
  for (let index = 0; index < declared.length; index++) {
    const tool = declared[index], path = `tools[${index}]`;
    if (!plainObject(tool) || Object.keys(tool).some(key => !['name', 'description', 'parameters'].includes(key))) {
      throw invalid(`${path} must hold only name, description and parameters`, path);
    }
    if (typeof tool.name !== 'string' || !TOOL_NAME.test(tool.name)) throw invalid(`${path}.name must match ${TOOL_NAME}`, path);
    if (names.has(tool.name)) throw invalid(`duplicate tool name ${tool.name}`, path);
    names.add(tool.name);
    const description = tool.description === undefined ? '' : tool.description;
    if (typeof description !== 'string' || description.length > MAX_DESCRIPTION_CHARACTERS) {
      throw invalid(`${path}.description must be text of at most ${MAX_DESCRIPTION_CHARACTERS} characters`, path);
    }
    const parameters = jsonObject(tool.parameters, `${path}.parameters`);
    assertSchema?.(parameters, `${path}.parameters`);
    tools.push({ name: tool.name, description, parameters });
  }
  let toolChoice = value.toolChoice;
  if (toolChoice === undefined) toolChoice = tools.length ? 'auto' : 'none';
  if (plainObject(toolChoice)) {
    if (Object.keys(toolChoice).join() !== 'name' || !names.has(toolChoice.name)) {
      throw invalid('toolChoice must name one declared tool', 'toolChoice');
    }
    toolChoice = { name: toolChoice.name };
  } else if (!['none', 'auto', 'required'].includes(toolChoice)) {
    throw invalid("toolChoice must be 'none', 'auto', 'required' or { name }", 'toolChoice');
  }
  if (!tools.length && toolChoice !== 'none') throw invalid("toolChoice must be 'none' when no tools are declared", 'toolChoice');
  const outputSchema = value.outputSchema ?? null;
  const schema = outputSchema === null ? null : jsonObject(outputSchema, 'outputSchema');
  if (schema !== null) assertSchema?.(schema, 'outputSchema');
  const thinking = value.thinking ?? null;
  if (![null, 'on', 'off'].includes(thinking)) throw invalid("thinking must be null, 'on' or 'off'", 'thinking');
  const settings = { schema: GENERATION_SETTINGS_SCHEMA, maxOutputTokens, tools, toolChoice, outputSchema: schema, thinking };
  const bytes = new TextEncoder().encode(canonicalize(settings)).byteLength;
  if (bytes > MAX_CANONICAL_BYTES) throw invalid(`canonical size ${bytes} exceeds ${MAX_CANONICAL_BYTES} bytes`, 'settings');
  return deepFreeze(settings);
}

/** True only for a value that is already the canonical settings object (key order aside). A
 * provider uses this on received settings: it never repairs or defaults a peer's request. */
export function isCanonicalGenerationSettings(value, options) {
  try { return value !== undefined && canonicalize(normalizeGenerationSettings(value, options)) === canonicalize(value); }
  catch { return false; }
}

/** `sha256:<hex>` over the model identity, adapters, messages and canonical settings. Requester
 * and provider each compute it from what they hold; object key order never changes it. */
export async function effectiveRequestDigest({ modelIdentity, adapterIdentities, messages, settings }) {
  const canonical = normalizeGenerationSettings(settings);
  if (canonical === undefined) throw new Error('Effective request digest requires generation settings');
  if (typeof modelIdentity !== 'string' || !DIGEST.test(modelIdentity)) throw new Error('Effective request digest requires an exact model identity');
  if (!Array.isArray(adapterIdentities) || adapterIdentities.some(identity => typeof identity !== 'string' || !DIGEST.test(identity))) {
    throw new Error('Effective request digest requires exact adapter identities');
  }
  if (!Array.isArray(messages) || !messages.length) throw new Error('Effective request digest requires the request messages');
  return hashJson({ schema: EFFECTIVE_REQUEST_SCHEMA, modelIdentity, adapterIdentities, messages, settings: canonical });
}

/** A well-formed capability, frozen, or `null` for anything else (including an absent one). */
export function normalizeGenerationSettingsCapability(value) {
  if (!plainObject(value) || value.schema !== GENERATION_SETTINGS_SCHEMA
    || Object.keys(value).length !== CAPABILITY_FLAGS.length + 1
    || CAPABILITY_FLAGS.some(flag => typeof value[flag] !== 'boolean')) return null;
  return Object.freeze({ schema: GENERATION_SETTINGS_SCHEMA,
    ...Object.fromEntries(CAPABILITY_FLAGS.map(flag => [flag, value[flag]])) });
}

/** What every listed provider supports: each flag AND-ed, or `null` when the list is empty or
 * any provider advertises no capability. */
export function intersectGenerationSettingsCapabilities(capabilities) {
  const normalized = capabilities.map(normalizeGenerationSettingsCapability);
  if (!normalized.length || normalized.includes(null)) return null;
  return Object.freeze({ schema: GENERATION_SETTINGS_SCHEMA,
    ...Object.fromEntries(CAPABILITY_FLAGS.map(flag => [flag, normalized.every(capability => capability[flag])])) });
}

/** What at least one listed provider supports: each flag OR-ed over the providers that advertise
 * a capability, or `null` when none does. It says a setting may be requested, not that one
 * provider supports every flag at once: provider choice checks each provider's own capability. */
export function unionGenerationSettingsCapabilities(capabilities) {
  const normalized = capabilities.map(normalizeGenerationSettingsCapability).filter(Boolean);
  if (!normalized.length) return null;
  return Object.freeze({ schema: GENERATION_SETTINGS_SCHEMA,
    ...Object.fromEntries(CAPABILITY_FLAGS.map(flag => [flag, normalized.some(capability => capability[flag])])) });
}

/** Refuse settings a route does not advertise, naming the first unsupported one. A route with
 * no capability refuses every settings object; a request without settings always passes. */
export function assertSettingsSupported(capability, settings) {
  const canonical = normalizeGenerationSettings(settings);
  if (canonical === undefined) return;
  const unsupported = (message, setting) => Object.assign(new Error(message),
    { code: 'GENERATION_SETTINGS_UNSUPPORTED', status: 400, setting, param: setting });
  const supported = normalizeGenerationSettingsCapability(capability);
  if (!supported) throw unsupported('Generation settings are not supported by this route', null);
  const used = { maxOutputTokens: canonical.maxOutputTokens !== null, tools: canonical.tools.length > 0,
    outputSchema: canonical.outputSchema !== null, thinking: canonical.thinking !== null };
  for (const flag of CAPABILITY_FLAGS) {
    if (used[flag] && !supported[flag]) throw unsupported(`Generation setting ${flag} is not supported by this route`, flag);
  }
}
