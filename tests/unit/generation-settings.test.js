// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { GENERATION_SETTINGS_SCHEMA, GENERATION_SETTINGS_CAPABILITY, normalizeGenerationSettings, isCanonicalGenerationSettings,
  effectiveRequestDigest, assertSettingsSupported, normalizeGenerationSettingsCapability,
  intersectGenerationSettingsCapabilities } from '../../packages/reploid/src/mesh/generation-settings.js';
import { parseTextChatCompletion } from '../../server/chat-completions.js';

const modelIdentity = 'sha256:' + 'a'.repeat(64);
const messages = [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'hello' }];
const weather = { name: 'get_weather', description: 'Weather for a city', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } };
const request = settings => ({ modelIdentity, adapterIdentities: [], messages, settings });

it('returns undefined for a request without settings and resolves every default otherwise', () => {
  expect(normalizeGenerationSettings(undefined)).toBeUndefined();
  expect(normalizeGenerationSettings({})).toEqual({ schema: GENERATION_SETTINGS_SCHEMA, maxOutputTokens: null, tools: [],
    toolChoice: 'none', outputSchema: null, thinking: null });
  expect(normalizeGenerationSettings({ tools: [{ name: 'lookup', parameters: {} }] })).toMatchObject({
    tools: [{ name: 'lookup', description: '', parameters: {} }], toolChoice: 'auto' });
});

it('canonicalizes to a deeply frozen object that normalizes to itself', () => {
  const canonical = normalizeGenerationSettings({ thinking: 'off', toolChoice: { name: 'get_weather' }, maxOutputTokens: 64,
    tools: [{ parameters: { required: ['city'], type: 'object', properties: { city: { type: 'string' } } }, name: 'get_weather', description: 'Weather for a city' }],
    outputSchema: { type: 'object', additionalProperties: false } });
  expect(Object.keys(canonical)).toEqual(['schema', 'maxOutputTokens', 'tools', 'toolChoice', 'outputSchema', 'thinking']);
  expect(canonical.tools).toEqual([weather]);
  expect(Object.keys(canonical.tools[0].parameters)).toEqual(['properties', 'required', 'type']);
  for (const value of [canonical, canonical.tools, canonical.tools[0], canonical.tools[0].parameters.properties.city, canonical.toolChoice, canonical.outputSchema]) {
    expect(Object.isFrozen(value)).toBe(true);
  }
  const again = normalizeGenerationSettings(canonical);
  expect(again).toEqual(canonical);
  expect(JSON.stringify(again)).toBe(JSON.stringify(canonical));
  expect(isCanonicalGenerationSettings(JSON.parse(JSON.stringify(canonical)))).toBe(true);
  // A partial object is acceptable input to a requester, but it is not the canonical form a provider accepts.
  expect(isCanonicalGenerationSettings({ maxOutputTokens: 64 })).toBe(false);
  expect(isCanonicalGenerationSettings(undefined)).toBe(false);
});

it.each([
  ['an unknown key', { temperature: 0.2 }, 'unknown key temperature'],
  ['another schema', { schema: 'reploid.generation-settings/v2' }, 'schema must be'],
  ['a zero limit', { maxOutputTokens: 0 }, 'maxOutputTokens'],
  ['a fractional limit', { maxOutputTokens: 1.5 }, 'maxOutputTokens'],
  ['duplicate tool names', { tools: [weather, { ...weather }] }, 'duplicate tool name get_weather'],
  ['an invalid tool name', { tools: [{ ...weather, name: 'get weather' }] }, 'name must match'],
  ['an unknown tool key', { tools: [{ ...weather, strict: true }] }, 'must hold only'],
  ['a tool without parameters', { tools: [{ name: 'lookup' }] }, 'parameters must be a plain JSON object'],
  ['a long description', { tools: [{ ...weather, description: 'x'.repeat(1025) }] }, 'description'],
  ['more than sixteen tools', { tools: Array.from({ length: 17 }, (_, index) => ({ ...weather, name: 'tool_' + index })) }, 'at most 16'],
  ['a tool choice without tools', { toolChoice: 'auto' }, "must be 'none' when no tools"],
  ['an undeclared tool choice', { tools: [weather], toolChoice: { name: 'other' } }, 'must name one declared tool'],
  ['an unknown tool choice', { tools: [weather], toolChoice: 'always' }, 'toolChoice must be'],
  ['a null tool list', { tools: null }, 'tools must be an array'],
  ['an array output schema', { outputSchema: [] }, 'outputSchema must be a plain JSON object'],
  ['a non-JSON schema value', { outputSchema: { pattern: /x/ } }, 'plain JSON data'],
  ['a non-finite number', { outputSchema: { minimum: Infinity } }, 'non-finite'],
  ['a reserved key', { outputSchema: { properties: { constructor: {} } } }, 'reserved key'],
  ['a schema nested too deep', { outputSchema: { a: { b: { c: { d: { e: { f: { g: { h: { i: 1 } } } } } } } } } }, 'deeper than 8'],
  ['an unknown thinking value', { thinking: 'auto' }, 'thinking must be'],
  ['a non-object', 'max', 'plain object is required'],
  ['null', null, 'plain object is required']
])('rejects %s', (_label, value, message) => {
  expect(() => normalizeGenerationSettings(value)).toThrow(message);
  expect(() => normalizeGenerationSettings(value)).toThrow(expect.objectContaining({ code: 'INVALID_GENERATION_SETTINGS', status: 400 }));
});

