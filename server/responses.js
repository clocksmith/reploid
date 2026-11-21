/** Stateless Responses protocol with client function tools. No response store, continuation lookup or hosted tools. */
import { randomUUID } from 'node:crypto';
import { canonicalTextRequest, parseTextChatCompletion, stripDescriptiveKeywords } from './chat-completions.js';
import { createTextRequester, fail, object, freeze } from './text-requester.js';
import policy from '../apps/poolday/config/partition-policy.json' with { type: 'json' };
import { parseRequesterBinding } from './text-request-options.js';

const MAX_CALL_ID = 128, ARGUMENT_FRAGMENT = 96;

/** Function tools as declared, kept for the response's `tools` echo, with descriptive schema keywords dropped. */
function parseTools(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 16) throw fail(400, 'tools must be a list of at most 16 function tools', 'tools');
  return value.map((tool, index) => {
    if (!object(tool) || tool.type !== 'function' || Object.keys(tool).some(key => !['type', 'name', 'description', 'parameters', 'strict'].includes(key))
      || ![undefined, null, true, false].includes(tool.strict) || !(tool.parameters == null || object(tool.parameters))) {
      throw fail(400, 'Only function tools with name, description, parameters and strict are supported', `tools[${index}]`);
    }
    // Arguments are always constrained to the schema, whatever `strict` says. No parameters means no arguments.
    return { type: 'function', name: tool.name, description: tool.description ?? null,
      parameters: stripDescriptiveKeywords(tool.parameters ?? { type: 'object', properties: {} }), strict: tool.strict ?? null };
  });
}

function parseToolChoice(value) {
  if (value === undefined || value === null) return undefined;
  if (['auto', 'none', 'required'].includes(value)) return value;
  if (object(value) && value.type === 'function' && typeof value.name === 'string' && Object.keys(value).every(key => ['type', 'name'].includes(key))) {
    return { name: value.name };
  }
  throw fail(400, "tool_choice must be 'auto', 'none', 'required' or { type: 'function', name }", 'tool_choice');
}

/** Input items as canonical messages. A `function_call` joins the assistant turn it follows (its
 * text, or its earlier calls) or opens one; a `function_call_output` is that call's tool result. */
function convertItems(items) {
  const messages = [];
  items.forEach((item, index) => {
    const param = `input[${index}]`;
    if (!object(item)) throw fail(400, 'Only message, function_call and function_call_output inputs are supported', param);
    if (item.type === undefined || item.type === 'message') {
      if (Object.keys(item).some(key => !['type', 'role', 'content'].includes(key)) || !['system', 'user', 'assistant'].includes(item.role)
        || typeof item.content !== 'string') throw fail(400, 'Only system/user/assistant string-content messages are supported', param);
      messages.push({ role: item.role, content: item.content });
      return;
    }
    const extra = Object.keys(item).some(key => !['type', 'id', 'status', 'call_id', item.type === 'function_call' ? 'name' : 'output',
      ...(item.type === 'function_call' ? ['arguments'] : [])].includes(key));
    if (!['function_call', 'function_call_output'].includes(item.type) || extra || typeof item.call_id !== 'string' || !item.call_id
      || item.call_id.length > MAX_CALL_ID) throw fail(400, 'Only message, function_call and function_call_output inputs are supported', param);
    if (item.type === 'function_call_output') {
      if (typeof item.output !== 'string') throw fail(400, 'A function_call_output needs string output', param);
      messages.push({ role: 'tool', toolCallId: item.call_id, content: item.output });
      return;
    }
    let parsed;
    try { parsed = JSON.parse(item.arguments); } catch { parsed = undefined; }
    if (typeof item.name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(item.name) || typeof item.arguments !== 'string' || !object(parsed)) {
      throw fail(400, 'A function_call needs a name and arguments that are a JSON object encoded as a string', param);
    }
    const call = { id: item.call_id, name: item.name, arguments: parsed }, turn = messages.at(-1);
    if (turn?.role === 'assistant') messages[messages.length - 1] = { ...turn, toolCalls: [...(turn.toolCalls ?? []), call] };
    else messages.push({ role: 'assistant', content: '', toolCalls: [call] });
  });
  return messages;
}

