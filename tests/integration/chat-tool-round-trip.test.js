// @vitest-environment node
// The Chat Completions tool-call round trip through the stock OpenAI SDK, against the fixture in
// tests/helpers/tool-round-trip.js: everything but the Doppler session is the real path. The model
// is scripted, so this shows the contract, the constraint and the refusals, not what a model does.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { verifyReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { effectiveRequestDigest, normalizeGenerationSettings } from '../../packages/reploid/src/mesh/generation-settings.js';
import { expectedConstraintIdentity } from '../../shared/infrastructure/tool-call-constraint.js';
import { parseToolCallOutput, toolCallId } from '../../shared/infrastructure/tool-call-format.js';
import { parseTextChatCompletion } from '../../server/chat-completions.js';
import { addCall, addTool, callText, createToolRoundTrip, question, roundTripPlan, token } from '../helpers/tool-round-trip.js';

let OpenAI = null, unavailable = null;
try { OpenAI = (await import('openai')).default; }
catch (error) { unavailable = `the optional openai package is not installed (${error.code || error.message})`; }
const sdk = unavailable ? it.skip : it;
if (unavailable) console.warn(`Skipping the OpenAI SDK tool round trip: ${unavailable}`);

const trip = createToolRoundTrip();
beforeEach(() => trip.setup());
afterEach(() => trip.teardown());

const tools = [{ type: 'function', function: addTool }];
const user = { role: 'user', content: question };
const client = f => new OpenAI({ apiKey: token, baseURL: f.url, maxRetries: 0 });
const settingsOf = toolChoice => normalizeGenerationSettings({ tools: [addTool], toolChoice });
const execute = call => String(Object.values(JSON.parse(call.function.arguments)).reduce((sum, value) => sum + value, 0));
/** The signed, settled receipt of the `index`-th request binds these messages and settings. */
async function expectReceipt(f, index, messages, settings) {
  const receipt = f.sent('reploid:receipt')[index].receipt;
  expect(receipt).toMatchObject({ version: 3, provider: f.keys[1].peerId, consumer: f.keys[0].peerId,
    settingsDigest: await effectiveRequestDigest({ modelIdentity: f.model.identity, adapterIdentities: [], messages, settings }) });
  const constraint = await expectedConstraintIdentity(settings);
  if (constraint) expect(receipt.constraintIdentity).toBe(constraint);
  else expect(receipt).not.toHaveProperty('constraintIdentity');
  expect(await verifyReceipt(receipt)).toEqual({ valid: true, providerValid: true, consumerValid: true });
  expect(f.row(index).binding.settingsDigest).toBe(receipt.settingsDigest);
  return receipt;
}