it('accepts eight levels of schema nesting and refuses settings larger than 16384 canonical bytes', () => {
  expect(normalizeGenerationSettings({ outputSchema: { a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } } }).outputSchema.a.b.c.d.e.f.g.h).toBe(1);
  const tools = Array.from({ length: 16 }, (_, index) => ({ name: 'tool_' + index, description: 'd'.repeat(1024), parameters: {} }));
  expect(() => normalizeGenerationSettings({ tools })).toThrow('exceeds 16384 bytes');
  expect(normalizeGenerationSettings({ tools: tools.slice(0, 8) }).tools).toHaveLength(8);
});

it('calls the pluggable schema check on every tool parameters object and on the output schema', () => {
  const assertSchema = vi.fn();
  normalizeGenerationSettings({ tools: [weather, { name: 'lookup', parameters: { type: 'object' } }], outputSchema: { type: 'string' } }, { assertSchema });
  expect(assertSchema.mock.calls).toEqual([[weather.parameters, 'tools[0].parameters'], [{ type: 'object' }, 'tools[1].parameters'], [{ type: 'string' }, 'outputSchema']]);
  expect(() => normalizeGenerationSettings({ outputSchema: { oneOf: [] } }, { assertSchema() { throw Error('oneOf is outside the supported subset'); } }))
    .toThrow('outside the supported subset');
  expect(() => normalizeGenerationSettings({}, { assertSchema: true })).toThrow(TypeError);
});

it('derives one digest for an effective request, whatever the key order', async () => {
  const digest = await effectiveRequestDigest(request({ maxOutputTokens: 32, tools: [weather], outputSchema: { type: 'object', required: ['a'] } }));
  expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  const reordered = { outputSchema: { required: ['a'], type: 'object' },
    tools: [{ parameters: { required: ['city'], properties: { city: { type: 'string' } }, type: 'object' }, description: weather.description, name: weather.name }],
    maxOutputTokens: 32 };
  expect(await effectiveRequestDigest({ settings: reordered, messages: messages.map(({ role, content }) => ({ content, role })), adapterIdentities: [], modelIdentity })).toBe(digest);
  // The canonical object and the partial input that produced it bind the same request.
  expect(await effectiveRequestDigest(request(normalizeGenerationSettings(reordered)))).toBe(digest);
});

it('changes the digest when any setting, a message, the model or an adapter changes', async () => {
  const base = { maxOutputTokens: 32, tools: [weather], toolChoice: 'auto', outputSchema: { type: 'object' }, thinking: 'on' };
  const digest = await effectiveRequestDigest(request(base));
  const variants = [
    request({ ...base, maxOutputTokens: 33 }),
    request({ ...base, maxOutputTokens: null }),
    request({ ...base, tools: [{ ...weather, description: 'Forecast for a city' }] }),
    request({ ...base, tools: [weather, { name: 'lookup', parameters: {} }] }),
    request({ ...base, toolChoice: 'required' }),
    request({ ...base, toolChoice: { name: 'get_weather' } }),
    request({ ...base, outputSchema: { type: 'array' } }),
    request({ ...base, outputSchema: null }),
    request({ ...base, thinking: 'off' }),
    { ...request(base), messages: [messages[0], { role: 'user', content: 'hello!' }] },
    { ...request(base), messages: [messages[1], messages[0]] },
    { ...request(base), messages: [...messages, { role: 'assistant', content: '' }] },
    { ...request(base), modelIdentity: 'sha256:' + 'b'.repeat(64) },
    { ...request(base), adapterIdentities: ['sha256:' + 'c'.repeat(64)] }
  ];
  const digests = await Promise.all(variants.map(effectiveRequestDigest));
  expect(new Set([digest, ...digests]).size).toBe(variants.length + 1);
});