export function parseTextResponse(body) {
  if (!object(body)) throw fail(400, 'A JSON object is required');
  for (const key of Object.keys(body)) {
    if (!['model', 'input', 'instructions', 'store', 'stream', 'max_output_tokens', 'text', 'reploid', 'tools', 'tool_choice', 'parallel_tool_calls'].includes(key)) {
      throw fail(400, `Unsupported parameter: ${key}`, key);
    }
  }
  if (body.store !== false) throw fail(400, 'Stateless Responses requires explicit store:false', 'store');
  if (body.instructions !== undefined && body.instructions !== null && typeof body.instructions !== 'string') throw fail(400, 'instructions must be text', 'instructions');
  if (body.max_output_tokens !== undefined && (!Number.isSafeInteger(body.max_output_tokens)
    || body.max_output_tokens <= 0 || body.max_output_tokens > policy.limits.maxTokens)) {
    throw fail(400, 'max_output_tokens must fit the prepared route budget', 'max_output_tokens');
  }
  const jsonObject = body.text !== undefined;
  if (jsonObject && (!object(body.text) || Object.keys(body.text).join() !== 'format'
    || !object(body.text.format) || Object.keys(body.text.format).join() !== 'type' || body.text.format.type !== 'json_object')) {
    throw fail(400, 'Only text.format.type json_object is supported', 'text');
  }
  // Accepted for compatibility. A forced call is constrained to exactly one call either way.
  if (![undefined, null, true, false].includes(body.parallel_tool_calls)) throw fail(400, 'parallel_tool_calls must be boolean', 'parallel_tool_calls');
  const tools = parseTools(body.tools), toolChoice = parseToolChoice(body.tool_choice);
  const tooling = tools.length > 0 || toolChoice !== undefined;
  // A JSON-object answer and a tool call are two different shapes of one output; only one can be asked for.
  if (tooling && jsonObject) throw fail(400, 'text.format json_object cannot be combined with tools', 'text');
  const prefix = [...(jsonObject ? [{ role: 'system', content: 'Return exactly one valid JSON object. No markdown fences or commentary.' }] : []),
    ...(typeof body.instructions === 'string' ? [{ role: 'system', content: body.instructions }] : [])];
  let messages;
  if (typeof body.input === 'string') messages = [{ role: 'user', content: body.input }];
  else if (!Array.isArray(body.input) || !body.input.length || body.input.length > 128) throw fail(400, 'Text input or text messages required', 'input');
  else if (tooling) messages = convertItems(body.input);
  else messages = body.input.map((value, index) => {
    if (!object(value) || Object.keys(value).some(key => !['type', 'role', 'content'].includes(key))
      || value.type !== undefined && value.type !== 'message') throw fail(400, 'Only text message inputs are supported', `input[${index}]`);
    return { role: value.role, content: value.content };
  });
  messages = [...prefix, ...messages];
  // Without tools this is the text contract unchanged, and no settings.
  const parsed = !tooling ? parseTextChatCompletion({ model: body.model, messages, stream: body.stream })
    : canonicalTextRequest({ model: body.model, stream: body.stream, messages, convert: message => message, toolChoice,
      tools: tools.map(tool => ({ name: tool.name, ...(tool.description === null ? {} : { description: tool.description }), parameters: tool.parameters })),
      toolParam: index => `tools[${index}].parameters` });
  return freeze({ ...parsed, instructions: body.instructions ?? null, jsonObject,
    // The declared tools and choice, echoed in the response object as the protocol does.
    ...(parsed.settings?.tools.length ? { declaredTools: tools, declaredToolChoice: body.tool_choice ?? 'auto', parallelToolCalls: body.parallel_tool_calls ?? true } : {}),
    ...(body.max_output_tokens === undefined ? {} : { generationRequest: {
      schema: 'reploid.partition-generation-request/v1', maxOutputTokens: body.max_output_tokens, usage: 'raw-model-tokens/v1',
    } }), ...(body.reploid === undefined ? {} : { reploid: parseRequesterBinding(body.reploid) }) });
}

