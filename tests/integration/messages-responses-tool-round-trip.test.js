// @vitest-environment node
// The add-tool round trip of chat-tool-round-trip.test.js through the Anthropic Messages and the
// OpenAI Responses adapters, with the stock SDKs, against the same fixture: real HTTP, credits,
// meshes and native provider chain over a scripted session. No model runs.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { verifyReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { effectiveRequestDigest, normalizeGenerationSettings } from '../../packages/reploid/src/mesh/generation-settings.js';
import { expectedConstraintIdentity } from '../../shared/infrastructure/tool-call-constraint.js';
import { addCall, addTool, callText, createToolRoundTrip, question, token } from '../helpers/tool-round-trip.js';

const load = async name => { try { return { module: (await import(name)).default }; } catch (error) { return { missing: `the optional ${name} package is not installed (${error.code || error.message})` }; } };
const anthropicSdk = await load('@anthropic-ai/sdk'), openaiSdk = await load('openai');
for (const sdk of [anthropicSdk, openaiSdk]) if (sdk.missing) console.warn(`Skipping an SDK tool round trip: ${sdk.missing}`);
const withAnthropic = anthropicSdk.missing ? it.skip : it, withOpenAI = openaiSdk.missing ? it.skip : it;

const trip = createToolRoundTrip();
beforeEach(() => trip.setup());
afterEach(() => trip.teardown());

const user = { role: 'user', content: question };
const settingsOf = toolChoice => normalizeGenerationSettings({ tools: [addTool], toolChoice });
const historyOf = id => [user, { role: 'assistant', content: '', toolCalls: [{ id, name: 'add', arguments: { a: 2, b: 3 } }] },
  { role: 'tool', toolCallId: id, content: '5' }];
const sse = text => text.trim().split('\n\n').map(frame => JSON.parse(frame.split('\n')[1].slice(6)));
/** The signed, settled receipt of the `index`-th request binds these messages, settings and the expected constraint. */
async function expectReceipt(f, index, messages, settings) {
  const receipt = f.sent('reploid:receipt')[index].receipt;
  expect(receipt).toMatchObject({ version: 3, constraintIdentity: await expectedConstraintIdentity(settings),
    settingsDigest: await effectiveRequestDigest({ modelIdentity: f.model.identity, adapterIdentities: [], messages, settings }) });
  expect(await verifyReceipt(receipt)).toEqual({ valid: true, providerValid: true, consumerValid: true });
  expect(f.row(index).binding.settingsDigest).toBe(receipt.settingsDigest);
}

const anthropicTools = [{ name: addTool.name, description: addTool.description, input_schema: addTool.parameters }];
const anthropic = f => new anthropicSdk.module({ apiKey: token, baseURL: f.url.replace(/\/v1$/, ''), maxRetries: 0 });
const toolResult = (id, content) => ({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] });

withAnthropic('completes the round trip through the Anthropic SDK Messages client and settles each turn once', async () => {
  const f = await trip.open();
  try {
    const first = await anthropic(f).messages.create({ model: f.model.id, max_tokens: 1024, messages: [user], tools: anthropicTools, tool_choice: { type: 'any' } });
    expect(first).toMatchObject({ type: 'message', role: 'assistant', stop_reason: 'tool_use', stop_sequence: null,
      content: [{ type: 'tool_use', id: expect.stringMatching(/^call_[a-f0-9]{24}$/), name: 'add', input: { a: 2, b: 3 } }] });
    expect(first.content).toHaveLength(1);
    await f.settled(1);
    expect(first.usage).toEqual({ input_tokens: expect.any(Number), output_tokens: f.row(0).outcome.outputTokens });
    await expectReceipt(f, 0, [user], settingsOf('required'));

    const call = first.content[0];
    const second = await anthropic(f).messages.create({ model: f.model.id, max_tokens: 1024, tools: anthropicTools,
      messages: [user, { role: 'assistant', content: first.content }, toolResult(call.id, String(call.input.a + call.input.b))] });
    expect(second).toMatchObject({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'The sum is 5.' }] });
    expect(f.executed[1]).toEqual({ messages: historyOf(call.id), settings: settingsOf('auto') });
    expect(f.seen[1].messages.map(message => message.content).slice(2)).toEqual([addCall, '<tool_response>\n5\n</tool_response>']);
    await f.settled(2);
    await expectReceipt(f, 1, historyOf(call.id), settingsOf('auto'));
  } finally { await f.close(); }
});