it('requires settings, an exact model identity and messages for an effective-request digest', async () => {
  await expect(effectiveRequestDigest({ modelIdentity, adapterIdentities: [], messages })).rejects.toThrow('requires generation settings');
  await expect(effectiveRequestDigest({ ...request({}), modelIdentity: null })).rejects.toThrow('exact model identity');
  await expect(effectiveRequestDigest({ ...request({}), adapterIdentities: ['adapter'] })).rejects.toThrow('exact adapter identities');
  await expect(effectiveRequestDigest({ ...request({}), messages: [] })).rejects.toThrow('request messages');
});

it('refuses settings a route does not advertise, naming the first unsupported one', () => {
  const none = GENERATION_SETTINGS_CAPABILITY, limitOnly = { ...none, maxOutputTokens: true };
  const all = { ...none, maxOutputTokens: true, tools: true, outputSchema: true, thinking: true };
  expect(() => assertSettingsSupported(undefined, undefined)).not.toThrow();
  expect(() => assertSettingsSupported(none, undefined)).not.toThrow();
  expect(() => assertSettingsSupported(undefined, {})).toThrow('Generation settings are not supported by this route');
  expect(() => assertSettingsSupported({ ...limitOnly, schema: 'other' }, { maxOutputTokens: 4 })).toThrow('not supported by this route');
  expect(() => assertSettingsSupported(none, {})).not.toThrow();
  expect(() => assertSettingsSupported(limitOnly, { maxOutputTokens: 4 })).not.toThrow();
  expect(() => assertSettingsSupported(none, { maxOutputTokens: 4 })).toThrow('Generation setting maxOutputTokens is not supported');
  expect(() => assertSettingsSupported(limitOnly, { maxOutputTokens: 4, tools: [weather], outputSchema: {}, thinking: 'on' })).toThrow('Generation setting tools is not supported');
  expect(() => assertSettingsSupported({ ...all, outputSchema: false }, { tools: [weather], outputSchema: {}, thinking: 'on' })).toThrow('Generation setting outputSchema is not supported');
  expect(() => assertSettingsSupported({ ...all, thinking: false }, { thinking: 'off' })).toThrow(expect.objectContaining({
    message: 'Generation setting thinking is not supported by this route', code: 'GENERATION_SETTINGS_UNSUPPORTED', setting: 'thinking' }));
  expect(() => assertSettingsSupported(all, { maxOutputTokens: 4, tools: [weather], outputSchema: {}, thinking: 'on' })).not.toThrow();
});

it('accepts only a complete capability and intersects providers flag by flag', () => {
  const limitOnly = { ...GENERATION_SETTINGS_CAPABILITY, maxOutputTokens: true };
  expect(normalizeGenerationSettingsCapability(limitOnly)).toEqual(limitOnly);
  for (const value of [undefined, null, {}, { ...limitOnly, tools: 1 }, { ...limitOnly, extra: true }, { maxOutputTokens: true }]) {
    expect(normalizeGenerationSettingsCapability(value)).toBeNull();
  }
  expect(intersectGenerationSettingsCapabilities([])).toBeNull();
  expect(intersectGenerationSettingsCapabilities([limitOnly, undefined])).toBeNull();
  expect(intersectGenerationSettingsCapabilities([{ ...limitOnly, tools: true }, { ...limitOnly, thinking: true }])).toEqual(limitOnly);
});

it('turns the chat completions output limit into settings and leaves a request without one unchanged', () => {
  const input = { model: 'model', messages: [{ role: 'user', content: 'hello' }] };
  expect(parseTextChatCompletion(input)).toEqual({ model: 'model', messages: input.messages, stream: false });
  expect(Object.keys(parseTextChatCompletion(input))).toEqual(['model', 'messages', 'stream']);
  const expected = normalizeGenerationSettings({ maxOutputTokens: 12 });
  expect(parseTextChatCompletion({ ...input, max_completion_tokens: 12 }).settings).toEqual(expected);
  expect(parseTextChatCompletion({ ...input, max_tokens: 12 }).settings).toEqual(expected);
  expect(parseTextChatCompletion({ ...input, max_tokens: 12, max_completion_tokens: 12 }).settings).toEqual(expected);
  expect(() => parseTextChatCompletion({ ...input, max_tokens: 12, max_completion_tokens: 13 })).toThrow('differ');
  for (const value of [0, -1, 1.5, '12', null, 4097]) {
    expect(() => parseTextChatCompletion({ ...input, max_completion_tokens: value })).toThrow('max_completion_tokens must be a positive integer');
  }
});
