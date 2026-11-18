/** Text Chat Completions protocol over the existing authenticated HTTP requester. */
import policy from '../apps/poolday/config/partition-policy.json' with { type: 'json' };
import { createTextRequester, fail, object, freeze } from './text-requester.js';
import { normalizeGenerationSettings } from '../packages/reploid/src/mesh/generation-settings.js';
import { assertSupportedSchema } from '../shared/infrastructure/output-constraint.js';

const DESCRIPTIVE_KEYWORDS = ['$schema', '$id', '$comment', 'default', 'examples'];
const MAX_TOOL_CALL_ID = 128, ARGUMENT_FRAGMENT = 96;

/** A copy of a tool's JSON Schema without the keywords that describe a value and never change
 * which values are valid. The constraint engine refuses them by name; every other keyword it
 * does not support still reaches it and is refused. Property names are never touched. */
export function stripDescriptiveKeywords(schema) {
  if (!object(schema)) return schema;
  const copy = {};
  for (const [key, value] of Object.entries(schema)) {
    if (DESCRIPTIVE_KEYWORDS.includes(key)) continue;
    if (key === 'properties' && object(value)) copy[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, stripDescriptiveKeywords(child)]));
    else copy[key] = key === 'items' ? stripDescriptiveKeywords(value) : value;
  }
  return copy;
}

/** Canonical generation settings from tool declarations in any protocol's shape, already reduced
 * to `{ name, description, parameters }`. `label(index)` names a tool's parameter in errors. A
 * schema outside the engine's subset is a 400 that names the keyword and the tool. */
export function toolSettings({ tools, toolChoice, maxOutputTokens }, label = index => `tools[${index}]`) {
  // Without tools, 'none' is already the default: it adds nothing to the request.
  if (!tools.length && toolChoice === 'none') toolChoice = undefined;
  if (maxOutputTokens === undefined && !tools.length && toolChoice === undefined) return undefined;
  const assertSchema = (schema, path) => {
    const index = Number(/^tools\[(\d+)\]/.exec(path)?.[1]), name = tools[index]?.name;
    try {
      assertSupportedSchema(schema);
      if (schema.type !== 'object' || Object.hasOwn(schema, 'enum') || Object.hasOwn(schema, 'const')) throw Error('the parameters must be an object schema');
    } catch (error) { throw fail(400, `Tool "${name}": ${error.message}`, label(index)); }
  };
  try {
    return normalizeGenerationSettings({ ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
      ...(tools.length ? { tools } : {}), ...(toolChoice === undefined ? {} : { toolChoice }) }, { assertSchema });
  } catch (error) {
    if (error.status && error.code !== 'INVALID_GENERATION_SETTINGS') throw error;
    throw fail(400, error.message, error.param ?? null);
  }
}

/** Canonical messages checked for the one tool-call rule every protocol shares: the results that
 * follow an assistant message answer each of its calls exactly once. Results are put in call
 * order, because the rendered conversation pairs results with calls by position. */
export function orderToolResults(messages) {
  const ordered = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === 'tool') throw fail(400, 'A tool result must follow the assistant message that made its call', `messages[${index}]`);
    ordered.push(message);
    const calls = message.toolCalls;
    if (!calls) continue;
    const results = [];
    while (messages[index + 1]?.role === 'tool') results.push(messages[++index]);
    const byId = new Map(results.map(result => [result.toolCallId, result]));
    if (new Set(calls.map(call => call.id)).size !== calls.length || byId.size !== results.length
      || results.length !== calls.length || calls.some(call => !byId.has(call.id))) {
      throw fail(400, 'Each tool call needs exactly one tool result with its id, directly after the assistant message', `messages[${index}]`);
    }
    for (const call of calls) ordered.push(byId.get(call.id));
  }
  return ordered;
}

function parseTools(body) {
  if (body.tools === undefined || body.tools === null) return [];
  if (!Array.isArray(body.tools) || body.tools.length > 16) throw fail(400, 'tools must be a list of at most 16 function tools', 'tools');
  return body.tools.map((tool, index) => {
    const param = `tools[${index}]`, declared = tool?.function;
    if (!object(tool) || tool.type !== 'function' || Object.keys(tool).some(key => !['type', 'function'].includes(key)) || !object(declared)
      || Object.keys(declared).some(key => !['name', 'description', 'parameters', 'strict'].includes(key))
      || ![undefined, null, true, false].includes(declared.strict)) {
      throw fail(400, 'Only function tools with name, description, parameters and strict are supported', param);
    }
    if (declared.parameters !== undefined && !object(declared.parameters)) throw fail(400, 'Tool parameters must be a JSON Schema object', param);
    // Arguments are always constrained to the schema, whatever `strict` says. No parameters means no arguments.
    return { name: declared.name, ...(declared.description == null ? {} : { description: declared.description }),
      parameters: stripDescriptiveKeywords(declared.parameters ?? { type: 'object', properties: {} }) };
  });
}