withAnthropic('streams the round trip through the Anthropic SDK: the call as input_json_delta, then text', async () => {
  const f = await trip.open();
  try {
    const events = [];
    for await (const event of await anthropic(f).messages.create({ model: f.model.id, max_tokens: 1024, messages: [user], tools: anthropicTools,
      tool_choice: { type: 'tool', name: 'add' }, stream: true })) events.push(event);
    expect(events.map(event => event.type)).toEqual(['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
    // The stream opens with the provider's own input count, reported before its first token and signed at completion.
    expect(f.sent('reploid:generation-update')[0]).toEqual({ requestId: expect.any(String), usage: { inputTokens: events[0].message.usage.input_tokens } });
    expect(events[0].message).toMatchObject({ content: [], stop_reason: null, usage: { input_tokens: f.sent('reploid:receipt')[0].receipt.inputTokens, output_tokens: 0 } });
    expect(events[0].message.usage.input_tokens).toBeGreaterThan(0);
    expect(events[1]).toMatchObject({ index: 0, content_block: { type: 'tool_use', id: expect.stringMatching(/^call_[a-f0-9]{24}$/), name: 'add', input: {} } });
    expect(events.filter(event => event.type === 'content_block_delta').map(event => event.delta)).toEqual([{ type: 'input_json_delta', partial_json: '{"a":2,"b":3}' }]);
    expect(events[4]).toMatchObject({ delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: f.sent('reploid:receipt')[0].receipt.outputTokens } });
    await f.settled(1);
    await expectReceipt(f, 0, [user], settingsOf({ name: 'add' }));

    const id = events[1].content_block.id, text = [];
    const assistant = { role: 'assistant', content: [{ type: 'tool_use', id, name: 'add', input: { a: 2, b: 3 } }] };
    const stream = anthropic(f).messages.stream({ model: f.model.id, max_tokens: 1024, tools: anthropicTools, messages: [user, assistant, toolResult(id, '5')] });
    stream.on('text', delta => text.push(delta));
    expect(await stream.finalMessage()).toMatchObject({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'The sum is 5.' }] });
    expect(text.join('')).toBe('The sum is 5.');
    await f.settled(2);
  } finally { await f.close(); }
});

