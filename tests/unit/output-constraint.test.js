import { describe, expect, it } from 'vitest';
import {
  assertSupportedSchema, compileConstraint, compileConstraintWithIdentity, constraintIdentitySource,
  createLogitMask, logitMaskIdentity, validateAgainstSchema
} from '../../shared/infrastructure/output-constraint.js';
import { parseToolCallOutput } from '../../shared/infrastructure/tool-call-format.js';

// A small vocabulary with the shapes a real one has: every printable ASCII character,
// pieces that straddle structural boundaries, strict prefixes of other pieces,
// whitespace runs, and tokens with no usable text.
function fakeTokenizer(extra = []) {
  const pieces = [];
  for (let code = 32; code < 127; code += 1) pieces.push(String.fromCharCode(code));
  pieces.push('\n', '\t', '\n\n', '  ', '   ', '\u00e9', '\u597d',
    '"}', '":', '",', '"}}', '}}', '": "', '", "', '{"', ' "', '":"', '}\n', '\n</', '"\n', '\\"', '\\n', '\\u',
    '<tool_call>', '</tool_call>', '<tool', '_call>', '<tool_call>oops', '<think>',
    'true', 'false', 'null', 'tr', 'name', 'arguments', 'get', 'get_weather', 'city', 'hello', ' world', '12', '0.5', ...extra);
  const END = pieces.length, PAD = END + 1, PARTIAL = END + 2, UNUSED = END + 3;
  const index = new Map(pieces.map((text, id) => [text, id]));
  const textOf = (id, skipSpecial) => {
    if (id === PARTIAL) return '\ufffd';
    if (id === END || id === PAD) return skipSpecial ? '' : '<|end|>';
    return pieces[id] ?? '';
  };
  return {
    END, PAD, PARTIAL, UNUSED, vocabSize: END + 4, pieces,
    id: text => index.get(text),
    decode(ids, skipSpecial = true, trim = true) {
      const text = ids.map(id => textOf(id, skipSpecial)).join('');
      return trim ? text.trim() : text;
    },
    // Longest-match encoding, the tokenization a model would most plausibly emit.
    encode(text) {
      const ids = [];
      for (let at = 0; at < text.length;) {
        let length = Math.min(16, text.length - at);
        while (!index.has(text.slice(at, at + length))) length -= 1;
        ids.push(index.get(text.slice(at, at + length)));
        at += length;
      }
      return ids;
    }
  };
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const allowedIds = logits => [...logits.keys()].filter(id => logits[id] !== -Infinity);
function maskAt(tokenizer, constraint, ids, endTokenIds = [tokenizer.END]) {
  const logits = new Float32Array(tokenizer.vocabSize).fill(1);
  createLogitMask({ constraint, endTokenIds })(logits, { generatedIds: ids, tokenizer, vocabSize: tokenizer.vocabSize });
  return logits;
}

// Greedy decoding against random logits: the model has no idea what a tool call is and
// the mask alone has to produce one. After `patience` steps closing punctuation is
// favoured so every run ends.
function generate({ tokenizer, constraint, seed, start = [], patience = 30, inspect = null }) {
  const next = random(seed), mask = createLogitMask({ constraint, endTokenIds: [tokenizer.END] });
  const closers = tokenizer.pieces.map(text => /["}\]]/.test(text));
  const ids = [...start], logits = new Float32Array(tokenizer.vocabSize);
  for (let step = 0; step < 2000; step += 1) {
    for (let id = 0; id < logits.length; id += 1) logits[id] = next() + (step > patience && closers[id] ? 1 : 0);
    if (step > patience) logits[tokenizer.END] += 2;
    mask(logits, { generatedIds: ids, tokenizer, vocabSize: tokenizer.vocabSize });
    if (inspect) inspect(ids, logits);
    let best = 0;
    for (let id = 1; id < logits.length; id += 1) if (logits[id] > logits[best]) best = id;
    if (logits[best] === -Infinity) throw new Error('the mask allowed no token');
    if (best === tokenizer.END) return tokenizer.decode(ids, true, false);
    ids.push(best);
  }
  throw new Error('generation did not end');
}

const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const WEATHER = { name: 'get_weather', description: 'Weather for a city', parameters: object({
  city: { type: 'string' }, unit: { type: 'string', enum: ['celsius', 'fahrenheit'] }, days: { type: 'integer' } }, ['city']) };
const PING = { name: 'get', description: 'No arguments', parameters: { type: 'object', properties: {} } };
const ORDER = { name: 'place-order_2', description: 'Nested arguments', parameters: object({
  customer: object({ name: { type: 'string', maxLength: 6 }, vip: { type: 'boolean' }, note: { type: 'null' } }, ['name']),
  lines: { type: 'array', minItems: 1, maxItems: 3, items: object({ sku: { type: 'string', enum: ['a', 'ab', 'abc'] }, qty: { type: 'integer' } }) },
  total: { type: 'number' },
  mode: { const: 'express' },
  tags: { type: 'array', items: { type: 'string', maxLength: 3 } },
  grid: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'array', maxItems: 2, items: { enum: [1, 10, 1.5, true, null, 'x'] } } }
}, ['customer', 'lines', 'total']) };

describe('schema subset', () => {
  it('accepts the documented keywords', () => {
    for (const tool of [WEATHER, PING, ORDER]) expect(() => assertSupportedSchema(tool.parameters)).not.toThrow();
    expect(() => assertSupportedSchema({ title: 'T', description: 'D', type: 'string', maxLength: 0 })).not.toThrow();
    expect(() => assertSupportedSchema({ enum: ['a', 1, false, null] })).not.toThrow();
  });

  it.each([
    ['$ref', { $ref: '#/x' }], ['anyOf', { anyOf: [{ type: 'string' }] }], ['oneOf', { oneOf: [{ type: 'string' }] }],
    ['pattern', { type: 'string', pattern: '^a' }], ['format', { type: 'string', format: 'date' }],
    ['minimum', { type: 'number', minimum: 0 }], ['minLength', { type: 'string', minLength: 1 }],
    ['default', { type: 'string', default: 'x' }],
    ['additionalProperties', { type: 'object', properties: {}, additionalProperties: true }],
    ['additionalProperties', { type: 'object', additionalProperties: { type: 'string' } }],
    ['type', { type: ['string', 'null'] }], ['type', { type: 'date' }],
    ['items', { type: 'array', items: [{ type: 'string' }] }], ['maxLength', { type: 'integer', maxLength: 3 }],
    ['enum', { enum: [{ a: 1 }] }], ['enum', { type: 'string', enum: ['a', 2] }], ['const', { const: [1] }],
    ['required', { type: 'object', properties: {}, required: ['missing'] }],
    ['minItems', { type: 'array', items: { type: 'null' }, minItems: 3, maxItems: 2 }]
  ])('rejects %s and names it', (keyword, schema) => {
    expect(() => assertSupportedSchema(schema)).toThrow(`"${keyword}"`);
    expect(() => assertSupportedSchema(object({ nested: schema }))).toThrow(`"${keyword}" at $.properties.nested`);
  });

  it('rejects open schemas and schemas past the size limits', () => {
    expect(() => assertSupportedSchema({})).toThrow('open schemas');
    expect(() => assertSupportedSchema({ type: 'array' })).toThrow('"items"');
    const nest = depth => (depth === 1 ? { type: 'null' } : { type: 'array', items: nest(depth - 1) });
    expect(() => assertSupportedSchema(nest(8))).not.toThrow();
    expect(() => assertSupportedSchema(nest(9))).toThrow('deeper than 8');
    const wide = count => object(Object.fromEntries(Array.from({ length: count }, (_, i) => [`p${i}`, { type: 'null' }])), []);
    expect(() => assertSupportedSchema(wide(64))).not.toThrow();
    expect(() => assertSupportedSchema(wide(65))).toThrow('"properties"');
    expect(() => assertSupportedSchema({ enum: Array.from({ length: 257 }, (_, i) => i) })).toThrow('"enum"');
    expect(() => assertSupportedSchema(object(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`g${i}`, wide(60)])), []))).toThrow('512 nodes');
    expect(validateAgainstSchema({ type: 'string', pattern: 'x' }, 'x')).toEqual({ valid: false, error: expect.stringContaining('"pattern"') });
  });
});