export function createResponses(options) {
  return createTextRequester(options, { path: '/v1/responses', idPrefix: 'resp_', parse: parseTextResponse,
    output({ id, created, model, input, write, end, json }) {
      const itemId = 'msg_' + randomUUID().replaceAll('-', '');
      const tooling = Boolean(input.declaredTools);
      let begun = false, started = false, sequence = 0, observedUsage, cachedInputTokens = 0;
      const part = text => ({ type: 'output_text', text, annotations: [], logprobs: [] });
      const item = (text, status) => ({ id: itemId, type: 'message', role: 'assistant', status, content: [part(text)] });
      const callItem = (call, status, encoded) => ({ id: 'fc_' + call.id.replace(/^call_/, ''), type: 'function_call', status,
        call_id: call.id, name: call.name, arguments: encoded });
      const response = (status, output = []) => ({ id, object: 'response', created_at: created, model, status,
        store: false, background: false, error: null, incomplete_details: status === 'incomplete' ? { reason: 'max_output_tokens' } : null,
        instructions: input.instructions, output, tools: input.declaredTools ?? [], tool_choice: input.declaredToolChoice ?? 'none',
        parallel_tool_calls: input.parallelToolCalls ?? false,
        temperature: null, top_p: null, metadata: null, access_programs: null, previous_response_id: null,
        text: { format: { type: input.jsonObject ? 'json_object' : 'text' } },
        ...(observedUsage ? { usage: { input_tokens: observedUsage.inputTokens, output_tokens: observedUsage.outputTokens,
          total_tokens: observedUsage.inputTokens + observedUsage.outputTokens,
          ...(cachedInputTokens > 0 ? { input_tokens_details: { cached_tokens: cachedInputTokens } } : {}) } } : {}) });
      const frame = (type, value) => `event: ${type}\ndata: ${JSON.stringify({ ...value, type, sequence_number: sequence++ })}\n\n`;
      const event = (type, value) => write(frame(type, value));
      const position = { item_id: itemId, output_index: 0, content_index: 0 };
      const begin = () => {
        if (begun) return; begun = true;
        event('response.created', { response: response('in_progress') });
        event('response.in_progress', { response: response('in_progress') });
      };
      const start = () => {
        if (started) return; begin(); started = true;
        event('response.output_item.added', { output_index: 0, item: { ...item('', 'in_progress'), content: [] } });
        event('response.content_part.added', { ...position, part: part('') });
      };
      return {
        usage(value) { observedUsage = value; },
        delta(text) { start(); event('response.output_text.delta', { ...position, delta: text, logprobs: [] }); },
        complete(content, finishReason, reason, usage, evidence, toolCalls = [], timing = null) {
          // The Responses incomplete enum has no context-limit member. Do not
          // rename a context limit to an output-token budget or successful stop.
          if (reason === 'context-limit') throw fail(502, 'Requester stopped at its context limit');
          if (input.jsonObject) {
            let parsed;
            try { parsed = JSON.parse(content); } catch { throw fail(502, 'Requester did not return a JSON object'); }
            if (!object(parsed)) throw fail(502, 'Requester did not return a JSON object');
          }
          observedUsage = usage;
          cachedInputTokens = Number.isSafeInteger(timing?.reusedPrefixTokens) && timing.reusedPrefixTokens > 0
            ? timing.reusedPrefixTokens : 0;
          const status = finishReason === 'length' ? 'incomplete' : 'completed';
          // With tools declared, an answer holds a message item only when there is text; a call is a function_call item.
          const finalItem = tooling && !content ? null : item(content, status);
          const calls = toolCalls.map(call => callItem(call, 'completed', JSON.stringify(call.arguments)));
          const final = response(status, [...(finalItem ? [finalItem] : []), ...calls]);
          if (evidence) final.reploid = evidence;
          final.completed_at = status === 'completed' ? Math.floor(Date.now() / 1000) : null;
          if (!input.stream) { json(final); return; }
          begin();
          if (finalItem) {
            start();
            event('response.output_text.done', { ...position, text: content, logprobs: [] });
            event('response.content_part.done', { ...position, part: part(content) });
            event('response.output_item.done', { output_index: 0, item: finalItem });
          }
          // A call arrives here whole and validated: its item opens with empty arguments, which follow as fragments.
          calls.forEach((call, offset) => {
            const at = { item_id: call.id, output_index: offset + (finalItem ? 1 : 0) };
            event('response.output_item.added', { output_index: at.output_index, item: { ...call, status: 'in_progress', arguments: '' } });
            for (let index = 0; index < call.arguments.length; index += ARGUMENT_FRAGMENT) {
              event('response.function_call_arguments.delta', { ...at, delta: call.arguments.slice(index, index + ARGUMENT_FRAGMENT) });
            }
            event('response.function_call_arguments.done', { ...at, name: call.name, arguments: call.arguments });
            event('response.output_item.done', { output_index: at.output_index, item: call });
          });
          event(status === 'completed' ? 'response.completed' : 'response.incomplete', { response: final });
          end();
        },
        error(error) { end(frame('error', { code: error.code || 'server_error', message: String(error.message).slice(0, 1024), param: error.param })); }
      };
    }
  });
}