function parseToolChoice(value) {
  if (value === undefined || value === null) return undefined;
  if (['auto', 'none', 'required'].includes(value)) return value;
  if (object(value) && value.type === 'function' && Object.keys(value).every(key => ['type', 'function'].includes(key))
    && object(value.function) && Object.keys(value.function).join() === 'name' && typeof value.function.name === 'string') {
    return { name: value.function.name };
  }
  throw fail(400, "tool_choice must be 'auto', 'none', 'required' or { type: 'function', function: { name } }", 'tool_choice');
}

function parseMessage(message, index) {
  const param = `messages[${index}]`;
  const unsupported = () => fail(400, 'Only system/user/assistant/tool messages with string content are supported', param);
  if (!object(message)) throw unsupported();
  const keys = Object.keys(message);
  if (message.role === 'tool') {
    if (keys.some(key => !['role', 'content', 'tool_call_id'].includes(key)) || typeof message.content !== 'string') throw unsupported();
    if (typeof message.tool_call_id !== 'string' || !message.tool_call_id || message.tool_call_id.length > MAX_TOOL_CALL_ID) {
      throw fail(400, 'A tool message needs the tool_call_id it answers', param);
    }
    return { role: 'tool', toolCallId: message.tool_call_id, content: message.content };
  }
  if (message.role === 'assistant' && (message.tool_calls != null || message.refusal !== undefined)) {
    // An assistant message as this API returned it: `refusal` is always null and `content` is null beside calls.
    if (keys.some(key => !['role', 'content', 'tool_calls', 'refusal'].includes(key)) || message.refusal != null) throw unsupported();
    if (message.tool_calls == null) {
      if (typeof message.content !== 'string') throw unsupported();
      return { role: 'assistant', content: message.content };
    }
    if (message.content !== null && message.content !== undefined && typeof message.content !== 'string') throw unsupported();
    if (!Array.isArray(message.tool_calls) || !message.tool_calls.length || message.tool_calls.length > 16) {
      throw fail(400, 'tool_calls must list 1–16 function calls', param);
    }
    const toolCalls = message.tool_calls.map((call, position) => {
      const at = `${param}.tool_calls[${position}]`;
      if (!object(call) || call.type !== 'function' || Object.keys(call).some(key => !['id', 'type', 'function'].includes(key))
        || typeof call.id !== 'string' || !call.id || call.id.length > MAX_TOOL_CALL_ID || !object(call.function)
        || Object.keys(call.function).some(key => !['name', 'arguments'].includes(key))
        || typeof call.function.name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(call.function.name)
        || typeof call.function.arguments !== 'string') {
        throw fail(400, 'A tool call needs an id, type function, a function name and an arguments JSON string', at);
      }
      let parsed;
      try { parsed = JSON.parse(call.function.arguments); } catch { parsed = undefined; }
      if (!object(parsed)) throw fail(400, 'Tool call arguments must be a JSON object encoded as a string', at);
      return { id: call.id, name: call.function.name, arguments: parsed };
    });
    return { role: 'assistant', content: message.content ?? '', toolCalls };
  }
  if (keys.some(key => !['role', 'content'].includes(key)) || !['system', 'user', 'assistant'].includes(message.role)
    || typeof message.content !== 'string') throw unsupported();
  return { role: message.role, content: message.content };
}

// The mesh refuses these keys in anything it carries, so arguments holding one are refused here, as a 400.
const hasReservedKey = value => value !== null && typeof value === 'object' && (Array.isArray(value) ? value.some(hasReservedKey)
  : Object.keys(value).some(key => ['__proto__', 'prototype', 'constructor'].includes(key) || hasReservedKey(value[key])));

/**
 * The checks every protocol shares, after its own shapes are read. `convert(message, index)` turns
 * one wire message into one canonical message or a list of them; `tools` are already
 * `{ name, description, parameters }`. The result is the frozen request the text requester takes:
 * `{ model, messages, stream }` and, only when a limit or tools were given, `settings`.
 */
export function canonicalTextRequest({ model, stream, messages, convert, tools = [], toolChoice, maxOutputTokens, toolParam }) {
  if (typeof model !== 'string' || !model.trim() || model.length > 256) throw fail(400, 'A bounded model id is required', 'model');
  if (stream !== undefined && typeof stream !== 'boolean') throw fail(400, 'stream must be boolean', 'stream');
  if (!Array.isArray(messages) || !messages.length || messages.length > 128) throw fail(400, 'Require 1–128 text messages', 'messages');
  const settings = toolSettings({ tools, toolChoice, maxOutputTokens }, toolParam);
  let characters = 0, toolMessages = false;
  const canonical = messages.flatMap((message, index) => [convert(message, index)].flat().map(parsed => {
    characters += parsed.content.length + (parsed.toolCalls ? JSON.stringify(parsed.toolCalls).length : 0);
    if (characters > policy.inputLimits.maxInputCharacters) throw fail(413, 'Input text limit exceeded', 'messages');
    toolMessages ||= parsed.role === 'tool' || parsed.toolCalls !== undefined;
    if (hasReservedKey(parsed.toolCalls)) throw fail(400, 'Tool call arguments use a reserved key', `messages[${index}]`);
    return parsed;
  }));
  if (canonical.length > 128) throw fail(400, 'Require 1–128 text messages', 'messages');
  // Tool calls and results are readable to a model only through the declared tool-call format, which
  // a route advertises as the `tools` setting. Declaring the tools is what selects such a route.
  if (toolMessages && !tools.length) throw fail(400, 'Messages with tool calls or tool results require the tools they refer to', 'tools');
  return freeze({ model, messages: toolMessages ? orderToolResults(canonical) : canonical, stream: stream === true,
    ...(settings === undefined ? {} : { settings }) });
}