describe('validator and acceptor', () => {
  const schema = ORDER.parameters;
  const constraint = compileConstraint({ kind: 'json', schema });
  const accepted = text => {
    const state = constraint.advance(constraint.start(), text);
    return state !== null && constraint.isAccepting(state);
  };

  it.each([
    [true, '{"customer": {"name": "Ada"}, "lines": [{"sku": "ab", "qty": 2}], "total": 12.5}'],
    [true, '{"customer":{"name":"A\\u00e9\\"\\\\\\n","vip":true,"note":null},"lines":[{"sku":"a","qty":-1},{"sku":"abc","qty":0}],"total":-0.5e-3,"mode":"express","tags":[],"grid":[[1,10],[1.5,true]]}'],
    [true, '{"customer": {"name": ""}, "lines": [{"sku": "a", "qty": 1}], "total": 0, "tags": ["abc", "\u00e9\u597d"], "grid": [[], [null, "x"]]}'],
    [false, '{"customer": {"name": "Ada"}, "lines": [], "total": 1}'],
    [false, '{"customer": {"name": "Ada"}, "lines": [{"sku": "a", "qty": 1}]}'],
    [false, '{"customer": {"name": "Ada Lovelace"}, "lines": [{"sku": "a", "qty": 1}], "total": 1}'],
    [false, '{"customer": {"name": "Ada", "age": 36}, "lines": [{"sku": "a", "qty": 1}], "total": 1}'],
    [false, '{"customer": {"name": "Ada", "vip": "yes"}, "lines": [{"sku": "a", "qty": 1}], "total": 1}'],
    [false, '{"customer": {"name": "Ada"}, "lines": [{"sku": "abcd", "qty": 1}], "total": 1}'],
    [false, '{"customer": {"name": "Ada"}, "lines": [{"sku": "a", "qty": 1.5}], "total": 1}'],
    [false, '{"customer": {"name": "Ada"}, "lines": [{"sku": "a", "qty": 1}], "total": "1"}'],
    [false, '{"customer": {"name": "Ada"}, "lines": [{"sku": "a", "qty": 1}], "total": 1, "mode": "slow"}'],
    [false, '{"customer": {"name": "Ada"}, "lines": [{"sku": "a", "qty": 1}], "total": 1, "tags": ["abcd"]}'],
    [false, '{"customer": {"name": "Ada"}, "lines": [{"sku": "a", "qty": 1}], "total": 1, "grid": [[1]]}'],
    [false, '{"customer": {"name": "Ada"}, "lines": [{"sku": "a", "qty": 1}], "total": 1, "grid": [[1], [2]]}'],
    [false, '{"customer": {"name": "Ada"}, "lines": [{"sku": "a", "qty": 1}, {"sku": "a", "qty": 1}, {"sku": "a", "qty": 1}, {"sku": "a", "qty": 1}], "total": 1}'],
    [false, '{"customer": null, "lines": [{"sku": "a", "qty": 1}], "total": 1}'],
    [false, '[]']
  ])('agree (%s) on %s', (valid, text) => {
    expect(validateAgainstSchema(schema, JSON.parse(text)).valid).toBe(valid);
    expect(accepted(text)).toBe(valid);
  });

  it('validates properties in any order but generates them in declared order', () => {
    const text = '{"total": 1, "lines": [{"qty": 1, "sku": "a"}], "customer": {"name": "Ada"}}';
    expect(validateAgainstSchema(schema, JSON.parse(text))).toEqual({ valid: true, error: null });
    expect(accepted(text)).toBe(false);
    expect(validateAgainstSchema(schema, { customer: { name: 'Ada' }, lines: [{ sku: 'a', qty: 1 }] }).error).toBe('$: missing required property "total"');
  });

  it('bounds whitespace and number length so output cannot stall', () => {
    const call = compileConstraint({ kind: 'tool-call', tools: [WEATHER], toolChoice: 'required' });
    const prefix = text => call.advance(call.start(), text) !== null;
    expect(prefix('\n\n<tool_call>\n\n{"name": "get_weather", "arguments": {"city": "x", "days": 1}}\n\n</tool_call>\n\n')).toBe(true);
    expect(prefix('\n\n\n')).toBe(false);
    expect(prefix('<tool_call>\n{"name":  ')).toBe(false);
    expect(prefix('<tool_call>\n{ ')).toBe(false);
    expect(prefix('<tool_call>\n{"name": "get_weather", "arguments": {"city": "x" ')).toBe(false);
    expect(prefix('<tool_call>\n{"name": "get_weather", "arguments": {"city": "x", "days": 1234567890123456')).toBe(true);
    expect(prefix('<tool_call>\n{"name": "get_weather", "arguments": {"city": "x", "days": 12345678901234567')).toBe(false);
    expect(prefix('<tool_call>\n{"name": "get_weather", "arguments": {"city": "x", "days": 01')).toBe(false);
  });

  it('interns states, so equal states are one reference whatever text reached them', () => {
    const call = compileConstraint({ kind: 'tool-call', tools: [WEATHER, PING], toolChoice: 'required' });
    const whole = call.advance(call.start(), '<tool_call>\n{"name": "get_weather", "arguments": {"city": "ab');
    const pieces = ['<tool', '_call>', '\n{"', 'name": "get', '_weather", "arguments":', ' {"city": "zzzzzz']
      .reduce((state, text) => call.advance(state, text), call.start());
    expect(pieces).toBe(whole);
    expect(call.advance(whole, '')).toBe(whole);
    expect(call.advance(whole, '\n')).toBe(null);
  });
});