/** Server-sent events of a streamed response, parsed as they reach the HTTP client. */
async function* arriving(response) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const bytes of response.body) {
    buffer += decoder.decode(bytes, { stream: true });
    for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
      yield JSON.parse(buffer.slice(0, end).split('\n')[1].slice(6));
      buffer = buffer.slice(end + 2);
    }
  }
}
/** Fails, instead of waiting for ever, when nothing arrives while the provider is held open. */
const whileHeld = async reading => {
  let timer;
  try { return await Promise.race([reading, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Nothing reached the client while the provider was held open')), 2000); })]); }
  finally { clearTimeout(timer); }
};
const requestKeys = ['adapterIdentities', 'admission', 'admissionProtocol', 'consumer', 'contextId', 'messages', 'model', 'modelContract', 'modelIdentity', 'offerId', 'privacy', 'privacyBinding', 'provider', 'recoverable', 'requestId'];

it('streams a Messages answer on a whole-model route while the provider is still generating, opening with its reported input count', async () => {
  // The scripted model stops before its third token until the test has read the first text from HTTP.
  const held = Promise.withResolvers();
  const f = await trip.open({ pace: index => index === 2 ? held.promise : undefined });
  try {
    const response = await f.post('/messages', { model: f.model.id, max_tokens: 1024, messages: [user], stream: true }, { 'x-api-key': token, authorization: '' });
    expect(response.status).toBe(200);
    const stream = arriving(response), early = [];
    while (!early.some(event => event.type === 'content_block_delta')) early.push((await whileHeld(stream.next())).value);
    expect(early.map(event => event.type)).toEqual(['message_start', 'content_block_start', 'content_block_delta']);
    expect(early[0].message.usage).toEqual({ input_tokens: Math.ceil(question.length / 4), output_tokens: 0 });
    expect(early[2].delta).toEqual({ type: 'text_delta', text: 'The' });
    // The first text reached the client while the provider was held open: it has sent no result, and nothing is signed.
    expect(f.sent('reploid:generation-result')).toEqual([]);
    expect(f.sent('reploid:receipt')).toEqual([]);
    // One observation went ahead of the text, and the request itself carries no generation setting.
    expect(f.sent('reploid:generation-update')[0]).toEqual({ requestId: expect.any(String), usage: { inputTokens: Math.ceil(question.length / 4) } });
    expect(f.sent('reploid:generation-update').filter(update => 'usage' in update)).toHaveLength(1);
    expect(Object.keys(f.sent('reploid:generation-request')[0]).sort()).toEqual(requestKeys);
    held.resolve();
    const events = [...early];
    for await (const event of stream) events.push(event);
    expect(events.map(event => event.type)).toEqual(['message_start', 'content_block_start', ...Array(6).fill('content_block_delta'), 'content_block_stop', 'message_delta', 'message_stop']);
    expect(events.filter(event => event.type === 'content_block_delta').map(event => event.delta.text)).toEqual(['The', ' sum', ' is', ' ', '5', '.']);
    expect(events.at(-2)).toMatchObject({ delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 6 } });
    // The signed receipt agrees with the count the stream opened with.
    await f.settled(1);
    expect(f.sent('reploid:receipt')[0].receipt).toMatchObject({ version: 2, inputTokens: early[0].message.usage.input_tokens, outputTokens: 6 });
    expect(f.executed).toEqual([{ messages: [user], settings: undefined }]);
  } finally { held.resolve(); await f.close(); }
});

it('holds text that could still be a tool call after the early count, and streams it once it cannot be one', async () => {
  const f = await trip.open();
  try {
    // A forced call: the stream opens early, no text is published, and the call arrives whole.
    const forced = sse(await (await f.post('/messages', { model: f.model.id, max_tokens: 1024, messages: [user], tools: anthropicTools, tool_choice: { type: 'any' }, stream: true })).text());
    expect(forced.map(event => event.type)).toEqual(['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
    expect(forced[1].content_block).toMatchObject({ type: 'tool_use', name: 'add', input: {} });
    expect(forced[2].delta).toEqual({ type: 'input_json_delta', partial_json: '{"a":2,"b":3}' });
    expect(forced[0].message.usage.input_tokens).toBe(f.sent('reploid:receipt')[0].receipt.inputTokens);
    // With the choice left to the model, prose is released from the first token that cannot begin a call.
    const prose = sse(await (await f.post('/messages', { model: f.model.id, max_tokens: 1024, messages: [user], tools: anthropicTools, stream: true })).text());
    expect(prose.map(event => event.type)).toEqual(['message_start', 'content_block_start', ...Array(6).fill('content_block_delta'), 'content_block_stop', 'message_delta', 'message_stop']);
    expect(prose.filter(event => event.type === 'content_block_delta').map(event => event.delta.text).join('')).toBe('The sum is 5.');
    expect(prose[0].message.usage.input_tokens).toBe(f.sent('reploid:receipt')[1].receipt.inputTokens);
    await f.settled(2);
  } finally { await f.close(); }
});

it('refuses, unsettled, a provider whose signed input count differs from the count it reported early', async () => {
  // The provider host reports one token more before generating than its completion and receipt then sign.
  const f = await trip.open({ execute: (provider, messages, update, controls) => provider.generate(messages, update,
    { ...controls, onUsage: usage => controls.onUsage({ inputTokens: usage.inputTokens + 1 }) }) });
  try {
    const response = await f.post('/messages', { model: f.model.id, max_tokens: 1024, messages: [user], stream: true });
    const events = sse(await response.text());
    expect(events[0]).toMatchObject({ type: 'message_start', message: { usage: { input_tokens: Math.ceil(question.length / 4) + 1 } } });
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { message: 'Provider input token count differs from its early observation' } });
    expect(events.some(event => ['message_delta', 'message_stop'].includes(event.type))).toBe(false);
    // The provider signed its receipt; the requester did not countersign it, so nothing was charged.
    expect(f.sent('reploid:generation-result')[0].receipt.inputTokens).toBe(Math.ceil(question.length / 4));
    expect(f.sent('reploid:receipt')).toEqual([]);
    expect(f.journal()).toEqual([]);
    expect(f.amounts()[0]).toMatchObject({ balance: 0 });
    expect(f.amounts()[0].held).toBeGreaterThan(0);
    expect(f.row(0).state).not.toBe('settled');

    // Only a streamed Messages response publishes the early count, so only it asks for and binds it.
    // Chat Completions, Responses and an unstreamed Messages request are as before against this provider.
    const chat = (await (await f.post('/chat/completions', { model: f.model.id, messages: [user], stream: true })).text()).trim().split('\n\n');
    expect(chat.at(-1)).toBe('data: [DONE]');
    expect(chat.slice(0, -1).map(frame => JSON.parse(frame.slice(6)).choices[0].delta.content ?? '').join('')).toBe('The sum is 5.');
    const responses = sse(await (await f.post('/responses', { model: f.model.id, store: false, input: [user], max_output_tokens: 1024, stream: true })).text());
    expect(responses.at(-1)).toMatchObject({ type: 'response.completed', response: { usage: { input_tokens: Math.ceil(question.length / 4), output_tokens: 6 } } });
    expect(responses[0]).toMatchObject({ type: 'response.created' });
    expect(responses[0].response).not.toHaveProperty('usage');
    const plain = await f.post('/messages', { model: f.model.id, max_tokens: 1024, messages: [user] });
    expect(await plain.json()).toMatchObject({ content: [{ type: 'text', text: 'The sum is 5.' }], usage: { input_tokens: Math.ceil(question.length / 4), output_tokens: 6 } });
    expect(f.sent('reploid:receipt')).toHaveLength(3);
  } finally { await f.close(); }
});

it('completes a streamed Messages answer from an older provider that reports no early count, by holding its text', async () => {
  const f = await trip.open({ countsPrompt: false });
  try {
    // A plain text request, no tools: before the adapter kept text until completion this was a 502 at the first delta.
    const response = await f.post('/messages', { model: f.model.id, max_tokens: 1024, messages: [user], stream: true }, { 'x-api-key': token, authorization: '' });
    expect(response.status).toBe(200);
    const events = sse(await response.text());
    expect(events.map(event => event.type)).toEqual(['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
    expect(events[0].message.usage).toEqual({ input_tokens: Math.ceil(question.length / 4), output_tokens: 0 });
    expect(events[2].delta).toEqual({ type: 'text_delta', text: 'The sum is 5.' });
    expect(events[4]).toMatchObject({ delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 6 } });
    // No settings were sent: the request is the earlier text contract.
    expect(f.executed).toEqual([{ messages: [user], settings: undefined }]);
    expect(f.sent('reploid:receipt')[0].receipt.version).toBe(2);
    // Text was all the provider sent before its result: no observation, so the stream opened at completion.
    expect(f.sent('reploid:generation-update').some(update => 'usage' in update)).toBe(false);
    expect(f.sent('reploid:generation-update').length).toBeGreaterThan(1);
    await f.settled(1);
  } finally { await f.close(); }
});

it('authenticates Messages by x-api-key on that route only, and refuses a wrong key', async () => {
  const f = await trip.open();
  try {
    const body = { model: f.model.id, max_tokens: 1024, messages: [user] };
    expect((await f.post('/messages', body, { authorization: '', 'x-api-key': token })).status).toBe(200);
    const wrong = await f.post('/messages', body, { authorization: '', 'x-api-key': `${token}x` });
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error.type).toBe('authentication_error');
    expect((await f.post('/chat/completions', { model: f.model.id, messages: [user] }, { authorization: '', 'x-api-key': token })).status).toBe(401);
    expect(f.executed).toHaveLength(1);
  } finally { await f.close(); }
});

const responseTools = [{ type: 'function', name: addTool.name, description: addTool.description, parameters: addTool.parameters }];
const openai = f => new openaiSdk.module({ apiKey: token, baseURL: f.url, maxRetries: 0 });
const outputOf = (call, output) => ({ type: 'function_call_output', call_id: call.call_id, output });

withOpenAI('completes the round trip through the OpenAI SDK Responses client and settles each turn once', async () => {
  const f = await trip.open();
  try {
    const first = await openai(f).responses.create({ model: f.model.id, store: false, input: [user], tools: responseTools, tool_choice: 'required' });
    expect(first).toMatchObject({ object: 'response', status: 'completed', store: false, tool_choice: 'required', tools: [{ type: 'function', name: 'add' }],
      output: [{ type: 'function_call', status: 'completed', call_id: expect.stringMatching(/^call_[a-f0-9]{24}$/), name: 'add', arguments: '{"a":2,"b":3}' }] });
    expect(first.output).toHaveLength(1);
    expect(first.output_text).toBe('');
    await f.settled(1);
    await expectReceipt(f, 0, [user], settingsOf('required'));

    // Stateless: the caller sends the call back with its output; nothing is looked up by response id.
    const [call] = first.output, args = JSON.parse(call.arguments);
    const second = await openai(f).responses.create({ model: f.model.id, store: false, tools: responseTools, input: [user, call, outputOf(call, String(args.a + args.b))] });
    expect(second).toMatchObject({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'The sum is 5.' }] }] });
    expect(second.output_text).toBe('The sum is 5.');
    expect(f.executed[1]).toEqual({ messages: historyOf(call.call_id), settings: settingsOf('auto') });
    await f.settled(2);
    await expectReceipt(f, 1, historyOf(call.call_id), settingsOf('auto'));
  } finally { await f.close(); }
});