export function parseTextChatCompletion(body) {
  if (!object(body)) throw fail(400, 'A JSON object is required');
  for (const key of Object.keys(body)) {
    if (!['model', 'messages', 'stream', 'max_completion_tokens', 'max_tokens', 'tools', 'tool_choice', 'parallel_tool_calls'].includes(key)) {
      throw fail(400, `Unsupported parameter: ${key}`, key);
    }
  }
  // The caller's output limit and its tools are the generation settings this protocol accepts. They
  // become one settings object that the provider enforces; `max_tokens` is the older name of the limit.
  let maxOutputTokens;
  for (const key of ['max_completion_tokens', 'max_tokens']) {
    if (body[key] === undefined) continue;
    if (!Number.isSafeInteger(body[key]) || body[key] <= 0 || body[key] > policy.limits.maxTokens) {
      throw fail(400, `${key} must be a positive integer within the route budget`, key);
    }
    if (maxOutputTokens !== undefined && maxOutputTokens !== body[key]) throw fail(400, 'max_completion_tokens and max_tokens differ', key);
    maxOutputTokens = body[key];
  }
  // Accepted for compatibility. A forced call is constrained to exactly one call either way.
  if (![undefined, null, true, false].includes(body.parallel_tool_calls)) throw fail(400, 'parallel_tool_calls must be boolean', 'parallel_tool_calls');
  return canonicalTextRequest({ model: body.model, stream: body.stream, messages: body.messages, convert: parseMessage,
    tools: parseTools(body), toolChoice: parseToolChoice(body.tool_choice), maxOutputTokens,
    toolParam: index => `tools[${index}].function.parameters` });
}

/** Tool calls in the Chat Completions result shape; arguments are a JSON string. */
const callsOut = toolCalls => toolCalls.map(call => ({ id: call.id, type: 'function',
  function: { name: call.name, arguments: JSON.stringify(call.arguments) } }));

export function createChatCompletions(options) {
  return createTextRequester(options, { path: '/v1/chat/completions', idPrefix: 'chatcmpl-', parse: parseTextChatCompletion,
    output({ id, created, model, input, write, end, json }) {
      let started = false;
      const chunk = (delta, finishReason = null, usage = undefined) => write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, ...(usage ? { usage } : {}),
        choices: [{ index: 0, delta, logprobs: null, finish_reason: finishReason }] })}\n\n`);
      return {
        delta(text) { chunk({ ...(started ? {} : { role: 'assistant' }), content: text }); started = true; },
        complete(content, finishReason, _reason, measured, _evidence, toolCalls = []) {
          const usage = measured ? { prompt_tokens: measured.inputTokens, completion_tokens: measured.outputTokens,
            total_tokens: measured.inputTokens + measured.outputTokens } : undefined;
          const calls = callsOut(toolCalls);
          // With tools declared, an answer without text has `content: null`, as a call does.
          const text = input.settings?.tools.length && !content ? null : content;
          if (!input.stream) {
            json({ id, object: 'chat.completion', created, model, ...(usage ? { usage } : {}),
              choices: [{ index: 0, message: { role: 'assistant', content: text, refusal: null, ...(calls.length ? { tool_calls: calls } : {}) },
                logprobs: null, finish_reason: finishReason }] });
            return;
          }
          // Calls arrive here whole and validated: each is announced with its id and name, then its
          // arguments follow in fragments, as a client's accumulator expects.
          calls.forEach((call, index) => {
            chunk({ ...(started ? {} : { role: 'assistant', content: null }),
              tool_calls: [{ index, id: call.id, type: 'function', function: { name: call.function.name, arguments: '' } }] });
            started = true;
            for (let at = 0; at < call.function.arguments.length; at += ARGUMENT_FRAGMENT) {
              chunk({ tool_calls: [{ index, function: { arguments: call.function.arguments.slice(at, at + ARGUMENT_FRAGMENT) } }] });
            }
          });
          chunk({}, finishReason, usage); end('data: [DONE]\n\n');
        },
        error(error) { end(`data: ${JSON.stringify({ error })}\n\n`); }
      };
    }
  });
}