describe('constraint identity', () => {
  const spec = { kind: 'tool-call', tools: [WEATHER, PING], toolChoice: 'auto' };

  it('depends on what is accepted and on nothing else', () => {
    const reworded = { kind: 'tool-call', toolChoice: 'auto', tools: [
      { ...PING, description: 'changed' },
      { name: 'get_weather', description: '', parameters: { required: ['city'], type: 'object', properties: {
        city: { description: 'where', type: 'string' }, unit: { enum: ['fahrenheit', 'celsius'], type: 'string' }, days: { type: 'integer', title: 'n' } } } }] };
    expect(constraintIdentitySource(reworded)).toBe(constraintIdentitySource(spec));
    const reordered = { ...spec, tools: [{ ...WEATHER, parameters: object({ unit: WEATHER.parameters.properties.unit,
      city: { type: 'string' }, days: { type: 'integer' } }, ['city']) }, PING] };
    expect(constraintIdentitySource(reordered)).not.toBe(constraintIdentitySource(spec));
    expect(constraintIdentitySource({ ...spec, toolChoice: 'required' })).not.toBe(constraintIdentitySource(spec));
    expect(constraintIdentitySource({ ...spec, toolChoice: { name: 'get' } }))
      .toBe(constraintIdentitySource({ kind: 'tool-call', tools: [PING], toolChoice: 'required' }));
  });

  it('carries a digest only when one is supplied or computed', async () => {
    expect(compileConstraint(spec).identity).toBe(null);
    expect(() => logitMaskIdentity(compileConstraint(spec))).toThrow('without an identity');
    expect(() => compileConstraint(spec, { identity: 'abc' })).toThrow('sha256');
    const constraint = await compileConstraintWithIdentity(spec);
    expect(constraint.identity).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect((await compileConstraintWithIdentity({ ...spec, tools: [PING, WEATHER] })).identity).toBe(constraint.identity);
    expect(logitMaskIdentity(constraint)).toEqual({ id: 'reploid.output-constraint/v1', contentDigest: constraint.identity });
  });

  it('rejects tool sets it cannot constrain', () => {
    expect(() => compileConstraint({ kind: 'tool-call', tools: [WEATHER], toolChoice: { name: 'other' } })).toThrow('undeclared tool');
    expect(() => compileConstraint({ kind: 'tool-call', tools: [], toolChoice: 'required' })).toThrow('at least one tool');
    expect(() => compileConstraint({ kind: 'tool-call', tools: [WEATHER, WEATHER], toolChoice: 'auto' })).toThrow('unique');
    expect(() => compileConstraint({ kind: 'tool-call', tools: [{ name: 'x', parameters: { type: 'string' } }] })).toThrow('object schema');
    expect(() => compileConstraint({ kind: 'tool-call', tools: [{ name: 'x', parameters: object({ a: { type: 'string', pattern: 'a' } }) }] }))
      .toThrow('Tool "x" parameters: Unsupported JSON Schema keyword "pattern"');
  });
});