withOpenAI('streams the round trip through the OpenAI SDK Responses client with function-call events', async () => {
  const f = await trip.open();
  try {
    const events = [];
    for await (const event of await openai(f).responses.create({ model: f.model.id, store: false, input: [user], tools: responseTools,
      tool_choice: { type: 'function', name: 'add' }, stream: true })) events.push(event);
    expect(events.map(event => event.type)).toEqual(['response.created', 'response.in_progress', 'response.output_item.added',
      'response.function_call_arguments.delta', 'response.function_call_arguments.done', 'response.output_item.done', 'response.completed']);
    expect(events.map(event => event.sequence_number)).toEqual(events.map((_, index) => index));
    const item = events[2].item;
    expect(item).toMatchObject({ type: 'function_call', status: 'in_progress', name: 'add', arguments: '' });
    expect(events[3]).toMatchObject({ item_id: item.id, output_index: 0, delta: '{"a":2,"b":3}' });
    expect(events[4]).toMatchObject({ item_id: item.id, output_index: 0, arguments: '{"a":2,"b":3}' });
    expect(events[5].item).toEqual({ ...item, status: 'completed', arguments: '{"a":2,"b":3}' });
    expect(events[6].response).toMatchObject({ status: 'completed', output: [events[5].item] });
    await f.settled(1);
    await expectReceipt(f, 0, [user], settingsOf({ name: 'add' }));

    const stream = openai(f).responses.stream({ model: f.model.id, store: false, tools: responseTools, input: [user, events[5].item, outputOf(item, '5')] });
    const text = [];
    stream.on('response.output_text.delta', event => text.push(event.delta));
    const final = await stream.finalResponse();
    expect(final).toMatchObject({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'The sum is 5.' }] }] });
    expect(text.join('')).toBe('The sum is 5.');
    expect(text.length).toBeGreaterThan(1);
    await f.settled(2);
  } finally { await f.close(); }
});