sdk('completes a forced call, its tool result and the final answer through the OpenAI SDK, settling each turn once', async () => {
  const f = await trip.open();
  try {
    expect(f.provider.getGenerationSettingsCapability()).toMatchObject({ maxOutputTokens: true, tools: true, outputSchema: false, thinking: false });
    const first = await client(f).chat.completions.create({ model: f.model.id, messages: [user], tools, tool_choice: 'required' });
    const [choice] = first.choices;
    expect(choice.finish_reason).toBe('tool_calls');
    expect(choice.message).toMatchObject({ role: 'assistant', content: null,
      tool_calls: [{ id: expect.stringMatching(/^call_[a-f0-9]{24}$/), type: 'function', function: { name: 'add', arguments: '{"a":2,"b":3}' } }] });
    expect(choice.message.tool_calls).toHaveLength(1);
    // The model was given rendered plain messages with the tools block, a mask and its identity.
    expect(f.seen[0].messages.map(message => message.role)).toEqual(['system', 'user']);
    expect(f.seen[0].messages[0].content).toContain('<tools>\n{"type": "function", "function": {"name": "add"');
    expect(f.seen[0].options.logitMaskFn).toBeTypeOf('function');
    expect(f.seen[0].options.logitMaskIdentity).toEqual({ id: 'reploid.output-constraint/v1', contentDigest: await expectedConstraintIdentity(settingsOf('required')) });
    await f.settled(1);
    await expectReceipt(f, 0, [user], settingsOf('required'));
    expect(first.usage.completion_tokens).toBe(f.row(0).outcome.outputTokens);

    // The caller runs the tool and returns the assistant message exactly as it received it.
    const call = choice.message.tool_calls[0], result = execute(call);
    expect(result).toBe('5');
    const second = await client(f).chat.completions.create({ model: f.model.id, tools,
      messages: [user, choice.message, { role: 'tool', tool_call_id: call.id, content: result }] });
    expect(second.choices[0]).toMatchObject({ finish_reason: 'stop', message: { role: 'assistant', content: 'The sum is 5.' } });
    expect(second.choices[0].message.tool_calls).toBeUndefined();
    // The id the caller sent back is kept in the canonical messages the provider received and digested.
    const history = [user, { role: 'assistant', content: '', toolCalls: [{ id: call.id, name: 'add', arguments: { a: 2, b: 3 } }] },
      { role: 'tool', toolCallId: call.id, content: '5' }];
    expect(f.executed[1]).toEqual({ messages: history, settings: settingsOf('auto') });
    expect(f.seen[1].messages.map(message => message.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(f.seen[1].messages[2].content).toBe(addCall);
    expect(f.seen[1].messages[3].content).toBe('<tool_response>\n5\n</tool_response>');
    await f.settled(2);
    await expectReceipt(f, 1, history, settingsOf('auto'));
    const charged = f.row(0).outcome.charge + f.row(1).outcome.charge;
    expect(f.amounts()).toEqual([{ balance: -charged, held: 0 }, { balance: charged, held: 0 }]);
  } finally { await f.close(); }
});

sdk('streams the same round trip: nothing until the call has validated, then the call, then text as it arrives', async () => {
  const f = await trip.open();
  try {
    const chunks = [];
    const stream = client(f).beta.chat.completions.stream({ model: f.model.id, messages: [user], tools, tool_choice: 'required', stream: true });
    for await (const chunk of stream) chunks.push(chunk);
    const first = await stream.finalChatCompletion();
    expect(first.choices[0]).toMatchObject({ finish_reason: 'tool_calls',
      message: { role: 'assistant', tool_calls: [{ type: 'function', function: { name: 'add', arguments: '{"a":2,"b":3}' } }] } });
    // The wire: one announcement with the id and name, argument fragments, then the finish chunk.
    const deltas = chunks.map(chunk => chunk.choices[0]);
    expect(deltas.every(choice => !choice.delta.content)).toBe(true);
    expect(deltas[0]).toMatchObject({ finish_reason: null, delta: { role: 'assistant', content: null,
      tool_calls: [{ index: 0, id: first.choices[0].message.tool_calls[0].id, type: 'function', function: { name: 'add', arguments: '' } }] } });
    expect(deltas.slice(1, -1).map(choice => choice.delta.tool_calls[0].function.arguments).join('')).toBe('{"a":2,"b":3}');
    expect(deltas.slice(1, -1).every(choice => choice.delta.tool_calls[0].id === undefined && choice.delta.tool_calls[0].index === 0)).toBe(true);
    expect(deltas.at(-1)).toMatchObject({ finish_reason: 'tool_calls', delta: {} });
    await f.settled(1);
    expect(chunks.at(-1).usage.completion_tokens).toBe(f.row(0).outcome.outputTokens);
    await expectReceipt(f, 0, [user], settingsOf('required'));

    const call = first.choices[0].message.tool_calls[0];
    expect(call.id).toMatch(/^call_[a-f0-9]{24}$/);
    const text = [];
    // The stream helper adds its own `parsed` fields to the message, so the turn is sent back in the wire shape.
    const assistant = { role: 'assistant', content: null,
      tool_calls: [{ id: call.id, type: 'function', function: { name: call.function.name, arguments: call.function.arguments } }] };
    const next = client(f).beta.chat.completions.stream({ model: f.model.id, tools, stream: true,
      messages: [user, assistant, { role: 'tool', tool_call_id: call.id, content: execute(call) }] });
    for await (const chunk of next) if (chunk.choices[0].delta.content) text.push(chunk.choices[0].delta.content);
    const second = await next.finalChatCompletion();
    expect(second.choices[0]).toMatchObject({ finish_reason: 'stop', message: { content: 'The sum is 5.' } });
    // Text that cannot be a call is released as the provider's own deltas, not as one block.
    expect(text.join('')).toBe('The sum is 5.');
    expect(text.length).toBeGreaterThan(1);
    await f.settled(2);
  } finally { await f.close(); }
});

it.each([
  ['free text', ['The sum is 5.', addCall], 'The sum is 5.'],
  ['a tool that was not declared', [callText('subtract', '{"a": 2, "b": 3}'), addCall], callText('subtract', '{"a": 2, "b": 3}')],
  ['an argument of the wrong type', [callText('add', '{"a": "two", "b": 3}'), addCall], callText('add', '{"a": "two", "b": 3}')]
])('forces a valid call from a model that prefers %s', async (_label, scripts, preferred) => {
  // Without the mask the same scripted model writes its first preference, which is not a valid call.
  const loose = await trip.open({ plan: () => scripts, unmasked: true });
  try {
    const response = await loose.post('/chat/completions', { model: loose.model.id, messages: [user], tools, tool_choice: 'required' });
    expect(response.status).toBe(502);
    expect(loose.sent('reploid:generation-result')[0].response.content).toBe(preferred);
    expect(parseToolCallOutput(preferred, settingsOf('required'))).toMatchObject({ toolCalls: [] });
  } finally { await loose.close(); }
  // With it, every token outside the constraint is removed before the choice and the call is valid.
  const f = await trip.open({ plan: () => scripts });
  try {
    const response = await f.post('/chat/completions', { model: f.model.id, messages: [user], tools, tool_choice: 'required' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.choices[0]).toMatchObject({ finish_reason: 'tool_calls', message: { content: null,
      tool_calls: [{ id: toolCallId(response.headers.get('x-reploid-attempt-id'), 0), function: { name: 'add' } }] } });
    expect(JSON.parse(body.choices[0].message.tool_calls[0].function.arguments)).toEqual({ a: expect.any(Number), b: 3 });
    const output = f.sent('reploid:generation-result')[0].response.content;
    expect(output).not.toBe(preferred);
    expect(parseToolCallOutput(output, settingsOf('required'))).toMatchObject({ complete: true, error: null, text: '', toolCalls: [{ name: 'add' }] });
    await f.settled(1);
  } finally { await f.close(); }
});

it.each([
  ['the tool choice', payload => { payload.settings.toolChoice = 'auto'; }],
  ['a tool schema', payload => { payload.settings.tools[0].parameters.properties.a.type = 'number'; }],
  ['the tool list', payload => { payload.settings.tools.push({ name: 'subtract', description: '', parameters: payload.settings.tools[0].parameters }); }]
])('refuses %s changed on the wire after the quote was accepted, before the provider runs', async (_label, alter) => {
  const f = await trip.open({ intercept: (type, payload) => { if (type === 'reploid:generation-request') alter(payload); } });
  try {
    const response = await f.post('/chat/completions', { model: f.model.id, messages: [user], tools, tool_choice: 'required' });
    expect(response.status).toBe(502);
    expect((await response.json()).error.message).toContain('Generation settings differ from credit admission');
    expect(f.executed).toEqual([]);
    expect(f.seen).toEqual([]);
    expect(f.sent('reploid:receipt')).toEqual([]);
    await vi.waitFor(() => expect(f.amounts()).toEqual([{ balance: 0, held: 0 }, { balance: 0, held: 0 }]));
    expect(f.journal()).toEqual([]);
  } finally { await f.close(); }
});

it('ends a call cut off by the output limit with length and nothing executable, streaming or not', async () => {
  const f = await trip.open();
  try {
    const body = { model: f.model.id, messages: [user], tools, tool_choice: 'required', max_completion_tokens: 8 };
    const response = await f.post('/chat/completions', body);
    expect(response.status).toBe(200);
    const completion = await response.json();
    expect(completion.choices[0]).toEqual({ index: 0, message: { role: 'assistant', content: null, refusal: null }, logprobs: null, finish_reason: 'length' });
    expect(completion.usage.completion_tokens).toBe(8);
    // The provider did generate the start of a call; none of it reached the caller.
    const partial = f.sent('reploid:generation-result')[0].response.content;
    expect(addCall.startsWith(partial) && partial.length < addCall.length).toBe(true);

    const streamed = await (await f.post('/chat/completions', { ...body, stream: true })).text();
    const chunks = streamed.trim().split('\n\n').map(row => row.slice(6));
    expect(chunks.pop()).toBe('[DONE]');
    expect(chunks.map(JSON.parse).map(chunk => chunk.choices[0])).toEqual([{ index: 0, delta: {}, logprobs: null, finish_reason: 'length' }]);
    await f.settled(2);
  } finally { await f.close(); }
});

it('refuses an unsupported schema keyword before any reservation and accepts descriptive ones', async () => {
  const f = await trip.open();
  try {
    const withSchema = parameters => ({ model: f.model.id, messages: [user], tool_choice: 'required',
      tools: [{ type: 'function', function: { ...addTool, parameters } }] });
    for (const [keyword, parameters] of [
      ['minimum', { ...addTool.parameters, properties: { a: { type: 'integer', minimum: 0 }, b: { type: 'integer' } } }],
      ['anyOf', { ...addTool.parameters, properties: { a: { anyOf: [{ type: 'integer' }] }, b: { type: 'integer' } } }],
      ['additionalProperties', { ...addTool.parameters, additionalProperties: true }]
    ]) {
      const response = await f.post('/chat/completions', withSchema(parameters));
      expect(response.status).toBe(400);
      const { error } = await response.json();
      expect(error).toMatchObject({ type: 'invalid_request_error', param: 'tools[0].function.parameters' });
      expect(error.message).toContain(`Tool "add": Unsupported JSON Schema keyword "${keyword}"`);
    }
    expect((await f.post('/chat/completions', withSchema({ type: 'string' }))).status).toBe(400);
    expect(f.reservations).toEqual([]);
    expect(f.sent('reploid:generation-request')).toEqual([]);

    // Keywords that only describe a value are dropped; a property that happens to be named `default` is kept.
    const described = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'add', $comment: 'two addends', ...addTool.parameters,
      properties: { a: { type: 'integer', default: 0, examples: [2], description: 'first' }, b: { type: 'integer', title: 'second' } } };
    const response = await f.post('/chat/completions', withSchema(described));
    expect(response.status).toBe(200);
    expect((await response.json()).choices[0].message.tool_calls[0].function).toEqual({ name: 'add', arguments: '{"a":2,"b":3}' });
    expect(f.executed[0].settings.tools[0].parameters).toEqual({ ...addTool.parameters,
      properties: { a: { type: 'integer', description: 'first' }, b: { type: 'integer', title: 'second' } } });
    const named = parseTextChatCompletion(withSchema({ type: 'object', properties: { default: { type: 'string', default: 'x' } } }));
    expect(named.settings.tools[0].parameters).toEqual({ type: 'object', properties: { default: { type: 'string' } } });
  } finally { await f.close(); }
});

it('refuses a call that breaks the schema before countersigning: never surfaced, never settled', async () => {
  const invalid = callText('add', '{"a": "two", "b": 3}');
  const f = await trip.open({ plan: () => [invalid], unmasked: true });
  try {
    for (const stream of [false, true]) {
      const response = await f.post('/chat/completions', { model: f.model.id, messages: [user], tools, tool_choice: 'required', stream });
      expect(response.status).toBe(502);
      const text = await response.text();
      expect(JSON.parse(text).error.message).toContain('Provider output violates the generation settings of this request');
      expect(text).not.toContain('tool_calls');
      expect(text).not.toContain('two');
    }
    // The provider sent the invalid call and signed that it applied the constraint. The requester
    // read the answer before countersigning, so no receipt went back and nothing was charged.
    expect(f.sent('reploid:generation-result').map(result => result.response.content)).toEqual([invalid, invalid]);
    expect(f.sent('reploid:receipt')).toEqual([]);
    expect(f.journal()).toEqual([]);
    expect(f.amounts()[1]).toEqual({ balance: 0, held: 0 });
  } finally { await f.close(); }
});

it.each([
  ['another constraint identity', result => ({ ...result, constraintIdentity: 'sha256:' + 'e'.repeat(64) })],
  ['no constraint identity', ({ constraintIdentity: _applied, ...result }) => result]
])('refuses a provider that reports %s and does not settle it', async (_label, misreport) => {
  const f = await trip.open({ execute: async (provider, messages, update, controls) => misreport(await provider.generate(messages, update, controls)) });
  try {
    const response = await f.post('/chat/completions', { model: f.model.id, messages: [user], tools, tool_choice: 'required' });
    expect(response.status).toBe(502);
    expect((await response.json()).error.message).toContain('Receipt does not bind the generation settings of this request');
    expect(f.sent('reploid:receipt')).toEqual([]);
    expect(f.row().state).not.toBe('settled');
    expect(f.journal()).toEqual([]);
    expect(f.amounts()[1]).toEqual({ balance: 0, held: 0 });
  } finally { await f.close(); }
});

it('refuses tools on a route that does not advertise them, before authorization, reservation or disclosure', async () => {
  const f = await trip.open({ toolCallFormat: null });
  try {
    expect(f.provider.getGenerationSettingsCapability()).toMatchObject({ maxOutputTokens: true, tools: false });
    const response = await f.post('/chat/completions', { model: f.model.id, messages: [user], tools });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatchObject({ message: 'Generation setting tools is not supported by this route', param: 'tools' });
    expect(f.reservations).toEqual([]);
    expect(f.sent('reploid:generation-request')).toEqual([]);
    expect(f.executed).toEqual([]);
  } finally { await f.close(); }
});

it('keeps a plain chat request exactly as before: no settings on the wire, no rendering, no mask', async () => {
  const f = await trip.open({ plan: roundTripPlan });
  try {
    const response = await f.post('/chat/completions', { model: f.model.id, messages: [user] });
    expect(response.status).toBe(200);
    expect((await response.json()).choices[0]).toEqual({ index: 0, message: { role: 'assistant', content: 'The sum is 5.', refusal: null },
      logprobs: null, finish_reason: 'stop' });
    expect(Object.keys(f.sent('reploid:generation-request')[0]).sort()).toEqual(['adapterIdentities', 'consumer', 'contextId', 'messages',
      'model', 'modelContract', 'modelIdentity', 'provider', 'recoverable', 'requestId']);
    expect(f.executed).toEqual([{ messages: [user], settings: undefined }]);
    expect(f.seen[0].messages).toEqual([user]);
    expect(f.seen[0].options).not.toHaveProperty('logitMaskFn');
    expect(f.seen[0].options).not.toHaveProperty('logitMaskIdentity');
    const { receipt } = f.sent('reploid:receipt')[0];
    expect(receipt.version).toBe(2);
    expect(receipt).not.toHaveProperty('settingsDigest');
    expect(receipt).not.toHaveProperty('constraintIdentity');
    expect(f.sent('reploid:generation-result')[0].response).not.toHaveProperty('constraintIdentity');
    await f.settled(1);
    // With tools declared but calling forbidden, messages are still rendered and nothing is masked.
    const none = await f.post('/chat/completions', { model: f.model.id, messages: [user], tools, tool_choice: 'none' });
    expect((await none.json()).choices[0]).toMatchObject({ finish_reason: 'stop', message: { content: 'The sum is 5.' } });
    expect(f.seen[1].messages).toEqual([user]);
    expect(f.seen[1].options).not.toHaveProperty('logitMaskFn');
    expect(f.sent('reploid:receipt')[1].receipt).toMatchObject({ version: 3 });
    expect(f.sent('reploid:receipt')[1].receipt).not.toHaveProperty('constraintIdentity');
  } finally { await f.close(); }
});