describe('constrained generation', () => {
  const tokenizer = fakeTokenizer();
  const cases = [
    { tools: [WEATHER], toolChoice: 'required' },
    { tools: [PING], toolChoice: 'required' },
    { tools: [ORDER], toolChoice: 'required' },
    { tools: [WEATHER, PING, ORDER], toolChoice: 'required' },
    { tools: [WEATHER, PING, ORDER], toolChoice: { name: 'get' } },
    { tools: [WEATHER, PING, ORDER], toolChoice: { name: 'place-order_2' } }
  ];

  it.each(cases.map((settings, index) => [index, settings]))('case %i always yields one valid call of an allowed tool', (index, settings) => {
    const constraint = compileConstraint({ kind: 'tool-call', ...settings });
    const allowed = typeof settings.toolChoice === 'string' ? settings.tools.map(tool => tool.name) : [settings.toolChoice.name];
    const seen = new Set();
    for (let seed = 0; seed < 100; seed += 1) {
      const text = generate({ tokenizer, constraint, seed: index * 1000 + seed, patience: 10 + (seed % 5) * 15 });
      const result = parseToolCallOutput(text, settings);
      expect(result, text).toMatchObject({ text: '', complete: true, error: null });
      expect(result.toolCalls, text).toHaveLength(1);
      const [call] = result.toolCalls;
      expect(allowed).toContain(call.name);
      expect(validateAgainstSchema(settings.tools.find(tool => tool.name === call.name).parameters, call.arguments)).toEqual({ valid: true, error: null });
      seen.add(call.name);
    }
    expect([...seen].sort()).toEqual([...allowed].sort());
  });

  it('allows exactly the tokens the acceptor accepts one at a time', () => {
    const tools = [ORDER, WEATHER, PING];
    const steps = { total: 0, inBoundedText: 0 };
    for (const spec of [{ kind: 'tool-call', tools, toolChoice: 'required' }, { kind: 'tool-call', tools, toolChoice: 'auto' },
      { kind: 'json', schema: ORDER.parameters }]) {
      const constraint = compileConstraint(spec);
      for (let seed = 0; seed < 25; seed += 1) {
        generate({ tokenizer, constraint, seed, patience: 40, inspect(ids, logits) {
          const state = constraint.advance(constraint.start(), tokenizer.decode(ids, true, false));
          if (constraint.isUnconstrained(state)) return;
          const expected = [];
          for (let id = 0; id < tokenizer.vocabSize; id += 1) {
            const text = tokenizer.decode([id], true, false), reached = text ? constraint.advance(state, text) : null;
            if (id === tokenizer.END ? constraint.isAccepting(state)
              : reached !== null && (!text.includes('\ufffd') || constraint.isUnconstrained(reached))) expected.push(id);
          }
          expect(allowedIds(logits), tokenizer.decode(ids, true, false)).toEqual(expected);
          steps.total += 1;
          if (constraint.plainRun(state) >= 0 && constraint.plainRun(state) < 4) steps.inBoundedText += 1;
        } });
      }
    }
    // The walk's shortcut for bounded strings near their limit was exercised, not just reachable.
    expect(steps.total).toBeGreaterThan(1000);
    expect(steps.inBoundedText).toBeGreaterThan(50);
  });

  it('keeps a string with tags, quotes, backslashes, newlines and non-ASCII text intact', () => {
    const settings = { tools: [WEATHER], toolChoice: 'required' };
    const city = 'He said "hi" \\ </tool_call>\n\tline two \u00e9\u597d {"name": 1}';
    const output = `<tool_call>\n{"name": "get_weather", "arguments": {"city": ${JSON.stringify(city)}}}\n</tool_call>`;
    const constraint = compileConstraint({ kind: 'tool-call', ...settings });
    const mask = createLogitMask({ constraint, endTokenIds: [tokenizer.END] });
    const wanted = tokenizer.encode(output), ids = [];
    const opened = tokenizer.encode(output.slice(0, output.indexOf('He said'))).length;
    const closing = wanted.length - tokenizer.encode('"}}\n</tool_call>').length;
    for (let step = 0; step <= wanted.length; step += 1) {
      // The model wants the next token of the escaped text, and failing that the end or a raw newline.
      const logits = new Float32Array(tokenizer.vocabSize);
      logits[tokenizer.END] = 5;
      logits[tokenizer.id('\n')] = 4;
      if (step < wanted.length) logits[wanted[step]] = 9;
      mask(logits, { generatedIds: ids, tokenizer, vocabSize: tokenizer.vocabSize });
      const best = allowedIds(logits).reduce((a, b) => (logits[b] > logits[a] ? b : a));
      if (step >= opened && step <= closing) expect(logits[tokenizer.id('\n')], `step ${step}`).toBe(-Infinity);
      if (step === wanted.length) expect(best).toBe(tokenizer.END);
      else {
        expect(best).toBe(wanted[step]);
        ids.push(best);
      }
    }
    const result = parseToolCallOutput(tokenizer.decode(ids, true, false), settings);
    expect(result).toEqual({ text: '', toolCalls: [{ name: 'get_weather', arguments: { city } }], complete: true, error: null });
  });

  it('forces valid escapes when the model insists on raw control characters', () => {
    const settings = { tools: [WEATHER], toolChoice: 'required' };
    const constraint = compileConstraint({ kind: 'tool-call', ...settings });
    const start = tokenizer.encode('<tool_call>\n{"name": "get_weather", "arguments": {"city": "a\\');
    const afterBackslash = allowedIds(maskAt(tokenizer, constraint, start)).map(id => tokenizer.pieces[id]);
    expect(afterBackslash).toEqual(expect.arrayContaining(['"', '/', '\\', 'b', 'f', 'n', 'r', 't', 'u', 'name', '\\"']));
    expect(afterBackslash.every(text => '"/\\bfnrtu'.includes(text[0]))).toBe(true);
    expect(afterBackslash).not.toContain('\n');
    const afterU = allowedIds(maskAt(tokenizer, constraint, [...start, tokenizer.id('u')])).map(id => tokenizer.pieces[id]);
    expect(afterU).toContain('12');
    expect(afterU).not.toContain('g');
    expect(afterU.every(text => /^[0-9a-fA-F]{1,4}$/.test(text))).toBe(true);
  });
});