it('ends a call cut off at the model ceiling as max_tokens or incomplete, with nothing executable', async () => {
  // A Messages or Responses limit cannot lower a whole-model ceiling, so the ceiling itself is small here.
  const small = createToolRoundTrip({ ceiling: 8 });
  await small.setup();
  try {
    const f = await small.open();
    try {
      for (const stream of [false, true]) {
        const response = await f.post('/messages', { model: f.model.id, max_tokens: 1024, messages: [user], tools: anthropicTools, tool_choice: { type: 'any' }, stream });
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).not.toContain('tool_use');
        if (!stream) expect(JSON.parse(text)).toMatchObject({ content: [], stop_reason: 'max_tokens', usage: { output_tokens: 8 } });
        else expect(sse(text).map(event => event.type)).toEqual(['message_start', 'message_delta', 'message_stop']);
      }
      for (const stream of [false, true]) {
        const response = await f.post('/responses', { model: f.model.id, store: false, input: [user], tools: responseTools, tool_choice: 'required', stream });
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).not.toContain('function_call');
        const final = stream ? sse(text).at(-1).response : JSON.parse(text);
        expect(final).toMatchObject({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [], completed_at: null });
        if (stream) expect(sse(text).map(event => event.type)).toEqual(['response.created', 'response.in_progress', 'response.incomplete']);
      }
      await f.settled(4);
    } finally { await f.close(); }
  } finally { await small.teardown(); }
});