describe('automatic tool choice', () => {
  const tokenizer = fakeTokenizer();
  const settings = { tools: [WEATHER, PING], toolChoice: 'auto' };
  const constraint = compileConstraint({ kind: 'tool-call', ...settings });
  const texts = logits => allowedIds(logits).map(id => tokenizer.pieces[id] ?? id);

  it('leaves free text untouched', () => {
    for (const text of ['hello', 'hello world <tool_call>', '<think>', '< tool', ' \n x']) {
      const logits = maskAt(tokenizer, constraint, tokenizer.encode(text));
      expect(logits.every(value => value === 1), text).toBe(true);
    }
    const none = compileConstraint({ kind: 'tool-call', tools: [WEATHER], toolChoice: 'none' });
    expect(maskAt(tokenizer, none, []).every(value => value === 1)).toBe(true);
    expect(maskAt(tokenizer, compileConstraint({ kind: 'tool-call', tools: [] }), []).every(value => value === 1)).toBe(true);
  });

  it('keeps both readings open while the output is a prefix of the opening tag', () => {
    for (const text of ['', '\n ', '<', ' <tool', '<tool_call']) {
      const allowed = texts(maskAt(tokenizer, constraint, tokenizer.encode(text)));
      expect(allowed, text).toContain('hello');
      expect(allowed, text).toContain(tokenizer.END);
      expect(allowed, text).toContain(tokenizer.PARTIAL);
      expect(allowed, text).not.toContain(tokenizer.PAD);
      const state = constraint.advance(constraint.start(), text);
      expect(constraint.isAccepting(state)).toBe(true);
      expect(constraint.isUnconstrained(state)).toBe(false);
    }
    const start = texts(maskAt(tokenizer, constraint, []));
    expect(start).toEqual(expect.arrayContaining(['<', '<tool', '<tool_call>', '<think>', ' ', '\n\n']));
    expect(start).not.toContain('<tool_call>oops');
    const afterAngle = texts(maskAt(tokenizer, constraint, [tokenizer.id('<')]));
    expect(afterAngle).toEqual(expect.arrayContaining(['t', 'tr', 'true', 'h', '<']));
    expect(texts(maskAt(tokenizer, constraint, tokenizer.encode('<tool')))).toEqual(expect.arrayContaining(['_call>', '_', 'x']));
  });

  it('commits to a valid call once the opening tag is complete', () => {
    for (const opening of [['<tool_call>'], ['\n', '<tool', '_call>'], ['<', 't', 'o', 'o', 'l', '_call>']]) {
      const start = opening.map(tokenizer.id);
      const committed = texts(maskAt(tokenizer, constraint, start));
      expect(committed).toEqual(expect.arrayContaining(['{', '{"', '\n', '\n\n']));
      expect(committed).not.toContain('hello');
      expect(committed).not.toContain(tokenizer.END);
      expect(committed).not.toContain(tokenizer.PARTIAL);
      for (let seed = 0; seed < 40; seed += 1) {
        const result = parseToolCallOutput(generate({ tokenizer, constraint, seed, start }), settings);
        expect(result).toMatchObject({ text: '', complete: true, error: null });
        expect(['get', 'get_weather']).toContain(result.toolCalls[0].name);
      }
    }
  });

  it('never interferes once the output is free text', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      expect(generate({ tokenizer, constraint, seed, start: [tokenizer.id('hello')], patience: 5 }).startsWith('hello')).toBe(true);
    }
  });
});