it('never surfaces an invalid call through Messages or Responses, and refuses unsupported schemas before any reservation', async () => {
  const f = await trip.open({ plan: () => [callText('add', '{"a": "two", "b": 3}')], unmasked: true });
  try {
    const invalid = { ...addTool.parameters, properties: { a: { type: 'integer', minimum: 0 }, b: { type: 'integer' } } };
    const refusedMessages = await f.post('/messages', { model: f.model.id, max_tokens: 1024, messages: [user], tools: [{ ...anthropicTools[0], input_schema: invalid }] });
    expect(refusedMessages.status).toBe(400);
    expect(await refusedMessages.json()).toMatchObject({ type: 'error', error: { type: 'invalid_request_error', message: expect.stringContaining('Tool "add": Unsupported JSON Schema keyword "minimum"') } });
    const refusedResponses = await f.post('/responses', { model: f.model.id, store: false, input: [user], tools: [{ ...responseTools[0], parameters: invalid }] });
    expect(refusedResponses.status).toBe(400);
    expect((await refusedResponses.json()).error).toMatchObject({ param: 'tools[0].parameters', message: expect.stringContaining('Unsupported JSON Schema keyword "minimum"') });
    expect(f.reservations).toEqual([]);

    for (const [route, body] of [['/messages', { max_tokens: 1024, messages: [user], tools: anthropicTools, tool_choice: { type: 'any' } }],
      ['/responses', { store: false, input: [user], tools: responseTools, tool_choice: 'required' }]]) {
      for (const stream of [false, true]) {
        const response = await f.post(route, { model: f.model.id, ...body, stream });
        // A streamed Messages response has already opened with the provider's early input count, so
        // its refusal is the stream's error event; nothing of the call follows the opening.
        const opened = stream && route === '/messages';
        expect(response.status).toBe(opened ? 200 : 502);
        const text = await response.text();
        if (opened) expect(sse(text).map(event => event.type)).toEqual(['message_start', 'error']);
        expect(text).toContain('Provider output violates the generation settings of this request');
        expect(text).not.toContain('two');
      }
    }
    // Refused before countersigning: nothing was charged, and each refused request keeps its hold
    // until the provider signs cleanup or the claim window passes.
    expect(f.journal()).toEqual([]);
    expect(f.amounts()[0].balance).toBe(0);
    expect(f.amounts()[0].held).toBeGreaterThan(0);
  } finally { await f.close(); }
});