describe('end tokens and dead ends', () => {
  const tokenizer = fakeTokenizer();
  const constraint = compileConstraint({ kind: 'tool-call', tools: [PING], toolChoice: 'required' });
  const call = '<tool_call>\n{"name": "get", "arguments": {}}\n</tool_call>';

  it('allows end tokens exactly when the output is complete', () => {
    const ids = tokenizer.encode(call);
    for (let length = 0; length < ids.length; length += 1) {
      const logits = maskAt(tokenizer, constraint, ids.slice(0, length));
      expect(logits[tokenizer.END], `after ${length} tokens`).toBe(-Infinity);
      expect(allowedIds(logits).length).toBeGreaterThan(0);
    }
    const done = maskAt(tokenizer, constraint, ids);
    expect(done[tokenizer.END]).toBe(1);
    expect(allowedIds(done).map(id => tokenizer.pieces[id] ?? id).sort()).toEqual([tokenizer.END, '\t', '\n', '\n\n', ' ', '  '].sort());
    expect(allowedIds(maskAt(tokenizer, constraint, [...ids, tokenizer.id('\n\n')]))).toEqual([tokenizer.END]);
    const several = maskAt(tokenizer, constraint, ids, [tokenizer.PAD, tokenizer.END, tokenizer.PAD]);
    expect(allowedIds(several)).toEqual(expect.arrayContaining([tokenizer.END, tokenizer.PAD]));
  });

  it('never offers tokens without text while constrained, or ids past the vocabulary', () => {
    const logits = new Float32Array(tokenizer.vocabSize + 8).fill(1);
    createLogitMask({ constraint, endTokenIds: [tokenizer.END] })(logits, { generatedIds: [], tokenizer, vocabSize: tokenizer.vocabSize });
    expect(allowedIds(logits).map(id => tokenizer.pieces[id]).sort()).toEqual(['\t', '\n', '\n\n', ' ', '  ', '<', '<tool', '<tool_call>'].sort());
  });

  it('follows the generated ids when they are rewound or replaced', () => {
    const mask = createLogitMask({ constraint, endTokenIds: [tokenizer.END] });
    const at = ids => {
      const logits = new Float32Array(tokenizer.vocabSize).fill(1);
      mask(logits, { generatedIds: ids, tokenizer, vocabSize: tokenizer.vocabSize });
      return allowedIds(logits);
    };
    const ids = tokenizer.encode(call);
    const first = at(ids.slice(0, 3));
    expect(at(ids)).toContain(tokenizer.END);
    expect(at(ids.slice(0, 3))).toEqual(first);
    expect(at(tokenizer.encode('\n<tool'))).toEqual([tokenizer.id('_'), tokenizer.id('_call>')]);
  });

  it('throws instead of masking every token', () => {
    expect(() => maskAt(tokenizer, constraint, tokenizer.encode('hello'))).toThrow('already broken by generated token');
    expect(() => maskAt(tokenizer, constraint, tokenizer.encode(`${call}\n\n`), [])).toThrow('no token in the vocabulary may follow');
    const narrow = { vocabSize: 3, decode: ids => ids.map(id => ['a', 'b', ''][id]).join('') };
    expect(() => maskAt(narrow, constraint, [], [2])).toThrow('no token in the vocabulary may follow');
    const glued = { vocabSize: 3, decode: ids => ids.map(id => ['a', 'b', ''][id]).join(' ') };
    expect(() => maskAt(glued, constraint, [], [2])).toThrow('independently');
    expect(() => createLogitMask({ constraint: {}, endTokenIds: [] })).toThrow('compiled constraint');
  });
});
